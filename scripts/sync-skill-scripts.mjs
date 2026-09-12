/** Keep standalone skill archives self-contained, with one authoring source. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECTS } from "../src/lib/projects.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceProject = PROJECTS.filter((project) => project.skill.publishAtRoot);
if (sourceProject.length !== 1)
  throw new Error("Expected one root-published skill");
const names = [
  "live-report.mjs",
  "run-receipt.mjs",
  "terms-preflight.mjs",
  "wallet-claim.mjs",
];
const check = process.argv.includes("--check");
for (const name of names) {
  const source = join(root, sourceProject[0].skill.sourcePath, "scripts", name);
  const contents = readFileSync(source);
  for (const project of PROJECTS) {
    const target = join(root, project.skill.sourcePath, "scripts", name);
    // Some project contracts deliberately omit wallet support.
    if (!existsSync(target)) continue;
    if (contents.equals(readFileSync(target))) continue;
    if (check)
      throw new Error(
        `${target} differs from ${source}; run bun run skills:sync`,
      );
    writeFileSync(target, contents);
  }
}
console.log(`Shared skill scripts ${check ? "verified" : "synchronized"}.`);
