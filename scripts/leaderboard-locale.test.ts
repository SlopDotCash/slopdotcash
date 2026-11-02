import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import type { PullRequestRecord } from "../src/lib/leaderboard-types";
import { snapshotFixture } from "../tests/fixtures";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

function withTurkishLocale(run: () => void) {
  const original = String.prototype.localeCompare;
  const locale = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return original.call(this, other, locales ?? "tr", options);
    },
  );
  try {
    run();
  } finally {
    locale.mockRestore();
  }
}

// Adjacent PR IDs in the production snapshot published 2026-10-30. Turkish
// default collation reverses this order because it treats I and i differently.
const ids = ["PR_kwDOMT5cIs8AAAABG3i2Yg", "PR_kwDOMT5cIs8AAAABG3IwgQ"];

test("published review exclusions validate with a Turkish default locale", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const snapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
  snapshot.reviewExclusions = ids.map((pullRequestId, index) => ({
    id: `${pullRequestId}:review-exclusion:PRR_locale${index}`,
    pullRequestId,
    pullRequestNumber: 34000 + index,
    reviewId: `PRR_locale${index}`,
    repository: snapshot.repositories[0].id,
    url: `${snapshot.repositories[0].githubUrl}/pull/${34000 + index}#pullrequestreview-${index + 1}`,
    reason: "unchanged-outcome",
  }));
  withTurkishLocale(() => {
    expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();
    snapshot.reviewExclusions?.reverse();
    expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
      "snapshot.reviewExclusions must be ordered",
    );
  });
});

test("published model declarations validate with a Turkish default locale", () => {
  const snapshot = snapshotFixture();
  snapshot.attributions.push({
    ...snapshot.attributions[0],
    id: "COMMENT_MODEL_fixture:machine-marker:1",
    provider: "OpenAI",
    model: "GPT-5",
    identifier: "OpenAI/GPT-5",
  });
  snapshot.leaders[0].reportedModels = ["openai/gpt-5", "OpenAI/GPT-5"];
  withTurkishLocale(() => {
    expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();
    snapshot.leaders[0].reportedModels.push("openai/gpt-6");
    expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
      "untraceable reported models",
    );
  });
});

test("Turkish generation keeps the published review exclusion order", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  input.mergedPullRequests = structuredClone(input.mergedPullRequests);
  input.mergedPullRequests.slice(0, 2).forEach((pull, index) => {
    pull.id = ids[index];
    input.mergedPullRequestOutcomes[index].id = pull.id;
    input.detailEligibleMergedPullRequestIds[index] = pull.id;
    pull.reviews = [
      {
        id: `PRR_locale${index}`,
        body: "Reviewed.",
        state: "COMMENTED",
        submittedAt: pull.mergedAt as string,
        url: `${pull.url}#pullrequestreview-${index + 1}`,
        author: {
          id: "BOT_locale",
          login: "reviewer[bot]",
          avatarUrl: "https://avatars.githubusercontent.com/in/1?v=4",
          url: "https://github.com/apps/reviewer",
          kind: "Bot",
        },
        inlineCommentCount: 0,
      },
    ];
  });
  withTurkishLocale(() => {
    const snapshot = createLeaderboardSnapshot(input);
    expect(
      snapshot.reviewExclusions?.map((entry) => entry.pullRequestId),
    ).toEqual(ids);
    expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();
  });
});

// Same i/I pair shape as `ids` above; English collation keeps ...i before ...I,
// Turkish default collation reverses them.
const reviewIds = ["PRR_kwDOMT5cIs8AAAABG3i2Yg", "PRR_kwDOMT5cIs8AAAABG3IwgQ"];

test("Turkish generation keeps expand-review opportunity on English-first review id", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const submittedAt = "2026-11-15T12:00:00.000Z";
  input.openPullRequests = [
    {
      id: "PR_open_locale",
      number: 42,
      title: "Open change awaiting a fuller review",
      url: "https://github.com/SlopDotCash/asi/pull/42",
      body: "Implements the accepted behavior.",
      createdAt: "2026-11-14T00:00:00.000Z",
      updatedAt: submittedAt,
      lastEditedAt: null,
      editor: null,
      mergedAt: null,
      closedAt: null,
      headRefOid: "a".repeat(40),
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      activeReviewRequestCount: 0,
      author: PROJECT_OWNER,
      assignees: [],
      labels: [],
      files: [{ path: "src/fix.py", additions: 4, deletions: 1 }],
      comments: [],
      reviews: reviewIds.map((id, index) => ({
        id,
        body: "Looks fine.",
        state: "CHANGES_REQUESTED" as const,
        submittedAt,
        url: `https://github.com/SlopDotCash/asi/pull/42#pullrequestreview-${index + 1}`,
        author: PENALIZED_AUTHOR,
        inlineCommentCount: 0,
      })),
      closingIssueIds: [],
      additions: 4,
      deletions: 1,
      changedFiles: 1,
      commitCount: 1,
    },
  ];
  const englishFirst = [...reviewIds].sort((left, right) =>
    left.localeCompare(right, "en"),
  )[0];
  withTurkishLocale(() => {
    const snapshot = createLeaderboardSnapshot(input);
    const expand = snapshot.opportunities?.filter(
      (entry) => entry.kind === "expand-review",
    );
    expect(expand?.map((entry) => entry.source.id)).toEqual([englishFirst]);
  });
});

