import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type {
  GitHubActor,
  GitHubTextSource,
  LeaderboardInput,
  PullRequestReview,
} from "../src/lib/leaderboard-types";
import { findProject } from "../src/lib/projects.mjs";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import {
  type ProjectRunReceipt,
  runReceiptMarker,
  runReceiptSigningPayload,
} from "../src/lib/run-receipts";
import { verifyRunReceiptSignature } from "./run-receipt-crypto";

// SCR-04: one merged pull request into develop with two linked commit authors.
// Both are credit actors, so no review of the pull request by either may score.
const pullRequestId = "PR_shared_outcome";
const url = "https://github.com/elizaOS/eliza/pull/9001";
const head = "a".repeat(40);
const mergedAt = "2026-10-06T00:00:00.000Z";
const actor = (id: string, login: string): GitHubActor => ({
  id,
  login,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id.length}`,
  url: `https://github.com/${login}`,
  kind: "User",
});
const author = actor("U_author", "pr-author");
const coAuthor = actor("U_coauthor", "commit-coauthor");
const maintainer = actor("U_maintainer", "other-maintainer");
const reviewer = actor("U_reviewer", "outside-reviewer");
// A later merge ratified into the same work unit claims that unit's merge
// credit first, so the shared pull request above emits no merge events.
const later = {
  id: "PR_later_outcome",
  url: "https://github.com/elizaOS/eliza/pull/9002",
  head: "d".repeat(40),
};
const laterAuthor = actor("U_later", "later-author");
const laterMaintainer = actor("U_maintainer_2", "second-maintainer");

function comment(
  id: string,
  by: GitHubActor,
  body: string,
  at: string,
  on: { id: string; url: string } = { id: pullRequestId, url },
): GitHubTextSource {
  return {
    id,
    artifactId: on.id,
    kind: "comment",
    body,
    url: `${on.url}#issuecomment-${id.replace(/\D/g, "")}`,
    createdAt: at,
    updatedAt: at,
    author: by,
    authorAssociation: "MEMBER",
  };
}

function scoreRecord(
  tier: "micro" | "small",
  proposals: string[],
  on: { id: string; head: string } = { id: pullRequestId, head },
): string {
  return [
    "```slop-score",
    JSON.stringify({
      schemaVersion: "1",
      ruleVersion: "slop-score-v2",
      projectId: "eliza",
      pullRequestNodeId: on.id,
      headSha: on.head,
      workUnitId: "wu_eliza_shared_outcome",
      tier,
      scoreThirds: tier === "micro" ? 1 : 3,
      proposalReviewNodeIds: proposals,
      coRatifierNodeIds: [],
      reason: "Correct fix to an accepted outcome.",
      supersedes: null,
    }),
    "```",
  ].join("\n");
}

/** A second maintainer's slop-score-approval for the shared pull request. */
function scoreApproval(
  id: string,
  tier: "micro" | "small" | "exceptional",
  by: GitHubActor = laterMaintainer,
): GitHubTextSource {
  return comment(
    id,
    by,
    [
      "```slop-score-approval",
      JSON.stringify({
        schemaVersion: "1",
        ruleVersion: "slop-score-v2",
        projectId: "eliza",
        pullRequestNodeId: pullRequestId,
        headSha: head,
        workUnitId: "wu_eliza_shared_outcome",
        tier,
        decision: "approve",
        reason: "Independent approval of the accepted outcome.",
      }),
      "```",
    ].join("\n"),
    "2026-10-05T11:00:00.000Z",
  );
}

/** A co-author's slop-score, co-ratified by a second maintainer (SCR-04). */
function coRatifiedScore(
  id: string,
  by: GitHubActor,
  tier: "micro" | "small",
  proposals: string[],
  at: string,
  approver: GitHubActor = laterMaintainer,
): GitHubTextSource[] {
  const approval = scoreApproval(`${id}0`, tier, approver);
  return [
    approval,
    comment(
      id,
      by,
      scoreRecord(tier, proposals).replace(
        '"coRatifierNodeIds":[]',
        `"coRatifierNodeIds":["${approval.id}"]`,
      ),
      at,
    ),
  ];
}

