/**
 * Runs the complete browser matrix against the stable built-site preview and,
 * at the same time, checks redirects, artifacts, and contributor API access
 * with Pages headers. Wrangler can terminate during long browser sessions on
 * constrained hosted runners, while that focused check still exercises the
 * behavior only Pages supplies instead of replacing it with a generic
 * static-server assertion. Each phase owns its own port and output folder, so
 * the two phases run concurrently and neither can serve the other's bytes.
 * SLOP_E2E_LANE=preview|pages|registry runs one phase only, so CI can split
 * the phases (and preview shards passed as --shard=N/M) across separate runners.
 *
 * The D1 project registry may be empty, so the preview and Pages phases run
 * in the fixture workspace from prepare-e2e-fixture.mjs, which restores the
 * frozen projects and history. The registry phase runs the @registry specs on
 * the shipped bundle with Pages Functions, a fresh local D1, and two seeded
 * site sessions.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_OWNER,
  startGitHubApiFixture,
} from "../tests/github-api-fixture.mjs";
import { childEnvironment } from "./child-environment.mjs";
import { prepareE2eFixture } from "./prepare-e2e-fixture.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

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
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runPhase(label, server, port, args, extraEnv = {}) {
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
      ...(process.env.SLOP_E2E_WORKERS
        ? { SLOP_E2E_WORKERS: process.env.SLOP_E2E_WORKERS }
        : {}),
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

// Releases must exercise the online build without regenerating its journal.
if (process.env.SLOP_E2E_PREBUILT !== "1") runSync("bun", ["run", "build"]);
runSync("node", ["scripts/dist-manifest.mjs", "verify-local", "dist"]);

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

function sessionToken() {
  return randomBytes(32).toString("base64url");
}

/** Creates a fresh local D1 with every migration and two site sessions. */
function prepareRegistryDatabase() {
  const persistTo = mkdtempSync(join(tmpdir(), "slop-e2e-d1-"));
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
    owner: { token: sessionToken(), githubId: E2E_OWNER.githubId },
  };
  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const sql = Object.entries(sessions)
    .map(([role, { token, githubId }]) => {
      const actor = `U_e2e_${role}`;
      const hash = createHash("sha256").update(token).digest("hex");
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
  return {
    persistTo,
    env: {
      SLOP_E2E_PERSIST_TO: persistTo,
      SLOP_E2E_ADMIN_GITHUB_IDS: E2E_ADMIN_GITHUB_ID,
      SLOP_E2E_ADMIN_TOKEN: sessions.admin.token,
      SLOP_E2E_APPLICANT_TOKEN: sessions.applicant.token,
      SLOP_E2E_OWNER_TOKEN: sessions.owner.token,
    },
  };
}

async function runRegistryPhase() {
  const database = prepareRegistryDatabase();
  const githubPort = basePort + 3;
  const github = await startGitHubApiFixture(githubPort);
  try {
    return await runPhase(
      "registry",
      "pages",
      String(basePort + 2),
      ["--grep", "@registry", ...extraArgs],
      {
        ...database.env,
        SLOP_E2E_GITHUB_API_ORIGIN: `http://127.0.0.1:${githubPort}`,
        SLOP_E2E_OUTPUT: "registry",
      },
    );
  } finally {
    github.close();
    rmSync(database.persistTo, { force: true, recursive: true });
  }
}

/** Runs the preview and Pages phases inside the fixture workspace. */
function runFixturePhases() {
  const workspace = prepareE2eFixture();
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
    // CI uploads diagnostics from this checkout, not the temporary copy.
    for (const folder of ["playwright-report", "test-results"]) {
      const source = join(workspace, folder);
      if (existsSync(source))
        cpSync(source, join(packageRoot, folder), { recursive: true });
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
      args: [
        "--project=wide-desktop-chromium",
        "--grep",
        "@pages",
        ...extraArgs,
      ],
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
