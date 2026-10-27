/**
 * Restores the frozen pre-registry history and project skills from
 * tests/fixtures. The fixtures keep one copy of shared bytes: a cycle stored
 * without its source snapshot binds the eliza snapshot of the same month, and
 * every contributor skill carries the shared scripts from scripts/skill-kit.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RAW_PROJECT_DEFINITIONS } from "./fixtures/project-registry.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(repositoryRoot, "tests", "fixtures");

/** Copies the frozen history into `target`, the root of a repository copy. */
export function copyFixtureHistory(target) {
  const history = join(fixtures, "history");
  cpSync(history, target, { recursive: true });
  for (const project of readdirSync(join(history, "cycles")))
    for (const cycle of readdirSync(join(history, "cycles", project))) {
      const snapshot = join("cycles", project, cycle, "source-snapshot.json");
      if (!existsSync(join(history, snapshot)))
        copyFileSync(
          join(target, "cycles", "eliza", cycle, "source-snapshot.json"),
          join(target, snapshot),
        );
    }
}

/**
 * Copies the frozen skills into `target`, a skills directory. An
 * external-prize-share project never enters the payment lifecycle, so its
 * skill has no wallet claim script.
 */
export function copyFixtureSkills(target) {
  cpSync(join(fixtures, "skills"), target, { recursive: true });
  const kit = join(repositoryRoot, "scripts", "skill-kit");
  for (const skill of readdirSync(target)) {
    if (!skill.startsWith("contribute-to-")) continue;
    const project = RAW_PROJECT_DEFINITIONS.find(
      (entry) => entry.skill.sourcePath === `skills/${skill}`,
    );
    if (!project) throw new Error(`No fixture project for ${skill}`);
    const scripts = join(target, skill, "scripts");
    mkdirSync(scripts, { recursive: true });
    for (const name of readdirSync(kit))
      if (
        name !== "wallet-claim.mjs" ||
        project.reward.kind !== "external-prize-share"
      )
        copyFileSync(join(kit, name), join(scripts, name));
  }
}
