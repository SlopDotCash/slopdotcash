/**
 * A project's published reward start bounds every cycle of that project.
 * The collection window is a uniform 35 days, so a project registered inside
 * the window has ledger work merged before its start; the project views and
 * the global ranking already exclude that work when they read the ledger
 * (projectCycleWindow, openMonthScores). The snapshot leaders must agree:
 * every reader of the score uses the same event set (score-penalties.ts).
 * ASI's fixture reward start is 2026-08-12, inside the window of a snapshot
 * generated on 2026-09-10.
 */
import { expect, setSystemTime, test } from "bun:test";
import type { CycleIndex } from "../src/lib/cycle-index";
import {
  createGlobalLeaders,
  openMonthScores,
} from "../src/lib/global-leaderboard";
import {
  createLeaderboardSnapshot,
  type LeaderboardInput,
} from "../src/lib/leaderboard";
import type {
  GitHubActor,
  PullRequestRecord,
} from "../src/lib/leaderboard-types";
import { createProjectView } from "../src/lib/project-view";
import {
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

const GENERATED_AT = "2026-09-10T00:00:00.000Z";
const REPO_URL = "https://github.com/SlopDotCash/asi";

function pull(
  id: string,
  number: number,
  author: GitHubActor,
  at: { createdAt: string; mergedAt: string | null; closedAt: string },
): PullRequestRecord {
  return {
    id,
    number,
    title: at.mergedAt ? "fix: accepted change" : "Followers",
    url: `${REPO_URL}/pull/${number}`,
    body: at.mergedAt ? "Fixes a defect." : "Buy cheap followers today.",
    createdAt: at.createdAt,
    updatedAt: at.closedAt,
    lastEditedAt: null,
    editor: null,
    mergedAt: at.mergedAt,
    closedAt: at.closedAt,
    headRefOid: String(number % 10).repeat(40),
    isDraft: false,
    reviewDecision: null,
    activeReviewRequestCount: 0,
    author,
    assignees: [],
    labels: [],
    files: [{ path: "src/fix.py", additions: 4, deletions: 1 }],
    comments: [],
    reviews: [],
    closingIssueIds: [],
    additions: 4,
    deletions: 1,
    changedFiles: 1,
    commitCount: 1,
  };
}

/** Merged four days before ASI's reward start; outside every ASI cycle. */
const PR_PRE = pull("PR_pre", 11, PENALIZED_AUTHOR, {
  createdAt: "2026-08-07T00:00:00.000Z",
  mergedAt: "2026-08-08T12:00:00.000Z",
  closedAt: "2026-08-08T12:00:00.000Z",
});
/** Merged after the reward start; the one credit every reader must keep. */
const PR_POST = pull("PR_post", 12, PENALIZED_AUTHOR, {
  createdAt: "2026-08-19T00:00:00.000Z",
  mergedAt: "2026-08-20T12:00:00.000Z",
  closedAt: "2026-08-20T12:00:00.000Z",
});
const PR_SPAM = pull("PR_spam", 13, PENALIZED_AUTHOR, {
  createdAt: "2026-08-23T00:00:00.000Z",
  mergedAt: null,
  closedAt: "2026-08-24T00:00:00.000Z",
});
/** Spam PR closed before ASI's reward start; outside every ASI cycle. */
const PR_SPAM_PRE = pull("PR_spam_pre", 14, PENALIZED_AUTHOR, {
  createdAt: "2026-08-07T00:00:00.000Z",
  mergedAt: null,
  closedAt: "2026-08-08T00:00:00.000Z",
});

function input(debitThirds: number | null): LeaderboardInput {
  const base = penaltyScoreInput(
    debitThirds === null
      ? []
      : [
          {
            itemNodeId: "PR_spam",
            authorGithubId: "42",
            category: "spam",
            tableVersion: "slopbot-penalties-v1",
            debitThirds,
            period: "2026-08",
            recordedAt: "2026-08-24T00:00:00.000Z",
          },
        ],
    GENERATED_AT,
  );
  if (debitThirds === null) {
    // Legacy scoring path (mirrors merged-score-index.test.ts); a closed
    // unmerged pull request would require value decisions, so the debit
    // cases below keep the policy inputs instead.
    delete base.valuePolicy;
    delete base.valueDecisions;
  }
  const mergedPullRequests = [
    structuredClone(PR_PRE),
    structuredClone(PR_POST),
  ];
  base.mergedPullRequests = mergedPullRequests;
  base.mergedPullRequestOutcomes = mergedPullRequests.map((p) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    url: p.url,
    body: p.body,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    mergedAt: p.mergedAt as string,
    headRefOid: p.headRefOid,
    author: p.author,
    additions: p.additions,
    deletions: p.deletions,
    baseRefName: "main",
    commits: [{ oid: p.headRefOid, author: p.author }],
  }));
  base.closedUnmergedPullRequests =
    debitThirds === null ? [] : [structuredClone(PR_SPAM)];
  base.detailEligibleMergedPullRequestIds = mergedPullRequests.map((p) => p.id);
  base.source.counts.mergedPullRequests = mergedPullRequests.length;
  base.source.counts.detailedMergedPullRequests = mergedPullRequests.length;
  base.sourceUpdatedAt = "2026-08-20T12:00:00.000Z";
  return base;
}

