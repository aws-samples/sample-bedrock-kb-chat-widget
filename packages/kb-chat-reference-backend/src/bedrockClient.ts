// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';

/**
 * AWS SDK v3 has no request timeout by default (DEFAULT_REQUEST_TIMEOUT = 0) and its
 * default retry count is low for a user-facing streaming call — a transient throttle
 * or connect blip would otherwise surface directly to the end user instead of being
 * absorbed by the SDK's own adaptive retry strategy.
 */
export function createBedrockClient(region: string): BedrockAgentRuntimeClient {
  return new BedrockAgentRuntimeClient({
    region,
    maxAttempts: 3,
    retryMode: 'adaptive',
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      requestTimeout: 60_000, // generous: this wraps a streaming call, not a quick RPC
    }),
  });
}
