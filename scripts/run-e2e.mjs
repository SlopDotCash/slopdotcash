/**
 * Runs the complete browser matrix against the stable built-site preview, then
 * gives the one redirect/header/artifact contract a focused Pages-emulator run.
 * Wrangler can terminate during long browser sessions on constrained hosted
 * runners, while that focused check still exercises the behavior only Pages
 * supplies instead of replacing it with a generic static-server assertion.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = join(packageRoot, "node_modules", ".bin", "playwright");
const artifactContract =
  "serves byte-consistent install and read-only artifacts for every project";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("bun", ["run", "build"]);

run(
  playwright,
  ["test", "--grep-invert", artifactContract, ...process.argv.slice(2)],
  {
    ...process.env,
    SLOP_E2E_PREBUILT: "1",
    SLOP_E2E_SERVER: "preview",
  },
);

run(
  playwright,
  [
    "test",
    "--project=wide-desktop-chromium",
    "--grep",
    artifactContract,
    ...process.argv.slice(2),
  ],
  {
    ...process.env,
    SLOP_E2E_PREBUILT: "1",
    SLOP_E2E_SERVER: "pages",
  },
);
