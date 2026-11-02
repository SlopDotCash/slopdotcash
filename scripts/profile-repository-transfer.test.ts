/**
 * A transferred repository keeps its old name in the pre-registry history:
 * src/lib/legacy-projects.json lists elizaOS/asi with the alias
 * SlopDotCash/asi. The live registry lists the same repository under its
 * current name only ({"id":"SlopDotCash/asi"}, no aliases), so the census
 * collects every pull request under SlopDotCash/asi. A previous census row
 * under the old name must then not be carried on top of that fresh, complete
 * collection (scripts/generate-profiles.ts). The census published on
 * 2026-10-31 carried elizaOS/asi and elizaOS/proximityprize next to
 * SlopDotCash/asi and SlopDotCash/proximityprize, so every contributor's pull
 * requests in those repositories counted twice on their profile.
 *
 * The frozen fixture registry records these transfers the older way (old id
 * plus the current name as an alias). This test copies the working tree,
 * rewrites the registry to the live shape, and runs the census carry rule in a
 * separate process so it reads the rewritten registry.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCheckout } from "../tests/fixture-checkout";

// Repositories of a previous census: the two old names, the current names,
// a paused project and a retired project that are no longer collected, and a
// repository the registry does not know.
const previous = [
  "elizaOS/asi",
  "elizaOS/proximityprize",
  "SlopDotCash/asi",
  "SlopDotCash/proximityprize",
  "Canonry/canonry",
  "heirlabs/element-sdk",
  "example/unregistered",
];

let root = "";
beforeAll(() => {
  root = fixtureCheckout("profile-repository-transfer-");
  const registry = join(root, "src/lib/project-registry.generated.mjs");
  writeFileSync(
    registry,
    `${readFileSync(registry, "utf8")}
// The live registry names a transferred repository by its current path only.
for (const project of RAW_PROJECT_DEFINITIONS)
  for (const repository of project.repositories)
    if (repository.aliases) {
      repository.id = repository.aliases.at(-1);
      delete repository.aliases;
    }
`,
  );
  // The same carry decision scripts/generate-profiles.ts makes for each
  // repository of the previous census.
  writeFileSync(
    join(root, "profile-carry-check.ts"),
    `
import {
  collectedProfileRepositories,
  isCarriedProfileRepository,
} from "./src/lib/profiles";
import { TARGET_REPOSITORIES } from "./src/lib/repositories.mjs";
const targets = TARGET_REPOSITORIES.map((repository) => repository.id);
const collected = new Set(targets);
const collectedRepositories = collectedProfileRepositories(targets);
const previous = ${JSON.stringify(previous)};
console.log(JSON.stringify({
  targets,
  carried: previous.filter((repository) =>
    isCarriedProfileRepository(repository, collected, collectedRepositories),
  ),
}));
`,
  );
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

test("a previous row under a transferred repository's old name is not carried", () => {
  const result = spawnSync(process.execPath, ["profile-carry-check.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: join(root, ".bun-tmp") },
    timeout: 60000,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || String(result.error));
  const { targets, carried } = JSON.parse(result.stdout) as {
    targets: string[];
    carried: string[];
  };
  expect(targets).toContain("SlopDotCash/asi");
  expect(targets).toContain("SlopDotCash/proximityprize");
  expect(targets).not.toContain("elizaOS/asi");
  expect(carried).toEqual([
    "Canonry/canonry",
    "heirlabs/element-sdk",
    "example/unregistered",
  ]);
}, 120000);
