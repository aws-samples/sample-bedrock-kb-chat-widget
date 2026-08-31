// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useRef, useState } from 'react';
import { KBChatSession } from '@sample/kb-chat-core';
import type { FetchResponse, KBChatState } from '@sample/kb-chat-core';

export interface UseKBChatOptions {
  fetchResponse: FetchResponse;
}

export interface UseKBChatResult extends KBChatState {
  ask: (query: string) => void;
}

const initialState = (): KBChatState => ({
  text: '',
  citations: [],
  snippets: [],
  isStreaming: false,
  error: null,
  stage: null,
});

/**
 * React binding for KBChatSession. Renders nothing — callers own 100% of the UI and
 * just read `text` / `citations` / `snippets` / `isStreaming` / `error` / `stage`
 * (Agentic Retrieval progress, null for non-agentic calls) off the returned object.
 *
 * `fetchResponse` is read through a ref so passing a new inline function on every
 * render (the common case: `fetchResponse={(q) => fetch(...)}`) does not tear down
 * and recreate the underlying session — only the identity of `useKBChat`'s call site
 * matters, not the identity of the callback.
 */
export function useKBChat(options: UseKBChatOptions): UseKBChatResult {
  const fetchResponseRef = useRef(options.fetchResponse);
  fetchResponseRef.current = options.fetchResponse;

  const sessionRef = useRef<KBChatSession>();
  if (!sessionRef.current) {
    sessionRef.current = new KBChatSession({
      fetchResponse: (query) => fetchResponseRef.current(query),
    });
  }

  const [state, setState] = useState<KBChatState>(initialState);

  useEffect(() => {
    const session = sessionRef.current!;
    setState(session.getState());
    return session.on('update', setState);
  }, []);

  const ask = useCallback((query: string) => {
    void sessionRef.current!.ask(query);
  }, []);

  return { ...state, ask };
}
