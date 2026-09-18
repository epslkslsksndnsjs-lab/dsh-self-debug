import { defineConfig } from 'vitest/config';

// CI-consumable test command: `vitest run` (wired to `npm test`).
// No network is required: every fixture project's scripts run offline.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Real-subprocess tests (no mocks) contend for the CPU and the toolchain
    // when files run in parallel; serializing files keeps per-test timings
    // stable and the suite reliable in CI (still network-free).
    fileParallelism: false,
    // Subprocess-heavy checks can be slow on a loaded CI box; give headroom.
    testTimeout: 15000,
  },
});
