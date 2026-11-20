/**
 * ASI and Proximity Prize moved from elizaOS to SlopDotCash. The removed
 * pre-registry record keeps the old name, and the live registry lists only
 * the current name. findHistoricalRepository therefore maps the two names to
 * different repository ids. A review recorded before the transfer and an
 * evaluated award or later review recorded after it are one pull request.
 * Counting both gives the contributor the review twice (PRD section 7, no
 * duplicate credit).
 *
 * The frozen fixture registry still records these transfers as an old id plus
 * a current-name alias, which hides the split. This test rewrites a copy to
 * the live shape and reads it in a separate process, the same way
 * scripts/profile-repository-transfer.test.ts does.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCheckout } from "../tests/fixture-checkout";

let root = "";
beforeAll(() => {
  root = fixtureCheckout("points-transferred-review-");
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
  writeFileSync(join(root, "points-transferred-review-check.ts"), CHECK);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const CHECK = `
import {
  canonicalReviewIdentity,
  pointMembers,
  POINTS_RULE,
  pointRevisionId,
} from "./src/lib/points.ts";

function award(category, sourceUrl, amount, key) {
  return {
    key,
    actor: { id: "MDQ6VXNlcjE=", login: "alice" },
    projectId: "asi",
    category,
    amount,
    occurredAt: "2026-09-15T00:00:00.000Z",
    sourceId: key,
    sourceUrl,
    workUnitId: key,
    provisional: false,
  };
}
function revision(row) {
  const body = {
    previous: null,
    recordedAt: "2026-09-16T00:00:00.000Z",
    sourceDigest: "a".repeat(64),
    sourceRule: "slop-score-v2",
    award: row,
  };
  return { id: pointRevisionId(body), ...body };
}
function members(awards) {
  return pointMembers({
    schemaVersion: "1",
    ruleVersion: POINTS_RULE,
    generatedAt: "2026-10-01T00:00:00.000Z",
    coverage: [],
    revisions: awards.map(revision),
  }).filter((member) => member.actor.id === "MDQ6VXNlcjE=");
}
const reviewed = "https://github.com/elizaOS/asi/pull/8#pullrequestreview-1";
const evaluated = "https://github.com/SlopDotCash/ASI/pull/8#discussion_r4";
const before = "https://github.com/elizaOS/proximityprize/pull/12#pullrequestreview-1";
const after = "https://github.com/SlopDotCash/proximityprize/pull/12#pullrequestreview-2";
const suppressed = members([
  award("evaluated-contribution", evaluated, 8, "evaluated"),
  award("substantive-review", reviewed, 50, "review"),
]);
const doubled = members([
  award("substantive-review", before, 40, "before-transfer"),
  award("substantive-review", after, 30, "after-transfer"),
]);
console.log(JSON.stringify({
  asi: [canonicalReviewIdentity(reviewed), canonicalReviewIdentity(evaluated)],
  proximity: [canonicalReviewIdentity(before), canonicalReviewIdentity(after)],
  kept: canonicalReviewIdentity("https://github.com/elizaOS/eliza/pull/3#pullrequestreview-1"),
  suppressedTotal: suppressed[0]?.total ?? null,
  suppressedCategories: suppressed[0]?.awards.map((row) => row.category) ?? [],
  doubledTotal: doubled[0]?.total ?? null,
}));
`;

test("a transferred repository's old and current review URLs are one pull request", () => {
  const result = spawnSync(
    process.execPath,
    ["points-transferred-review-check.ts"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: join(root, ".bun-tmp") },
      timeout: 60000,
    },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || String(result.error));
  const report = JSON.parse(result.stdout) as {
    asi: [string, string];
    proximity: [string, string];
    kept: string;
    suppressedTotal: number;
    suppressedCategories: string[];
    doubledTotal: number;
  };
  expect(report.asi).toEqual([
    "slopdotcash/asi/pull/8",
    "slopdotcash/asi/pull/8",
  ]);
  expect(report.proximity).toEqual([
    "slopdotcash/proximityprize/pull/12",
    "slopdotcash/proximityprize/pull/12",
  ]);
  expect(report.kept).toBe("elizaos/eliza/pull/3");
  expect(report.suppressedTotal).toBe(8);
  expect(report.suppressedCategories).toEqual(["evaluated-contribution"]);
  expect(report.doubledTotal).toBe(40);
}, 120000);
