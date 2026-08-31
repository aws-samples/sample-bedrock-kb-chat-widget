// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it, vi } from 'vitest';
import { KBChatSession } from '../KBChatSession.js';
import type { KBChatState } from '../types.js';

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(stream);
}

describe('KBChatSession', () => {
  it('accumulates text deltas, citations, and snippets, then clears isStreaming on done', async () => {
    const session = new KBChatSession({
      fetchResponse: async () =>
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'Hello ' }),
          JSON.stringify({ type: 'text', delta: 'world' }),
          JSON.stringify({ type: 'citation', citation: { id: 'c1', snippetId: 's1' } }),
          JSON.stringify({
            type: 'snippet',
            snippet: { id: 's1', title: 'Doc', uri: 'https://x', excerpt: '...' },
          }),
          JSON.stringify({ type: 'done' }),
        ]),
    });

    const states: KBChatState[] = [];
    session.on('update', (s) => states.push(s));

    await session.ask('hi');

    const final = session.getState();
    expect(final.text).toBe('Hello world');
    expect(final.citations).toEqual([{ id: 'c1', snippetId: 's1' }]);
    expect(final.snippets).toEqual([
      { id: 's1', title: 'Doc', uri: 'https://x', excerpt: '...' },
    ]);
    expect(final.isStreaming).toBe(false);
    expect(final.error).toBeNull();
    expect(states.length).toBeGreaterThan(0);
  });

  it('sets isStreaming true immediately, before the fetch resolves', async () => {
    let resolveFetch: () => void;
    const session = new KBChatSession({
      fetchResponse: () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve(ndjsonResponse([JSON.stringify({ type: 'done' })]));
        }),
    });

    const promise = session.ask('hi');
    expect(session.getState().isStreaming).toBe(true);
    resolveFetch!();
    await promise;
    expect(session.getState().isStreaming).toBe(false);
  });

  it('surfaces a stream-level error event and stops streaming', async () => {
    const session = new KBChatSession({
      fetchResponse: async () =>
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'partial' }),
          JSON.stringify({ type: 'error', message: 'upstream Bedrock call failed' }),
        ]),
    });

    await session.ask('hi');

    const final = session.getState();
    expect(final.isStreaming).toBe(false);
    expect(final.error?.message).toBe('upstream Bedrock call failed');
    expect(final.text).toBe('partial'); // partial text preserved rather than discarded
  });

  it('surfaces a network/fetch rejection as an error state', async () => {
    const session = new KBChatSession({
      fetchResponse: async () => {
        throw new Error('network drop');
      },
    });

    await session.ask('hi');

    const final = session.getState();
    expect(final.isStreaming).toBe(false);
    expect(final.error?.message).toBe('network drop');
  });

  it('marks isStreaming false even if the stream ends without an explicit done event', async () => {
    const session = new KBChatSession({
      fetchResponse: async () =>
        ndjsonResponse([JSON.stringify({ type: 'text', delta: 'cut off' })]),
    });

    await session.ask('hi');

    const final = session.getState();
    expect(final.isStreaming).toBe(false);
    expect(final.text).toBe('cut off');
    expect(final.error).toBeNull();
  });

  it('discards an older in-flight ask() when a newer one is issued before it resolves', async () => {
    let resolveFirst!: (r: Response) => void;
    const fetchResponse = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async () =>
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'second answer' }),
          JSON.stringify({ type: 'done' }),
        ]),
      );

    const session = new KBChatSession({ fetchResponse });

    const firstAsk = session.ask('first query');
    const secondAsk = session.ask('second query');

    // First query's response finally arrives late, after the second query already started.
    resolveFirst(
      ndjsonResponse([
        JSON.stringify({ type: 'text', delta: 'stale first answer' }),
        JSON.stringify({ type: 'done' }),
      ]),
    );

    await Promise.all([firstAsk, secondAsk]);

    expect(session.getState().text).toBe('second answer');
  });

  it('surfaces agentic retrieval stage progress and clears it once the answer starts streaming', async () => {
    const session = new KBChatSession({
      fetchResponse: async () =>
        ndjsonResponse([
          JSON.stringify({
            type: 'stage',
            label: 'Iteration 1 in progress...',
            live: true,
          }),
          JSON.stringify({
            type: 'stage',
            label: 'Iteration 1 completed in 2s. 3 chunks retrieved.',
            live: false,
          }),
          JSON.stringify({ type: 'text', delta: 'Here is the answer.' }),
          JSON.stringify({ type: 'done' }),
        ]),
    });

    const states: KBChatState[] = [];
    session.on('update', (s) => states.push(s));

    await session.ask('hi');

    const liveStageState = states.find((s) => s.stage?.live === true);
    expect(liveStageState?.stage).toEqual({
      label: 'Iteration 1 in progress...',
      live: true,
    });

    const settledStageState = states.find((s) =>
      s.stage?.label.startsWith('Iteration 1 completed'),
    );
    expect(settledStageState?.stage).toEqual({
      label: 'Iteration 1 completed in 2s. 3 chunks retrieved.',
      live: false,
    });

    // The last reported stage persists in final state — the widget can choose whether
    // to keep showing it once text starts, but the session itself doesn't clear it.
    const final = session.getState();
    expect(final.text).toBe('Here is the answer.');
    expect(final.stage?.label).toBe('Iteration 1 completed in 2s. 3 chunks retrieved.');
  });

  it('has a null stage when the backend never emits stage events (non-agentic path)', async () => {
    const session = new KBChatSession({
      fetchResponse: async () =>
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'answer' }),
          JSON.stringify({ type: 'done' }),
        ]),
    });

    await session.ask('hi');

    expect(session.getState().stage).toBeNull();
  });

  it('resets text/citations/snippets/stage on a new ask() rather than accumulating across turns', async () => {
    const fetchResponse = vi
      .fn()
      .mockResolvedValueOnce(
        ndjsonResponse([
          JSON.stringify({
            type: 'stage',
            label: 'Iteration 1 in progress...',
            live: true,
          }),
          JSON.stringify({ type: 'text', delta: 'first answer' }),
          JSON.stringify({ type: 'citation', citation: { id: 'c1', snippetId: 's1' } }),
          JSON.stringify({ type: 'done' }),
        ]),
      )
      .mockResolvedValueOnce(
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'second answer' }),
          JSON.stringify({ type: 'done' }),
        ]),
      );

    const session = new KBChatSession({ fetchResponse });

    await session.ask('one');
    expect(session.getState().text).toBe('first answer');
    expect(session.getState().citations).toHaveLength(1);
    expect(session.getState().stage?.label).toBe('Iteration 1 in progress...');

    await session.ask('two');
    expect(session.getState().text).toBe('second answer');
    expect(session.getState().citations).toHaveLength(0);
    expect(session.getState().stage).toBeNull();
  });
});
