/**
 * Drives desktop and mobile browser verification against the built site.
 */

import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl =
  process.env.SLOP_BASE_URL ??
  process.env.GITARMY_BASE_URL ??
  process.env.ELIZA_ARMY_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Wrangler's Pages proxy can terminate while serving concurrent browser
  // workers. Keep one browser worker so the production-like server remains
  // available for the complete desktop/mobile matrix.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:4466",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          "bun run build && bunx wrangler pages dev dist --ip 127.0.0.1 --port 4466 --log-level warn --show-interactive-dev-session=false",
        url: "http://127.0.0.1:4466",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
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
