// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKBChat } from '../useKBChat.js';

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

function TestHarness({
  fetchResponse,
}: {
  fetchResponse: (q: string) => Promise<Response>;
}) {
  const { ask, text, isStreaming, citations, error, stage } = useKBChat({
    fetchResponse,
  });
  return (
    <div>
      <div data-testid="text">{text}</div>
      <div data-testid="streaming">{String(isStreaming)}</div>
      <div data-testid="citation-count">{citations.length}</div>
      <div data-testid="error">{error?.message ?? ''}</div>
      <div data-testid="stage">{stage?.label ?? ''}</div>
      <div data-testid="stage-live">{String(stage?.live ?? '')}</div>
      <button onClick={() => ask('a question')}>ask</button>
    </div>
  );
}

describe('useKBChat', () => {
  it('starts idle, then reflects streamed text and isStreaming as chunks arrive', async () => {
    const fetchResponse = vi
      .fn()
      .mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'Hello ' }),
          JSON.stringify({ type: 'text', delta: 'world' }),
          JSON.stringify({ type: 'citation', citation: { id: 'c1', snippetId: 's1' } }),
          JSON.stringify({ type: 'done' }),
        ]),
      );

    render(<TestHarness fetchResponse={fetchResponse} />);

    expect(screen.getByTestId('text').textContent).toBe('');
    expect(screen.getByTestId('streaming').textContent).toBe('false');

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('text').textContent).toBe('Hello world'),
    );
    expect(screen.getByTestId('streaming').textContent).toBe('false');
    expect(screen.getByTestId('citation-count').textContent).toBe('1');
  });

  it('surfaces agentic retrieval stage progress, then the final answer', async () => {
    const fetchResponse = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({
          type: 'stage',
          label: 'Iteration 1 in progress...',
          live: true,
        }),
        JSON.stringify({ type: 'text', delta: 'answer' }),
        JSON.stringify({ type: 'done' }),
      ]),
    );

    render(<TestHarness fetchResponse={fetchResponse} />);

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() => expect(screen.getByTestId('text').textContent).toBe('answer'));
    expect(screen.getByTestId('stage').textContent).toBe('Iteration 1 in progress...');
    expect(screen.getByTestId('stage-live').textContent).toBe('true');
  });

  it('surfaces an error without throwing in the component', async () => {
    const fetchResponse = vi.fn().mockRejectedValue(new Error('backend unreachable'));

    render(<TestHarness fetchResponse={fetchResponse} />);

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('backend unreachable'),
    );
    expect(screen.getByTestId('streaming').textContent).toBe('false');
  });

  it('does not recreate the session when an inline fetchResponse function is passed each render', async () => {
    const fetchResponse = vi
      .fn()
      .mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'ok' }),
          JSON.stringify({ type: 'done' }),
        ]),
      );

    function Wrapper() {
      // A new inline closure every render — the common real-world usage pattern.
      return <TestHarness fetchResponse={(q) => fetchResponse(q)} />;
    }

    const { rerender } = render(<Wrapper />);
    rerender(<Wrapper />);
    rerender(<Wrapper />);

    await act(async () => {
      screen.getByText('ask').click();
    });

    await waitFor(() => expect(screen.getByTestId('text').textContent).toBe('ok'));
    expect(fetchResponse).toHaveBeenCalledTimes(1);
  });
});
