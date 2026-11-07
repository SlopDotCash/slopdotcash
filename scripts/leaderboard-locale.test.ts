import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
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

test("Turkish generation keeps the same evaluated contributions under the legacy cap", () => {
  // Evaluated-contribution credit scores only before Score v2 takes effect,
  // so this case stays in the July 2026 legacy window. Four same-time awards
  // from one actor compete for the cap of three; the i/I pair straddles the
  // boundary, so an unpinned tie-break would credit a different award — worth
  // 8 points instead of 1 — on a Turkish-locale host.
  const generatedAt = "2026-07-20T00:00:00.000Z";
  const occurredAt = "2026-07-15T12:00:00.000Z";
  setSystemTime(new Date(generatedAt));
  const pair = [
    "eval:PR_kwDOMT5cIs8AAAABG3i2Yg",
    "eval:PR_kwDOMT5cIs8AAAABG3IwgQ",
  ];
  const awardIds = ["eval:aaa-first", "eval:aaa-second", ...pair];
  const buildInput = () => {
    const input = penaltyScoreInput([], generatedAt);
    input.mergedPullRequests = [];
    input.mergedPullRequestOutcomes = [];
    input.closedUnmergedPullRequests = [];
    input.detailEligibleMergedPullRequestIds = [];
    input.sourceUpdatedAt = generatedAt;
    input.valuePolicy = undefined;
    input.valueDecisions = undefined;
    input.closedIssueCount = 0;
    input.evaluatedContributions = awardIds.map((id, index) => ({
      id,
      actor: PENALIZED_AUTHOR,
      category: "evaluated-contribution",
      points: id === pair[1] ? 8 : 1,
      occurredAt,
      repository: "elizaOS/asi",
      source: {
        id: `SRC_eval_${index}`,
        kind: "pull-request",
        number: 100 + index,
        title: "Evaluated change",
        url: `https://github.com/SlopDotCash/asi/pull/${100 + index}`,
      },
      reason:
        "The evaluated contribution fixed the failing boundary case directly.",
      evaluation: {
        decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
        reviewedAt: "2026-07-16T00:00:00.000Z",
        reviewer: "maintainer",
        manifestPath: `evaluations/asi/award-${index}.json`,
        manifestSha256: String(index + 1)
          .repeat(64)
          .slice(0, 64)
          .replace(/./g, (char) => "abcdef"[Number(char) % 6]),
      },
    })) as never;
    return input;
  };
  const credited = () => {
    const snapshot = createLeaderboardSnapshot(buildInput());
    const leader = snapshot.leaders.find(
      (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
    );
    return {
      ids: snapshot.ledger
        .filter((entry) => entry.category === "evaluated-contribution")
        .map((entry) => entry.id)
        .sort(),
      points: leader?.points.evaluatedContributions,
      score: leader?.score,
    };
  };
  const expected = {
    ids: ["eval:aaa-first", "eval:aaa-second", pair[0]].sort(),
    points: 3,
    score: 3,
  };
  expect(credited()).toEqual(expected);
  withTurkishLocale(() => {
    expect(credited()).toEqual(expected);
  });
});

test("Turkish generation keeps the same retained reviews under the legacy cap", () => {
  // The retained-review sort in createLeaderboardSnapshot feeds the same
  // capped addScore path as the evaluated contributions above:
  // SCORE_CAPS.substantiveReviews = 10 per actor / project / UTC month in the
  // legacy window. Legacy substantive-review credit is pinned to 3 points, so
  // the score cannot change — but which reviews land in the ledger is decided
  // by the sort order. Eleven same-time retained reviews from one actor
  // compete for the cap of ten; the i/I pair straddles the boundary, so an
  // unpinned tie-break would credit a different review on a Turkish-locale
  // host and the published snapshot would not reproduce from the same input.
  const generatedAt = "2026-07-20T00:00:00.000Z";
  const occurredAt = "2026-07-15T12:00:00.000Z";
  setSystemTime(new Date(generatedAt));
  const pair = ["PR_kwDOMT5cIs8AAAABG3i2Yg", "PR_kwDOMT5cIs8AAAABG3IwgQ"];
  const parentIds = [
    ...Array.from({ length: 9 }, (_, index) => `PR_aaa-retained-${index}`),
    ...pair,
  ];
  const buildInput = () => {
    const input = penaltyScoreInput([], generatedAt);
    input.mergedPullRequests = [];
    input.mergedPullRequestOutcomes = [];
    input.closedUnmergedPullRequests = [];
    input.detailEligibleMergedPullRequestIds = [];
    input.sourceUpdatedAt = generatedAt;
    input.valuePolicy = undefined;
    input.valueDecisions = undefined;
    input.closedIssueCount = 0;
    input.source.counts.mergedPullRequests = parentIds.length;
    input.retainedReviewEvents = parentIds.map((parentId, index) => ({
      id: `${parentId}:reviewer:${PENALIZED_AUTHOR.id}`,
      actor: PENALIZED_AUTHOR,
      category: "substantive-review",
      points: 3,
      occurredAt,
      repository: "elizaOS/asi",
      source: {
        id: `PRR_retained_${index}`,
        kind: "review",
        number: 200 + index,
        title: "Retained change",
        url: `https://github.com/SlopDotCash/asi/pull/${200 + index}#pullrequestreview-${index + 1}`,
      },
      reason:
        "First qualifying substantive, non-self review submitted before merge.",
      continuity: {
        sourceSnapshotSha256: String(index + 1).padStart(64, "0"),
        decisionUrl: `https://github.com/SlopDotCash/slopdotcash/issues/${313 + index}`,
      },
    })) as never;
    return input;
  };
  const credited = () => {
    const snapshot = createLeaderboardSnapshot(buildInput());
    const leader = snapshot.leaders.find(
      (entry) => entry.actor.id === PENALIZED_AUTHOR.id,
    );
    return {
      ids: snapshot.ledger
        .filter((entry) => entry.category === "substantive-review")
        .map((entry) => entry.id)
        .sort(),
      points: leader?.points.substantiveReviews,
      score: leader?.score,
    };
  };
  const expected = {
    ids: parentIds
      .slice(0, 10)
      .map((parentId) => `${parentId}:reviewer:${PENALIZED_AUTHOR.id}`)
      .sort(),
    points: 30,
    score: 30,
  };
  expect(credited()).toEqual(expected);
  withTurkishLocale(() => {
    expect(credited()).toEqual(expected);
  });
});
