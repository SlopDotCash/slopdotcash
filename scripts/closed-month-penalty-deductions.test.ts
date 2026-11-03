import { expect, test } from "bun:test";
import type { CycleIndex } from "../src/lib/cycle-index";
import {
  closedMonthPenaltyDeductions,
  openMonthScores,
} from "../src/lib/global-leaderboard";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";

/**
 * The profile penalty history lists every published debit, but its applied
 * amounts came only from openMonthScores, so a penalty from a month closed
 * by a cycle record rendered "0 applied" even when that month's score did
 * deduct it. closedMonthPenaltyDeductions recomputes those months with the
 * shared caps; these tests pin the split between the two sources.
 */

const ELIZA = "elizaOS/eliza";
const ASI = "SlopDotCash/asi";

function actor(id: string) {
  return {
    id,
    login: `contributor-${id}`,
    avatarUrl: `https://avatars.githubusercontent.com/${id}?size=96`,
    url: `https://github.com/contributor-${id}`,
    kind: "User",
  };
}

function scoreEvent(
  actorId: string,
  repository: string,
  occurredAt: string,
  scoreThirds: number,
) {
  return {
    actor: actor(actorId),
    repository,
    occurredAt,
    scoreThirds,
    points: scoreThirds / 3,
  };
}

function penalty(
  id: string,
  actorId: string,
  repository: string,
  occurredAt: string,
  debitThirds: number,
) {
  return {
    id,
    actor: actor(actorId),
    repository,
    occurredAt,
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds,
    source: {
      id: `source-${id}`,
      kind: "pull-request",
      number: 32909,
      title: "A pull request",
      url: "https://github.com/elizaOS/eliza/pull/32909",
    },
  };
}

function snapshot(
  ledger: ReturnType<typeof scoreEvent>[],
  penalties: ReturnType<typeof penalty>[],
): LeaderboardSnapshot {
  return { ledger, penalties } as unknown as LeaderboardSnapshot;
}

function cycleIndex(...closed: Array<readonly [string, string]>): CycleIndex {
  return {
    schemaVersion: "1",
    generatedAt: "2026-10-16T00:00:00.000Z",
    cycles: closed.map(([projectId, cycleId]) => ({ projectId, cycleId })),
  } as unknown as CycleIndex;
}

/** The merge ProfilePage renders from: open first, closed fills its own. */
function appliedByPenalty(
  snap: LeaderboardSnapshot,
  index: CycleIndex,
): Map<string, number> {
  const applied = new Map(openMonthScores(snap, index).deductions.byPenalty);
  for (const [penaltyId, thirds] of closedMonthPenaltyDeductions(snap, index)
    .byPenalty) {
    applied.set(penaltyId, thirds);
  }
  return applied;
}

test("a closed-month penalty reports the amount its month deducted", () => {
  const snap = snapshot(
    [
      scoreEvent("101", ELIZA, "2026-09-05T00:00:00.000Z", 120),
      scoreEvent("101", ELIZA, "2026-09-20T00:00:00.000Z", 84),
    ],
    [penalty("pen-closed", "101", ELIZA, "2026-09-29T00:00:00.000Z", 24)],
  );
  const index = cycleIndex(["eliza", "2026-09"]);

  // Open-month scores never see the closed month...
  expect(
    openMonthScores(snap, index).deductions.byPenalty.has("pen-closed"),
  ).toBe(false);
  // ...but the month did deduct the full debit from its 204 thirds.
  const closed = closedMonthPenaltyDeductions(snap, index);
  expect(closed.byPenalty.get("pen-closed")).toBe(24);
  expect(closed.byActor.get("101")).toBe(24);
  expect(appliedByPenalty(snap, index).get("pen-closed")).toBe(24);
});

test("closed-month deductions keep the shared cap and application order", () => {
  const snap = snapshot(
    [scoreEvent("102", ELIZA, "2026-09-05T00:00:00.000Z", 30)],
    [
      penalty("pen-second", "102", ELIZA, "2026-09-20T00:00:00.000Z", 24),
      penalty("pen-first", "102", ELIZA, "2026-09-10T00:00:00.000Z", 24),
    ],
  );
  const index = cycleIndex(["eliza", "2026-09"]);

  // The month holds only 30 thirds: the earlier debit applies in full and
  // the later one is capped by what remains, never below zero.
  const closed = closedMonthPenaltyDeductions(snap, index);
  expect(closed.byPenalty.get("pen-first")).toBe(24);
  expect(closed.byPenalty.get("pen-second")).toBe(6);
  expect(closed.byActor.get("102")).toBe(30);
});

test("open-month amounts stay byte-identical and the two sources are disjoint", () => {
  const snap = snapshot(
    [
      scoreEvent("101", ELIZA, "2026-09-05T00:00:00.000Z", 204),
      scoreEvent("101", ELIZA, "2026-10-01T00:00:00.000Z", 159),
    ],
    [
      penalty("pen-closed", "101", ELIZA, "2026-09-29T00:00:00.000Z", 24),
      penalty("pen-open", "101", ELIZA, "2026-10-01T12:00:00.000Z", 3),
    ],
  );
  const index = cycleIndex(["eliza", "2026-09"]);

  const open = openMonthScores(snap, index).deductions.byPenalty;
  const closed = closedMonthPenaltyDeductions(snap, index).byPenalty;
  expect(open.get("pen-open")).toBe(3);
  expect(closed.has("pen-open")).toBe(false);
  expect(open.has("pen-closed")).toBe(false);

  const applied = appliedByPenalty(snap, index);
  expect(applied.get("pen-open")).toBe(open.get("pen-open"));
  expect(applied.get("pen-closed")).toBe(24);
  expect(applied.size).toBe(open.size + closed.size);
});

test("a month closed for a different project does not close this one", () => {
  const snap = snapshot(
    [scoreEvent("103", ASI, "2026-09-10T00:00:00.000Z", 51)],
    [penalty("pen-asi", "103", ASI, "2026-09-15T00:00:00.000Z", 5)],
  );
  const index = cycleIndex(["eliza", "2026-09"]);

  // Only eliza's September is closed; asi's September stays an open month.
  expect(
    closedMonthPenaltyDeductions(snap, index).byPenalty.has("pen-asi"),
  ).toBe(false);
  expect(openMonthScores(snap, index).deductions.byPenalty.get("pen-asi")).toBe(
    5,
  );
});

test("a penalty before the project's reward start stays unapplied in both sources", () => {
  const snap = snapshot(
    [scoreEvent("101", ELIZA, "2026-07-20T00:00:00.000Z", 99)],
    // Eliza's reward start is 2026-07-07 in the fixture registry.
    [penalty("pen-prestart", "101", ELIZA, "2026-07-05T00:00:00.000Z", 24)],
  );
  const index = cycleIndex(["eliza", "2026-07"]);

  expect(
    closedMonthPenaltyDeductions(snap, index).byPenalty.has("pen-prestart"),
  ).toBe(false);
  expect(
    openMonthScores(snap, index).deductions.byPenalty.has("pen-prestart"),
  ).toBe(false);
});