// Same production i/I pair as `ids` above. Two penalties recorded at the
// same time order by their `<pull id>:penalty` IDs, and two expand-review
// opportunities at the same time on same-number pull requests in different
// repositories order by their `<pull id>:opportunity:...` IDs; a Turkish
// default collation reverses both published orders.
const orderPairIds = ["PR_kwDOMT5cIs8AAAABG3i2Yg", "PR_kwDOMT5cIs8AAAABG3IwgQ"];

test("Turkish generation keeps the published same-time penalty order", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const recordedAt = "2026-11-15T12:00:00.000Z";
  const input = penaltyScoreInput(
    orderPairIds.map((itemNodeId) => ({
      itemNodeId,
      authorGithubId: "42",
      category: "spam",
      tableVersion: "slopbot-penalties-v1",
      debitThirds: 3,
      period: "2026-11",
      recordedAt,
    })),
    AFTER_NOVEMBER,
  );
  const closedPull = (id: string, number: number): PullRequestRecord => ({
    id,
    number,
    title: "Followers",
    url: `https://github.com/SlopDotCash/asi/pull/${number}`,
    body: "Buy cheap followers today.",
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    lastEditedAt: null,
    editor: null,
    mergedAt: null,
    closedAt: "2026-11-10T00:00:00.000Z",
    headRefOid: "5".repeat(40),
    isDraft: false,
    reviewDecision: null,
    activeReviewRequestCount: 0,
    author: PENALIZED_AUTHOR,
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
  });
  input.closedUnmergedPullRequests = orderPairIds.map((id, index) =>
    closedPull(id, 500 + index),
  );
  withTurkishLocale(() => {
    const snapshot = createLeaderboardSnapshot(input);
    expect(snapshot.penalties?.map((penalty) => penalty.id)).toEqual(
      orderPairIds.map((id) => `${id}:penalty`),
    );
  });
});

test("Turkish generation keeps the published same-time opportunity order", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const submittedAt = "2026-11-15T12:00:00.000Z";
  const openPull = (
    id: string,
    repositoryUrl: string,
    reviewId: string,
  ): PullRequestRecord => ({
    id,
    number: 42,
    title: "Open change awaiting a fuller review",
    url: `${repositoryUrl}/pull/42`,
    body: "Implements the accepted behavior.",
    createdAt: "2026-11-14T00:00:00.000Z",
    updatedAt: submittedAt,
    lastEditedAt: null,
    editor: null,
    mergedAt: null,
    closedAt: null,
    headRefOid: "a".repeat(40),
    isDraft: false,
    reviewDecision: "CHANGES_REQUESTED",
    activeReviewRequestCount: 0,
    author: PROJECT_OWNER,
    assignees: [],
    labels: [],
    files: [{ path: "src/fix.py", additions: 4, deletions: 1 }],
    comments: [],
    reviews: [
      {
        id: reviewId,
        body: "Looks fine.",
        state: "CHANGES_REQUESTED",
        submittedAt,
        url: `${repositoryUrl}/pull/42#pullrequestreview-1`,
        author: PENALIZED_AUTHOR,
        inlineCommentCount: 0,
      },
    ],
    closingIssueIds: [],
    additions: 4,
    deletions: 1,
    changedFiles: 1,
    commitCount: 1,
  });
  const input = penaltyScoreInput([]);
  input.openPullRequests = [
    openPull(
      orderPairIds[0],
      "https://github.com/SlopDotCash/asi",
      "PRR_order_a",
    ),
    openPull(
      orderPairIds[1],
      "https://github.com/elizaOS/eliza",
      "PRR_order_b",
    ),
  ];
  withTurkishLocale(() => {
    const snapshot = createLeaderboardSnapshot(input);
    const expand = snapshot.opportunities?.filter(
      (entry) => entry.kind === "expand-review",
    );
    expect(expand?.map((entry) => entry.id)).toEqual(
      orderPairIds.map(
        (id) => `${id}:opportunity:expand-review:${PENALIZED_AUTHOR.id}`,
      ),
    );
  });
});
