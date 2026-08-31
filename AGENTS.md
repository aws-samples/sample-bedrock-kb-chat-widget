# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

An `aws-samples` code sample (MIT-0, non-production): an embeddable React chat
widget + a reference Node.js backend that render streaming answers, citations, and
source snippets from Amazon Bedrock Knowledge Bases / Agentic Retrieval. It is not a
maintained package — favor clarity and readability over cleverness.

## Layout

- `packages/kb-chat-core` — framework-agnostic stream parsing + state (no UI).
- `packages/kb-chat-react` — `useKBChat()` React hook over the core.
- `packages/kb-chat-widget` — pre-styled embeddable widget (npm + standalone bundle).
- `packages/kb-chat-reference-backend` — example Node.js proxy that calls Bedrock.
- `demo/` — runnable static page wiring the widget to the backend.

Build order matters: `kb-chat-core` and `kb-chat-react` must build before the
widget/backend, which resolve them from `dist/`.

## Commands

- Install + build + typecheck + test: `npm run build:all`
- Build all packages (dependency order): `npm run build`
- Typecheck only: `npm run typecheck`
- Run tests: `npm test`
- Format: `npm run format` · check formatting: `npm run format:check`
- Lint: `npm run lint`

## Conventions

- TypeScript, ES modules, 2-space indent. Keep runtime dependencies minimal.
- The browser-side packages must NEVER hold AWS credentials or call AWS directly —
  they only call a customer-supplied `fetchResponse(query)`. Only the backend talks
  to Bedrock, using its own IAM role.
- Render model output with `react-markdown` (HTML-escaped); never use
  `dangerouslySetInnerHTML`.
- Every source file carries an SPDX MIT-0 header.
- No secrets, account IDs, ARNs, or real Knowledge Base IDs in tracked files —
  `demo/config.json` uses placeholders only.
