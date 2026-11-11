/**
 * A review that already earned an evaluated award is a score-bearing source
 * (PRD section 7): the review pass skips it and records no second outcome.
 */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  AFTER_NOVEMBER,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

test("a review with an evaluated award is not also excluded or credited as a review", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([], AFTER_NOVEMBER);
  const pull = input.mergedPullRequests.find((p) => p.id === "PR_november");
  if (!pull) throw new Error("fixture pull request missing");
  const review = {
    id: "PRR_owner_review",
    url: `${pull.url}#pullrequestreview-1`,
    author: PROJECT_OWNER,
    state: "APPROVED" as const,
    body: "Checked the fix against the failing case.",
    submittedAt: "2026-11-04T12:00:00.000Z",
    comments: [],
  };
  input.mergedPullRequests = input.mergedPullRequests.map((p) =>
    p.id === pull.id ? { ...p, reviews: [review] } : p,
  ) as never;
  input.evaluatedContributions = [
    {
      id: "evaluation:owner-review",
      actor: PROJECT_OWNER,
      category: "evaluated-contribution",
      points: 1,
      scoreThirds: 3,
      occurredAt: review.submittedAt,
      repository: "elizaOS/asi",
      source: {
        id: review.id,
        kind: "review",
        number: pull.number,
        title: pull.title,
        url: review.url,
      },
      reason: "The review found the failing boundary before the merge.",
      evaluation: {
        decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
        reviewedAt: "2026-11-06T00:00:00.000Z",
        reviewer: "maintainer",
        manifestPath: "evaluations/asi/award-owner-review.json",
        manifestSha256: "a".repeat(64),
      },
    },
  ] as never;
  const snapshot = createLeaderboardSnapshot(input);
  expect(
    snapshot.ledger
      .filter((event) => event.source.id === review.id)
      .map((event) => [event.category, event.actor.id]),
  ).toEqual([["evaluated-contribution", PROJECT_OWNER.id]]);
  expect(
    (snapshot.reviewExclusions ?? []).filter((exclusion) =>
      JSON.stringify(exclusion).includes(review.id),
    ),
  ).toEqual([]);
});

// The census stores a formal review's inline comments with the pull
// request's comments (kind "comment", a #discussion_r URL), while the award
// manifest names an inline review comment as source kind "review".
function inlineReviewAwardInput(commentAuthor: typeof PROJECT_OWNER) {
  const input = penaltyScoreInput([], AFTER_NOVEMBER);
  const pull = input.mergedPullRequests.find((p) => p.id === "PR_november");
  if (!pull) throw new Error("fixture pull request missing");
  const occurredAt = "2026-11-04T12:00:00.000Z";
  const review = {
    id: "PRR_owner_inline",
    url: `${pull.url}#pullrequestreview-2`,
    author: PROJECT_OWNER,
    state: "COMMENTED" as const,
    body: "",
    submittedAt: occurredAt,
    inlineCommentCount: 1,
  };
  const inline = {
    id: "PRRC_owner_inline",
    artifactId: pull.id,
    kind: "comment" as const,
    body: "This boundary still fails for an empty page.",
    url: `${pull.url}#discussion_r1234567`,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    author: commentAuthor,
    authorAssociation: "OWNER",
  };
  input.mergedPullRequests = input.mergedPullRequests.map((p) =>
    p.id === pull.id
      ? { ...p, reviews: [review], comments: [...p.comments, inline] }
      : p,
  ) as never;
  input.evaluatedContributions = [
    {
      id: "evaluation:owner-inline-review",
      actor: PROJECT_OWNER,
      category: "evaluated-contribution",
      points: 1,
      scoreThirds: 3,
      occurredAt,
      repository: "elizaOS/asi",
      source: {
        id: inline.id,
        kind: "review",
        number: pull.number,
        title: pull.title,
        url: inline.url,
      },
      reason: "The inline review comment found the failing boundary.",
      evaluation: {
        decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
        reviewedAt: "2026-11-06T00:00:00.000Z",
        reviewer: "maintainer",
        manifestPath: "evaluations/asi/award-owner-inline-review.json",
        manifestSha256: "b".repeat(64),
      },
    },
  ] as never;
  return { input, inline };
}

test("an evaluated award for an inline review comment matches the collected comment", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const { input, inline } = inlineReviewAwardInput(PROJECT_OWNER);
  const snapshot = createLeaderboardSnapshot(input);
  expect(
    snapshot.ledger
      .filter((event) => event.source.id === inline.id)
      .map((event) => [event.category, event.actor.id]),
  ).toEqual([["evaluated-contribution", PROJECT_OWNER.id]]);
});

test("an inline review comment award still requires the comment's author", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const { input } = inlineReviewAwardInput({
    ...PROJECT_OWNER,
    id: "U_someone_else",
    login: "someone-else",
  });
  expect(() => createLeaderboardSnapshot(input)).toThrow(
    "does not match its exact GitHub review",
  );
});
