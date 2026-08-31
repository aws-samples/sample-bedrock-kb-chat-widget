// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { parseNdjsonStream } from '../parseNdjsonStream.js';
import type { KBChatEvent } from '../types.js';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<KBChatEvent[]> {
  const events: KBChatEvent[] = [];
  for await (const event of parseNdjsonStream(stream)) events.push(event);
  return events;
}

describe('parseNdjsonStream', () => {
  it('parses one event per line when chunks align with line boundaries', async () => {
    const stream = streamFromChunks([
      '{"type":"text","delta":"Hello "}\n',
      '{"type":"text","delta":"world"}\n',
      '{"type":"done"}\n',
    ]);
    expect(await collect(stream)).toEqual([
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'world' },
      { type: 'done' },
    ]);
  });

  it('buffers a line split across multiple network chunks', async () => {
    const stream = streamFromChunks([
      '{"type":"text",',
      '"delta":"partial line split mid-JSON"}\n',
      '{"type":"done"}\n',
    ]);
    expect(await collect(stream)).toEqual([
      { type: 'text', delta: 'partial line split mid-JSON' },
      { type: 'done' },
    ]);
  });

  it('handles a citation arriving before its snippet without dropping either', async () => {
    const stream = streamFromChunks([
      '{"type":"citation","citation":{"id":"c1","snippetId":"s1"}}\n',
      '{"type":"snippet","snippet":{"id":"s1","title":"Doc","uri":"https://x","excerpt":"..."}}\n',
    ]);
    const events = await collect(stream);
    expect(events[0]).toEqual({
      type: 'citation',
      citation: { id: 'c1', snippetId: 's1' },
    });
    expect(events[1].type).toBe('snippet');
  });

  it('skips a malformed line rather than throwing', async () => {
    const stream = streamFromChunks([
      'not json at all\n',
      '{"type":"text","delta":"still works"}\n',
    ]);
    expect(await collect(stream)).toEqual([{ type: 'text', delta: 'still works' }]);
  });

  it('parses a final line with no trailing newline (stream closes mid-line)', async () => {
    const stream = streamFromChunks(['{"type":"text","delta":"no trailing newline"}']);
    expect(await collect(stream)).toEqual([
      { type: 'text', delta: 'no trailing newline' },
    ]);
  });

  it('returns no events for an empty stream', async () => {
    const stream = streamFromChunks([]);
    expect(await collect(stream)).toEqual([]);
  });
});
