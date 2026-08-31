// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useKBChat } from '@sample/kb-chat-react';
import type { Citation, Snippet } from '@sample/kb-chat-react';
import type { KBChatWidgetProps } from './types.js';
import './widget.css';

/** A stable identity for a source document, so the same doc chunked N times collapses. */
function sourceKey(snippet: Snippet): string {
  return snippet.source?.documentId ?? (snippet.uri || snippet.id);
}

/** The snippet id a wire citation points at is `result-<resultIndex>`; recover N. */
function resultIndexOf(snippetId: string): number | null {
  const m = /^result-(\d+)$/.exec(snippetId);
  return m ? Number(m[1]) : null;
}

/**
 * The model writes inline markers like `[1][3]` into its prose, 1-indexed over the
 * retrieved chunks (i.e. `[N]` → result index N-1). Turn the ones that correspond to a
 * real cited chunk into markdown links to an internal `#kbcite-<N>` anchor (handled by
 * the link renderer); leave others as plain text so bogus markers don't become dead
 * links.
 */
function linkifyCitations(text: string, citedResultIndexes: Set<number>): string {
  return text.replace(/\[(\d+)\]/g, (whole, digits) => {
    const n = Number(digits);
    return citedResultIndexes.has(n - 1) ? `[${n}](#kbcite-${n})` : whole;
  });
}

/** Assistant avatar — a small gen-AI glyph (inline SVG, no image asset). */
function AssistantAvatar() {
  return (
    <span className="kbcw-avatar kbcw-avatar--assistant" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M8 1.5l1.2 3.1 3.3.2-2.5 2.1.8 3.2L8 9.6 5.2 11.4l.8-3.2L3.5 6l3.3-.2L8 1.5z" />
      </svg>
    </span>
  );
}

/**
 * An inline citation marker rendered as `[N]`. Hovering or focusing it reveals a
 * popover with the source chunk that grounds the nearby text — pure hover/focus, no
 * click state, keyboard-accessible (the marker is a focusable button).
 */
function CitationMarker({
  n,
  snippet,
  onActivate,
}: {
  n: number;
  snippet: Snippet | undefined;
  onActivate?: (snippet: Snippet) => void;
}) {
  return (
    <span className="kbcw-cite">
      <button
        type="button"
        className="kbcw-cite-marker"
        aria-label={`Source ${n}`}
        aria-haspopup="dialog"
        onClick={() => snippet && onActivate?.(snippet)}
      >
        [{n}]
      </button>
      {snippet && (
        <span
          className="kbcw-cite-popover"
          role="dialog"
          aria-label={`Source: ${snippet.title}`}
        >
          <span className="kbcw-cite-popover-title">{snippet.title}</span>
          <span className="kbcw-cite-popover-excerpt">
            {snippet.excerpt || 'No excerpt available for this source.'}
          </span>
        </span>
      )}
    </span>
  );
}

/** A completed or in-progress answer: the streamed text, inline citations, sources. */
interface AnswerData {
  text: string;
  citations: Citation[];
  snippets: Snippet[];
}

/** One question/answer exchange kept in the transcript. */
interface Turn extends AnswerData {
  id: number;
  query: string;
}

/**
 * Renders a single assistant answer: markdown with clickable inline `[N]` citations
 * and a de-duplicated Sources list. Self-contained so each transcript turn keeps its
 * own resolved-URL state (snippet ids like `result-0` repeat across turns).
 */
