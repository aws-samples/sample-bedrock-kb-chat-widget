// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { KBChatEvent } from './types.js';

/**
 * Reads newline-delimited JSON from a byte stream, yielding one parsed event per line.
 * Chunks from the network rarely align with line boundaries, so incomplete lines are
 * buffered until a newline completes them. A malformed line is skipped rather than
 * thrown — one bad line should not kill an otherwise-healthy stream.
 */
export async function* parseNdjsonStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<KBChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseLine(line);
        if (event) yield event;
      }
    }

    buffer += decoder.decode();
    const finalEvent = parseLine(buffer);
    if (finalEvent) yield finalEvent;
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string): KBChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as KBChatEvent;
  } catch {
    return null;
  }
}

/** Normalizes a fetch Response or a raw ReadableStream into a byte stream. */
export function toByteStream(
  source: Response | ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  if (source instanceof ReadableStream) return source;
  if (!source.body) {
    throw new Error('fetchResponse resolved to a Response with no readable body');
  }
  return source.body;
}
