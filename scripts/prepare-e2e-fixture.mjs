/**
 * Builds the browser-test fixture workspace. Projects now live in the D1
 * registry, whose committed snapshot may be empty, so project, funding, cycle,
 * and profile specs run against a copy of this tree that restores the frozen
 * pre-registry projects, skills, and history from `tests/fixtures/`. The
 * shipped `dist` is never touched; the copy gets its own Git commit because
 * the site build reads tracked files.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  copyFixtureHistory,
  copyFixtureSkills,
} from "../tests/fixture-overlay.mjs";
import { copyWorkingTree } from "./copy-working-tree.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(repositoryRoot, "tests", "fixtures");
/** The sync time the fixture build publishes with its last good registry. */
export const FIXTURE_REGISTRY_SYNCED_AT = "2026-10-16T06:00:00.000Z";

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

/** Restores the frozen registry, its skills, and its history in the copy. */
function overlayFixtures(workspace) {
  const registry = join(
    workspace,
    "src",
    "lib",
    "project-registry.generated.mjs",
  );
  copyFileSync(join(fixtures, "project-registry.mjs"), registry);
  // Stamp the frozen registry the way projects:sync stamps a D1 read, so the
  // build publishes it as the last good registry (PRD section 9).
  appendFileSync(
    registry,
    `\nexport const PROJECT_REGISTRY_SYNCED_AT = ${JSON.stringify(FIXTURE_REGISTRY_SYNCED_AT)};\n`,
  );
  copyFixtureSkills(join(workspace, "skills"));
  copyFixtureHistory(workspace);
}

export async function prepareE2eFixture() {
  const workspace = mkdtempSync(join(tmpdir(), "slop-e2e-fixture-"));
  try {
    copyWorkingTree(repositoryRoot, workspace);
    overlayFixtures(workspace);
    run("git", ["init", "-q"], workspace);
    run("git", ["add", "-A"], workspace);
    run(
      "git",
      [
        "-c",
        "user.name=Slop E2E fixture",
        "-c",
        "user.email=e2e-fixture@slop.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "-m",
        "E2E fixture workspace",
      ],
      workspace,
    );
    // Runtime dependencies are not fixture source, including symlinks that a
    // directory-only .gitignore rule would otherwise let git add capture.
    symlinkSync(
      join(repositoryRoot, "node_modules"),
      join(workspace, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    if (process.env.SLOP_E2E_SOLANA_VAULT === "1") {
      for (const directory of ["node_modules", "target"]) {
        symlinkSync(
          join(repositoryRoot, "contracts", "solana", directory),
          join(workspace, "contracts", "solana", directory),
          process.platform === "win32" ? "junction" : "dir",
        );
      }
    }
    // The last production ledger published before the D1 registry, with an
    // open cycle, is frozen as a fixture. Its cycle month comes from its own
    // window, so it does not age. Rebind it the way pull-request builds do.
    const ledger = join(workspace, "public", "data", "fixture-ledger.json");
    mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(
      ledger,
      gunzipSync(
        readFileSync(join(fixtures, "leaderboard-2026-10-16.json.gz")),
      ),
    );
    run(
      "bun",
      ["scripts/prepare-pr-ledger.ts", ledger, "public/data/leaderboard.json"],
      workspace,
    );
    rmSync(ledger);
    // The browser reads the registry at runtime. The fixture build serves the
    // frozen registry as a static file in the API's response shape, so its
    // specs need no D1 rows.
    const { RAW_PROJECT_DEFINITIONS } = await import(
      pathToFileURL(join(fixtures, "project-registry.mjs")).href
    );
    writeFileSync(
      join(workspace, "public", "data", "fixture-project-registry.json"),
      `${JSON.stringify({ schemaVersion: "1", projects: RAW_PROJECT_DEFINITIONS })}\n`,
    );
    run("bun", ["run", "build"], workspace, {
      ...process.env,
      // The caller may build the live registry with a different profile input.
      // This isolated workspace must use the matching frozen profile inventory.
      SLOP_PROFILES_INPUT: join(workspace, "data", "profiles", "seed.json"),
      VITE_SLOP_PROJECT_REGISTRY_URL: "/data/fixture-project-registry.json",
    });
    return workspace;
  } catch (error) {
    await rm(workspace, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
    throw error;
  }
}

if (import.meta.main) process.stdout.write(`${await prepareE2eFixture()}\n`);
