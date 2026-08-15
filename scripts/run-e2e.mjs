/**
 * Runs the complete browser matrix with a fresh Pages emulator per viewport.
 * Wrangler can terminate after a long, multi-browser session on constrained
 * hosted runners; restarting only the emulator keeps the exact Pages behavior
 * under test without rebuilding or weakening the assertions.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = join(packageRoot, "node_modules", ".bin", "playwright");
const projects = [
  "wide-desktop-chromium",
  "desktop-chromium",
  "tablet-chromium",
  "narrow-mobile-chromium",
];

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

for (const project of projects) {
  run(playwright, ["test", `--project=${project}`, ...process.argv.slice(2)], {
    ...process.env,
    SLOP_E2E_PREBUILT: "1",
  });
}
