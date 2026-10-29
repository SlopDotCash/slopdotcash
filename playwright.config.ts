import { execFileSync } from "node:child_process";
import { availableParallelism } from "node:os";

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
// The slopdotcash App stand-in key (advisory reads) and the automatic
// private intake bindings (opt-in; tests/e2e/security-bounty.spec.ts).
const registryIntakeKey = process.env.SLOP_E2E_INTAKE_APP_KEY;
if (
  registryIntakeKey !== undefined &&
  !/^[A-Za-z0-9+/]+={0,2}$/u.test(registryIntakeKey)
)
  throw new Error("SLOP_E2E_INTAKE_APP_KEY must be a base64 PKCS#8 key");
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
    ? ` --binding SLOP_PRIVATE_INTAKE_MODE=on --binding GITHUB_INTAKE_APP_CLIENT_ID=Iv1.e2efixture --binding GITHUB_INTAKE_APP_CLIENT_SECRET=e2e-fixture-secret --binding SLOP_INTAKE_GRANT_KEY=${registryIntakeGrant} --binding SLOP_GITHUB_OAUTH_ORIGIN=${registryGitHub}`
    : "";
const registryVettingKey = process.env.SLOP_E2E_VETTING_PUBLIC_KEY;
if (
  registryVettingKey !== undefined &&
  !/^[A-Za-z0-9+/]{43}=$/u.test(registryVettingKey)
)
  throw new Error("SLOP_E2E_VETTING_PUBLIC_KEY must be a base64 Ed25519 key");
// The web server command runs in a shell: sh on Linux and macOS, cmd.exe on
// Windows. cmd.exe keeps single quotes in the argument, so a single-quoted
// binding reaches wrangler under a different name. Double-quoted JSON strings
// (no $, ` or %) give the same argument in both shells.
const shellArgument = (value: string) => JSON.stringify(value);
const registryArguments = registryPersistTo
  ? // Positive local registry workflows must explicitly select test networks;
    // the release configuration intentionally has no network enabled by default.
    ` --persist-to ${JSON.stringify(registryPersistTo)} --binding ${shellArgument('PAYMENT_NETWORKS=["base-sepolia","solana-devnet"]')}${
      registryAdmins ? ` --binding ADMIN_GITHUB_IDS=${registryAdmins}` : ""
    }${
      registryModerators
        ? ` --binding PROJECT_MODERATOR_GITHUB_IDS=${registryModerators}`
        : ""
    }${
      // The loopback fixture also answers the Surplus analysis provider, so
      // private analysis and appeal triage run in every registry run.
      registryGitHub
        ? ` --binding SLOP_GITHUB_API_ORIGIN=${registryGitHub} --binding SURPLUS_API_KEY=e2e-fixture-analysis-key --binding SLOP_ANALYSIS_API_ORIGIN=${registryGitHub}`
        : ""
    }${
      registryIntakeKey
        ? ` --binding GITHUB_INTAKE_APP_ID=1 --binding ${shellArgument(`GITHUB_INTAKE_APP_PRIVATE_KEY=${registryIntakeKey}`)}`
        : ""
    }${
      registryVettingKey
        ? ` --binding VETTING_RESULT_PUBLIC_KEYS=${registryVettingKey} --r2 VETTING_EVIDENCE`
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
  // Registry runs make the first service-binding call before the first test.
  globalSetup: registryPersistTo ? "./tests/e2e/registry-warmup.ts" : undefined,
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
  // workers, so the Pages phase keeps one worker. Registry tests also share
  // one local D1 fixture; concurrent writers can fail inside Miniflare.
  // Explicit local-chain runs share a chain port between viewport projects.
  // Other preview checks run in parallel, capped because each loads the ledger.
  // SLOP_E2E_WORKERS overrides either default.
  workers:
    requestedWorkers === undefined
      ? localServer === "pages" ||
        registryPersistTo !== undefined ||
        process.env.SLOP_E2E_VAULT_ACTIONS === "1" ||
        process.env.SLOP_E2E_SOLANA_VAULT === "1"
        ? 1
        : Math.max(1, Math.min(2, Math.floor(availableParallelism() / 2)))
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
  // Every spec runs at the 1440 px desktop and the 320 px mobile viewport; the
  // 1024 px laptop and 768 px tablet viewports run representative @breakpoint layouts.
  // The email workflow observed a Chromium no-store stream EOF and ERR_ABORTED
  // (https://github.com/microsoft/playwright/issues/42742). Keep the bounded
  // private reader and strict failure assertions, and run the email workflow
  // in Firefox at both widths. Firefox also repeats the private evidence
  // download. The registry lane shards by test order, and each viewport's
  // registry workflow is one serial group, so Firefox comes first: the
  // desktop group then starts in the first shard and the mobile group in the
  // second.
  projects: [
    {
      name: "firefox-desktop",
      testMatch: [
        "**/evidence-download.spec.ts",
        "**/email-preferences.spec.ts",
      ],
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "firefox-mobile",
      testMatch: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 320, height: 800 },
      },
    },
    {
      name: "chromium-desktop",
      testIgnore: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "chromium-mobile",
      grepInvert: /@desktop-only/,
      testIgnore: "**/email-preferences.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 800 },
      },
    },
    {
      name: "chromium-laptop",
      grep: /@breakpoint/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "chromium-tablet",
      grep: /@breakpoint/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
});
