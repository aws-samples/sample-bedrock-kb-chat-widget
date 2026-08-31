// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type {
  Citation as BedrockCitation,
  RetrieveAndGenerateStreamResponseOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { KBChatEvent } from '@sample/kb-chat-core';

/**
 * Bedrock's `citations` array bundles a generated-text segment with its retrieved
 * references in one object. kb-chat-core's wire format wants those as separate
 * snippet/citation events, so each Bedrock citation is fanned out into one snippet
 * event per reference plus a citation event linking to it.
 */
function* fromBedrockCitations(
  citations: BedrockCitation[] | undefined,
): Generator<KBChatEvent> {
  if (!citations) return;

  for (const [citationIndex, citation] of citations.entries()) {
    const references = citation.retrievedReferences ?? [];
    for (const [refIndex, ref] of references.entries()) {
      const snippetId = `c${citationIndex}-r${refIndex}`;
      yield {
        type: 'snippet',
        snippet: {
          id: snippetId,
          title:
            ref.location?.s3Location?.uri ?? ref.location?.webLocation?.url ?? 'Source',
          uri: ref.location?.s3Location?.uri ?? ref.location?.webLocation?.url ?? '',
          excerpt: ref.content?.text ?? '',
        },
      };
      yield {
        type: 'citation',
        citation: { id: `citation-${citationIndex}-${refIndex}`, snippetId },
      };
    }
  }
}

/** Adapts a RetrieveAndGenerateStreamCommand `stream` output into KBChatEvents. */
export function* fromRetrieveAndGenerateStreamChunk(
  chunk: RetrieveAndGenerateStreamResponseOutput,
): Generator<KBChatEvent> {
  if (chunk.output?.text) {
    yield { type: 'text', delta: chunk.output.text };
  }
  if (chunk.citation?.citation) {
    yield* fromBedrockCitations([chunk.citation.citation]);
  }
}
