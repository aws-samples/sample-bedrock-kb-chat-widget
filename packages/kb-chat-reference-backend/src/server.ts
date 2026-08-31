// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createServer } from 'node:http';
import {
  AgenticRetrieveStreamCommand,
  GetDocumentContentCommand,
  RetrieveAndGenerateStreamCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { KBChatEvent } from '@sample/kb-chat-core';
import { createBedrockClient } from './bedrockClient.js';
import { fromRetrieveAndGenerateStreamChunk } from './bedrockToKBChatEvents.js';
import { fromAgenticRetrieveStream } from './agenticRetrieveToKBChatEvents.js';

const PORT = Number(process.env.PORT ?? 3000);
const REGION = process.env.AWS_REGION ?? 'us-west-2';
// Optional default KB. The caller (e.g. the demo) normally supplies knowledgeBaseIds
// per request; this env var is only a fallback for callers that don't. Leave it unset
// and let the client choose the KB(s) — the backend bakes in no specific KB.
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;
const MODEL_ARN = process.env.MODEL_ARN;
const AGENTIC = process.env.AGENTIC === 'true';

if (!MODEL_ARN) {
  throw new Error('MODEL_ARN environment variable is required.');
}

const client = createBedrockClient(REGION);

function writeEvent(res: import('node:http').ServerResponse, event: KBChatEvent): void {
  res.write(JSON.stringify(event) + '\n');
}

async function* streamAgenticRetrieve(
  query: string,
  opts: { knowledgeBaseIds?: string[]; modelArn?: string } = {},
): AsyncGenerator<KBChatEvent> {
  // Multiple KBs → multiple retrievers (Agentic Retrieval fans out across them). Uses
  // the caller-supplied KBs, falling back to the optional env default only if none were
  // given. Errors if neither is available (the backend bakes in no specific KB).
  const kbIds = opts.knowledgeBaseIds?.length
    ? opts.knowledgeBaseIds
    : KNOWLEDGE_BASE_ID
      ? [KNOWLEDGE_BASE_ID]
      : [];
  if (kbIds.length === 0) {
    throw new Error(
      'No knowledge base specified. Provide knowledgeBaseIds in the request or set KNOWLEDGE_BASE_ID.',
    );
  }
  const modelArn = opts.modelArn || MODEL_ARN!;
  const response = await client.send(
    new AgenticRetrieveStreamCommand({
      messages: [{ role: 'user', content: { text: query } }],
      retrievers: kbIds.map((knowledgeBaseId) => ({
        configuration: { knowledgeBase: { knowledgeBaseId } },
      })),
      agenticRetrieveConfiguration: {
        foundationModelType: 'CUSTOM',
        foundationModelConfiguration: {
          type: 'BEDROCK_FOUNDATION_MODEL',
          bedrockFoundationModelConfiguration: { modelConfiguration: { modelArn } },
        },
      },
      generateResponse: true,
    }),
  );
  if (!response.stream)
    throw new Error('AgenticRetrieveStreamCommand returned no stream');
  yield* fromAgenticRetrieveStream(response.stream);
}

async function* streamKnowledgeBase(
  query: string,
  opts: { knowledgeBaseIds?: string[]; modelArn?: string } = {},
): AsyncGenerator<KBChatEvent> {
  // Plain RetrieveAndGenerate targets a single KB — use the first requested one, else
  // the optional env default. Errors if neither is available.
  const knowledgeBaseId = opts.knowledgeBaseIds?.[0] ?? KNOWLEDGE_BASE_ID;
  if (!knowledgeBaseId) {
    throw new Error(
      'No knowledge base specified. Provide knowledgeBaseIds in the request or set KNOWLEDGE_BASE_ID.',
    );
  }
  const response = await client.send(
    new RetrieveAndGenerateStreamCommand({
      input: { text: query },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId,
          modelArn: opts.modelArn || MODEL_ARN!,
        },
      },
    }),
  );
  for await (const chunk of response.stream ?? []) {
    yield* fromRetrieveAndGenerateStreamChunk(chunk);
  }
}

async function readJsonBody<T>(req: import('node:http').IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T;
}

async function handleAsk(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) {
  // The caller supplies which knowledge base(s) to query (the demo reads them from
  // config.json); modelArn is an optional model override. Both fall back to env
  // defaults (KNOWLEDGE_BASE_ID / MODEL_ARN) when omitted.
  const { query, knowledgeBaseIds, modelArn } = await readJsonBody<{
    query: string;
    knowledgeBaseIds?: string[];
    modelArn?: string;
  }>(req);

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
  });

  try {
    const events = AGENTIC
      ? streamAgenticRetrieve(query, { knowledgeBaseIds, modelArn })
      : streamKnowledgeBase(query, { knowledgeBaseIds, modelArn });
    for await (const event of events) {
      writeEvent(res, event);
    }
    writeEvent(res, { type: 'done' });
  } catch (err) {
    // Log the full error server-side; return a generic message so internal
    // details (SDK internals, stack traces) are not exposed to the client.
    console.error('Knowledge Base request failed:', err);
    writeEvent(res, {
      type: 'error',
      message: 'The Knowledge Base request failed. See the server logs for details.',
    });
  } finally {
    res.end();
  }
}

/**
 * Resolves a source document to a fresh, openable URL on demand. The widget calls
 * this when a user clicks a citation — never up front — because GetDocumentContent
 * pre-signed URLs expire after ~5 minutes.
 */
async function handleDocument(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) {
  const { knowledgeBaseId, dataSourceId, documentId } = await readJsonBody<{
    knowledgeBaseId?: string;
    dataSourceId?: string;
    documentId?: string;
  }>(req);

  if (!knowledgeBaseId || !dataSourceId || !documentId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'knowledgeBaseId, dataSourceId, and documentId are required.',
      }),
    );
    return;
  }

  try {
    const { presignedUrl } = await client.send(
      new GetDocumentContentCommand({ knowledgeBaseId, dataSourceId, documentId }),
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: presignedUrl ?? '' }));
  } catch (err) {
    // Log the full error server-side; return a generic message so internal
    // details (SDK internals, stack traces) are not exposed to the client.
    console.error('GetDocumentContent failed:', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Failed to resolve document content. See the server logs for details.',
      }),
    );
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/ask') {
    await handleAsk(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/document') {
    await handleDocument(req, res);
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`kb-chat-reference-backend listening on http://localhost:${PORT}`);
});
