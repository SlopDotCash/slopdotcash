/**
 * Regression: a credited value review submitted inside its allocation
 * window but before the current scoring window keeps its slot and share
 * (protocol/scoring-v2.md, "Review credit"). The builder omits its ledger
 * event — a value event outside the scoring window is not publishable —
 * and publishes the exclusion `review-credit-outside-window`. The omitted
 * allocation must still reach the Points journal: when the first snapshot
 * generated after the merge is already late enough that the review sits
 * before its window, no earlier award exists to "keep", so the snapshot
 * publishes the allocated share as an omitted review credit and
 * applyPointsSnapshot materializes the award from it.
 *
 * One value-policy PR merged 2026-11-05. Its allocation window is
 * [2026-10-01, 2026-11-05). Two assessed standard reviews sit inside it:
 *  - early reviewer, submitted 2026-11-02 (after the 2026-11-01 policy start)
 *  - late reviewer,  submitted 2026-11-04
 * The same census is scored at two first-generation times:
 *  - timely: generated 2026-11-13, scoring window from 2026-10-09
 *  - late:   generated 2026-12-08, scoring window from 2026-11-03
 */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
} from "../src/lib/leaderboard-types";
import {
  applyPointsSnapshot,
  emptyPointsJournal,
  latestPoints,
  POINTS_PER_THIRD,
  type PointsJournal,
} from "../src/lib/points";
import { penaltyScoreInput } from "../tests/penalty-score-fixture";

beforeAll(() => setSystemTime(new Date("2026-12-10T00:00:00.000Z")));
afterAll(() => setSystemTime());

const early: GitHubActor = {
  id: "MDQ6VXNlcjcx",
  login: "early-reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/71?v=4",
  url: "https://github.com/early-reviewer",
  kind: "User",
};
const late: GitHubActor = {
  id: "MDQ6VXNlcjcy",
  login: "late-reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/72?v=4",
  url: "https://github.com/late-reviewer",
  kind: "User",
};

function build(generatedAt: string) {
  const census = penaltyScoreInput([], generatedAt);
  // Mirror the real collector: the census for a generation only contains
  // merged outcomes inside its own 35-day window.
  const windowFromMs = Date.parse(generatedAt) - 35 * 24 * 60 * 60 * 1000;
  census.mergedPullRequests = census.mergedPullRequests.filter(
    (row) => row.mergedAt && Date.parse(row.mergedAt) >= windowFromMs,
  );
  census.mergedPullRequestOutcomes = census.mergedPullRequestOutcomes.filter(
    (row) => Date.parse(row.mergedAt) >= windowFromMs,
  );
  census.source.counts.mergedPullRequests = census.mergedPullRequests.length;
  census.source.counts.detailedMergedPullRequests =
    census.mergedPullRequests.length;
  const pull = census.mergedPullRequests.find(
    (row) => row.id === "PR_november",
  );
  if (!pull?.mergedAt) throw new Error("missing fixture pull request");
  pull.reviews = [
    {
      id: "PRR_early",
      body: "Reproduced the defect and confirmed the fix.",
      state: "APPROVED",
      submittedAt: "2026-11-02T00:00:00.000Z",
      url: `${pull.url}#pullrequestreview-1`,
      author: early,
      inlineCommentCount: 0,
    },
    {
      id: "PRR_late",
      body: "Reproduced the defect and confirmed the fix.",
      state: "APPROVED",
      submittedAt: "2026-11-04T12:00:00.000Z",
      url: `${pull.url}#pullrequestreview-2`,
      author: late,
      inlineCommentCount: 0,
    },
  ];
  census.detailEligibleMergedPullRequestIds = [];
  const decision = {
    status: "assessed",
    implementationActorNodeIds: [],
    record: {
      pullRequestNodeId: pull.id,
      repository: "elizaOS/asi",
      headSha: pull.headRefOid,
      occurredAt: pull.mergedAt,
      assessment: { tier: "medium", reviews: [] },
    },
    assessment: {
      status: "assessed",
      tier: "medium",
      reviews: [
        {
          sourceId: "PRR_early",
          tier: "standard",
          finding: "confirms the fix",
          outcome: "useful validation",
        },
        {
          sourceId: "PRR_late",
          tier: "standard",
          finding: "confirms the fix",
          outcome: "useful validation",
        },
      ],
    },
    history: [
      {
        sequence: 1,
        record_digest: "e".repeat(64),
        record_json: "{}",
        recorded_at: "2026-11-05T01:00:00.000Z",
      },
    ],
    latestDigest: "d".repeat(64),
  };
  census.valueDecisions = new Map([
    [
      pull.id,
      decision as unknown as NonNullable<
        LeaderboardInput["valueDecisions"]
      > extends ReadonlyMap<string, infer V>
        ? V
        : never,
    ],
  ]);
  return createLeaderboardSnapshot(census);
}

