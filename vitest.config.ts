import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom for the React-integration and DOM-input tests; pure engine/state
    // machine tests do not depend on it but tolerate the shared environment.
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
});