/** A deep slop-review record with a run receipt signed by a new device key. */
function signedReviewRecord(): string {
  const project = findProject("eliza");
  if (project?.terms.receiptPolicy.state !== "active")
    throw new Error("The Eliza receipt policy must be active");
  const policy = project.terms.receiptPolicy.bindings[0];
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const unsigned: ProjectRunReceipt = {
    schemaVersion: "2",
    runId: "run_01JZ0000000000000000000000",
    projectId: "eliza",
    repositoryId: "elizaOS/eliza",
    startedAt: "2026-10-05T01:00:00.000Z",
    completedAt: "2026-10-05T02:00:00.000Z",
    provider: "anthropic",
    model: "claude-opus-5-5",
    client: "claude-code",
    skillRevision: `SlopDotCash/slopdotcash@${"b".repeat(40)}:${project.skill.sourcePath}`,
    skillSha256: "c".repeat(64),
    policyAcknowledgement: {
      policyRevision: policy.policyRevision,
      licenseSha256: policy.licenseSha256,
      inboundTermsSha256: policy.inboundTermsSha256,
      prizeRulesSha256: policy.prizeRulesSha256,
      acknowledgedAt: "2026-10-05T01:00:00.000Z",
    },
    usage: {
      source: "none",
      confidence: "unavailable",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costMicroUsd: "0",
      sessionCount: 0,
    },
    trajectorySha256: null,
    traceUpload: null,
    signatureAlgorithm: "ed25519",
    devicePublicKey: publicKeyDer.toString("base64url"),
    deviceKeyId: createHash("sha256").update(publicKeyDer).digest("hex"),
    deviceSignature: "",
  };
  const receipt: ProjectRunReceipt = {
    ...unsigned,
    deviceSignature: sign(
      null,
      Buffer.from(runReceiptSigningPayload(unsigned), "utf8"),
      privateKey,
    ).toString("base64url"),
  };
  const record = {
    schemaVersion: "2",
    projectId: "eliza",
    artifactUrl: url,
    headSha: head,
    provider: receipt.provider,
    model: receipt.model,
    client: receipt.client,
    runId: receipt.runId,
    traceSha256: null,
    recommendation: "accept",
    reproduced: true,
    securityRisk: "none",
    duplicateRisk: "none",
    splitRisk: "none",
    effortBand: "small",
    complexity: "moderate",
    impact: "meaningful",
    reviewLoad: "deep",
    recommendedTier: "small",
    recommendedThirds: 3,
    workUnitId: "wu_eliza_shared_outcome",
    confidenceBasisPoints: 8000,
    valueRationale: "Reproduced the defect and the fix at the merged head.",
    usefulArtifacts: [],
    commands: ["bun test"],
    evidenceUrls: [],
    summary: "Deep review of the shared outcome.",
  };
  return [
    "```slop-review",
    JSON.stringify(record),
    "```",
    "",
    `AI provider/model: ${receipt.provider} / ${receipt.model}`,
    `Client / agent tooling: ${receipt.client}`,
    `Skill revision: ${receipt.skillRevision}`,
    "Attribution status: self-reported",
    "— [reviewer]",
    `<!-- elizaos-contribution-attribution:v2 ${JSON.stringify(runReceiptMarker(receipt))} -->`,
  ].join("\n");
}

