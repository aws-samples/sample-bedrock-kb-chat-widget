// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface Snippet {
  id: string;
  title: string;
  /**
   * A source location for the document, if the backend has one. May be a bare
   * (often non-clickable) storage URI. For a guaranteed-openable link, prefer
   * resolving on demand from the identifiers below — see `SourceLocator`.
   */
  uri: string;
  excerpt: string;
  /**
   * Identifiers the host app can pass to a backend `GetDocumentContent` call to
   * resolve a fresh, openable (e.g. pre-signed) document link on demand. Present when
   * the backend can supply them (Agentic Retrieval exposes them via result metadata);
   * absent for backends that can't. See `SourceLocator`.
   */
  source?: SourceLocator;
}

/**
 * The identifiers needed to fetch a document's content from Bedrock via
 * `GetDocumentContent`. The widget never calls AWS itself; it hands these to a
 * host-supplied resolver that proxies through the customer's backend.
 */
export interface SourceLocator {
  knowledgeBaseId: string;
  dataSourceId: string;
  documentId: string;
}

export interface Citation {
  id: string;
  snippetId: string;
  /** Character offset in `text` where the citation marker applies, if provided by the backend. */
  textOffset?: number;
}

/**
 * A human-readable progress label for a step of an in-progress Agentic Retrieval
 * loop (e.g. "Iteration 2 in progress...", "Thought for 4s"). `live: true` means the
 * step is still running (render as a transient/animated indicator); `live: false`
 * means it finished (render as a settled line, then move on to the next stage or the
 * final answer). Absent entirely for non-agentic Retrieve/RetrieveAndGenerate calls,
 * which have no intermediate steps to report.
 */
export interface Stage {
  label: string;
  live: boolean;
}

export interface KBChatState {
  text: string;
  citations: Citation[];
  snippets: Snippet[];
  isStreaming: boolean;
  error: Error | null;
  /** Most recent Agentic Retrieval progress stage, or null if none has been reported. */
  stage: Stage | null;
}

/**
 * Wire protocol emitted by the customer's own backend proxy, one JSON object per line
 * (newline-delimited JSON). The proxy is responsible for translating whatever Bedrock
 * KB / Agentic Retrieval returns into this shape — kb-chat-core never talks to Bedrock
 * directly and has no opinion on how the proxy got its data.
 */
export type KBChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'citation'; citation: Citation }
  | { type: 'snippet'; snippet: Snippet }
  | { type: 'stage'; label: string; live: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * Supplied by the host application. Never handles AWS credentials — it only calls
 * whatever endpoint the customer's own backend exposes, and returns the raw response
 * stream for kb-chat-core to parse.
 */
export type FetchResponse = (
  query: string,
) => Promise<Response | ReadableStream<Uint8Array>>;

/**
 * Optionally supplied by the host application to resolve a source document to an
 * openable URL on demand (e.g. when a user clicks a citation). Like `FetchResponse`,
 * it never handles AWS credentials — it calls the customer's own backend, which is
 * expected to call Bedrock `GetDocumentContent` and return a fresh URL. Resolving on
 * demand (rather than up front) matters because `GetDocumentContent` pre-signed URLs
 * expire after ~5 minutes.
 */
export type ResolveSource = (source: SourceLocator) => Promise<{ url: string }>;

export interface KBChatSessionOptions {
  fetchResponse: FetchResponse;
}

export type KBChatEventName = 'update' | 'error';
export type KBChatListener = (state: KBChatState) => void;
