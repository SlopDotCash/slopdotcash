import {
  E2E_EMAIL_ACCOUNTS,
  startNotifyWorkerFixture,
} from "../tests/notify-worker-fixture.mjs";

/**
 * Runs the complete browser matrix against the stable built-site preview and,
 * at the same time, checks redirects, artifacts, and contributor API access
 * with Pages headers. Wrangler can terminate during long browser sessions on
 * constrained hosted runners, while that focused check still exercises the
 * behavior only Pages supplies instead of replacing it with a generic
 * static-server assertion. Each phase owns its own port and output folder, so
 * the two phases run concurrently and neither can serve the other's bytes.
 * SLOP_E2E_LANE=preview|pages|registry runs one phase only, so CI can split
 * the phases (and preview or registry shards passed as --shard=N/M) across
 * separate runners. Each registry shard gets its own local D1.
 *
 * The D1 project registry may be empty, so the preview and Pages phases run
 * in the fixture workspace from prepare-e2e-fixture.mjs, which restores the
 * frozen projects and history. The registry phase runs the @registry specs on
 * the shipped bundle with Pages Functions, a fresh local D1, and two seeded
 * site sessions.
 */

import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_MAINTAINER_ACCOUNTS,
  E2E_OWNER,
  E2E_SECURITY_ACCOUNTS,
  startGitHubApiFixture,
} from "../tests/github-api-fixture.mjs";
import { startSlopbotWorkerFixture } from "../tests/slopbot-worker-fixture.mjs";
import { childEnvironment } from "./child-environment.mjs";
import { prepareE2eFixture } from "./prepare-e2e-fixture.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";
import { sha256Hex } from "./sha256.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = join(packageRoot, "node_modules", ".bin", "playwright");
function runSync(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env: childEnvironment(),
    stdio: "inherit",
    timeout: 40 * 60_000,
    killSignal: "SIGKILL",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed with status ${result.status ?? "unknown"}`,
    );
}

function runPhase(label, server, port, args, extraEnv = {}) {
  // Each registry shard shares one local SQLite database between Pages and
  // Slopbot. Concurrent test files can invalidate a reporting read's snapshot
  // while another file writes. Keep those cases serial; separate shards still
  // have independent databases, and preview keeps its requested parallelism.
  const workers = label === "registry" ? "1" : process.env.SLOP_E2E_WORKERS;
  return runE2ePhase({
    label,
    command: playwright,
    args: ["test", ...args],
    cwd: packageRoot,
    env: {
      ...childEnvironment(),
      ...extraEnv,
      SLOP_E2E_PREBUILT: "1",
      SLOP_E2E_FORCE_FRESH_SERVER: "1",
      SLOP_E2E_SERVER: server,
      SLOP_E2E_PORT: port,
      ...(workers ? { SLOP_E2E_WORKERS: workers } : {}),
    },
  });
}

const lane = process.env.SLOP_E2E_LANE;
if (
  lane !== undefined &&
  lane !== "preview" &&
  lane !== "pages" &&
  lane !== "registry"
) {
  throw new TypeError(`Unsupported SLOP_E2E_LANE: ${lane}`);
}
const insideFixture = process.env.SLOP_E2E_WORKSPACE === "fixture";

// Explicit local-chain workflows use the seeded fixture, which builds and
// verifies its own manifest below. They have no live-registry ledger to build
// in the outer checkout. Release and ordinary browser checks retain that gate.
const walletFixture =
  !insideFixture &&
  lane === "preview" &&
  (process.env.SLOP_E2E_VAULT_ACTIONS === "1" ||
    process.env.SLOP_E2E_SOLANA_VAULT === "1");
if (!walletFixture) {
  if (process.env.SLOP_E2E_PREBUILT !== "1") runSync("bun", ["run", "build"]);
  runSync("node", ["scripts/dist-manifest.mjs", "verify-local", "dist"]);
}

// The preview phase binds the base port and Pages binds the next one.
const basePort = Number(process.env.SLOP_E2E_PORT ?? "4466");
if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65534) {
  throw new TypeError(`Invalid SLOP_E2E_PORT: ${process.env.SLOP_E2E_PORT}`);
}
const extraArgs = process.argv.slice(2);
const wrangler = join(
  packageRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const E2E_ADMIN_GITHUB_ID = "900000001";
// A second admin with the moderator role decides appeals independently.
const E2E_MODERATOR_GITHUB_ID = "900000004";
// The recorded evidence policy owner (backend/vetting/evidence.ts). The
// evidence policy accepts only the recorded owner and readers.
const E2E_EVIDENCE_OWNER_GITHUB_ID = "18633264";

function sessionToken() {
  return randomBytes(32).toString("base64url");
}

/** Creates a fresh local D1 with every migration and two site sessions. */
function prepareRegistryDatabase(persistTo) {
  const local = ["--local", "--persist-to", persistTo];
  runSync("node", [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "slop-private",
    ...local,
  ]);
  const sessions = {
    admin: { token: sessionToken(), githubId: E2E_ADMIN_GITHUB_ID },
    applicant: { token: sessionToken(), githubId: "900000002" },
    moderator: { token: sessionToken(), githubId: E2E_MODERATOR_GITHUB_ID },
    owner: { token: sessionToken(), githubId: E2E_OWNER.githubId },
    evidenceOwner: {
      token: sessionToken(),
      githubId: E2E_EVIDENCE_OWNER_GITHUB_ID,
    },
    ...Object.fromEntries(
      Object.entries(E2E_EMAIL_ACCOUNTS).map(([role, githubId]) => [
        role,
        { token: sessionToken(), githubId },
      ]),
    ),
    // Maintainers a moderator bans in tests/e2e/registry.spec.ts.
    ...Object.fromEntries(
      Object.entries(E2E_MAINTAINER_ACCOUNTS).map(([role, githubId]) => [
        role,
        { token: sessionToken(), githubId },
      ]),
    ),
    // Private security bounty roles (tests/e2e/security-bounty.spec.ts).
    ...Object.fromEntries(
      Object.entries(E2E_SECURITY_ACCOUNTS).map(([role, githubId]) => [
        role,
        { token: sessionToken(), githubId },
      ]),
    ),
  };
  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const sql = Object.entries(sessions)
    .map(([role, { token, githubId }]) => {
      const actor = `U_e2e_${role}`;
      const hash = sha256Hex(token);
      return `INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('${actor}','${githubId}','e2e-${role}','2026-01-01T00:00:00.000Z',0); INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES('${hash}','${actor}','${expires}');`;
    })
    .join(" ");
  runSync("node", [
    wrangler,
    "d1",
    "execute",
    "slop-private",
    ...local,
    "--command",
    sql,
  ]);
  // A throwaway key stands in for the external secure-VM vetting service.
  const vettingKey = generateKeyPairSync("ed25519");
  return {
    persistTo,
    env: {
      SLOP_E2E_VETTING_PUBLIC_KEY: Buffer.from(
        vettingKey.publicKey.export({ format: "jwk" }).x,
        "base64url",
      ).toString("base64"),
      SLOP_E2E_VETTING_PRIVATE_KEY: vettingKey.privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      SLOP_E2E_PERSIST_TO: persistTo,
      SLOP_E2E_ADMIN_GITHUB_IDS: `${E2E_ADMIN_GITHUB_ID},${E2E_MODERATOR_GITHUB_ID}`,
      // The security "dispute" account is a Slop moderator: moderators decide
      // escalated private-case appeals and related-party award reviews.
      SLOP_E2E_MODERATOR_GITHUB_IDS: `${E2E_ADMIN_GITHUB_ID},${E2E_MODERATOR_GITHUB_ID},${E2E_SECURITY_ACCOUNTS.dispute}`,
      SLOP_E2E_ADMIN_TOKEN: sessions.admin.token,
      SLOP_E2E_APPLICANT_TOKEN: sessions.applicant.token,
      SLOP_E2E_EMAIL_TOKENS: JSON.stringify(
        Object.fromEntries(
          Object.keys(E2E_EMAIL_ACCOUNTS).map((role) => [
            role,
            sessions[role].token,
          ]),
        ),
      ),
      SLOP_E2E_MAINTAINER_TOKENS: JSON.stringify(
        Object.fromEntries(
          Object.keys(E2E_MAINTAINER_ACCOUNTS).map((role) => [
            role,
            sessions[role].token,
          ]),
        ),
      ),
      SLOP_E2E_MODERATOR_TOKEN: sessions.moderator.token,
      SLOP_E2E_OWNER_TOKEN: sessions.owner.token,
      SLOP_E2E_EVIDENCE_OWNER_TOKEN: sessions.evidenceOwner.token,
      SLOP_E2E_SECURITY_TOKENS: JSON.stringify(
        Object.fromEntries(
          Object.keys(E2E_SECURITY_ACCOUNTS).map((role) => [
            role,
            sessions[role].token,
          ]),
        ),
      ),
    },
  };
}

async function runRegistryPhase() {
  const persistTo = mkdtempSync(join(tmpdir(), "slop-e2e-d1-"));
  const githubPort = basePort + 3;
  let github, notify, slopbot;
  let failed = false;
  let failure;
  let status;
  try {
    const database = prepareRegistryDatabase(persistTo);
    github = await startGitHubApiFixture(githubPort);
    notify = await startNotifyWorkerFixture(
      packageRoot,
      persistTo,
      basePort + 4,
    );
    slopbot = await startSlopbotWorkerFixture(
      packageRoot,
      `http://127.0.0.1:${githubPort}`,
      basePort + 5,
      persistTo,
    );
    status = await runPhase(
      "registry",
      "pages",
      String(basePort + 2),
      ["--grep", "@registry", ...extraArgs],
      {
        ...database.env,
        SLOP_E2E_GITHUB_API_ORIGIN: `http://127.0.0.1:${githubPort}`,
        // A throwaway key for the slopdotcash App stand-in. It mints the
        // fixture's advisory-read installation tokens in every registry run.
        SLOP_E2E_INTAKE_APP_KEY: generateKeyPairSync("rsa", {
          modulusLength: 2048,
        })
          .privateKey.export({ format: "der", type: "pkcs8" })
          .toString("base64"),
        // Automatic private intake against the loopback fixture, opt-in so
        // the default lane keeps intake off.
        ...(process.env.SLOP_E2E_PRIVATE_INTAKE === "1"
          ? {
              SLOP_E2E_PRIVATE_INTAKE: "1",
              SLOP_E2E_INTAKE_GRANT_KEY: randomBytes(32).toString("base64url"),
            }
          : {}),
        SLOP_E2E_OUTPUT: "registry",
        SLOP_E2E_NOTIFY_SERVICE: notify.name,
        SLOP_E2E_SLOPBOT_SERVICE: slopbot.name,
        SLOP_E2E_REPORTING_REFRESH: `http://127.0.0.1:${basePort + 5}/__fixture/reporting-refresh`,
        ...(process.env.SLOP_VETTING_OVERLAY_PATH
          ? { SLOP_VETTING_OVERLAY_PATH: process.env.SLOP_VETTING_OVERLAY_PATH }
          : {}),
      },
    );
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => slopbot?.close()),
      Promise.resolve().then(() => notify?.close()),
      Promise.resolve().then(() => github?.close()),
    ]);
    // The fixture Workers hold the local D1 files until they exit, and
    // Windows refuses to delete an open file. Windows can also release the
    // stopped Pages server's handles a moment later, so retry with a bound.
    // Use the asynchronous rm: on Windows, rmSync throws EPERM at once and
    // does not use maxRetries.
    const removed = await Promise.allSettled([
      rm(persistTo, {
        force: true,
        recursive: true,
        maxRetries: 10,
        retryDelay: 200,
      }),
    ]);
    const cleanup = [...closed, ...removed];
    const errors = cleanup
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length) {
      const cleanupError = new AggregateError(
        errors,
        "Registry fixture cleanup failed",
      );
      if (failed) console.error(cleanupError);
      else {
        failed = true;
        failure = cleanupError;
      }
    }
  }
  if (failed) throw failure;
  return status;
}