function reviewCredit(
  comments: GitHubTextSource[],
  reviews: PullRequestReview[] = [],
  laterComments?: GitHubTextSource[],
) {
  const laterPullRequest = laterComments && {
    id: later.id,
    number: 9002,
    title: "fix: rest of the shared outcome",
    url: later.url,
    body: "Fixes the rest of the defect.",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    mergedAt: "2026-10-07T00:00:00.000Z",
    author: laterAuthor,
    additions: 4,
    deletions: 1,
  };
  const mergedCount = laterPullRequest ? 2 : 1;
  const pullRequest = {
    id: pullRequestId,
    number: 9001,
    title: "fix: shared outcome",
    url,
    body: "Fixes a defect.",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: mergedAt,
    mergedAt,
    author,
    additions: 10,
    deletions: 2,
  };
  const input: LeaderboardInput = {
    generatedAt: "2026-10-13T00:00:00.000Z",
    windowFrom: "2026-09-08T00:00:00.000Z",
    windowTo: "2026-10-13T00:00:00.000Z",
    sourceUpdatedAt: mergedAt,
    source: {
      provider: "github-graphql",
      fetchedAt: "2026-10-13T00:00:00.000Z",
      cutoffAt: "2026-10-13T00:00:00.000Z",
      repositoryId: "R_fixture",
      repositories: TARGET_REPOSITORIES.map((repository) => ({
        id: repository.id,
        repositoryId:
          repository.role === "primary"
            ? "R_fixture"
            : `R_fixture_${repository.name.replaceAll("-", "_")}`,
      })),
      requestCount: 1,
      searchSliceCount: 1,
      rateLimit: {
        cost: 1,
        limit: 5000,
        remaining: 4999,
        resetAt: "2026-10-13T01:00:00.000Z",
      },
      counts: {
        mergedPullRequests: mergedCount,
        detailedMergedPullRequests: mergedCount,
        closedIssues: 0,
        detailedClosedIssues: 0,
        resolvedIssues: 0,
        openIssues: 0,
        openPullRequests: 0,
      },
      verificationWindow: {
        days: 35,
        from: "2026-09-08T00:00:00.000Z",
        to: "2026-10-13T00:00:00.000Z",
      },
      evidenceVerification: {
        status: "complete",
        sourceCount: 0,
        artifactCount: 0,
        maxSources: 64,
        maxArtifacts: 64,
      },
    },
    mergedPullRequestOutcomes: [
      {
        ...pullRequest,
        baseRefName: "develop",
        commits: [
          { oid: "1".repeat(40), author },
          { oid: "2".repeat(40), author: coAuthor },
        ],
      },
      ...(laterPullRequest
        ? [
            {
              ...laterPullRequest,
              baseRefName: "develop",
              commits: [{ oid: "3".repeat(40), author: laterAuthor }],
            },
          ]
        : []),
    ],
    mergedPullRequests: [
      {
        ...pullRequest,
        lastEditedAt: null,
        editor: null,
        headRefOid: head,
        isDraft: false,
        reviewDecision: "APPROVED",
        activeReviewRequestCount: 0,
        assignees: [],
        labels: [],
        files: [
          { path: "packages/core/src/fix.ts", additions: 10, deletions: 2 },
        ],
        comments,
        reviews,
        closingIssueIds: [],
        changedFiles: 1,
        commitCount: 2,
      },
      ...(laterPullRequest
        ? [
            {
              ...laterPullRequest,
              lastEditedAt: null,
              editor: null,
              headRefOid: later.head,
              isDraft: false,
              reviewDecision: "APPROVED" as const,
              activeReviewRequestCount: 0,
              assignees: [],
              labels: [],
              files: [
                {
                  path: "packages/core/src/fix.ts",
                  additions: 4,
                  deletions: 1,
                },
              ],
              comments: laterComments ?? [],
              reviews: [],
              closingIssueIds: [],
              changedFiles: 1,
              commitCount: 1,
            },
          ]
        : []),
    ],
    detailEligibleMergedPullRequestIds: laterPullRequest
      ? [pullRequestId, later.id]
      : [pullRequestId],
    closedIssueCount: 0,
    resolvedIssues: [],
    openIssues: [],
    openPullRequests: [],
    verificationWindowFrom: "2026-09-08T00:00:00.000Z",
    verifiedEvidence: [],
    verifyRunReceipt: verifyRunReceiptSignature,
  };
  const snapshot = createLeaderboardSnapshot(input);
  const credit = (category: string) =>
    snapshot.ledger
      .filter(
        (event) =>
          event.category === category && event.id.startsWith(pullRequestId),
      )
      .map((event) => `${event.actor.login}:${event.scoreThirds}`)
      .sort();
  return {
    merges: credit("merged-pull-request"),
    reviews: credit("substantive-review"),
    exclusions: (snapshot.reviewExclusions ?? []).map(
      (exclusion) => `${exclusion.reviewId}:${exclusion.reason}`,
    ),
  };
}

test("a commit co-author's score ratification earns no review credit", () => {
  const changesRequested: PullRequestReview = {
    id: "PRR_coauthor",
    body: "Please handle the empty input case before this merges.",
    state: "CHANGES_REQUESTED",
    submittedAt: "2026-10-05T06:00:00.000Z",
    url: `${url}#pullrequestreview-1`,
    author: coAuthor,
    inlineCommentCount: 1,
    commitId: "1".repeat(40),
  };
  const coAuthorRatifies = reviewCredit(
    coRatifiedScore("IC_1", coAuthor, "micro", [], "2026-10-05T12:00:00.000Z"),
    [changesRequested],
  );
  expect(coAuthorRatifies.merges).toEqual(["commit-coauthor:1", "pr-author:1"]);
  expect(coAuthorRatifies.exclusions).toEqual(["PRR_coauthor:self-review"]);
  expect(coAuthorRatifies.reviews).toEqual([]);

  const maintainerRatifies = reviewCredit([
    comment(
      "IC_1",
      maintainer,
      scoreRecord("micro", []),
      "2026-10-05T12:00:00.000Z",
    ),
  ]);
  expect(maintainerRatifies.reviews).toEqual(["other-maintainer:1"]);
});

