# Architecture

## Runtime data flow

```mermaid
flowchart LR
    User(["End user"]) --> UI["Your UI"]
    UI <-->|state| Hook["useKBChat() / KBChatSession"]
    Hook -->|"fetchResponse(query)"| Backend["Your backend<br/>(kb-chat-reference-backend is one example)"]
    Backend -->|SigV4, own IAM role| Bedrock["Amazon Bedrock<br/>Knowledge Bases / Agentic Retrieval"]
    Backend -.->|NDJSON stream| Hook
```

Only the backend holds AWS credentials and calls Bedrock. The browser-side pieces
never touch AWS — they call a customer-supplied `fetchResponse(query)` and render
whatever the backend streams back as newline-delimited JSON (NDJSON).

## Package dependencies

```mermaid
flowchart TD
    core["kb-chat-core<br/>parsing + state, no UI"]
    react["kb-chat-react<br/>useKBChat() hook"]
    widget["kb-chat-widget<br/>pre-styled widget"]
    backend["kb-chat-reference-backend<br/>example Bedrock proxy"]
    react --> core
    widget --> react
    widget --> core
    backend --> core
```

Build `kb-chat-core` and `kb-chat-react` first — the widget and backend resolve them
from `dist/`, not from source.

## NDJSON wire format

The backend translates whatever Bedrock returns into a stream of NDJSON events, one
per line, which `kb-chat-core` parses into a single `KBChatState`:

```jsonl
{"type":"stage","label":"Iteration 1 in progress...","live":true}
{"type":"text","delta":"The API key can be reset from the account settings page."}
{"type":"citation","citation":{"id":"c1","snippetId":"s1"}}
{"type":"snippet","snippet":{"id":"s1","title":"API Key Management","uri":"https://docs.example.com/api-keys","excerpt":"..."}}
{"type":"done"}
```

`stage` events are only relevant for Agentic Retrieval (multi-step retrieval
progress); a backend using plain `RetrieveAndGenerate` never emits them.
