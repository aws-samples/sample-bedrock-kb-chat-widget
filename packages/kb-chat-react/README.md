# kb-chat-react

> Code sample, not a maintained package — copy and adapt rather than depend on.

A thin React binding over [`kb-chat-core`](../kb-chat-core): the `useKBChat()` hook
wraps a `KBChatSession` and returns its state plus an `ask()` function. Like the core,
it **renders nothing** — you own all the UI. If you want a pre-built UI instead, use
[`kb-chat-widget`](../kb-chat-widget), which is built on this hook.

## Usage

```tsx
import { useKBChat } from './kb-chat-react/src/index.js'; // or copy the package in

function SupportPage() {
  const { ask, text, citations, snippets, isStreaming, error, stage } = useKBChat({
    // Your backend holds AWS credentials and calls Bedrock; the hook only calls this.
    fetchResponse: (query) =>
      fetch('/api/ask', { method: 'POST', body: JSON.stringify({ query }) }),
  });

  return (
    <div className="my-own-branded-chat-box">
      {stage && <p className="progress">{stage.label}</p>}
      <p>{text}</p>
      {isStreaming && <Spinner />}
      {error && <ErrorBanner message={error.message} />}
      {citations.map((c) => {
        const snippet = snippets.find((s) => s.id === c.snippetId);
        return snippet ? <CitationChip key={c.id} title={snippet.title} uri={snippet.uri} /> : null;
      })}
      <MyInput onSubmit={ask} disabled={isStreaming} />
    </div>
  );
}
```

The returned object is `KBChatState` (`text`, `citations`, `snippets`, `isStreaming`,
`error`, `stage`) plus `ask(query)`. The NDJSON wire format your backend must emit is
documented in [`kb-chat-core`](../kb-chat-core#the-wire-format-your-backend-must-emit).

`fetchResponse` is read through a ref, so passing a new inline function each render
(the common case) does not tear down and recreate the underlying session.

## Exports

- `useKBChat(options)` → `UseKBChatResult` (state + `ask`).
- Types: `UseKBChatOptions`, `UseKBChatResult`, and the re-exported core types
  (`KBChatState`, `Citation`, `Snippet`, `SourceLocator`, `Stage`, `ResolveSource`).

## Build

```bash
npm run build -w packages/kb-chat-react   # requires kb-chat-core built first
```

`kb-chat-core` must be built before this package — it's resolved from `dist/`, not
source. Use `npm run build` from the repo root to build everything in order.
