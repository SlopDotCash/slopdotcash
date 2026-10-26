/** The faster lookup must retain the public snapshot's exclusion boundary. */
import { expect, test } from "bun:test";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import { snapshotFixture } from "../tests/fixtures";

test("excluded reviews cannot share a scored source ID or URL in their repository", () => {
  const snapshot = snapshotFixture("2026-07-30T00:00:00.000Z");
  const review = snapshot.ledger.find(
    (event) => event.source.kind === "review",
  );
  if (!review) throw new Error("Fixture must contain a scored review");
  const exclusion = {
    id: "PR_excluded:review-exclusion:REVIEW_unscored",
    pullRequestId: "PR_excluded",
    pullRequestNumber: review.source.number,
    reviewId: "REVIEW_unscored",
    repository: review.repository,
    url: `${review.source.url}00`,
    reason: "post-merge" as const,
  };
  snapshot.reviewExclusions = [exclusion];
  expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();

  for (const matched of [
    { ...exclusion, url: review.source.url },
    {
      ...exclusion,
      id: `PR_excluded:review-exclusion:${review.source.id}`,
      reviewId: review.source.id,
    },
  ]) {
    snapshot.reviewExclusions = [matched];
    expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
      "snapshot.reviewExclusions cannot contain a score-bearing review source",
    );
  }

  snapshot.reviewExclusions = [
    {
      ...exclusion,
      id: `PR_excluded:review-exclusion:${review.source.id}`,
      reviewId: review.source.id,
      repository: "elizaOS/asi",
      url: `https://github.com/elizaOS/asi/pull/${review.source.number}#pullrequestreview-1`,
    },
  ];
  expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();
});

test("cached exclusion identities must agree with the rest of the snapshot", () => {
  const snapshot = snapshotFixture("2026-07-30T00:00:00.000Z");
  const review = snapshot.ledger.find(
    (event) => event.source.kind === "review",
  );
  if (!review) throw new Error("Fixture must contain a scored review");
  const exclusion = {
    id: "PR_excluded:review-exclusion:REVIEW_unscored",
    pullRequestId: "PR_excluded",
    pullRequestNumber: review.source.number,
    reviewId: "REVIEW_unscored",
    repository: review.repository,
    url: `${review.source.url}00`,
    reason: "unchanged-outcome" as const,
  };
  snapshot.reviewExclusions = [{ ...exclusion, reviewer: review.actor }];
  expect(() => assertLeaderboardSnapshot(snapshot)).not.toThrow();

  snapshot.reviewExclusions = [
    {
      ...exclusion,
      reviewer: { ...review.actor, url: "https://github.com/someone-else" },
    },
  ];
  expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
    "canonical GitHub profile",
  );

  snapshot.reviewExclusions = [
    { ...exclusion, reviewer: { ...review.actor, id: "U_other" } },
  ];
  expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
    "maps to multiple actor IDs",
  );

  snapshot.reviewExclusions = [
    {
      ...exclusion,
      reviewer: {
        ...review.actor,
        login: "renamed-reviewer",
        url: "https://github.com/renamed-reviewer",
      },
    },
  ];
  expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
    "changes identity inside the snapshot",
  );

  snapshot.reviewExclusions = [
    { ...exclusion, reviewerLogin: "someone" } as typeof exclusion,
  ];
  expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
    "must contain exactly the review exclusion fields",
  );
});
