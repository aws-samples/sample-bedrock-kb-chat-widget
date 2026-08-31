# Demo — Bedrock Knowledge Base chat widget

A minimal static page that loads the standalone widget bundle and points it at a
backend. Use it to see the widget working without a build step in your own app.

## What it shows

- The pre-styled chat widget answering from Bedrock Knowledge Bases (streaming text,
  clickable `[N]` citations with source-chunk popovers, a de-duplicated Sources list,
  and a Reset button).
- How a host page wires the widget: `fetchResponse` (query → backend), `resolveSource`
  (open a source document via a pre-signed URL), a `title`, a `logo`, and a dark-mode
  toggle.

## Configure (no code edits)

Everything runtime-configurable lives in [`config.json`](./config.json), fetched on
load so the same page works across environments:

```json
{
  "backendUrl": "http://localhost:3900/api/ask",
  "knowledgeBaseIds": ["<kb-id>", "<kb-id>"]
}
```

- `backendUrl` — your backend's `/api/ask` endpoint. Falls back to
  `http://localhost:3900/api/ask` if the file is missing.
- `knowledgeBaseIds` — the knowledge base(s) the backend should query for this demo
  (passed through `fetchResponse`). Leave empty to use the backend's own default.

The widget never holds AWS credentials or talks to AWS — it only calls `backendUrl`,
and the backend owns all Bedrock configuration.

> **Before publishing:** `config.json` in this repo may contain real knowledge base
> IDs for local testing. Revert `knowledgeBaseIds` (and any non-localhost
> `backendUrl`) to placeholders before making the repo public.

## Run it

1. Build the widget so `dist/standalone/` exists (from the repo root):
   ```bash
   npm run build
   ```
2. Start a backend the widget can reach — e.g. `kb-chat-reference-backend`:
   ```bash
   AWS_REGION=us-east-1 \
   MODEL_ARN=<your-inference-profile-arn> \
   PORT=3900 AGENTIC=true \
   npm run dev -w packages/kb-chat-reference-backend
   ```
   (No `KNOWLEDGE_BASE_ID` needed — the demo supplies KB ids from `config.json`.)
3. Serve the **repo root** (the page loads the bundle via `../packages/...` paths):
   ```bash
   python3 -m http.server 8080
   ```
4. Open <http://localhost:8080/demo/index.html>.

The widget and backend are different origins here, so the backend must send permissive
CORS headers (or serve both from one origin) for the browser to read the stream.
