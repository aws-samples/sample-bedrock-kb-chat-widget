// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { KBChatWidget } from './KBChatWidget.js';
import type { KBChatWidgetProps } from './types.js';

export interface KBChatWidgetInitOptions extends KBChatWidgetProps {
  target: HTMLElement;
}

/**
 * Entry point for the `<script>` tag build (IIFE, global `KBChatWidget`, set via
 * tsup's --global-name from this module's own exports). Mounts the same React
 * component used by the npm package — no-build customers get identical behavior to
 * bundler-based ones, just without needing their own React setup.
 */
export function init(options: KBChatWidgetInitOptions): void {
  const { target, ...props } = options;
  createRoot(target).render(createElement(KBChatWidget, props));
}
