/**
 * Runs deterministic component and contribution-scoring tests in a browser-like DOM.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "src/lib/leaderboard.ts",
        "src/lib/reward-cycle.ts",
        "src/lib/rewards.ts",
        "src/lib/run-receipts.ts",
        "src/lib/wallets.ts",
        "src/lib/review-records.ts",
        "src/lib/contribution-quality.ts",
        "src/lib/browser-json.ts",
      ],
    },
    hookTimeout: 120_000,
    testTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: "domain",
          environment: "node",
          include: ["src/lib/**/*.test.ts"],
          exclude: ["src/lib/install-command.test.ts"],
          fileParallelism: true,
          maxWorkers: 4,
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "functions/**/*.test.ts",
            "workers/**/*.test.ts",
            "src/**/*.test.{ts,tsx}",
            "scripts/**/*.test.{ts,mjs}",
            "tests/**/*.test.{ts,tsx}",
          ],
          sequence: { groupOrder: 1 },
          environment: "jsdom",
          exclude: ["src/lib/**/*.test.ts"],
          // Shared publication and installer fixtures are intentionally serial.
          fileParallelism: false,
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "installer",
          sequence: { groupOrder: 2 },
          environment: "node",
          include: ["src/lib/install-command.test.ts"],
          fileParallelism: false,
          setupFiles: [],
        },
      },
    ],
  },
});