function reviewEvents(snapshot: ReturnType<typeof build>) {
  return snapshot.ledger.filter(
    (event) =>
      event.category === "substantive-review" &&
      event.id.startsWith("PR_november:value-review:"),
  );
}

function reviewAwards(journal: PointsJournal) {
  return [...latestPoints(journal).values()]
    .map((revision) => revision.award)
    .filter(
      (award) =>
        award.category === "substantive-review" &&
        (award.sourceId === "PRR_early" || award.sourceId === "PRR_late"),
    );
}

function revisionsFor(journal: PointsJournal, sourceId: string) {
  return journal.revisions.filter(
    (revision) =>
      revision.award.category === "substantive-review" &&
      revision.award.sourceId === sourceId,
  );
}

test("timely first generation credits both reviewers and publishes no omitted credits", () => {
  const snapshot = build("2026-11-13T00:00:00.000Z");
  const events = reviewEvents(snapshot);
  expect(events.map((event) => event.actor.login).sort()).toEqual([
    "early-reviewer",
    "late-reviewer",
  ]);
  for (const event of events) expect(event.scoreThirds).toBeGreaterThan(0);
  expect(snapshot.omittedReviewCredits).toBeUndefined();
  expect(
    (snapshot.reviewExclusions ?? []).filter(
      (entry) => entry.pullRequestId === "PR_november",
    ),
  ).toEqual([]);
});

test("late first generation publishes the early reviewer's allocated share as an omitted credit", () => {
  const timely = build("2026-11-13T00:00:00.000Z");
  const late = build("2026-12-08T00:00:00.000Z");
  const timelyEvents = reviewEvents(timely);
  const timelyEarlyThirds = timelyEvents.find(
    (event) => event.actor.login === "early-reviewer",
  )?.scoreThirds;
  const timelyLateThirds = timelyEvents.find(
    (event) => event.actor.login === "late-reviewer",
  )?.scoreThirds;
  if (timelyEarlyThirds === undefined || timelyLateThirds === undefined)
    throw new Error("missing timely review events");
  // The allocation itself does not change between runs: the late reviewer
  // keeps the identical ledger share, and the early reviewer's share is
  // published as an omitted credit instead of vanishing.
  const lateEvents = reviewEvents(late);
  expect(lateEvents.map((event) => event.actor.login)).toEqual([
    "late-reviewer",
  ]);
  expect(lateEvents[0]?.scoreThirds).toEqual(timelyLateThirds);
  const omitted = late.omittedReviewCredits ?? [];
  expect(omitted).toHaveLength(1);
  const credit = omitted[0];
  if (!credit) throw new Error("missing omitted credit");
  expect(credit.id).toBe("PR_november:value-review:PRR_early");
  expect(credit.reviewId).toBe("PRR_early");
  expect(credit.pullRequestId).toBe("PR_november");
  expect(credit.reviewer.login).toBe("early-reviewer");
  expect(credit.scoreThirds).toBe(timelyEarlyThirds);
  expect(credit.submittedAt).toBe("2026-11-02T00:00:00.000Z");
  expect(credit.scoreDecisionSourceId).toBe(`value:${"d".repeat(64)}`);
  // The audit exclusion is still published alongside the omitted credit.
  const exclusions = (late.reviewExclusions ?? []).filter(
    (entry) => entry.pullRequestId === "PR_november",
  );
  expect(
    exclusions.map((entry) => `${entry.reviewId}:${entry.reason}`),
  ).toEqual(["PRR_early:review-credit-outside-window"]);
});

