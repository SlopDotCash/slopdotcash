import { describe, expect, it } from "vitest";
import { assertPublishableLeaderboardSnapshot } from "../src/lib/leaderboard";
import { snapshotFixture } from "../tests/fixtures";
import { preparePullRequestLedger } from "./prepare-pr-ledger";

describe("pull-request ledger schema bridge", () => {
  it("accepts an already-current public ledger unchanged", () => {
    const snapshot = snapshotFixture();
    expect(preparePullRequestLedger(snapshot)).toBe(snapshot);
  });

  it("migrates deployed schema 5 data without inventing additive August activity", () => {
    const legacy = structuredClone(snapshotFixture()) as unknown as Record<
      string,
      unknown
    >;
    legacy.schemaVersion = "5";
    legacy.ruleVersion = "slop-score-v1";
    for (const leader of legacy.leaders as Array<Record<string, unknown>>) {
      delete leader.scoreThirds;
      delete leader.pointThirds;
    }
    const ledger = legacy.ledger as Array<Record<string, unknown>>;
    ledger[0].occurredAt = "2026-08-01T12:00:00.000Z";
    legacy.window = {
      days: 35,
      from: "2026-06-28T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    };
    const source = legacy.source as Record<string, unknown>;
    source.cutoffAt = "2026-08-02T00:00:00.000Z";
    source.verificationWindow = {
      days: 35,
      from: "2026-06-28T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    };

    const migrated = preparePullRequestLedger(legacy);
    assertPublishableLeaderboardSnapshot(migrated);
    const event = migrated.ledger.find((entry) => entry.id === ledger[0].id);
    expect(event).toMatchObject({ points: 1 / 3, scoreThirds: 1 });
    expect(
      migrated.ledger.some(
        (entry) =>
          entry.occurredAt >= "2026-08-01T00:00:00.000Z" &&
          ["resolved-issue", "material-test-change", "evidence"].includes(
            entry.category,
          ),
      ),
    ).toBe(false);
  });
});
