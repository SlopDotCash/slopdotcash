import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { snapshotFixture } from "../tests/fixtures";
import {
  AFTER_NOVEMBER,
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
