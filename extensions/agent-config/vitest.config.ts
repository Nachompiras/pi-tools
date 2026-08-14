import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extensions/agent-config/test/**/*.test.ts"],
    environment: "node",
    globals: false,
    // NodeNext modules require forking to avoid ESM import quirks.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Suppress noisy TUI output in CI.
    reporters: ["default"],
  },
});