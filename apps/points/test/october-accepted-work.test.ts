// spec/points/rewardWeights.md, "A month's net weight is its accepted-work credit less its applied debits"
import { test, expect } from "vitest";
import type { Award, Journal, Revision } from "../src/kernels/records/canonical.ts";
import { octoberAcceptedWork } from "../src/rewardWeights/octoberProjection.ts";

const from = "2026-10-10T00:00:00.000Z";
const node = (user: number) => Buffer.from(`04:User${user}`).toString("base64");
const alice = { id: node(42), login: "alice" };
const bob = { id: node(43), login: "bob" };

function row(key: string, changes: Partial<Award> = {}, decision?: Revision["decision"]): Revision {
  const award = {
    key,
    actor: alice,
    projectId: "eliza",
    category: "merged-pull-request",
    amount: 30,
    occurredAt: "2026-10-15T00:00:00.000Z",
    sourceId: `PR_${key}`,
    sourceUrl: "",
    workUnitId: `wu_${key}`,
    provisional: true,
    ...changes,
  };
  const revision = { id: key, previous: null, recordedAt: award.occurredAt, sourceDigest: "0".repeat(64), sourceRule: "slop-score-v2", award };
  return decision === undefined ? revision : { ...revision, decision };
}

function calculate(revisions: Revision[]) {
  const journal: Journal = {
    schemaVersion: "1", ruleVersion: "slop-points-v1", generatedAt: "2026-11-15T00:00:00.000Z", coverage: [], revisions,
  };
  return octoberAcceptedWork(journal, "eliza", from, (url) => url.includes("review-") ? "elizaos/eliza/pull/1" : undefined);
}

test("October weights follow latest revisions, deduplicate across the full journal and omit prior settlement", () => {
  const { weights, identities } = calculate([
    row("original", { amount: 90 }),
    row("original", { amount: 40 }),
    row("older", { workUnitId: "shared", occurredAt: "2026-10-01T00:00:00.000Z", amount: 30 }),
    row("later", { workUnitId: "shared", amount: 30 }),
    row("next", { occurredAt: "2026-11-01T00:00:00.000Z" }),
    row("other", { projectId: "feed" }),
    row("paid", { category: "payout-received" }),
    row("debit", { category: "slopbot-penalty", amount: -5 }),
    row("known", { actor: bob, occurredAt: "2026-09-01T00:00:00.000Z" }),
  ]);
  expect([...weights]).toEqual([["42", { githubNodeId: alice.id, acceptedWorkPoints: 35 }]]);
  expect(identities.get("43")).toBe(bob.id);
});

test("October assessed value retains the author at zero and suppresses equivalent evaluated review credit", () => {
  const assessed = { sourceId: "value:decision", effectiveAt: from, reason: "Reviewed", delta: 0 };
  const { weights, identities } = calculate([
    row("ordinary-review", { category: "substantive-review", sourceUrl: "https://github.com/elizaos/eliza/pull/1#pullrequestreview-1" }),
    row("evaluated-review", { category: "evaluated-contribution", sourceUrl: "https://github.com/ELIZAOS/eliza/pull/1#pullrequestreview-2", amount: 20 }),
    row("assessed-october", { workUnitId: "cross-month-unit", amount: 25 }, assessed),
    row("assessed-november", { workUnitId: "cross-month-unit", amount: 200, occurredAt: "2026-11-12T00:00:00.000Z" }, assessed),
    row("zero", { actor: bob, amount: 0 }, assessed),
    row("debit", { actor: bob, category: "slopbot-penalty", amount: -5 }),
  ]);
  expect(weights.get("42")?.acceptedWorkPoints).toBe(45);
  expect(weights.get("43")?.acceptedWorkPoints).toBe(0);
  expect(identities.get("43")).toBe(bob.id);
});
