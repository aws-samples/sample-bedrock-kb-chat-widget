import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@sample/kb-chat-core': path.resolve(
        __dirname,
        'packages/kb-chat-core/src/index.ts',
      ),
      '@sample/kb-chat-react': path.resolve(
        __dirname,
        'packages/kb-chat-react/src/index.ts',
      ),
    },
  },
});
