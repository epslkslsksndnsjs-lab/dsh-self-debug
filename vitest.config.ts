import { defineConfig } from 'vitest/config';

// CI-consumable test command: `vitest run` (wired to `npm test`).
// No network is required: every fixture project's scripts run offline.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
