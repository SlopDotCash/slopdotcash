import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import type { PublishedPenalty } from "../src/lib/leaderboard-types";
import { penaltyDeductions } from "../src/lib/score-penalties";
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

// Two penalties recorded at the same time for one actor, project and month
// whose month's score covers only one debit: application order decides
// which penalty is recorded as applied, and a Turkish default collation
// reverses that order because the penalty IDs are the production i/I pair
// in `ids` above with a `:penalty` suffix. Every reader of the score runs
// this same function, so the split must not depend on the host locale.
test("Turkish generation keeps which same-time penalty is applied", () => {
  const events = [
    {
      actor: PENALIZED_AUTHOR,
      repository: "asi",
      occurredAt: "2026-11-05T00:00:00.000Z",
      scoreThirds: 3,
      points: 1,
    },
  ];
  const penalties: PublishedPenalty[] = ids.map((pullId, index) => ({
    id: `${pullId}:penalty`,
    actor: PENALIZED_AUTHOR,
    repository: "asi",
    occurredAt: "2026-11-15T12:00:00.000Z",
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: 3,
    source: {
      id: pullId,
      kind: "pull-request",
      number: 500 + index,
      title: "Followers",
      url: `https://github.com/SlopDotCash/asi/pull/${500 + index}`,
    },
  }));
  withTurkishLocale(() => {
    const deductions = penaltyDeductions(
      events,
      penalties,
      (repository) => repository,
    );
    expect([...deductions.byPenalty.entries()]).toEqual([
      [`${ids[0]}:penalty`, 3],
    ]);
    expect(deductions.byActor.get(PENALIZED_AUTHOR.id)).toBe(3);
  });
});