test("a maintainer who also reviews earns one review award, not two", () => {
  // The maintainer posts a micro ratification and also submits a qualifying
  // pre-merge request for changes. The ratification must not stack on top of
  // the formal review award: one artifact gives an actor at most one review
  // award.
  const changesRequested: PullRequestReview = {
    id: "PRR_maintainer",
    body: "Please handle the empty input case before this merges.",
    state: "CHANGES_REQUESTED",
    submittedAt: "2026-10-05T06:00:00.000Z",
    url: `${url}#pullrequestreview-9`,
    author: maintainer,
    inlineCommentCount: 1,
    commitId: "1".repeat(40),
  };
  const result = reviewCredit(
    [
      comment(
        "IC_1",
        maintainer,
        scoreRecord("micro", []),
        "2026-10-05T12:00:00.000Z",
      ),
    ],
    [changesRequested],
  );
  expect(result.reviews).toEqual(["other-maintainer:1"]);
});

test("a commit co-author's signed review proposal earns no review credit", () => {
  const ratifiedProposal = (by: GitHubActor) =>
    reviewCredit([
      comment("IC_2", by, signedReviewRecord(), "2026-10-05T03:00:00.000Z"),
      comment(
        "IC_3",
        maintainer,
        scoreRecord("small", ["IC_2"]),
        "2026-10-05T12:00:00.000Z",
      ),
    ]);

  const coAuthorProposes = ratifiedProposal(coAuthor);
  expect(coAuthorProposes.merges).toEqual(["commit-coauthor:1", "pr-author:2"]);
  expect(coAuthorProposes.reviews).toEqual(["other-maintainer:1"]);

  const outsiderProposes = ratifiedProposal(reviewer);
  expect(outsiderProposes.reviews).toEqual([
    "other-maintainer:1",
    "outside-reviewer:9",
  ]);
});

// The later merge's ratification, by a second maintainer, into the same unit.
const laterRatified = [
  comment(
    "IC_9",
    laterMaintainer,
    scoreRecord("micro", [], later),
    "2026-10-06T12:00:00.000Z",
    later,
  ),
];

test("a co-author's ratification and review earn nothing when a later merge owns the work unit", () => {
  const changesRequested: PullRequestReview = {
    id: "PRR_coauthor",
    body: "Please handle the empty input case before this merges.",
    state: "CHANGES_REQUESTED",
    submittedAt: "2026-10-05T06:00:00.000Z",
    url: `${url}#pullrequestreview-1`,
    author: coAuthor,
    inlineCommentCount: 1,
    commitId: "1".repeat(40),
  };
  const coAuthorRatifies = reviewCredit(
    coRatifiedScore("IC_1", coAuthor, "micro", [], "2026-10-05T12:00:00.000Z"),
    [changesRequested],
    laterRatified,
  );
  expect(coAuthorRatifies).toEqual({
    merges: [],
    reviews: [],
    exclusions: ["PRR_coauthor:self-review"],
  });
});

test("a co-author's signed review proposal earns nothing when a later merge owns the work unit", () => {
  const coAuthorProposes = reviewCredit(
    [
      comment(
        "IC_2",
        coAuthor,
        signedReviewRecord(),
        "2026-10-05T03:00:00.000Z",
      ),
      comment(
        "IC_3",
        maintainer,
        scoreRecord("small", ["IC_2"]),
        "2026-10-05T12:00:00.000Z",
      ),
    ],
    [],
    laterRatified,
  );
  expect(coAuthorProposes).toEqual({
    merges: [],
    reviews: ["other-maintainer:1"],
    exclusions: [],
  });
});

