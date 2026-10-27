/** Run the unchanged Workerd qualification under Node's Undici transport. */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "../../scripts/child-environment.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "slop-flags-node-"));
const entry = join(directory, "workflow.mjs");
try {
  await symlink(
    join(root, "node_modules"),
    join(directory, "node_modules"),
    "junction",
  );
  const options = { cwd: root, env: childEnvironment(), stdio: "inherit" };
  // Bun compiles TypeScript but must not host Miniflare: its Undici fetch
  // ignores the dispatcher's Pool that the synchronous D1/R2 bridge uses.
  execFileSync(
    "bun",
    [
      "--no-env-file",
      "build",
      "workers/vetting-flags/workflow.ts",
      "--target=node",
      "--packages=external",
      `--outfile=${entry}`,
    ],
    options,
  );
  execFileSync(process.execPath, [entry], options);
} finally {
  await rm(directory, { recursive: true, force: true });
}
