/** Quint allocations replay through the review allocator, snapshot and Points journal. */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createLeaderboardSnapshot,
  repositoryIdFromUrl,
} from "../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
} from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  applyPointsSnapshot,
  emptyPointsJournal,
  latestPoints,
  type PointAward,
  pointKey,
} from "../src/lib/points";
import { allocatePullRequestReviewCredit } from "../src/lib/scoring-policy";
import { penaltyScoreInput } from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date("2027-01-15T00:00:00Z")));
afterAll(() => setSystemTime());
const date = (day: number) =>
  new Date(Date.parse("2026-11-01T00:00:00Z") + day * 86_400_000).toISOString();
type Sample = {
  size: number;
  high: number;
  tie: boolean;
  outside: boolean;
  later: boolean;
  currentFrom: number;
  credited: number[];
  sources: number[];
  shares: number[];
  issued: number[];
  retained: number[];
};
function sources(sample: Sample) {
  return Array.from({ length: 7 }, (_, i) => {
    const id = i + 1;
    const actorId = id === 3 ? 1 : id > 3 ? id - 1 : id;
    const actor: GitHubActor = {
      id: Buffer.from(`04:User${actorId + 60}`).toString("base64"),
      login: `reviewer-${actorId}`,
      kind: "User",
      url: `https://github.com/reviewer-${actorId}`,
      avatarUrl: `https://avatars.githubusercontent.com/u/${actorId + 60}?v=4`,
    };
    return {
      id,
      actorId,
      actor,
      reviewId: `PRR_${String(id === 2 && sample.tie ? 0 : id).padStart(2, "0")}`,
      submittedAt: date(
        id === 1 && sample.outside ? 0 : id === 2 && sample.tie ? 1 : id,
      ),
      thirds: id === 3 ? sample.high : 1,
    };
  });
}
function snapshot(sample: Sample, records = sources(sample)) {
  const generatedAt = date(sample.currentFrom + 35);
  const input = penaltyScoreInput([], generatedAt);
  const pull = input.mergedPullRequests.find((row) => row.id === "PR_november");
  const outcome = input.mergedPullRequestOutcomes?.find(
    (row) => row.id === "PR_november",
  );
  if (!pull || !outcome) throw new Error("Missing complete outcome fixture");
  pull.createdAt = date(0);
  pull.mergedAt = date(36);
  pull.closedAt = date(36);
  pull.updatedAt = date(36);
  pull.reviews = records.map((r) => ({
    id: r.reviewId,
    author: r.actor,
    state: "APPROVED",
    submittedAt: r.submittedAt,
    url: `${pull.url}#pullrequestreview-${r.id}`,
    body: "Verified a concrete failure path.",
    inlineCommentCount: 0,
  }));
  input.mergedPullRequests = [pull];
  input.mergedPullRequestOutcomes = [
    {
      ...outcome,
      createdAt: pull.createdAt,
      updatedAt: pull.updatedAt,
      mergedAt: pull.mergedAt,
    },
  ];
  input.closedUnmergedPullRequests = [];
  input.detailEligibleMergedPullRequestIds = [];
  input.windowFrom = date(sample.currentFrom);
  input.windowTo = generatedAt;
  input.verificationWindowFrom = date(sample.currentFrom);
  input.sourceUpdatedAt = date(36);
  input.source = {
    ...input.source,
    fetchedAt: generatedAt,
    cutoffAt: generatedAt,
    counts: {
      ...input.source.counts,
      mergedPullRequests: 1,
      detailedMergedPullRequests: 0,
    },
    verificationWindow: { days: 35, from: input.windowFrom, to: generatedAt },
  };
  const tier =
    sample.size === 0
      ? "none"
      : sample.size === 1
        ? "micro"
        : sample.size === 3
          ? "small"
          : "medium";
  const assessment = {
    status: "assessed",
    tier,
    reviews: records.map((r) => ({
      sourceId: r.reviewId,
      tier: r.thirds === 3 ? "standard" : "triage",
      finding: "Concrete review finding",
      outcome: "Useful validation",
    })),
  };
  const decision = {
    status: "assessed",
    implementationActorNodeIds: [],
    record: {
      pullRequestNodeId: pull.id,
      repository: repositoryIdFromUrl(pull.url),
      headSha: pull.headRefOid,
      occurredAt: pull.mergedAt,
      assessment,
    },
    assessment,
    history: [
      {
        sequence: 1,
        record_digest: "e".repeat(64),
        record_json: "{}",
        recorded_at: date(36),
      },
    ],
    latestDigest: "d".repeat(64),
  };
  input.valueDecisions = new Map([
    [
      pull.id,
      decision as unknown as NonNullable<
        LeaderboardInput["valueDecisions"]
      > extends ReadonlyMap<string, infer V>
        ? V
        : never,
    ],
  ]);
  return createLeaderboardSnapshot(input);
}

