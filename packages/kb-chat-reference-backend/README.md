# kb-chat-reference-backend

> Code sample, not a maintained package — copy and adapt rather than depend on.

Example Node.js backend for `kb-chat-widget` / `kb-chat-react`. Calls
Bedrock Knowledge Bases (`RetrieveAndGenerateStreamCommand`) with the AWS SDK for
JavaScript and streams the result as NDJSON events in the wire format
`kb-chat-core` expects.

This is a minimal example of the proxy contract described in the design doc's Auth
Model: the widget never holds AWS credentials, only this backend does, and it calls
Bedrock with its own IAM role.

## Resilience

The Bedrock client is configured per AWS SDK v3 best practice for a user-facing
streaming call (see `src/bedrockClient.ts`):
- `maxAttempts: 3`, `retryMode: 'adaptive'` — absorbs transient throttling/connect
  errors via the SDK's own retry strategy instead of surfacing them straight to the
  end user.
- `NodeHttpHandler` with an explicit `connectionTimeout` and `requestTimeout` — the
  SDK's default request timeout is unbounded (`0`), which is unsafe for a
  customer-facing endpoint.

## Running

```bash
export AWS_REGION=us-west-2
export MODEL_ARN=<your-model-or-inference-profile-arn>
# Optional: a default KB for callers that don't pass knowledgeBaseIds. The demo
# supplies its own KB ids per request, so this can be left unset.
# export KNOWLEDGE_BASE_ID=<your-kb-id>
npm run dev -w packages/kb-chat-reference-backend
```

Only `MODEL_ARN` is required. The knowledge base(s) to query come from each request's
`knowledgeBaseIds` (the demo reads them from `demo/config.json`); `KNOWLEDGE_BASE_ID`
is only a fallback for callers that omit them.

Requires AWS credentials in your environment (standard AWS SDK credential chain).
Scope the IAM policy to the least privilege this server needs on the target
Knowledge Base — `bedrock:RetrieveAndGenerateStream`, plus
`bedrock:AgenticRetrieveStream` only if you run with `AGENTIC=true`, plus
`bedrock:GetDocumentContent` for the `/api/document` source-link endpoint. Grant
these on the specific Knowledge Base resource rather than `*`.

## Endpoints

- `POST /api/ask` — body `{ "query": string, "knowledgeBaseIds"?: string[], "modelArn"?: string }`,
  returns `Content-Type: application/x-ndjson`. This is what `kb-chat-widget`'s
  `fetchResponse` prop posts to. `knowledgeBaseIds` (multiple → multiple agentic
  retrievers) and `modelArn` are optional overrides; both fall back to the
  `KNOWLEDGE_BASE_ID` / `MODEL_ARN` env vars, and only apply to the agentic path.
- `POST /api/document` — body `{ "knowledgeBaseId", "dataSourceId", "documentId" }`,
  returns `{ "url": string }`, a fresh pre-signed document URL from
  `GetDocumentContent`. Backs the widget's Sources links (the pre-signed URL expires
  after ~5 minutes).