for (const [tier, thirds] of [
  ["xl", 45],
  ["exceptional", 75],
] as const) {
  test(`${tier} merge credit cannot bypass co-ratification with an array tier`, () => {
    const proposal = comment(
      "IC_10",
      reviewer,
      signedReviewRecord(),
      "2026-10-05T04:00:00.000Z",
    );
    const score = scoreRecord("small", [proposal.id])
      .replace('"tier":"small"', `"tier":"${tier}"`)
      .replace('"scoreThirds":3', `"scoreThirds":${thirds}`);
    const credit = (body: string) =>
      reviewCredit([
        proposal,
        comment("IC_20", maintainer, body, "2026-10-05T05:00:00.000Z"),
      ]);
    expect(() => credit(score)).toThrow("require a co-ratifier");
    const approval = comment(
      "IC_30",
      laterMaintainer,
      [
        "```slop-score-approval",
        JSON.stringify({
          schemaVersion: "1",
          ruleVersion: "slop-score-v2",
          projectId: "eliza",
          pullRequestNodeId: pullRequestId,
          headSha: head,
          workUnitId: "wu_eliza_shared_outcome",
          tier,
          decision: "approve",
          reason: "Independent approval of the accepted outcome.",
        }),
        "```",
      ].join("\n"),
      "2026-10-05T06:00:00.000Z",
    );
    const approved = reviewCredit([
      proposal,
      approval,
      comment(
        "IC_20",
        maintainer,
        score.replace(
          '"coRatifierNodeIds":[]',
          `"coRatifierNodeIds":["${approval.id}"]`,
        ),
        "2026-10-05T05:00:00.000Z",
      ),
    ]);
    expect(
      approved.merges.reduce((sum, row) => sum + Number(row.split(":")[1]), 0),
    ).toBe(thirds);
    expect(() =>
      credit(score.replace(`"tier":"${tier}"`, `"tier":["${tier}"]`)),
    ).toThrow("tier and scoreThirds do not match");
  });
}

// SCR-04 makes every linked commit author a credit actor of the merge, so a
// co-author's slop-score decides their own share exactly like the author's.
test("a commit co-author's score ratification requires a second maintainer", () => {
  const proposal = comment(
    "IC_10",
    reviewer,
    signedReviewRecord(),
    "2026-10-05T04:00:00.000Z",
  );
  for (const [tier, proposals] of [
    ["micro", []],
    ["small", [proposal.id]],
  ] as const) {
    expect(() =>
      reviewCredit([
        proposal,
        comment(
          "IC_20",
          coAuthor,
          scoreRecord(tier, [...proposals]),
          "2026-10-05T12:00:00.000Z",
        ),
      ]),
    ).toThrow("self slop-score requires a second maintainer co-ratifier");
    const coRatified = reviewCredit([
      proposal,
      ...coRatifiedScore(
        "IC_20",
        coAuthor,
        tier,
        [...proposals],
        "2026-10-05T12:00:00.000Z",
      ),
    ]);
    expect(coRatified.merges).toEqual(
      tier === "micro"
        ? ["commit-coauthor:1", "pr-author:1"]
        : ["commit-coauthor:1", "pr-author:2"],
    );
  }
});

// The second maintainer stands outside the outcome. Under SCR-04 the author and
// every linked commit author share it, so none of them can approve another's
// slop-score or the tier of their own merge.
test("a slop-score co-ratifier must not share the scored outcome", () => {
  const proposal = comment(
    "IC_10",
    reviewer,
    signedReviewRecord(),
    "2026-10-05T04:00:00.000Z",
  );
  for (const [ratifier, approver] of [
    [coAuthor, author],
    [author, coAuthor],
  ]) {
    expect(() =>
      reviewCredit([
        proposal,
        ...coRatifiedScore(
          "IC_20",
          ratifier,
          "small",
          [proposal.id],
          "2026-10-05T12:00:00.000Z",
          approver,
        ),
      ]),
    ).toThrow("slop-score co-ratifier must not share the scored outcome");
  }

  const exceptional = (approver: GitHubActor) => {
    const approval = scoreApproval("IC_30", "exceptional", approver);
    return reviewCredit([
      proposal,
      approval,
      comment(
        "IC_20",
        maintainer,
        scoreRecord("small", [proposal.id])
          .replace('"tier":"small"', '"tier":"exceptional"')
          .replace('"scoreThirds":3', '"scoreThirds":75')
          .replace(
            '"coRatifierNodeIds":[]',
            `"coRatifierNodeIds":["${approval.id}"]`,
          ),
        "2026-10-05T12:00:00.000Z",
      ),
    ]);
  };
  for (const approver of [author, coAuthor]) {
    expect(() => exceptional(approver)).toThrow(
      "slop-score co-ratifier must not share the scored outcome",
    );
  }
  expect(exceptional(laterMaintainer).merges).toEqual([
    "commit-coauthor:37",
    "pr-author:38",
  ]);
});
