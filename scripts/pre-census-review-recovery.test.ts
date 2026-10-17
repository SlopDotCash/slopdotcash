import { expect, test } from "bun:test";
import {
  createLeaderboardSnapshot,
  paymentReviewSnapshot,
} from "../src/lib/leaderboard";
import type { LeaderboardInput } from "../src/lib/leaderboard-types";
import { parsePreCensusReviewRecoveries } from "../src/lib/pre-census-review-recovery";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

const actor = {
  id: "U_recovery",
  login: "reviewer",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=1",
  url: "https://github.com/reviewer",
  kind: "User",
};

function recovery(decision = "award") {
  return {
    id: "recovery-1",
    decision,
    repository: "SlopDotCash/slopdotcash",
    pullRequestNumber: 730,
    pullRequestTitle: "fix(settlement): reject pre-plan replay",
    pullRequestUrl: "https://github.com/SlopDotCash/slopdotcash/pull/730",
    reviewedHeadOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    mergedHeadOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    mergeCommitOid: "cccccccccccccccccccccccccccccccccccccccc",
    mergedAt: "2026-10-14T16:00:00Z",
    responseCommitOids: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    actor,
    review: {
      id: "5514965110",
      url: "https://github.com/SlopDotCash/slopdotcash/pull/730#pullrequestreview-5514965110",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-10-14T08:00:00Z",
      commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      body: "The replay guard needs an executable regression and a positive control.",
      inlineCommentCount: 0,
    },
    lifecycleReviewIds: ["5514965110", "5514965111"],
    continuity: {
      sourceSnapshotSha256:
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/797",
    },
    ...(decision === "exclude"
      ? { exclusionReason: "pull-request-review-awarded" }
      : {}),
  };
}

test("materializes one bounded pre-census award", () => {
  const result = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [recovery()],
  });
  expect(result.events).toHaveLength(1);
  expect(result.exclusions).toHaveLength(0);
  expect(result.events[0]).toMatchObject({
    category: "substantive-review",
    scoreThirds: 1,
    points: 1 / 3,
    workUnitId: "wu_slopdotcash_slopdotcash_pr_730_review_u_recovery",
    source: {
      id: "5514965110",
      number: 730,
    },
    continuity: {
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/797",
    },
  });
  expect(result.events[0]?.workUnitId).toMatch(
    /^wu_[a-z0-9][a-z0-9_-]{2,255}$/u,
  );
});

test("publishes an explicit exclusion without creating score", () => {
  const result = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [recovery("exclude")],
  });
  expect(result.events).toEqual([]);
  expect(result.exclusions[0]).toMatchObject({
    reviewId: "5514965110",
    reason: "pull-request-review-awarded",
  });
});

test("accepts an inline-only change request and still rejects empty evidence", () => {
  const inlineOnly = recovery();
  const parsed = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...inlineOnly,
        review: { ...inlineOnly.review, body: "", inlineCommentCount: 1 },
      },
    ],
  });
  expect(parsed.events).toHaveLength(1);
  expect(parsed.events[0]?.points).toBe(1 / 3);

  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        {
          ...inlineOnly,
          review: { ...inlineOnly.review, body: "", inlineCommentCount: 0 },
        },
      ],
    }),
  ).toThrow("substantive review evidence");

  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        { ...inlineOnly, review: { ...inlineOnly.review, body: null } },
      ],
    }),
  ).toThrow("body must be a string");
});

test("restores the pre-release payment weight on the payment pass", () => {
  const fixture = recovery();
  const parsed = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...fixture,
        mergedAt: "2026-10-08T16:00:00Z",
        review: { ...fixture.review, submittedAt: "2026-10-08T08:00:00Z" },
      },
    ],
  });
  expect(parsed.events[0]).toMatchObject({ points: 1 / 3, scoreThirds: 1 });
  expect(parsed.paymentEvents[0]).toMatchObject({ points: 3 });
  expect(parsed.paymentEvents[0]?.scoreThirds).toBeUndefined();

  const snapshot = createLeaderboardSnapshot({
    ...emptyLeaderboardInput(),
    retainedReviewEvents: parsed.events,
    retainedReviewPaymentEvents: parsed.paymentEvents,
  });
  const published = snapshot.ledger.find(
    (event) => event.source.id === "5514965110",
  );
  expect(published?.scoreThirds).toBe(1);
  const paid = paymentReviewSnapshot(snapshot).ledger.find(
    (event) => event.source.id === "5514965110",
  );
  expect(paid?.scoreThirds ?? Math.round((paid?.points ?? 0) * 3)).toBe(3);
});

test("restores standard credit for a pre-October recovery in both passes", () => {
  const fixture = recovery();
  const parsed = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...fixture,
        mergedAt: "2026-09-20T16:00:00Z",
        review: { ...fixture.review, submittedAt: "2026-09-20T08:00:00Z" },
      },
    ],
  });
  expect(parsed.events[0]).toMatchObject({ points: 3 });
  expect(parsed.paymentEvents[0]).toMatchObject({ points: 3 });
});