test("snapshot validation rejects an omitted credit that contradicts its bounds", () => {
  const late = build("2026-12-08T00:00:00.000Z");
  // The entry is bound to the snapshot's own published records, exactly as
  // a ledger value event is: the decision digest must match the pull
  // request's assessment coverage row.
  const rebound = structuredClone(late);
  const credit = rebound.omittedReviewCredits?.[0];
  if (!credit) throw new Error("missing omitted credit");
  credit.scoreDecisionSourceId = `value:${"f".repeat(64)}`;
  expect(() => assertLeaderboardSnapshot(rebound)).toThrow();
  const moved = structuredClone(late);
  const movedCredit = moved.omittedReviewCredits?.[0];
  if (!movedCredit) throw new Error("missing omitted credit");
  // A submission inside the scoring window is not an omission.
  movedCredit.submittedAt = "2026-11-04T12:00:00.000Z";
  expect(() => assertLeaderboardSnapshot(moved)).toThrow();
});

test("late first snapshot materializes the omitted award in an empty journal", () => {
  const timely = build("2026-11-13T00:00:00.000Z");
  const timelyEarlyThirds = reviewEvents(timely).find(
    (event) => event.actor.login === "early-reviewer",
  )?.scoreThirds;
  if (timelyEarlyThirds === undefined)
    throw new Error("missing timely review event");
  const late = build("2026-12-08T00:00:00.000Z");
  const journal = applyPointsSnapshot(
    emptyPointsJournal("2026-12-08T00:00:00.000Z"),
    late,
    "a".repeat(64),
    "2026-12-08T00:00:00.000Z",
  );
  const awards = reviewAwards(journal);
  expect(awards.map((award) => award.sourceId).sort()).toEqual([
    "PRR_early",
    "PRR_late",
  ]);
  const earlyAward = awards.find((award) => award.sourceId === "PRR_early");
  if (!earlyAward) throw new Error("missing early award");
  expect(earlyAward.amount).toBe(timelyEarlyThirds * POINTS_PER_THIRD);
  expect(earlyAward.occurredAt).toBe("2026-11-02T00:00:00.000Z");
  expect(earlyAward.workUnitId).toBe("wu_value_review_prr_early");
  expect(earlyAward.provisional).toBe(true);
});

test("reapplying the late snapshot does not duplicate the materialized award", () => {
  const late = build("2026-12-08T00:00:00.000Z");
  let journal = applyPointsSnapshot(
    emptyPointsJournal("2026-12-08T00:00:00.000Z"),
    late,
    "a".repeat(64),
    "2026-12-08T00:00:00.000Z",
  );
  journal = applyPointsSnapshot(
    journal,
    late,
    "a".repeat(64),
    "2026-12-08T00:00:00.000Z",
  );
  expect(revisionsFor(journal, "PRR_early")).toHaveLength(1);
  expect(revisionsFor(journal, "PRR_late")).toHaveLength(1);
});

test("timely snapshot first, then late: the earlier award is retained unchanged", () => {
  const timely = build("2026-11-13T00:00:00.000Z");
  const late = build("2026-12-08T00:00:00.000Z");
  let journal = applyPointsSnapshot(
    emptyPointsJournal("2026-11-13T00:00:00.000Z"),
    timely,
    "b".repeat(64),
    "2026-11-13T00:00:00.000Z",
  );
  expect(
    reviewAwards(journal)
      .map((award) => award.sourceId)
      .sort(),
  ).toEqual(["PRR_early", "PRR_late"]);
  const timelyEarlyAmount = reviewAwards(journal).find(
    (award) => award.sourceId === "PRR_early",
  )?.amount;
  journal = applyPointsSnapshot(
    journal,
    late,
    "a".repeat(64),
    "2026-12-08T00:00:00.000Z",
  );
  const awards = reviewAwards(journal);
  expect(awards.map((award) => award.sourceId).sort()).toEqual([
    "PRR_early",
    "PRR_late",
  ]);
  const earlyAward = awards.find((award) => award.sourceId === "PRR_early");
  expect(earlyAward?.amount).toBe(timelyEarlyAmount);
  expect(earlyAward?.amount).toBeGreaterThan(0);
  // The late run adds no second revision for the retained award.
  expect(revisionsFor(journal, "PRR_early")).toHaveLength(1);
});
