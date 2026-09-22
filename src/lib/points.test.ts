import { describe, expect, it } from "vitest";
import { snapshotFixture } from "../../tests/fixtures";
import {
  appendPointAwards,
  applyPointsSnapshot,
  assertPointsJournal,
  awardForScore,
  emptyPointsJournal,
  pointMembers,
  pointsForScore,
} from "./points";
import { createProjectView } from "./project-view";

const now = "2026-09-21T12:00:00.000Z";
const hash = "a".repeat(64);
describe("permanent nonfinancial points", () => {
  it("backdates accepted work, preserves history across rolling windows, and never changes rewards", () => {
    const snapshot = snapshotFixture();
    const before = JSON.stringify(
      createProjectView(snapshot, "eliza"),
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    const journal = applyPointsSnapshot(
      emptyPointsJournal(now),
      snapshot,
      hash,
      now,
    );
    const replay = applyPointsSnapshot(journal, snapshot, hash, now);
    expect(replay.revisions).toEqual(journal.revisions);
    expect(pointMembers(journal, "2026-09")[0].monthly).toBe(0);
    expect(pointMembers(journal, "2026-07")[0].monthly).toBeGreaterThan(0);
    expect(
      JSON.stringify(createProjectView(snapshot, "eliza"), (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ).toBe(before);
    const shifted = structuredClone(snapshot);
    shifted.window.from = "2026-09-01T00:00:00.000Z";
    shifted.window.to = now;
    shifted.ledger = [];
    expect(
      pointMembers(applyPointsSnapshot(journal, shifted, "b".repeat(64), now)),
    ).toEqual(pointMembers(journal));
  });
  it("records tier changes and reversals without issuing a second outcome", () => {
    const event = snapshotFixture().ledger[0];
    const award = { ...awardForScore(event), amount: 30 };
    let j = appendPointAwards(
      emptyPointsJournal(now),
      [award],
      hash,
      "slop-score-v2",
      now,
    );
    j = appendPointAwards(
      j,
      [{ ...award, amount: 90 }],
      "b".repeat(64),
      "slop-score-v2",
      now,
    );
    expect(pointMembers(j)[0].total).toBe(90);
    expect(j.revisions[1].previous).toBe(j.revisions[0].id);
    j = appendPointAwards(
      j,
      [{ ...award, amount: 0 }],
      "c".repeat(64),
      "slop-score-v2",
      now,
    );
    expect(pointMembers(j)).toEqual([]);
    expect(j.revisions).toHaveLength(3);
    const tampered = structuredClone(j);
    tampered.revisions[0].award.amount = 999;
    expect(() => assertPointsJournal(tampered)).toThrow();
  });
  it("groups split work, uses exact thirds, and ignores compute and receipt weights", () => {
    const event = snapshotFixture().ledger[0];
    const a = { ...awardForScore(event), amount: 90, workUnitId: "wu_shared" };
    const b = {
      ...awardForScore({
        ...event,
        id: "other",
        source: { ...event.source, id: "PR_other" },
      }),
      amount: 90,
      workUnitId: "wu_shared",
    };
    const j = appendPointAwards(
      emptyPointsJournal(now),
      [a, b],
      hash,
      "slop-score-v2",
      now,
    );
    expect(pointMembers(j)[0].total).toBe(90);
    expect(pointsForScore({ points: 1 / 3, scoreThirds: 1 })).toBe(10);
    expect(pointsForScore({ points: 25, scoreThirds: 75 })).toBe(750);
    expect(() => pointsForScore({ points: 0.11 })).toThrow();
  });
});