/** Runs the preview and Pages phases inside the fixture workspace. */
async function runFixturePhases() {
  const workspace = await prepareE2eFixture();
  const status = runE2ePhase({
    label: "fixture",
    command: "node",
    args: ["scripts/run-e2e.mjs", ...extraArgs],
    cwd: workspace,
    env: {
      ...childEnvironment(),
      SLOP_E2E_PREBUILT: "1",
      SLOP_E2E_WORKSPACE: "fixture",
      SLOP_E2E_PORT: String(basePort),
      ...(lane ? { SLOP_E2E_LANE: lane } : {}),
      ...(process.env.SLOP_E2E_WORKERS
        ? { SLOP_E2E_WORKERS: process.env.SLOP_E2E_WORKERS }
        : {}),
    },
    timeoutMs: 60 * 60_000,
  });
  return status.finally(() => {
    try {
      // CI uploads diagnostics from this checkout, not the temporary copy.
      for (const folder of ["playwright-report", "test-results"]) {
        const source = join(workspace, folder);
        if (existsSync(source))
          cpSync(source, join(packageRoot, folder), { recursive: true });
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}

let statuses;
if (insideFixture) {
  const phases = [
    {
      server: "preview",
      port: String(basePort),
      args: ["--grep-invert", "@pages-only|@registry", ...extraArgs],
    },
    {
      server: "pages",
      port: String(basePort + 1),
      args: ["--project=chromium-desktop", "--grep", "@pages", ...extraArgs],
    },
  ];
  statuses = await Promise.all(
    phases
      .filter((phase) => lane === undefined || phase.server === lane)
      .map(({ server, port, args }) => runPhase(server, server, port, args)),
  );
} else {
  statuses = await Promise.all([
    ...(lane === undefined || lane === "registry" ? [runRegistryPhase()] : []),
    ...(lane === undefined || lane !== "registry" ? [runFixturePhases()] : []),
  ]);
}
const failed = statuses.find((status) => status !== 0);
if (failed !== undefined) process.exit(failed);