function AnswerBody({
  answer,
  resolveSource,
  onCitationClick,
  onError,
}: {
  answer: AnswerData;
  resolveSource?: KBChatWidgetProps['resolveSource'];
  onCitationClick?: KBChatWidgetProps['onCitationClick'];
  onError?: KBChatWidgetProps['onError'];
}) {
  const { text, citations, snippets } = answer;
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

  const citedResultIndexes = useMemo(() => {
    const set = new Set<number>();
    for (const c of citations) {
      const idx = resultIndexOf(c.snippetId);
      if (idx !== null) set.add(idx);
    }
    return set;
  }, [citations]);

  // Only documents the answer actually cited (the agentic retriever returns chunks
  // even for questions the answer doesn't ground in), de-duplicated by document.
  const citedSources = useMemo(() => {
    const seen = new Set<string>();
    const out: Snippet[] = [];
    for (const c of citations) {
      const snippet = snippets.find((s) => s.id === c.snippetId);
      if (!snippet) continue;
      const key = sourceKey(snippet);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(snippet);
    }
    return out;
  }, [citations, snippets]);

  const displayText = useMemo(
    () => linkifyCitations(text, citedResultIndexes),
    [text, citedResultIndexes],
  );

  // Eagerly resolve pre-signed URLs so Sources entries are real <a href> links (a
  // genuine anchor click is never caught by pop-up blockers).
  useEffect(() => {
    if (!resolveSource) return;
    for (const snippet of citedSources) {
      if (!snippet.source || resolvedUrls[snippet.id]) continue;
      resolveSource(snippet.source)
        .then(({ url }) =>
          setResolvedUrls((prev) =>
            prev[snippet.id] ? prev : { ...prev, [snippet.id]: url },
          ),
        )
        .catch((err) => onError?.(err instanceof Error ? err : new Error(String(err))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citedSources, resolveSource]);

  const activateCitation = (snippet: Snippet) => {
    const citation = citations.find((c) => c.snippetId === snippet.id);
    if (citation) onCitationClick?.(snippet, citation);
  };

  return (
    <>
      <div className="kbcw-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, href, children, ...props }) => {
              const m = href ? /^#kbcite-(\d+)$/.exec(href) : null;
              if (m) {
                const n = Number(m[1]);
                return (
                  <CitationMarker
                    n={n}
                    snippet={snippets.find((s) => s.id === `result-${n - 1}`)}
                    onActivate={activateCitation}
                  />
                );
              }
              return (
                <a {...props} href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              );
            },
          }}
        >
          {displayText}
        </ReactMarkdown>
      </div>

      {citedSources.length > 0 && (
        <div className="kbcw-sources">
          <div className="kbcw-sources-title">Sources</div>
          {citedSources.map((snippet) => {
            const href = resolvedUrls[snippet.id] || snippet.uri;
            return (
              <div className="kbcw-source-item" key={sourceKey(snippet)}>
                {href ? (
                  <a
                    className="kbcw-source-link"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {snippet.title}
                  </a>
                ) : (
                  snippet.title
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Pre-styled chat widget: a multi-turn transcript of question/answer exchanges as chat
 * bubbles, with clickable inline citations and a de-duplicated source list per answer.
 * Built entirely on @sample/kb-chat-react's state — this component owns no parsing
 * logic of its own, only rendering and transcript bookkeeping.
 *
 * History is UI-only: every completed turn stays visible until Reset, but each new
 * question is still sent to the backend on its own (no prior turns are replayed).
 */
export function KBChatWidget({
  fetchResponse,
  theme,
  title = 'Knowledge base assistant',
  logo,
  placeholder = 'Ask a question…',
  resolveSource,
  onCitationClick,
  onError,
}: KBChatWidgetProps) {
  const { ask, text, citations, snippets, isStreaming, error, stage } = useKBChat({
    fetchResponse,
  });
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasStreaming = useRef(false);
  const nextId = useRef(0);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [text, stage, citations, snippets, turns]);

  useEffect(() => {
    if (error) onError?.(error);
  }, [error, onError]);

  // When a stream finishes, snapshot the completed answer into the transcript so it
  // persists while the next question is asked. Keyed off the streaming edge.
  useEffect(() => {
    if (wasStreaming.current && !isStreaming && pendingQuery !== null) {
      const query = pendingQuery;
      const snapshot: Turn = { id: nextId.current++, query, text, citations, snippets };
      setTurns((prev) => [...prev, snapshot]);
      setPendingQuery(null);
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, pendingQuery, text, citations, snippets]);

  const submit = () => {
    const query = input.trim();
    if (!query || isStreaming) return;
    ask(query);
    setPendingQuery(query);
    setInput('');
  };

  const reset = () => {
    setTurns([]);
    setPendingQuery(null);
    setInput('');
    nextId.current = 0;
  };

  const hasContent = turns.length > 0 || pendingQuery !== null;

  const rootStyle = theme?.primaryColor
    ? ({ '--kbcw-primary': theme.primaryColor } as React.CSSProperties)
    : undefined;

  return (
    <div className="kbcw-root" style={{ ...rootStyle, fontFamily: theme?.fontFamily }}>
      <div className="kbcw-header">
        {logo != null &&
          (typeof logo === 'string' ? (
            <img className="kbcw-logo" src={logo} alt="" />
          ) : (
            <span className="kbcw-logo">{logo}</span>
          ))}
        <span className="kbcw-header-title">{title}</span>
        {hasContent && (
          <button type="button" className="kbcw-reset" onClick={reset}>
            Reset
          </button>
        )}
      </div>

      <div className="kbcw-messages" ref={scrollRef}>
        {!hasContent && !error && (
          <div className="kbcw-empty">Ask a question to search your knowledge base.</div>
        )}

        {/* Completed turns (persist until Reset). */}
        {turns.map((turn) => (
          <div key={turn.id} className="kbcw-turn">
            <div className="kbcw-message kbcw-message--user">
              <div className="kbcw-bubble kbcw-bubble--user">{turn.query}</div>
            </div>
            <div className="kbcw-message kbcw-message--assistant">
              <AssistantAvatar />
              <div className="kbcw-bubble kbcw-bubble--assistant">
                <AnswerBody
                  answer={turn}
                  resolveSource={resolveSource}
                  onCitationClick={onCitationClick}
                  onError={onError}
                />
              </div>
            </div>
          </div>
        ))}

        {/* The in-progress turn (present only while a question is being answered). */}
        {pendingQuery !== null && (
          <div className="kbcw-turn">
            <div className="kbcw-message kbcw-message--user">
              <div className="kbcw-bubble kbcw-bubble--user">{pendingQuery}</div>
            </div>
            <div className="kbcw-message kbcw-message--assistant">
              <AssistantAvatar />
              <div className="kbcw-bubble kbcw-bubble--assistant">
                {isStreaming && !text && (
                  <div className="kbcw-stage" aria-live="polite">
                    {(stage?.live ?? true) && (
                      <span className="kbcw-spinner" aria-hidden="true" />
                    )}
                    {stage?.label ?? 'Searching…'}
                  </div>
                )}
                {text.length > 0 && (
                  <AnswerBody
                    answer={{ text, citations, snippets }}
                    resolveSource={resolveSource}
                    onCitationClick={onCitationClick}
                    onError={onError}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <div className="kbcw-error">{error.message}</div>}

      <div className="kbcw-input-row">
        <input
          className="kbcw-input"
          value={input}
          placeholder={placeholder}
          disabled={isStreaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          className="kbcw-send"
          disabled={isStreaming || !input.trim()}
          onClick={submit}
        >
          Send
        </button>
      </div>
    </div>
  );
}
