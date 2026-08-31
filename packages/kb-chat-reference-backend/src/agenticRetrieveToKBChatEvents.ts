// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { AgenticRetrieveStreamResponseOutput } from '@aws-sdk/client-bedrock-agent-runtime';
import type { KBChatEvent } from '@sample/kb-chat-core';

/**
 * Adapts an AgenticRetrieveStreamCommand response stream into KBChatEvents,
 * including `stage` progress events for the multi-step retrieval loop. Stage labels
 * mirror the KB console's own agentic-retrieval trace UI (confirmed against
 * AWSC-Bedrock-Knowledge-Bases-Module's useAgenticRetrieveStream.tsx / en.json):
 *   "Iteration {N} in progress..." -> "Iteration {N} completed in {s}s. ..."
 *   -> "Speculative retrieval in progress..." -> "...completed in {s}s. ..."
 *   -> "Thought for {s}s" once generation starts.
 * Unconfirmed step/status combinations fall back to the API's own human-readable
 * `attributes.message` rather than inventing new copy.
 */
export async function* fromAgenticRetrieveStream(
  stream: AsyncIterable<AgenticRetrieveStreamResponseOutput>,
): AsyncGenerator<KBChatEvent> {
  let iteration = 0;
  let planningStartedAt: number | null = null;
  let speculativeStartedAt: number | null = null;
  let thinkingStartedAt: number | null = null;
  let hasStartedAnswer = false;

  for await (const chunk of stream) {
    if (chunk.traceEvent?.attributes) {
      const { step, status, message, retrievalResponse } = chunk.traceEvent.attributes;
      const timestamp = chunk.traceEvent.timestamp ?? Date.now();
      thinkingStartedAt ??= timestamp;
      const chunkCount = retrievalResponse?.length;

      if (step === 'Planning' && status === 'IN_PROGRESS') {
        iteration += 1;
        planningStartedAt = timestamp;
        yield {
          type: 'stage',
          label: `Iteration ${iteration} in progress...`,
          live: true,
        };
      } else if (step === 'Retrieval' && status === 'SUCCEEDED') {
        const elapsed =
          planningStartedAt !== null
            ? Math.round((timestamp - planningStartedAt) / 1000)
            : 0;
        const countText =
          chunkCount !== undefined
            ? `${chunkCount} chunks were retrieved and reranked.`
            : 'Retrieval complete.';
        yield {
          type: 'stage',
          label: `Iteration ${iteration} completed in ${elapsed}s. ${countText}`,
          live: false,
        };
      } else if (step === 'SpeculativeRetrieval' && status === 'IN_PROGRESS') {
        speculativeStartedAt = timestamp;
        yield {
          type: 'stage',
          label: 'Speculative retrieval in progress...',
          live: true,
        };
      } else if (step === 'SpeculativeRetrieval' && status === 'SUCCEEDED') {
        const elapsed =
          speculativeStartedAt !== null
            ? Math.round((timestamp - speculativeStartedAt) / 1000)
            : 0;
        const countText =
          chunkCount !== undefined
            ? `${chunkCount} chunks were retrieved.`
            : 'Retrieval complete.';
        yield {
          type: 'stage',
          label: `Speculative retrieval completed in ${elapsed}s. ${countText}`,
          live: false,
        };
      } else if (status === 'FAILED') {
        yield { type: 'stage', label: message || `${step} failed.`, live: false };
      } else {
        yield {
          type: 'stage',
          label: message || `${step}...`,
          live: status === 'IN_PROGRESS',
        };
      }
      continue;
    }

    if (chunk.responseEvent) {
      if (!hasStartedAnswer) {
        hasStartedAnswer = true;
        if (thinkingStartedAt !== null) {
          const thoughtSeconds = Math.round((Date.now() - thinkingStartedAt) / 1000);
          yield { type: 'stage', label: `Thought for ${thoughtSeconds}s`, live: false };
        }
      }
      yield { type: 'text', delta: chunk.responseEvent.text ?? '' };
      continue;
    }

    if (chunk.result) {
      const { results, generatedResponse } = chunk.result;
      for (const [index, item] of (results ?? []).entries()) {
        // The document's title/URI live in the result's `metadata`, not in
        // `sourceRetriever` (which only carries the retriever's `identifier`, i.e. the
        // Knowledge Base ID). Bedrock KB exposes standard `_`-prefixed metadata keys;
        // fall back progressively so a source always has a usable title.
        const metadata = (item.metadata ?? {}) as Record<string, unknown>;
        const asString = (value: unknown): string | undefined =>
          typeof value === 'string' ? value : undefined;
        const uri =
          asString(metadata['_source_uri']) ?? asString(metadata['_document_id']) ?? '';
        const title =
          asString(metadata['_document_title']) ??
          // Last resort: the file name from the URI, never the bare KB ID.
          (uri ? uri.split('/').pop() || uri : undefined) ??
          `Source ${index + 1}`;

        // Identifiers for an on-demand GetDocumentContent call (fresh pre-signed URL).
        // Only attach `source` when all three are present, so the client can rely on
        // it being complete. `sourceRetriever.identifier` is the Knowledge Base ID.
        const knowledgeBaseId = item.sourceRetriever?.identifier;
        const dataSourceId = asString(metadata['_data_source_id']);
        const documentId = asString(metadata['_document_id']);
        const source =
          knowledgeBaseId && dataSourceId && documentId
            ? { knowledgeBaseId, dataSourceId, documentId }
            : undefined;

        yield {
          type: 'snippet',
          snippet: {
            id: `result-${index}`,
            title,
            uri,
            excerpt: item.content?.text ?? '',
            ...(source ? { source } : {}),
          },
        };
      }
      for (const [index, citation] of (generatedResponse?.citations ?? []).entries()) {
        for (const ref of citation.references ?? []) {
          yield {
            type: 'citation',
            citation: {
              id: `citation-${index}-${ref.resultIndex}`,
              snippetId: `result-${ref.resultIndex}`,
            },
          };
        }
      }
      if (generatedResponse?.answer && !hasStartedAnswer) {
        // generateResponse:false path never sends responseEvent chunks — surface the
        // full answer at once rather than silently dropping it.
        yield { type: 'text', delta: generatedResponse.answer };
      }
      return;
    }
  }
}
