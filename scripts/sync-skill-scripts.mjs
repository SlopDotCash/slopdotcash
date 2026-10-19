/** Keep standalone skill archives self-contained, with one authoring source. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_SKILL_TEMPLATES } from "../src/lib/project-schema.mjs";
import { PROJECTS } from "../src/lib/projects.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "scripts", "skill-kit");
const names = [
  "live-report.mjs",
  "run-receipt.mjs",
  "skill-authority.mjs",
  "skill-authority.d.mts",
  "terms-preflight.mjs",
  "wallet-claim.mjs",
];
const check = process.argv.includes("--check");
// Registry skills, plus the frozen fixture skills that tests and the browser
// fixture build install, so both always exercise the current shared scripts.
const fixtureSkills = join("tests", "fixtures", "skills");
// The contributor template always carries every shared script, so every
// generated project skill does too.
const TEMPLATE = PROJECT_SKILL_TEMPLATES.contributor;
const skillPaths = [
  ...new Set([
    TEMPLATE,
    ...PROJECTS.map((project) => project.skill.sourcePath),
  ]),
  ...readdirSync(join(root, fixtureSkills))
    .filter((name) => name.startsWith("contribute-to-"))
    .map((name) => join(fixtureSkills, name)),
];
for (const name of names) {
  const source = join(sourceRoot, name);
  const contents = readFileSync(source);
  for (const skillPath of skillPaths) {
    const target = join(root, skillPath, "scripts", name);
    // Some project contracts deliberately omit wallet support.
    if (!existsSync(target) && skillPath !== TEMPLATE) {
      if (
        !name.startsWith("skill-authority.") ||
        !existsSync(join(root, skillPath, "scripts", "run-receipt.mjs"))
      )
        continue;
      if (check)
        throw new Error(`${target} is missing; run bun run skills:sync`);
      writeFileSync(target, contents);
      continue;
    }
    if (existsSync(target) && contents.equals(readFileSync(target))) continue;
    if (check)
      throw new Error(
        `${target} differs from ${source}; run bun run skills:sync`,
      );
    writeFileSync(target, contents);
  }
}
console.log(`Shared skill scripts ${check ? "verified" : "synchronized"}.`);
