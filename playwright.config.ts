import { execFileSync } from "node:child_process";
/**
 * Drives desktop and mobile browser verification against the built site.
 */

import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl =
  process.env.SLOP_BASE_URL ??
  process.env.GITARMY_BASE_URL ??
  process.env.ELIZA_ARMY_BASE_URL;
const prebuiltSite = process.env.SLOP_E2E_PREBUILT === "1";
const localServer = process.env.SLOP_E2E_SERVER ?? "pages";
if (!new Set(["pages", "preview"]).has(localServer)) {
  throw new TypeError(`Unsupported SLOP_E2E_SERVER: ${localServer}`);
}

const localServerCommand =
  localServer === "preview"
    ? "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4466 --strictPort"
    : "bunx wrangler pages dev dist --ip 127.0.0.1 --port 4466 --log-level warn --show-interactive-dev-session=false";

export default defineConfig({
  testDir: "./tests/e2e",
  metadata: {
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    server: localServer,
  },
  timeout: 120_000,
  globalTimeout: 20 * 60_000,
  outputDir: `test-results/${localServer}`,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Wrangler's Pages proxy can terminate while serving concurrent browser
  // workers. Keep one browser worker so the production-like server remains
  // available for the complete desktop/mobile matrix.
  workers: 1,
  // A retried browser failure cannot serve as binding release evidence: an
  // intermittent console, network, accessibility, or rendering failure must
  // fail the exact run instead of being converted into a flaky green result.
  retries: 0,
  reporter: [
    [
      "html",
      { open: "never", outputFolder: `playwright-report/${localServer}` },
    ],
    ["json", { outputFile: `test-results/${localServer}/results.json` }],
    ["list"],
  ],
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:4466",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `${prebuiltSite ? "" : "bun run build && "}${localServerCommand}`,
        url: "http://127.0.0.1:4466",
        // Evidence runs force a fresh server so a process already bound to the
        // port cannot substitute stale bytes. Direct local Playwright use may
        // still opt into its normal development convenience.
        reuseExistingServer:
          process.env.SLOP_E2E_FORCE_FRESH_SERVER !== "1" && !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [
    {
      name: "wide-desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "narrow-mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 800 },
      },
    },
  ],
});
