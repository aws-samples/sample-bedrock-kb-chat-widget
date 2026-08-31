# kb-chat-widget

> Code sample, not a maintained package — copy and adapt rather than depend on.

Pre-styled, embeddable chat widget for Bedrock Knowledge Bases / Agentic Retrieval.
Built on top of `kb-chat-react`'s state; this package owns rendering, `kb-chat-react`
owns parsing.

Features:
- **Streaming answers** rendered as markdown (bold, lists, links, tables via GFM).
- **Chat bubbles** for the question/answer exchange, with an assistant avatar.
- **Agentic Retrieval progress** — shows live stage labels ("Iteration N…",
  "Thought for Ns") instead of a generic spinner, for `AgenticRetrieveStream` backends.
- **Citations** — click a citation to open a popover showing the retrieved source
  chunk (the passage that grounded the answer).
- **De-duplicated source list** — one entry per document (even when retrieved as many
  chunks); clicking opens the document via a fresh pre-signed URL (see `resolveSource`).
- **Theming + dark mode** — restyle via CSS variables and a `primaryColor`/`title`/
  `logo` prop; auto-follows `prefers-color-scheme`, or force it with
  `data-theme="dark"` on the widget root.

## Known limitations

- **Style isolation.** The widget uses plain in-page CSS scoped under a `.kbcw-`
  class prefix — it is *not* isolated in a Shadow DOM or iframe. In practice this is
  fine for most host pages, but an aggressive host stylesheet could still bleed into
  the widget (or vice-versa). If you need hard isolation, wrap the widget in a Shadow
  DOM or iframe in your own integration. This is a deliberate simplicity tradeoff for
  a copy-and-adapt sample, not an oversight.
- **Conversation memory is UI-only.** The transcript keeps prior turns visible, but
  each question is sent to the backend on its own — prior turns are not replayed to
  Bedrock as conversational context.

## What it looks like

Run the demo to see it end-to-end: build the packages (`npm run build` from the repo
root), serve the repo root, and open `demo/index.html` — see [`demo/README.md`](../../demo/README.md).
The demo also shows how to wire `fetchResponse`, `resolveSource`, a `logo`, and a
dark-mode toggle.

Builds two ways from one component (copy whichever fits your project — this isn't
published anywhere, so there's no `npm install` step):
- **A bundler-consumable ESM/CJS build** (`dist/index.*`, React external) — copy
  `src/` into a React app with a bundler.
- **A standalone script bundle** (`dist/standalone/standalone.global.js`) — a
  self-contained IIFE (React/ReactDOM bundled in) that defines a `KBChatWidget`
  global, for no-build static sites.

## Usage — React app

```tsx
import { KBChatWidget } from '@sample/kb-chat-widget';
import '@sample/kb-chat-widget/style.css';

function SupportPage() {
  return (
    <KBChatWidget
      fetchResponse={(query) => fetch('/api/ask', { method: 'POST', body: JSON.stringify({ query }) })}
      theme={{ primaryColor: '#0972d3' }}
      onCitationClick={(snippet) => window.open(snippet.uri)}
    />
  );
}
```

## Usage — no-build static site

```html
<link rel="stylesheet" href="https://cdn.example.com/kb-chat-widget/v1/standalone.css" />
<div id="kb-chat"></div>
<script src="https://cdn.example.com/kb-chat-widget/v1/standalone.global.js"></script>
<script>
  KBChatWidget.init({
    target: document.getElementById('kb-chat'),
    fetchResponse: (query) => fetch('/api/ask', { method: 'POST', body: JSON.stringify({ query }) }),
  });
</script>
```

Both entry points render the identical component and expect the identical
`fetchResponse` contract as `@sample/kb-chat-react` — see that package's README for the
NDJSON wire format your backend proxy needs to emit.

## Props

| Prop | Type | Description |
|---|---|---|
| `fetchResponse` | `(query) => Promise<Response \| ReadableStream>` | **Required.** Calls your backend and returns the NDJSON stream. Never handles AWS credentials. |
| `resolveSource` | `(source) => Promise<{ url }>` | Optional. Resolves a source document to an openable URL on demand (e.g. via a `GetDocumentContent` proxy). When set, entries in the Sources list open the document via a fresh pre-signed URL on click. |
| `title` | `string` | Header title. Defaults to `"Knowledge base assistant"`. |
| `logo` | `string \| ReactNode` | Optional header logo — an image URL or your own node, for host branding. |
| `theme` | `{ primaryColor?, fontFamily? }` | Quick theming. For full control, override the widget's CSS variables. |
| `placeholder` | `string` | Input placeholder. |
| `onCitationClick` | `(snippet, citation) => void` | Called when a citation is clicked. |
| `onError` | `(error) => void` | Called on stream or resolve errors. |

### Resolving source links (`resolveSource`)

Agentic Retrieval backends can supply the identifiers needed to fetch a document's
content. Wire `resolveSource` to a backend endpoint that calls Bedrock
`GetDocumentContent` and returns a fresh URL (pre-signed URLs expire in ~5 minutes, so
the widget resolves them on click, not up front):

```tsx
<KBChatWidget
  fetchResponse={(query) => fetch('/api/ask', { method: 'POST', body: JSON.stringify({ query }) })}
  resolveSource={(source) =>
    fetch('/api/document', { method: 'POST', body: JSON.stringify(source) }).then((r) => r.json())
  }
/>
```

`@sample/kb-chat-reference-backend` implements both `/api/ask` and `/api/document`.

## Development

```bash
npm run build -w packages/kb-chat-widget
```

Builds both targets: the npm-consumable ESM/CJS bundle (`dist/index.*`, React external)
and the standalone IIFE bundle (`dist/standalone/*`, React bundled in, minified,
`process.env.NODE_ENV` replaced with `production` so React's dev-mode code paths are
dead-code-eliminated).
