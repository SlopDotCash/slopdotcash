import { describe, expect, it } from "vitest";
import {
  assertLeaderboardSnapshot,
  assertPublishableLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { createProjectView } from "../src/lib/project-view";
import { snapshotFixture } from "../tests/fixtures";
import { preparePullRequestLedger } from "./prepare-pr-ledger";

describe("pull-request ledger schema bridge", () => {
  it("accepts an already-current public ledger unchanged", () => {
    const snapshot = snapshotFixture();
    expect(preparePullRequestLedger(snapshot)).toBe(snapshot);
  });

  it("rebinds only a registered pre-transfer repository presentation", () => {
    const deployed = structuredClone(snapshotFixture());
    const asi = deployed.repositories.find(
      (repository) => repository.id === "elizaOS/asi",
    ) as unknown as {
      owner: string;
      name: string;
      displayName: string;
      githubUrl: string;
    };
    if (!asi) throw new Error("missing ASI fixture repository");
    asi.owner = "elizaOS";
    asi.name = "asi";
    asi.displayName = "elizaOS/asi";
    asi.githubUrl = "https://github.com/elizaOS/asi";

    const rebound = preparePullRequestLedger(deployed);
    expect(rebound).not.toBe(deployed);
    expect(
      rebound.repositories.find(
        (repository) => repository.id === "elizaOS/asi",
      ),
    ).toMatchObject({
      owner: "SlopDotCash",
      name: "asi",
      displayName: "SlopDotCash/asi",
      githubUrl: "https://github.com/SlopDotCash/asi",
    });

    asi.owner = "attacker";
    asi.displayName = "attacker/asi";
    asi.githubUrl = "https://github.com/attacker/asi";
    expect(() => preparePullRequestLedger(deployed)).toThrow(
      /not a registered/u,
    );
  });

  it("reads a prior inventory without inventing collection or allowing partial publication", () => {
    const historical = structuredClone(snapshotFixture());
    // Remove an active repository with no fixture events. Paused proposals
    // are already excluded from the complete collection inventory.
    const uncollected = historical.repositories[2];
    historical.repositories = historical.repositories.filter(
      (repository) => repository.id !== uncollected.id,
    );
    historical.source.repositories = historical.source.repositories.filter(
      (repository) => repository.id !== uncollected.id,
    );
    expect(() =>
      createProjectView(historical, "monna-agent-permission-diff"),
    ).toThrow(/not collected activity/u);
    const originalBytes = JSON.stringify(historical);
    expect(preparePullRequestLedger(historical)).toBe(historical);
    expect(JSON.stringify(historical)).toBe(originalBytes);
    expect(() => assertLeaderboardSnapshot(historical)).not.toThrow();
    expect(() => assertPublishableLeaderboardSnapshot(historical)).toThrow(
      /complete target repository registry/u,
    );

    const badScore = structuredClone(historical);
    badScore.leaders[0].score += 1;
    expect(() => assertLeaderboardSnapshot(badScore)).toThrow();
    const missingSource = structuredClone(historical);
    missingSource.source.repositories.pop();
    expect(() => assertLeaderboardSnapshot(missingSource)).toThrow(
      /GraphQL node ID/u,
    );
    const reordered = structuredClone(historical);
    reordered.repositories.reverse();
    expect(() => preparePullRequestLedger(reordered)).toThrow(
      /registry order/u,
    );
    const omittedActivity = structuredClone(historical);
    omittedActivity.workQueue.issues[0].repository = uncollected.id;
    omittedActivity.workQueue.issues[0].url = `${uncollected.githubUrl}/issues/1`;
    expect(() => assertLeaderboardSnapshot(omittedActivity)).toThrow(
      /repository/u,
    );
  });

  it("keeps a transferred historical inventory in source order and rejects unknown repositories", () => {
    const historical = structuredClone(snapshotFixture());
    historical.repositories = historical.repositories.slice(0, 4);
    historical.source.repositories = historical.source.repositories.slice(0, 4);
    Object.assign(historical.repositories[1], {
      owner: "elizaOS",
      name: "asi",
      displayName: "elizaOS/asi",
      githubUrl: "https://github.com/elizaOS/asi",
    });
    expect(preparePullRequestLedger(historical).repositories).toHaveLength(4);
    historical.repositories.reverse();
    expect(() => preparePullRequestLedger(historical)).toThrow(
      /registry order/u,
    );
    Object.assign(historical.repositories[0], { id: "unknown/repository" });
    expect(() => preparePullRequestLedger(historical)).toThrow(
      /not registered/u,
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