test("rejects duplicate pull requests and uncausal review heads", () => {
  const first = recovery();
  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [first, { ...first, id: "recovery-2" }],
    }),
  ).toThrow("one decision per pull request");

  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        {
          ...first,
          reviewedHeadOid: first.mergedHeadOid,
          review: { ...first.review, commitId: first.mergedHeadOid },
        },
      ],
    }),
  ).toThrow("changed accepted outcome");
});

test("normalizes repository case and registry aliases to the canonical id", () => {
  const mixed = recovery();
  const canonical = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...mixed,
        repository: "slopdotcash/slopDOTcash",
        pullRequestUrl: "https://github.com/slopdotcash/slopdotcash/pull/730",
        review: {
          ...mixed.review,
          url: "https://github.com/slopdotcash/slopdotcash/pull/730#pullrequestreview-5514965110",
        },
      },
    ],
  });
  expect(canonical.events[0]?.repository).toBe("SlopDotCash/slopdotcash");

  const alias = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...mixed,
        repository: "SlopDotCash/asi",
        pullRequestNumber: 5,
        pullRequestUrl: "https://github.com/SlopDotCash/asi/pull/5",
        review: {
          ...mixed.review,
          id: "5514965120",
          url: "https://github.com/SlopDotCash/asi/pull/5#pullrequestreview-5514965120",
        },
        lifecycleReviewIds: ["5514965120"],
      },
    ],
  });
  expect(alias.events[0]?.repository).toBe("elizaOS/asi");

  const excluded = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      { ...mixed, decision: "exclude", exclusionReason: "post-merge" },
    ],
  });
  expect(excluded.exclusions[0]?.repository).toBe("SlopDotCash/slopdotcash");

  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        mixed,
        { ...mixed, id: "recovery-2", repository: "slopdotcash/slopdotcash" },
      ],
    }),
  ).toThrow("one decision per pull request");
});

test("rejects a URL that belongs to another repository", () => {
  const differentPullRequestUrl = recovery();
  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        {
          ...differentPullRequestUrl,
          pullRequestUrl: "https://github.com/elizaOS/eliza/pull/730",
        },
      ],
    }),
  ).toThrow("must belong to");

  const differentReviewUrl = recovery();
  expect(() =>
    parsePreCensusReviewRecoveries({
      schemaVersion: "1",
      recoveries: [
        {
          ...differentReviewUrl,
          review: {
            ...differentReviewUrl.review,
            url: "https://github.com/elizaOS/eliza/pull/730#pullrequestreview-5514965110",
          },
        },
      ],
    }),
  ).toThrow("must belong to");
});

/**
 * The smallest publication-shaped input: no census records, one 35-day window.
 * Recovers the exact production path that consumes the manifest through
 * ``createLeaderboardSnapshot``, including ``assertPublishableLeaderboardSnapshot``.
 */
function emptyLeaderboardInput(): LeaderboardInput {
  const generatedAt = "2026-10-16T00:00:00.000Z";
  const windowFrom = "2026-09-11T00:00:00.000Z";
  return {
    generatedAt,
    windowFrom,
    windowTo: generatedAt,
    sourceUpdatedAt: "2026-10-15T00:00:00.000Z",
    source: {
      provider: "github-graphql",
      fetchedAt: generatedAt,
      cutoffAt: generatedAt,
      repositoryId: "R_recovery_fixture",
      repositories: TARGET_REPOSITORIES.map((repository) => ({
        id: repository.id,
        repositoryId:
          repository.role === "primary"
            ? "R_recovery_fixture"
            : `R_recovery_fixture_${repository.name.replaceAll("-", "_")}`,
      })),
      requestCount: 1,
      searchSliceCount: 1,
      rateLimit: {
        cost: 1,
        limit: 5000,
        remaining: 4999,
        resetAt: "2026-10-16T01:00:00.000Z",
      },
      counts: {
        mergedPullRequests: 0,
        detailedMergedPullRequests: 0,
        closedIssues: 0,
        detailedClosedIssues: 0,
        resolvedIssues: 0,
        openIssues: 0,
        openPullRequests: 0,
      },
      verificationWindow: {
        days: 35,
        from: windowFrom,
        to: generatedAt,
      },
      evidenceVerification: {
        status: "complete",
        sourceCount: 0,
        artifactCount: 0,
        maxSources: 64,
        maxArtifacts: 64,
      },
    },
    mergedPullRequestOutcomes: [],
    mergedPullRequests: [],
    detailEligibleMergedPullRequestIds: [],
    closedIssueCount: 0,
    resolvedIssues: [],
    openIssues: [],
    openPullRequests: [],
    verificationWindowFrom: windowFrom,
    verifiedEvidence: [],
  };
}