/** The reviewer's pre-start debit: one third recorded 2026-08-08. */
function preStartDebitInput(): LeaderboardInput {
  const base = penaltyScoreInput(
    [
      {
        itemNodeId: "PR_spam_pre",
        authorGithubId: "42",
        category: "spam",
        tableVersion: "slopbot-penalties-v1",
        debitThirds: 1,
        period: "2026-08",
        recordedAt: "2026-08-08T00:00:00.000Z",
      },
    ],
    GENERATED_AT,
  );
  const mergedPullRequests = [
    structuredClone(PR_PRE),
    structuredClone(PR_POST),
  ];
  base.mergedPullRequests = mergedPullRequests;
  base.mergedPullRequestOutcomes = mergedPullRequests.map((p) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    url: p.url,
    body: p.body,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    mergedAt: p.mergedAt as string,
    headRefOid: p.headRefOid,
    author: p.author,
    additions: p.additions,
    deletions: p.deletions,
    baseRefName: "main",
    commits: [{ oid: p.headRefOid, author: p.author }],
  }));
  base.closedUnmergedPullRequests = [structuredClone(PR_SPAM_PRE)];
  base.detailEligibleMergedPullRequestIds = mergedPullRequests.map((p) => p.id);
  base.source.counts.mergedPullRequests = mergedPullRequests.length;
  base.source.counts.detailedMergedPullRequests = mergedPullRequests.length;
  base.sourceUpdatedAt = "2026-08-20T12:00:00.000Z";
  return base;
}

const EMPTY_CYCLES = {
  schemaVersion: "1",
  generatedAt: GENERATED_AT,
  cycles: [],
} as unknown as CycleIndex;

function totalsFor(makeInput: () => LeaderboardInput) {
  setSystemTime(new Date(GENERATED_AT));
  const snapshot = createLeaderboardSnapshot(makeInput());
  const view = createProjectView(snapshot, "asi", "2026-08");
  const global = createGlobalLeaders(snapshot, [view], EMPTY_CYCLES);
  const snapLeader = snapshot.leaders.find(
    (l) => l.actor.id === PENALIZED_AUTHOR.id,
  );
  const viewLeader = view.leaders.find(
    (l) => l.actor.id === PENALIZED_AUTHOR.id,
  );
  const globalLeader = global.find((l) => l.actor.id === PENALIZED_AUTHOR.id);
  return {
    ledger: snapshot.ledger
      .filter((e) => e.actor.id === PENALIZED_AUTHOR.id)
      .map((e) => e.source.id),
    penalties: (snapshot.penalties ?? []).map((p) => p.id),
    snapshotThirds: snapLeader?.scoreThirds,
    snapshotPenaltyThirds: snapLeader?.penaltyThirds,
    viewThirds: viewLeader?.scoreThirds,
    viewPenaltyThirds: viewLeader?.penaltyThirds,
    globalThirds:
      globalLeader === undefined ? undefined : globalLeader.score * 3,
    appliedByActor: openMonthScores(
      snapshot,
      EMPTY_CYCLES,
    ).deductions.byActor.get(PENALIZED_AUTHOR.id),
  };
}

function totals(debitThirds: number | null) {
  return totalsFor(() => input(debitThirds));
}

test("work merged before the reward start earns no snapshot credit", () => {
  const t = totals(null);
  expect(t.ledger).toEqual(["PR_post"]);
  expect(t.snapshotThirds).toBe(t.viewThirds);
  expect(t.snapshotThirds).toBe(t.globalThirds);
  expect(t.snapshotThirds).toBeGreaterThan(0);
});

test("a same-month debit applies identically in every reader", () => {
  const t = totals(1);
  expect(t.snapshotPenaltyThirds).toBe(1);
  expect(t.snapshotPenaltyThirds).toBe(t.appliedByActor);
  expect(t.viewPenaltyThirds).toBe(t.appliedByActor);
  expect(t.snapshotThirds).toBe(t.viewThirds);
  expect(t.snapshotThirds).toBe(t.globalThirds);
});

test("a debit larger than the in-cycle credit stays capped in every reader", () => {
  const t = totals(3);
  // Only the post-start third is available in the author's ASI 2026-08
  // bucket, so every reader applies exactly one third, never the two the
  // pre-start work would have added.
  expect(t.snapshotPenaltyThirds).toBe(t.appliedByActor);
  expect(t.viewPenaltyThirds).toBe(t.appliedByActor);
  expect(t.snapshotThirds).toBe(t.viewThirds);
  expect(t.snapshotThirds).toBe(t.globalThirds);
});

test("a debit recorded before the reward start applies in no reader", () => {
  const t = totalsFor(preStartDebitInput);
  // The pre-start debit never reaches the published penalties, so the
  // snapshot keeps the post-start third and every reader agrees.
  expect(t.penalties).toEqual([]);
  // The view always reports a penalty total (0 when none); the applied
  // deductions map omits zero entries, so compare the normalized totals.
  expect(t.snapshotPenaltyThirds ?? 0).toBe(t.appliedByActor ?? 0);
  expect(t.viewPenaltyThirds ?? 0).toBe(t.appliedByActor ?? 0);
  expect(t.snapshotThirds).toBe(1);
  expect(t.snapshotThirds).toBe(t.viewThirds);
  expect(t.snapshotThirds).toBe(t.globalThirds);
});
