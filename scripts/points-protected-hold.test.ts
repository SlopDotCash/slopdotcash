import { expect, test } from "bun:test";
import type {
  PointAward,
  PointRevision,
  PointsJournal,
} from "../src/lib/points";
import { holdProtectedPointAwards } from "./generate-points";

const award = (over: Partial<PointAward>): PointAward => ({
  key: "k",
  actor: { id: "MDQ6VXNlcjE", login: "a" },
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
    revision("c2", "c1", { key: "c", actor: { id: "MDQ6VXNlcjE", login: "renamed" } }),
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