test("matches the ordinary path award for a pre-release review", () => {
  const ordinaryAuthor = {
    id: "U_author",
    login: "author",
    avatarUrl: "https://avatars.githubusercontent.com/u/2?v=1",
    url: "https://github.com/author",
    kind: "User" as const,
  };
  const ordinaryReviewer = {
    id: "U_reviewer",
    login: "reviewer",
    avatarUrl: "https://avatars.githubusercontent.com/u/3?v=1",
    url: "https://github.com/reviewer",
    kind: "User" as const,
  };
  const input = emptyLeaderboardInput();
  const ordinary = createLeaderboardSnapshot({
    ...input,
    source: {
      ...input.source,
      counts: { ...input.source.counts, mergedPullRequests: 1 },
    },
    mergedPullRequestOutcomes: [
      {
        id: "PR_ordinary_control",
        number: 900,
        title: "fix: ordinary control",
        url: "https://github.com/SlopDotCash/slopdotcash/pull/900",
        body: "",
        createdAt: "2026-10-08T07:00:00Z",
        updatedAt: "2026-10-08T16:00:00Z",
        mergedAt: "2026-10-08T16:00:00Z",
        author: ordinaryAuthor,
        additions: 1,
        deletions: 0,
        baseRefName: "development",
        commits: null,
      },
    ],
    reviewedMergedPullRequests: [
      {
        id: "PR_ordinary_control",
        number: 900,
        title: "fix: ordinary control",
        url: "https://github.com/SlopDotCash/slopdotcash/pull/900",
        body: "",
        createdAt: "2026-10-08T07:00:00Z",
        updatedAt: "2026-10-08T16:00:00Z",
        lastEditedAt: null,
        editor: null,
        mergedAt: "2026-10-08T16:00:00Z",
        headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        author: ordinaryAuthor,
        comments: [],
        reviews: [
          {
            id: "5514965999",
            body: "The replay guard needs an executable regression and a positive control.",
            state: "CHANGES_REQUESTED",
            submittedAt: "2026-10-08T08:00:00Z",
            url: "https://github.com/SlopDotCash/slopdotcash/pull/900#pullrequestreview-5514965999",
            author: ordinaryReviewer,
            inlineCommentCount: 0,
            commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        ],
      },
    ],
  });

  const fixture = recovery();
  const parsed = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [
      {
        ...fixture,
        mergedAt: "2026-10-08T16:00:00Z",
        review: { ...fixture.review, submittedAt: "2026-10-08T08:00:00Z" },
      },
    ],
  });
  const recovered = createLeaderboardSnapshot({
    ...emptyLeaderboardInput(),
    retainedReviewEvents: parsed.events,
    retainedReviewPaymentEvents: parsed.paymentEvents,
  });

  const awardThirds = (
    snapshot: ReturnType<typeof createLeaderboardSnapshot>,
    reviewId: string,
  ) => {
    const event = snapshot.ledger.find(
      (candidate) =>
        candidate.category === "substantive-review" &&
        candidate.source.id === reviewId,
    );
    return event?.scoreThirds ?? Math.round((event?.points ?? 0) * 3);
  };
  expect(awardThirds(ordinary, "5514965999")).toBe(1);
  expect(awardThirds(paymentReviewSnapshot(ordinary), "5514965999")).toBe(3);
  expect(awardThirds(recovered, "5514965110")).toBe(1);
  expect(awardThirds(paymentReviewSnapshot(recovered), "5514965110")).toBe(3);
});

test("a restored award passes full publication validation", () => {
  const parsed = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [recovery()],
  });
  const snapshot = createLeaderboardSnapshot({
    ...emptyLeaderboardInput(),
    retainedReviewEvents: parsed.events,
    retainedReviewPaymentEvents: parsed.paymentEvents,
  });
  const restored = snapshot.ledger.find(
    (event) => event.source.id === "5514965110",
  );
  expect(restored?.workUnitId).toBe(
    "wu_slopdotcash_slopdotcash_pr_730_review_u_recovery",
  );
  expect(restored?.scoreThirds).toBe(1);
  expect(
    snapshot.leaders.some((leader) => leader.actor.id === "U_recovery"),
  ).toBe(true);
});

test("a restored exclusion reaches the published snapshot", () => {
  const parsed = parsePreCensusReviewRecoveries({
    schemaVersion: "1",
    recoveries: [recovery("exclude")],
  });
  const snapshot = createLeaderboardSnapshot({
    ...emptyLeaderboardInput(),
    retainedReviewExclusions: parsed.exclusions,
  });
  expect(snapshot.ledger).toEqual([]);
  expect(snapshot.reviewExclusions).toEqual([
    expect.objectContaining({
      reviewId: "5514965110",
      reason: "pull-request-review-awarded",
    }),
  ]);
});
