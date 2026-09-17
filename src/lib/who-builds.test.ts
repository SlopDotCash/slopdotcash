import { describe, expect, it } from "vitest";
import type {
  GitHubActor,
  LeaderboardSnapshot,
  ScoreEvent,
} from "./leaderboard-types";
import { summarizeWhoBuilds } from "./who-builds";

const author: GitHubActor = {
  id: "U_author",
  login: "author",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  url: "https://github.com/author",
  kind: "User",
};

function scoredEvent(id: string, repository: string): ScoreEvent {
  return {
    id: `${id}:merged`,
    actor: author,
    category: "merged-pull-request",
    points: 3,
    occurredAt: "2026-08-20T12:00:00.000Z",
    repository: repository as ScoreEvent["repository"],
    source: {
      id,
      kind: "pull-request",
      number: 1,
      title: id,
      url: `https://github.com/${repository}/pull/1`,
    },
    reason: "Pull request merged during the rolling window.",
  };
}

function snapshot(ledger: ScoreEvent[], leaders = 2): LeaderboardSnapshot {
  return {
    window: { days: 35, from: "2026-08-01", to: "2026-09-05" },
    leaders: Array.from({ length: leaders }, () => ({})),
    ledger,
  } as unknown as LeaderboardSnapshot;
}

describe("summarizeWhoBuilds", () => {
  it("counts scored events per repository and labels each from its reviewed manifest", () => {
    const summary = summarizeWhoBuilds(
      snapshot([
        scoredEvent("PR_1", "elizaOS/eliza"),
        scoredEvent("PR_2", "elizaOS/eliza"),
        scoredEvent("PR_3", "elizaOS/eliza"),
        scoredEvent("PR_4", "elizaOS/asi"),
      ]),
    );

    expect(summary.windowDays).toBe(35);
    expect(summary.contributors).toBe(2);
    expect(summary.scoredEvents).toBe(4);
    expect(summary.repositories).toHaveLength(2);
    expect(summary.repositories[0]).toMatchObject({
      repositoryId: "elizaOS/eliza",
      displayName: "elizaOS/eliza",
      description: "Core elizaOS agent framework and runtime.",
      projectId: "eliza",
      projectName: "Eliza",
      events: 3,
      share: 0.75,
    });
    expect(summary.repositories[1]).toMatchObject({
      repositoryId: "elizaOS/asi",
      projectId: "asi",
      events: 1,
      share: 0.25,
    });
    expect(summary.repositories[1].description).toMatch(/reinforcement/u);
  });

  it("keeps unregistered repositories visible without inventing a manifest for them", () => {
    const summary = summarizeWhoBuilds(
      snapshot([
        scoredEvent("PR_1", "example/unregistered"),
        scoredEvent("PR_2", "elizaOS/eliza"),
      ]),
    );

    expect(summary.repositories.map((row) => row.repositoryId)).toEqual([
      "elizaOS/eliza",
      "example/unregistered",
    ]);
    expect(summary.repositories[1]).toMatchObject({
      displayName: "example/unregistered",
      description: null,
      projectId: null,
      projectName: null,
      share: 0.5,
    });
  });

  it("returns no repositories and a zero share when the ledger is empty", () => {
    const summary = summarizeWhoBuilds(snapshot([], 0));

    expect(summary.scoredEvents).toBe(0);
    expect(summary.contributors).toBe(0);
    expect(summary.repositories).toEqual([]);
  });
});

describe("who builds cross-reference pin", () => {
  it("renders from the committed, hash-pinned snapshot", async () => {
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const {
      WHO_BUILDS_CROSS_REFERENCE: pin,
      WHO_BUILDS_SNAPSHOT: snapshot,
      whoBuildsDateLabel,
    } = await import("./who-builds");
    const root = resolve(import.meta.dirname, "..", "..");
    const bytes = readFileSync(resolve(root, pin.snapshotPath));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      pin.snapshotSha256,
    );
    expect(readFileSync(resolve(root, pin.methodPath), "utf8")).toContain(
      pin.snapshotSha256,
    );
    expect(JSON.parse(bytes.toString("utf8"))).toEqual(snapshot);
    expect(pin.snapshotPath).toContain(`/${snapshot.generatedAt}/`);
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(whoBuildsDateLabel(snapshot.generatedAt)).toBe("8 September 2026");
    const all = snapshot.cohorts[0];
    expect(all.size).toBe(snapshot.contributors);
    expect(all.classifiable).toBeLessThanOrEqual(all.size);
    expect(all.aiPrimary).toBeLessThanOrEqual(all.classifiable);
    expect(all.aiExternalPr).toBeLessThanOrEqual(all.size);
    expect(snapshot.focus.some((area) => area.primaryContributors > 0)).toBe(
      true,
    );
    expect(snapshot.recognizable.length).toBeGreaterThan(0);
    expect(snapshot.topAi.length).toBeGreaterThan(0);
  });
});
