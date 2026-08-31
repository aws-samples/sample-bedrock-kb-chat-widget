// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { parseNdjsonStream, toByteStream } from './parseNdjsonStream.js';
import type { KBChatListener, KBChatSessionOptions, KBChatState } from './types.js';

const initialState = (): KBChatState => ({
  text: '',
  citations: [],
  snippets: [],
  isStreaming: false,
  error: null,
  stage: null,
});

/**
 * Framework-agnostic streaming session. Owns no DOM, no AWS credentials, and no
 * opinion on how `fetchResponse` reaches the customer's backend — it only knows how
 * to turn a byte stream of KBChatEvents into state updates.
 *
 * A new `ask()` call replaces the in-flight state; an older in-flight stream that
 * resolves after a newer `ask()` was issued is discarded rather than clobbering the
 * newer state, since fetch/stream requests are not guaranteed to resolve in order.
 */
export class KBChatSession {
  private state: KBChatState = initialState();
  private listeners = new Set<KBChatListener>();
  private generation = 0;

  constructor(private readonly options: KBChatSessionOptions) {}

  getState(): KBChatState {
    return this.state;
  }

  on(event: 'update', listener: KBChatListener): () => void {
    if (event !== 'update') {
      throw new Error(`Unsupported event: ${event}`);
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ask(query: string): Promise<void> {
    const myGeneration = ++this.generation;

    this.setState(
      {
        ...initialState(),
        isStreaming: true,
      },
      myGeneration,
    );

    try {
      const response = await this.options.fetchResponse(query);
      const byteStream = toByteStream(response);

      for await (const event of parseNdjsonStream(byteStream)) {
        if (myGeneration !== this.generation) return; // superseded by a newer ask()

        switch (event.type) {
          case 'text':
            this.setState(
              {
                ...this.state,
                text: this.state.text + event.delta,
              },
              myGeneration,
            );
            break;
          case 'citation':
            this.setState(
              {
                ...this.state,
                citations: [...this.state.citations, event.citation],
              },
              myGeneration,
            );
            break;
          case 'snippet':
            this.setState(
              {
                ...this.state,
                snippets: [...this.state.snippets, event.snippet],
              },
              myGeneration,
            );
            break;
          case 'stage':
            this.setState(
              {
                ...this.state,
                stage: { label: event.label, live: event.live },
              },
              myGeneration,
            );
            break;
          case 'error':
            this.setState(
              {
                ...this.state,
                isStreaming: false,
                error: new Error(event.message),
              },
              myGeneration,
            );
            return;
          case 'done':
            this.setState(
              {
                ...this.state,
                isStreaming: false,
              },
              myGeneration,
            );
            return;
        }
      }

      // Stream ended without an explicit 'done' event (e.g. connection closed early).
      if (myGeneration === this.generation) {
        this.setState({ ...this.state, isStreaming: false }, myGeneration);
      }
    } catch (err) {
      if (myGeneration !== this.generation) return;
      this.setState(
        {
          ...this.state,
          isStreaming: false,
          error: err instanceof Error ? err : new Error(String(err)),
        },
        myGeneration,
      );
    }
  }

  private setState(next: KBChatState, generation: number): void {
    if (generation !== this.generation) return;
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }
}
