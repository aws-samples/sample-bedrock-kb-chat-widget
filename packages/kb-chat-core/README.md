# kb-chat-core

> Code sample, not a maintained package — copy and adapt rather than depend on.

The framework-agnostic core: a `KBChatSession` class that parses a streamed
NDJSON response from your backend into a single observable `KBChatState`. It owns
**stream parsing and state only** — it renders nothing and never talks to AWS. Use it
directly in vanilla JS, Vue, Svelte, or any framework; `kb-chat-react` and
`kb-chat-widget` are built on top of it.

## Usage

```js
import { KBChatSession } from './kb-chat-core/src/index.js'; // or copy the package in

const session = new KBChatSession({
  // Called with the user's query; returns your backend's streamed response.
  // Your backend — never the browser — holds AWS credentials and calls Bedrock.
  fetchResponse: (query) =>
    fetch('/api/ask', { method: 'POST', body: JSON.stringify({ query }) }),
});

session.on('update', (state) => renderMyOwnUI(state));
session.ask('How do I reset my API key?');
```

Every `update` gives you the full current `KBChatState`:

```ts
{
  text: string;              // answer so far (accumulates as chunks arrive)
  citations: Citation[];     // inline citation references
  snippets: Snippet[];       // retrieved source chunks (title, uri, excerpt, source locator)
  isStreaming: boolean;
  error: Error | null;
  stage: Stage | null;       // Agentic Retrieval progress, e.g. "Iteration 2 in progress…"
}
```

## The wire format your backend must emit

`KBChatSession` expects **newline-delimited JSON (NDJSON)** — one JSON object per line
— from `fetchResponse`. Your backend translates whatever Bedrock returns into this
shape (see `kb-chat-reference-backend` for a working example):

```jsonl
{"type":"stage","label":"Iteration 1 in progress...","live":true}
{"type":"text","delta":"The API key can be reset "}
{"type":"text","delta":"from the account settings page."}
{"type":"snippet","snippet":{"id":"result-0","title":"API Keys","uri":"...","excerpt":"...","source":{"knowledgeBaseId":"...","dataSourceId":"...","documentId":"..."}}}
{"type":"citation","citation":{"id":"c1","snippetId":"result-0"}}
{"type":"done"}
```

- `text` — an incremental answer chunk (`delta` is concatenated onto `state.text`).
- `snippet` — a retrieved source chunk. `source` (optional) carries the identifiers a
  host can pass to a `GetDocumentContent` proxy to resolve a fresh document link.
- `citation` — links a span of the answer to a `snippet` by id.
- `stage` — Agentic Retrieval progress (`live:true` = running, `false` = settled).
  Omit entirely for plain `RetrieveAndGenerate` backends.
- `error` / `done` — terminal events.

## Exports

- `KBChatSession` — the session class (`ask()`, `on('update'|'error', …)`, `getState()`).
- `parseNdjsonStream`, `toByteStream` — the low-level NDJSON stream helpers.
- Types: `KBChatState`, `KBChatEvent`, `Citation`, `Snippet`, `SourceLocator`,
  `Stage`, `FetchResponse`, `ResolveSource`, `KBChatSessionOptions`, `KBChatListener`.

## Build

```bash
npm run build -w packages/kb-chat-core   # ESM + CJS + d.ts via tsup
```
