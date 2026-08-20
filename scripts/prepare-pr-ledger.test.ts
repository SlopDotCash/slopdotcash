import { describe, expect, it } from "vitest";
import { assertPublishableLeaderboardSnapshot } from "../src/lib/leaderboard";
import { snapshotFixture } from "../tests/fixtures";
import { preparePullRequestLedger } from "./prepare-pr-ledger";

describe("pull-request ledger schema bridge", () => {
  it("accepts an already-current public ledger unchanged", () => {
    const snapshot = snapshotFixture();
    expect(preparePullRequestLedger(snapshot)).toEqual(snapshot);
  });

  it("migrates registered repository transfers without rewriting stable ids", () => {
    const snapshot = structuredClone(snapshotFixture());
    for (const repository of snapshot.repositories) {
      if (repository.id === "elizaOS/asi") {
        Object.assign(repository, {
          owner: "elizaOS",
          name: "asi",
          displayName: "elizaOS/asi",
          githubUrl: "https://github.com/elizaOS/asi",
        });
      }
      if (repository.id === "elizaOS/proximityprize") {
        Object.assign(repository, {
          owner: "elizaOS",
          name: "proximityprize",
          displayName: "elizaOS/proximityprize",
          githubUrl: "https://github.com/elizaOS/proximityprize",
        });
      }
    }

    const migrated = preparePullRequestLedger(snapshot);
    expect(migrated.repositories).toEqual(snapshotFixture().repositories);
    expect(migrated.repositories[1].id).toBe("elizaOS/asi");
    expect(migrated.repositories[1].owner).toBe("SlopDotCash");
  });

  it("rejects an unregistered repository identity during transfer migration", () => {
    const snapshot = structuredClone(snapshotFixture());
    Object.assign(snapshot.repositories[1], {
      owner: "attacker",
      name: "asi",
      displayName: "attacker/asi",
      githubUrl: "https://github.com/attacker/asi",
    });

    expect(() => preparePullRequestLedger(snapshot)).toThrow(
      "is not a registered repository identity",
    );
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
