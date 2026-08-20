/**
 * Runs deterministic component and contribution-scoring tests in a browser-like DOM.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Several contract suites intentionally rebuild the shared public tree or
    // launch installer subprocesses. Running test files concurrently makes
    // those integration checks contend with one another and hit Vitest's
    // per-test timeout despite passing in isolation.
    fileParallelism: false,
    hookTimeout: 300_000,
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 0,
    include: [
      "functions/**/*.test.ts",
      "workers/**/*.test.ts",
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.{ts,mjs}",
      "tests/**/*.test.{ts,tsx}",
    ],
  },
});
