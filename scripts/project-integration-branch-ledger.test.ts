// A verified owner revision can move a registered repository to a new
// integration branch (PRD section 4). The deployed ledger was collected
// before that revision, so pull-request checks must adopt the current branch
// instead of refusing the published ledger until the next full collection.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("pull-request ledger adopts a verified integration branch change", () => {
  const directory = mkdtempSync(join(root, ".branch-ledger-probe-"));
  try {
    const file = join(directory, "probe.test.ts");
    writeFileSync(
      file,
      `
import { expect, mock, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { RAW_PROJECT_DEFINITIONS } from ${JSON.stringify(join(root, "tests/fixtures/project-registry.mjs"))};
const definitions = RAW_PROJECT_DEFINITIONS.map((project) =>
  project.id !== "asi" ? project : {
    ...project,
    repositories: [
      { ...project.repositories[0], integrationBranch: "vibestack" },
      ...project.repositories.slice(1),
    ],
  },
);
for (const path of [
  ${JSON.stringify(join(root, "src/lib/project-registry.generated.mjs"))},
  ${JSON.stringify(join(root, "src/lib/project-registry.ingested.mjs"))},
]) mock.module(path, () => ({ RAW_PROJECT_DEFINITIONS: definitions }));

test("probe", async () => {
  const { createLeaderboardSnapshot, assertPublishableLeaderboardSnapshot } = await import(${JSON.stringify(join(root, "src/lib/leaderboard.ts"))});
  const { TARGET_REPOSITORIES } = await import(${JSON.stringify(join(root, "src/lib/repositories.mjs"))});
  const { preparePullRequestLedger } = await import(${JSON.stringify(join(root, "scripts/prepare-pr-ledger.ts"))});
  const { penaltyScoreInput, AFTER_NOVEMBER } = await import(${JSON.stringify(join(root, "tests/penalty-score-fixture.ts"))});
  setSystemTime(new Date(AFTER_NOVEMBER));
  const target = TARGET_REPOSITORIES.find((row) => row.projectId === "asi");
  expect(target.integrationBranch).toBe("vibestack");

  // The deployed ledger still publishes the branch it was collected against.
  const deployed = createLeaderboardSnapshot(penaltyScoreInput([], AFTER_NOVEMBER));
  deployed.repositories.find((row) => row.id === target.id).integrationBranch = "main";

  const project = definitions.find((row) => row.id === "asi");
  const historical = RAW_PROJECT_DEFINITIONS.find((row) => row.id === "asi");
  expect(historical.repositories[0].integrationBranch).toBe("main");
  deployed.source.repositories.find((row) => row.id === target.id).repositoryId =
    historical.authority.repositoryNodeId;
  const cutoff = Date.parse(deployed.window.to);
  const revision = (manifest, revision, time) => ({
    projectId: manifest.id,
    revision,
    createdAt: new Date(time).toISOString(),
    manifest,
    manifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  });
  const revisions = [
    revision(historical, 1, cutoff - 1_000),
    revision(project, 2, cutoff + 1_000),
  ];
  const prepared = preparePullRequestLedger(structuredClone(deployed), revisions);
  const published = prepared.repositories.find((row) => row.id === target.id);
  expect(published.integrationBranch).toBe("vibestack");
  expect(published.description).toBe(target.description);
  expect(() => assertPublishableLeaderboardSnapshot(prepared)).not.toThrow();

  // Other permanent registry fields still refuse drift.
  const drifted = structuredClone(deployed);
  drifted.repositories.find((row) => row.id === target.id).description = "Another repository.";
  expect(() => preparePullRequestLedger(drifted, revisions)).toThrow(/description cannot change/);

  const arbitrary = structuredClone(deployed);
  arbitrary.repositories.find((row) => row.id === target.id).integrationBranch = "other";
  expect(() => preparePullRequestLedger(arbitrary, revisions)).toThrow(/integrationBranch is not verified/);

  const wrongNode = structuredClone(deployed);
  wrongNode.source.repositories.find((row) => row.id === target.id).repositoryId = "R_kgDOOtherExact";
  expect(() => preparePullRequestLedger(wrongNode, revisions)).toThrow(/integrationBranch is not verified/);

  const newerThanMove = structuredClone(deployed);
  newerThanMove.window.to = new Date(cutoff + 1_000).toISOString();
  expect(() => preparePullRequestLedger(newerThanMove, revisions)).toThrow(/integrationBranch is not verified/);

  const brokenDigest = [
    {...revisions[0], manifestSha256: "0".repeat(64)},
    revisions[1],
  ];
  expect(() => preparePullRequestLedger(deployed, brokenDigest)).toThrow(/integrationBranch is not verified/);
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
