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
// scripts/run-e2e.mjs runs the preview and Pages phases at the same time, so
// each phase binds its own port.
const localPort = Number(process.env.SLOP_E2E_PORT ?? 4466);
if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535)
  throw new Error("SLOP_E2E_PORT must be an unprivileged TCP port");
const localOrigin = `http://127.0.0.1:${localPort}`;
const requestedWorkers = process.env.SLOP_E2E_WORKERS;

const localServerCommand =
  localServer === "preview"
    ? `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${localPort} --strictPort`
    : `node node_modules/wrangler/bin/wrangler.js pages dev dist --ip 127.0.0.1 --port ${localPort} --log-level warn --show-interactive-dev-session=false`;

export default defineConfig({
  testDir: "./tests/e2e",
  metadata: {
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    server: localServer,
  },
  timeout: 120_000,
  // The deploy job's own 180 min limit still bounds a hung suite.
  globalTimeout: 35 * 60_000,
  outputDir: `test-results/${localServer}`,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Wrangler's Pages proxy can terminate while serving concurrent browser
  // workers, so the Pages phase keeps one worker. The static preview server
  // serves the full desktop/mobile matrix in parallel. SLOP_E2E_WORKERS
  // overrides either default.
  workers:
    requestedWorkers === undefined
      ? localServer === "pages"
        ? 1
        : "50%"
      : requestedWorkers.endsWith("%")
        ? requestedWorkers
        : Number(requestedWorkers),
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
    baseURL: externalBaseUrl ?? localOrigin,
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `${prebuiltSite ? "" : "bun run build && "}${localServerCommand}`,
        url: localOrigin,
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
