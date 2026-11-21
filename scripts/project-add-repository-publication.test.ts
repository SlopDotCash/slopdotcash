// Appended repository pins belong to the internal registry, while the public
// leaderboard retains its exact repository schema (PRD sections 4 and 7).
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("appended repositories publish valid snapshots and survive activation and rename adaptation", () => {
  const directory = mkdtempSync(join(root, ".publication-probe-"));
  try {
    const file = join(directory, "probe.test.ts");
    writeFileSync(
      file,
      `
import { expect, mock, setSystemTime, test } from "bun:test";
import { RAW_PROJECT_DEFINITIONS } from ${JSON.stringify(join(root, "tests/fixtures/project-registry.mjs"))};
const EXTRA = "acme-tools/extra";
const CURRENT = "acme-tools/renamed-extra";
const definitions = RAW_PROJECT_DEFINITIONS.map((project) =>
  project.id !== "asi" ? project : {
    ...project,
    repositories: [...project.repositories, {
      id: EXTRA,
      aliases: [CURRENT],
      displayName: CURRENT,
      githubUrl: "https://github.com/" + CURRENT,
      description: "Extra tooling used by the research framework.",
      integrationBranch: "main",
      githubId: "555000111",
      nodeId: "R_extra",
      countsFrom: "2026-12-01T00:00:00.000Z",
    }],
  },
);
for (const path of [
  ${JSON.stringify(join(root, "src/lib/project-registry.generated.mjs"))},
  ${JSON.stringify(join(root, "src/lib/project-registry.ingested.mjs"))},
]) mock.module(path, () => ({ RAW_PROJECT_DEFINITIONS: definitions }));

test("probe", async () => {
  const { createLeaderboardSnapshot, assertLeaderboardSnapshot } = await import(${JSON.stringify(join(root, "src/lib/leaderboard.ts"))});
  const { TARGET_REPOSITORIES } = await import(${JSON.stringify(join(root, "src/lib/repositories.mjs"))});
  const { addActivatedRepositories, preparePullRequestLedger } = await import(${JSON.stringify(join(root, "scripts/prepare-pr-ledger.ts"))});
  const { penaltyScoreInput, AFTER_NOVEMBER } = await import(${JSON.stringify(join(root, "tests/penalty-score-fixture.ts"))});
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([], AFTER_NOVEMBER);
  input.source.repositories.find((row) => row.id === EXTRA).repositoryId = "R_extra";
  const snapshot = createLeaderboardSnapshot(input);
  const publicKeys = ["id", "owner", "name", "displayName", "githubUrl", "description", "integrationBranch", "projectId", "role"].sort();
  const publicExtra = snapshot.repositories.find((row) => row.id === EXTRA);
  expect(Object.keys(publicExtra).sort()).toEqual(publicKeys);
  expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();

  // Source pins and start-month metadata remain available internally.
  const target = TARGET_REPOSITORIES.find((row) => row.id === EXTRA);
  expect(target.nodeId).toBe("R_extra");
  expect(target.githubId).toBe("555000111");
  expect(target.countsFrom).toBe("2026-12-01T00:00:00.000Z");
  expect(target.expectedNodeId).toBe("R_extra");

  const beforeActivation = structuredClone(snapshot);
  beforeActivation.repositories = beforeActivation.repositories.filter((row) => row.id !== EXTRA);
  beforeActivation.source.repositories = beforeActivation.source.repositories.filter((row) => row.id !== EXTRA);
  const activated = addActivatedRepositories(beforeActivation);
  expect(Object.keys(activated.repositories.find((row) => row.id === EXTRA)).sort()).toEqual(publicKeys);
  expect(activated.source.repositories.find((row) => row.id === EXTRA).repositoryId).toBe("R_extra");
  expect(() => assertLeaderboardSnapshot(activated)).not.toThrow();

  const beforeRename = structuredClone(snapshot);
  const priorExtra = beforeRename.repositories.find((row) => row.id === EXTRA);
  Object.assign(priorExtra, { owner: "acme-tools", name: "extra", displayName: EXTRA, githubUrl: "https://github.com/" + EXTRA });
  const renamed = preparePullRequestLedger(beforeRename);
  const renamedExtra = renamed.repositories.find((row) => row.id === EXTRA);
  expect(Object.keys(renamedExtra).sort()).toEqual(publicKeys);
  expect(renamedExtra.githubUrl).toBe("https://github.com/" + CURRENT);
  expect(renamed.source.repositories.find((row) => row.id === EXTRA).repositoryId).toBe("R_extra");
  expect(() => assertLeaderboardSnapshot(renamed)).not.toThrow();
});
`,
    );
    const result = spawnSync(process.execPath, ["test", file], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 70_000);
