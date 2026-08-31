// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ReactNode } from 'react';
import type { FetchResponse, ResolveSource } from '@sample/kb-chat-core';
import type { Citation, Snippet } from '@sample/kb-chat-react';

export interface KBChatWidgetTheme {
  primaryColor?: string;
  fontFamily?: string;
}

export interface KBChatWidgetProps {
  fetchResponse: FetchResponse;
  theme?: KBChatWidgetTheme;
  /** Header title shown at the top of the widget. Defaults to "Knowledge base assistant". */
  title?: string;
  /**
   * Optional logo shown in the header before the title, for host branding. Pass an
   * image URL (rendered as an <img>) or your own React node for full control.
   */
  logo?: string | ReactNode;
  placeholder?: string;
  /**
   * Optionally resolve a source document to an openable URL on demand (e.g. via a
   * backend `GetDocumentContent` proxy). When provided, clicking a citation reveals a
   * "View source" link resolved through this. Never handles AWS credentials.
   */
  resolveSource?: ResolveSource;
  onCitationClick?: (snippet: Snippet, citation: Citation) => void;
  onError?: (error: Error) => void;
}