test("generated pool traces preserve order, highest band, equal remainders, cap and window continuity", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-review-pool-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "run",
        "formal/models/ui_review_pool.qnt",
        "--backend=typescript",
        "--seed=20261108",
        "--max-samples=100",
        "--step=produce",
        "--max-steps=1",
        "--n-traces=100",
        `--out-itf=${join(directory, "pool-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const files = readdirSync(directory);
    expect(files.length).toBe(100);
    for (const file of files) {
      const trace = JSON.parse(
        readFileSync(join(directory, file), "utf8"),
        (_key, value) =>
          value && typeof value === "object" && "#bigint" in value
            ? Number(value["#bigint"])
            : value && typeof value === "object" && "#set" in value
              ? value["#set"]
              : value,
      ) as { states: { s: Sample }[] };
      const sample = trace.states.at(-1)?.s;
      if (!sample) throw new Error("Missing generated sample");
      const records = sources(sample);
      const present = records.filter((row) => sample.later || row.id !== 3);
      const eligible = present.filter((row) => row.submittedAt >= date(1));
      for (const ordered of [
        eligible,
        [...eligible].reverse(),
        [...eligible.slice(3), ...eligible.slice(0, 3)],
      ]) {
        const actual = allocatePullRequestReviewCredit(ordered, sample.size);
        expect(
          actual.credited.map((r) => Number(r.actor.login.split("-")[1])),
        ).toEqual(sample.credited);
        expect(actual.credited.map((r) => r.source.reviewId)).toEqual(
          sample.sources.map((id) => records[id - 1].reviewId),
        );
        expect(actual.credited.map((r) => r.shareThirds)).toEqual(
          sample.shares,
        );
        expect(actual.beyondLimitReviewIds).toEqual(
          eligible
            .filter((row) => !sample.credited.includes(row.actorId))
            .map((row) => row.reviewId),
        );
      }
      const actual = snapshot(sample, present);
      const issued = actual.ledger.filter(
        (event) => event.category === "substantive-review",
      );
      expect(
        issued.map((r) => Number(r.actor.login.split("-")[1])).sort(),
      ).toEqual([...sample.issued].sort());
      for (const event of issued)
        expect(event.scoreThirds).toBe(
          sample.shares[
            sample.credited.indexOf(Number(event.actor.login.split("-")[1]))
          ],
        );
      const award = (
        record: (typeof records)[number],
        amount: number,
      ): PointAward => ({
        key: pointKey(
          "asi",
          record.actor.id,
          "substantive-review",
          record.reviewId,
        ),
        actor: { id: record.actor.id, login: record.actor.login },
        projectId: "asi",
        category: "substantive-review",
        amount,
        occurredAt: record.submittedAt,
        sourceId: record.reviewId,
        sourceUrl: `https://github.com/SlopDotCash/asi/pull/8#pullrequestreview-${record.id}`,
        workUnitId: `wu_review_${record.id}`,
        provisional: true,
      });
      const previous = sample.retained.map((actor) => {
        const index = sample.credited.indexOf(actor);
        return award(
          records[sample.sources[index] - 1],
          sample.shares[index] * 10,
        );
      });
      // An old actor outside the allocation window takes no current slot;
      // its previously recorded Points are still not an adverse decision.
      if (sample.outside && !sample.later) previous.push(award(records[0], 10));
      const journal = appendPointAwards(
        emptyPointsJournal(date(36)),
        previous,
        "a".repeat(64),
        "slop-score-v2",
        date(36),
      );
      const updated = applyPointsSnapshot(
        journal,
        actual,
        "b".repeat(64),
        actual.generatedAt,
      );
      for (const award of previous)
        expect(latestPoints(updated).get(award.key)?.award.amount).toBe(
          award.amount,
        );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
