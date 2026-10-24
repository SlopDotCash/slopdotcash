import { execFileSync } from "node:child_process";

/**
 * Drives desktop and mobile browser verification against the built site.
 */

import { defineConfig, devices } from "@playwright/test";
import { localEvidencePolicy } from "./tests/vetting-evidence-fixture";

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

// The registry lane gives Pages a fresh local D1, test-only admins and
// test-only project moderators.
const registryNotify = process.env.SLOP_E2E_NOTIFY_SERVICE;
if (
  registryNotify !== undefined &&
  !/^slop-notify-e2e-[0-9]{4,5}$/u.test(registryNotify)
)
  throw new Error("Invalid local notification Worker name");
const registrySlopbot = process.env.SLOP_E2E_SLOPBOT_SERVICE;
if (
  registrySlopbot !== undefined &&
  !/^slopbot-e2e-[0-9]{4,5}$/u.test(registrySlopbot)
)
  throw new Error("Invalid local Slopbot Worker name");
const registryPersistTo = process.env.SLOP_E2E_PERSIST_TO;
const registryAdmins = process.env.SLOP_E2E_ADMIN_GITHUB_IDS;
const registryModerators = process.env.SLOP_E2E_MODERATOR_GITHUB_IDS;
for (const [name, value] of [
  ["SLOP_E2E_ADMIN_GITHUB_IDS", registryAdmins],
  ["SLOP_E2E_MODERATOR_GITHUB_IDS", registryModerators],
])
  if (value !== undefined && !/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/u.test(value))
    throw new Error(`${name} must list GitHub actor IDs`);
const registryGitHub = process.env.SLOP_E2E_GITHUB_API_ORIGIN;
if (
  registryGitHub !== undefined &&
  !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/u.test(registryGitHub)
)
  throw new Error("SLOP_E2E_GITHUB_API_ORIGIN must be a loopback origin");
// Automatic private intake bindings (opt-in; tests/e2e/security-bounty.spec.ts).
const registryIntakeKey = process.env.SLOP_E2E_INTAKE_APP_KEY;
const registryIntakeGrant = process.env.SLOP_E2E_INTAKE_GRANT_KEY;
if (
  process.env.SLOP_E2E_PRIVATE_INTAKE === "1" &&
  (registryGitHub === undefined ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(registryIntakeKey ?? "") ||
    !/^[A-Za-z0-9_-]{43}$/u.test(registryIntakeGrant ?? ""))
)
  throw new Error("Private intake e2e needs the loopback fixture and keys");
const registryIntake =
  process.env.SLOP_E2E_PRIVATE_INTAKE === "1"
    ? ` --binding SLOP_PRIVATE_INTAKE_MODE=on --binding GITHUB_INTAKE_APP_CLIENT_ID=Iv1.e2efixture --binding GITHUB_INTAKE_APP_CLIENT_SECRET=e2e-fixture-secret --binding GITHUB_INTAKE_APP_ID=1 --binding 'GITHUB_INTAKE_APP_PRIVATE_KEY=${registryIntakeKey}' --binding SLOP_INTAKE_GRANT_KEY=${registryIntakeGrant} --binding SLOP_GITHUB_OAUTH_ORIGIN=${registryGitHub}`
    : "";
const registryVettingKey = process.env.SLOP_E2E_VETTING_PUBLIC_KEY;
if (
  registryVettingKey !== undefined &&
  !/^[A-Za-z0-9+/]{43}=$/u.test(registryVettingKey)
)
  throw new Error("SLOP_E2E_VETTING_PUBLIC_KEY must be a base64 Ed25519 key");
const registryArguments = registryPersistTo
  ? ` --persist-to ${JSON.stringify(registryPersistTo)}${
      registryAdmins ? ` --binding ADMIN_GITHUB_IDS=${registryAdmins}` : ""
    }${
      registryModerators
        ? ` --binding PROJECT_MODERATOR_GITHUB_IDS=${registryModerators}`
        : ""
    }${
      registryGitHub
        ? ` --binding SLOP_GITHUB_API_ORIGIN=${registryGitHub}`
        : ""
    }${
      registryVettingKey
        ? ` --binding VETTING_RESULT_PUBLIC_KEYS=${registryVettingKey} --r2 VETTING_EVIDENCE --binding 'VETTING_EVIDENCE_POLICY=${JSON.stringify({ ...localEvidencePolicy(new Date()), maxObjectBytes: 32 * 1024 * 1024 }).replaceAll("'", "'\\''")}'`
        : ""
    }${registryNotify ? ` --service SLOP_NOTIFY=${registryNotify}` : ""}${
      registrySlopbot ? ` --service SLOPBOT=${registrySlopbot}` : ""
    }${registryIntake}`
  : "";
const outputName = process.env.SLOP_E2E_OUTPUT ?? localServer;

const localServerCommand =
  localServer === "preview"
    ? `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${localPort} --strictPort`
    : `node node_modules/wrangler/bin/wrangler.js pages dev dist --ip 127.0.0.1 --port ${localPort} --inspector-port 0 --log-level warn --show-interactive-dev-session=false${registryArguments}`;

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
  outputDir: `test-results/${outputName}`,
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
      { open: "never", outputFolder: `playwright-report/${outputName}` },
    ],
    ["json", { outputFile: `test-results/${outputName}/results.json` }],
    ["list"],
  ],
  use: {
    baseURL: externalBaseUrl ?? localOrigin,
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "on",
    video: process.env.SLOP_E2E_VIDEO === "1" ? "on" : "retain-on-failure",
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
      name: "evidence-firefox",
      testMatch: "**/evidence-download.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    // Observed no-store stream EOF + ERR_ABORTED matches this Chromium report:
    // https://github.com/microsoft/playwright/issues/42742
    // Keep the bounded private reader and strict failure assertions. Exercise
    // the new email workflow in Firefox; existing Chromium coverage is unchanged.
    ...[
      ["wide-desktop", 1440, 1000],
      ["desktop", 1024, 768],
      ["tablet", 768, 1024],
      ["narrow-mobile", 320, 800],
    ].map(([name, width, height]) => ({
      name: `${name}-email-firefox`,
      testMatch: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: Number(width), height: Number(height) },
      },
    })),
    {
      name: "wide-desktop-chromium",
      testIgnore: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "desktop-chromium",
      testIgnore: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "tablet-chromium",
      testIgnore: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "narrow-mobile-chromium",
      testIgnore: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 800 },
      },
    },
  ],
});
