import { expect, test } from "bun:test";
import {
  type PointAward,
  type PointRevision,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import {
  holdProtectedPointAwards,
  reviewedMergeGroups,
} from "./generate-points";

const award = (over: Partial<PointAward>): PointAward => ({
  key: "k",
  actor: { id: "1", login: "a" },
  projectId: "asi",
  category: "substantive-review",
  amount: 30,
  occurredAt: "2026-10-14T00:00:00.000Z",
  sourceId: "s",
  sourceUrl: "https://github.com/o/r/pull/1#pullrequestreview-1",
  workUnitId: "w",
  provisional: false,
  ...over,
});
const revision = (
  id: string,
  previous: string | null,
  over: Partial<PointAward>,
): PointRevision => ({
  id,
  previous,
  recordedAt: "2026-11-20T00:00:00.000Z",
  sourceDigest: "d",
  sourceRule: "r",
  award: award(over),
});
const journal = (revisions: PointRevision[]): PointsJournal => ({
  schemaVersion: "1",
  ruleVersion: "slop-points-v1",
  generatedAt: "2026-11-20T00:00:00.000Z",
  coverage: [],
  revisions,
});
const months = [{ projectId: "asi", period: "2026-10" }];

test("a changed award in a paid month is held with its successors; other months publish", () => {
  const known = new Set(["a1", "b1", "c1"]);
  const input = journal([
    revision("a1", null, { key: "a" }),
    revision("b1", null, { key: "b", projectId: "eliza" }),
    revision("c1", null, { key: "c" }),
    // Paid month, amount changes: held, and so is the revision built on it.
    revision("a2", "a1", { key: "a", amount: 0 }),
    revision("a3", "a2", { key: "a", amount: 10 }),
    // Unpaid project, same month: published.
    revision("b2", "b1", { key: "b", projectId: "eliza", amount: 0 }),
    // Paid month, only presentation changes: published.
    revision("c2", "c1", { key: "c", actor: { id: "1", login: "renamed" } }),
    // New award in the paid month: held.
    revision("d1", null, { key: "d" }),
    // New award in a later month of the same project: published.
    revision("e1", null, { key: "e", occurredAt: "2026-11-02T00:00:00.000Z" }),
    // A recorded payout is never held.
    revision("p1", null, { key: "p", category: "payout-received" }),
  ]);
  const result = holdProtectedPointAwards(input, known, months);
  expect(result.held).toBe(3);
  expect(result.journal.revisions.map((r) => r.id)).toEqual([
    "a1",
    "b1",
    "c1",
    "b2",
    "c2",
    "e1",
    "p1",
  ]);
});

test("an award moved out of a paid month is held, and known revisions never are", () => {
  const known = new Set(["a1", "a2"]);
  const input = journal([
    revision("a1", null, { key: "a" }),
    revision("a2", "a1", { key: "a", amount: 0 }),
    revision("a3", "a2", {
      key: "a",
      amount: 0,
      occurredAt: "2026-11-01T00:00:00.000Z",
    }),
  ]);
  const result = holdProtectedPointAwards(input, known, months);
  expect(result.journal.revisions.map((r) => r.id)).toEqual(["a1", "a2"]);
  expect(holdProtectedPointAwards(input, known, []).held).toBe(0);
});

test("a frozen retirement also holds its replacement in a later month", () => {
  const october = revision("prior", null, {
    key: "original",
    category: "merged-pull-request",
    amount: 10,
  });
  const decision = {
    sourceId: `value:${"a".repeat(64)}`,
    effectiveAt: "2026-11-20T00:00:00.000Z",
    reason: "Accepted work completed together",
  };
  const replacement = {
    ...revision("replacement", null, {
      key: "replacement",
      category: "merged-pull-request",
      amount: 10,
      sourceId: "new-source",
      workUnitId: "new-unit",
      occurredAt: "2026-11-13T00:00:00.000Z",
    }),
    decision: { ...decision, delta: 10 },
  };
  const retirement = {
    ...revision("retirement", october.id, {
      ...october.award,
      amount: 0,
    }),
    decision: { ...decision, delta: -10 },
  };
  const independent = revision("independent", null, {
    ...replacement.award,
    key: "independent",
    sourceId: "independent-source",
    workUnitId: "independent-unit",
  });
  const input = journal([october, replacement, retirement, independent]);
  const result = holdProtectedPointAwards(input, new Set([october.id]), months);

  expect(result.held).toBe(2);
  expect(result.journal.revisions).toEqual([october, independent]);
});

test("reviewed membership holds a standalone replacement without holding an independent unit in the same assessment", () => {
  const recordDigest = "a".repeat(64);
  const workUnitId = `wu_${"b".repeat(64)}`;
  const otherUnitId = `wu_${"c".repeat(64)}`;
  const snapshotDigest = "d";
  const decision = {
    sourceId: `value:${recordDigest}`,
    effectiveAt: "2026-11-20T00:00:00.000Z",
    reason: "Reviewed implementation",
  };
  const prior = {
    ...revision("joint", null, {
      category: "merged-pull-request",
      key: pointKey(
        "asi",
        "1",
        "merged-pull-request",
        "completion",
        workUnitId,
      ),
      sourceId: "completion",
      workUnitId,
      amount: 10,
    }),
    decision: { ...decision, delta: 10 },
  };
  const retirement = {
    ...revision("retirement", prior.id, { ...prior.award, amount: 0 }),
    decision: { ...decision, delta: -10 },
  };
  const replacement = revision("standalone", null, {
    category: "merged-pull-request",
    key: pointKey("asi", "1", "merged-pull-request", "member"),
    sourceId: "member",
    workUnitId: "independent-standalone-source-identity",
    occurredAt: "2026-09-30T00:00:00.000Z",
    amount: 10,
  });
  const independent = {
    ...revision("independent", null, {
      category: "merged-pull-request",
      key: pointKey("asi", "1", "merged-pull-request", "other", otherUnitId),
      sourceId: "other",
      workUnitId: otherUnitId,
      occurredAt: "2026-11-13T00:00:00.000Z",
      amount: 10,
    }),
    decision: { ...decision, delta: 10 },
  };
  const groups = reviewedMergeGroups([
    {
      digest: snapshotDigest,
      snapshot: {
        reviewedImplementationUnits: [
          { pullRequestId: "completion", unit: workUnitId },
          { pullRequestId: "member", unit: workUnitId },
          { pullRequestId: "other", unit: otherUnitId },
        ].map(({ pullRequestId, unit }) => ({
          pullRequestId,
          repository: "SlopDotCash/asi",
          units: [
            {
              recordDigest,
              workUnitId: unit,
              groupId: unit.slice(3),
            },
          ],
        })),
      },
    },
  ]);
  const result = holdProtectedPointAwards(
    journal([prior, replacement, retirement, independent]),
    new Set([prior.id]),
    months,
    [],
    groups,
  );
  expect(result.held).toBe(2);
  expect(result.journal.revisions).toEqual([prior, independent]);
});

test("a project protected in every month holds its candidate revisions in any month", () => {
  const known = new Set(["a1", "b1", "c1"]);
  const input = journal([
    revision("a1", null, { key: "a" }),
    revision("b1", null, { key: "b", projectId: "eliza" }),
    revision("c1", null, { key: "c" }),
    // Whole project: a change in a month no list names is held.
    revision("a2", "a1", { key: "a", amount: 0 }),
    // So is a new award in any other month of that project.
    revision("d1", null, { key: "d", occurredAt: "2026-03-09T00:00:00.000Z" }),
    // And an award moved to another project.
    revision("c2", "c1", { key: "c", projectId: "eliza" }),
    // Another project is untouched.
    revision("b2", "b1", { key: "b", projectId: "eliza", amount: 0 }),
    revision("e1", null, { key: "e", projectId: "eliza" }),
    // A recorded payout is never held.
    revision("p1", null, { key: "p", category: "payout-received" }),
  ]);
  const result = holdProtectedPointAwards(input, known, [], ["asi"]);
  expect(result.held).toBe(3);
  expect(result.journal.revisions.map((r) => r.id)).toEqual([
    "a1",
    "b1",
    "c1",
    "b2",
    "e1",
    "p1",
  ]);
  // Presentation alone still publishes, and known revisions never are held.
  const renamed = journal([
    revision("a1", null, { key: "a" }),
    revision("a2", "a1", { key: "a", actor: { id: "1", login: "renamed" } }),
  ]);
  expect(
    holdProtectedPointAwards(renamed, new Set(["a1"]), [], ["asi"]).held,
  ).toBe(0);
  // Months and whole projects add up; neither list alone names both.
  const both = holdProtectedPointAwards(
    input,
    known,
    [{ projectId: "eliza", period: "2026-10" }],
    ["asi"],
  );
  expect(both.journal.revisions.map((r) => r.id)).toEqual([
    "a1",
    "b1",
    "c1",
    "p1",
  ]);
  // Without the fourth argument the function behaves as before.
  expect(holdProtectedPointAwards(input, known, []).held).toBe(0);
  expect(holdProtectedPointAwards(input, known, [], []).held).toBe(0);
});
