// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KBChatWidget } from '../KBChatWidget.js';

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

/** An NDJSON stream whose controller stays open — for simulating an in-progress
 * agentic loop where more events (or `done`) haven't arrived yet. */
function openNdjsonStream(): {
  response: Response;
  push: (line: string) => void;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  return {
    response: new Response(stream),
    push: (line) => controllerRef.enqueue(encoder.encode(line + '\n')),
    close: () => controllerRef.close(),
  };
}

function ask(query: string): void {
  fireEvent.change(screen.getByPlaceholderText('Ask a question…'), {
    target: { value: query },
  });
  fireEvent.click(screen.getByText('Send'));
}

describe('KBChatWidget', () => {
  it('shows the agentic retrieval stage label while waiting, then the streamed answer', async () => {
    const { response, push, close } = openNdjsonStream();
    const fetchResponse = vi.fn().mockResolvedValue(response);

    render(<KBChatWidget fetchResponse={fetchResponse} />);

    await act(async () => ask('test query'));

    // No stage reported yet — falls back to the generic waiting label.
    await waitFor(() => expect(screen.getByText('Searching…')).toBeTruthy());

    await act(async () => {
      push(
        JSON.stringify({
          type: 'stage',
          label: 'Iteration 1 in progress...',
          live: true,
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText('Iteration 1 in progress...')).toBeTruthy(),
    );
    expect(screen.queryByText('Searching…')).toBeNull();

    await act(async () => {
      push(JSON.stringify({ type: 'text', delta: 'The final answer.' }));
      push(JSON.stringify({ type: 'done' }));
      close();
    });

    await waitFor(() => expect(screen.getByText('The final answer.')).toBeTruthy());
  });

  it('renders a cited source once the stream completes', async () => {
    const fetchResponse = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({ type: 'text', delta: 'The answer [1].' }),
        JSON.stringify({
          type: 'snippet',
          snippet: { id: 'result-0', title: 'Doc A', uri: 'https://x', excerpt: '...' },
        }),
        JSON.stringify({
          type: 'citation',
          citation: { id: 'c1', snippetId: 'result-0' },
        }),
        JSON.stringify({ type: 'done' }),
      ]),
    );

    render(<KBChatWidget fetchResponse={fetchResponse} />);

    await act(async () => ask('test query'));

    // "Doc A" appears in the Sources list (and the inline marker's popover title).
    await waitFor(() => expect(screen.getAllByText('Doc A').length).toBeGreaterThan(0));
  });

  it('shows only cited documents in the Sources list (omits uncited retrieved chunks)', async () => {
    const src = { knowledgeBaseId: 'kb1', dataSourceId: 'ds1', documentId: 'doc1' };
    const other = { knowledgeBaseId: 'kb1', dataSourceId: 'ds1', documentId: 'doc2' };
    const fetchResponse = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({ type: 'text', delta: 'Answer [1].' }),
        // Two chunks of doc1 (cited) + one chunk of an uncited doc2.
        JSON.stringify({
          type: 'snippet',
          snippet: {
            id: 'result-0',
            title: 'Doc A',
            uri: 'https://x',
            excerpt: 'chunk 1',
            source: src,
          },
        }),
        JSON.stringify({
          type: 'snippet',
          snippet: {
            id: 'result-1',
            title: 'Doc A',
            uri: 'https://x',
            excerpt: 'chunk 2',
            source: src,
          },
        }),
        JSON.stringify({
          type: 'snippet',
          snippet: {
            id: 'result-2',
            title: 'Doc B',
            uri: 'https://y',
            excerpt: 'unrelated',
            source: other,
          },
        }),
        JSON.stringify({
          type: 'citation',
          citation: { id: 'c1', snippetId: 'result-0' },
        }),
        JSON.stringify({ type: 'done' }),
      ]),
    );

    const { container } = render(<KBChatWidget fetchResponse={fetchResponse} />);
    await act(async () => ask('q'));

    await waitFor(() =>
      expect(screen.getByText('Answer', { exact: false })).toBeTruthy(),
    );
    // doc1's two chunks collapse to one entry; uncited doc2 is omitted → exactly 1.
    expect(container.querySelectorAll('.kbcw-source-item')).toHaveLength(1);
    expect(screen.queryByText('Doc B')).toBeNull();
  });

  it('renders an inline [N] marker as bracketed text with a hover popover of the chunk', async () => {
    const src = { knowledgeBaseId: 'kb1', dataSourceId: 'ds1', documentId: 'doc1' };
    const fetchResponse = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({ type: 'text', delta: 'The answer references a source [1].' }),
        JSON.stringify({
          type: 'snippet',
          snippet: {
            id: 'result-0',
            title: 'Doc A',
            uri: '',
            excerpt: 'the source chunk text',
            source: src,
          },
        }),
        JSON.stringify({
          type: 'citation',
          citation: { id: 'c1', snippetId: 'result-0' },
        }),
        JSON.stringify({ type: 'done' }),
      ]),
    );
    // The citation popover is purely about showing the grounding chunk — it must NOT
    // call resolveSource (opening the document is the Sources list's job).
    const resolveSource = vi
      .fn()
      .mockResolvedValue({ url: 'https://signed.example/doc1' });

    render(<KBChatWidget fetchResponse={fetchResponse} resolveSource={resolveSource} />);
    await act(async () => ask('q'));
    // The inline [1] marker renders as bracketed text on an accessible button.
    await waitFor(() => {
      const marker = screen.getByRole('button', { name: 'Source 1' });
      expect(marker.textContent).toBe('[1]');
    });

    // Its popover carries the chunk excerpt (shown on hover/focus via CSS), and the
    // citation marker itself is not a document link — there is no "View source" in it.
    // (resolveSource may be called to populate the separate Sources list; the point is
    // the citation marker shows the chunk, not a document link.)
    expect(screen.getByText('the source chunk text')).toBeTruthy();
    const marker = screen.getByRole('button', { name: 'Source 1' });
    expect(marker.closest('a')).toBeNull();
  });

  it('resolves a Sources-list link to a pre-signed URL via resolveSource (real anchor)', async () => {
    const src = { knowledgeBaseId: 'kb1', dataSourceId: 'ds1', documentId: 'doc1' };
    const fetchResponse = vi.fn().mockResolvedValue(
      ndjsonResponse([
        JSON.stringify({ type: 'text', delta: 'Answer [1].' }),
        JSON.stringify({
          type: 'snippet',
          snippet: {
            id: 'result-0',
            title: 'Doc A',
            uri: 'https://raw-uri/doc',
            excerpt: 'x',
            source: src,
          },
        }),
        JSON.stringify({
          type: 'citation',
          citation: { id: 'c1', snippetId: 'result-0' },
        }),
        JSON.stringify({ type: 'done' }),
      ]),
    );
    const resolveSource = vi
      .fn()
      .mockResolvedValue({ url: 'https://signed.example/doc1' });

    const { container } = render(
      <KBChatWidget fetchResponse={fetchResponse} resolveSource={resolveSource} />,
    );
    await act(async () => ask('q'));
    await waitFor(() =>
      expect(container.querySelector('.kbcw-source-link')).toBeTruthy(),
    );

    // The URL is resolved eagerly, and the Sources entry is a real anchor whose href
    // becomes the pre-signed URL (a plain link is never blocked by pop-up blockers).
    expect(resolveSource).toHaveBeenCalledWith(src);
    await waitFor(() => {
      const link = container.querySelector('.kbcw-source-link') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('https://signed.example/doc1');
      expect(link.getAttribute('target')).toBe('_blank');
    });
  });

  it('keeps prior turns in the transcript and clears them on Reset', async () => {
    const fetchResponse = vi
      .fn()
      .mockResolvedValueOnce(
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'First answer.' }),
          JSON.stringify({ type: 'done' }),
        ]),
      )
      .mockResolvedValueOnce(
        ndjsonResponse([
          JSON.stringify({ type: 'text', delta: 'Second answer.' }),
          JSON.stringify({ type: 'done' }),
        ]),
      );

    render(<KBChatWidget fetchResponse={fetchResponse} />);

    await act(async () => ask('first question'));
    await waitFor(() => expect(screen.getByText('First answer.')).toBeTruthy());

    await act(async () => ask('second question'));
    await waitFor(() => expect(screen.getByText('Second answer.')).toBeTruthy());

    // Both turns remain visible in the transcript.
    expect(screen.getByText('First answer.')).toBeTruthy();
    expect(screen.getByText('first question')).toBeTruthy();
    expect(screen.getByText('second question')).toBeTruthy();

    // Reset clears the whole transcript.
    await act(async () => {
      fireEvent.click(screen.getByText('Reset'));
    });
    expect(screen.queryByText('First answer.')).toBeNull();
    expect(screen.queryByText('Second answer.')).toBeNull();
    expect(
      screen.getByText('Ask a question to search your knowledge base.'),
    ).toBeTruthy();
  });
});
