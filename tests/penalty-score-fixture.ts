/**
 * Accepted work by two contributors and one Slopbot-closed pull request in
 * the ASI repository (PRD section 7). The real snapshot builder scores it;
 * only the GitHub census is synthetic. Node IDs are GitHub's legacy encoding
 * of users 42 and 43. User 42 is the author that the Slopbot penalty fixture
 * closes; user 43 is a project owner for the payout exclusion checks.
 */
import { verifyRunReceiptSignature } from "../scripts/run-receipt-crypto";
import type {
  GitHubActor,
  LeaderboardInput,
  PenaltyFeedRecord,
  PullRequestRecord,
} from "../src/lib/leaderboard-types";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { valueScoringPolicy } from "../src/lib/scoring-policy";

const actor = (id: string, login: string, user: number): GitHubActor => ({
  id,
  login,
  avatarUrl: `https://avatars.githubusercontent.com/u/${user}?v=4`,
  url: `https://github.com/${login}`,
  kind: "User",
});
export const PENALIZED_AUTHOR = actor("MDQ6VXNlcjQy", "author", 42);
export const PROJECT_OWNER = actor("MDQ6VXNlcjQz", "project-owner", 43);
export const CLOSED_PULL_REQUEST_ID = "PR_local";
/** Inside November 2026, after every fixture event. */
export const GENERATED_AT = "2026-11-20T00:00:00.000Z";
/** After November 2026 closes, so the whole month is in the window. */
export const AFTER_NOVEMBER = "2026-12-02T00:00:00.000Z";
const REPOSITORY = "https://github.com/SlopDotCash/asi";

function pullRequest(
  id: string,
  number: number,
  author: GitHubActor,
  at: { createdAt: string; mergedAt: string | null; closedAt: string },
): PullRequestRecord {
  return {
    id,
    number,
    title: at.mergedAt ? "fix: accepted change" : "Followers",
    url: `${REPOSITORY}/pull/${number}`,
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

// October work keeps the earlier rules: an unratified merge earns 1 point.
// November work is under the value policy; with no assessment each merge
// keeps the one-third minimum.
const merged = [
  pullRequest("PR_october", 7, PENALIZED_AUTHOR, {
    createdAt: "2026-10-29T00:00:00.000Z",
    mergedAt: "2026-10-29T12:00:00.000Z",
    closedAt: "2026-10-29T12:00:00.000Z",
  }),
  pullRequest("PR_november", 8, PENALIZED_AUTHOR, {
    createdAt: "2026-11-04T00:00:00.000Z",
    mergedAt: "2026-11-05T00:00:00.000Z",
    closedAt: "2026-11-05T00:00:00.000Z",
  }),
  pullRequest("PR_owner", 9, PROJECT_OWNER, {
    createdAt: "2026-11-11T00:00:00.000Z",
    mergedAt: "2026-11-12T00:00:00.000Z",
    closedAt: "2026-11-12T00:00:00.000Z",
  }),
];
const closed = pullRequest(CLOSED_PULL_REQUEST_ID, 5, PENALIZED_AUTHOR, {
  createdAt: "2026-11-09T00:00:00.000Z",
  mergedAt: null,
  closedAt: "2026-11-10T00:00:00.000Z",
});

/** The census with the debits that the penalty feed returned. */
export function penaltyScoreInput(
  penalties: PenaltyFeedRecord[],
  generatedAt = GENERATED_AT,
): LeaderboardInput {
  // Each caller can add reviews without changing another test's census.
  const mergedPullRequests = structuredClone(merged);
  const windowFrom = new Date(
    Date.parse(generatedAt) - 35 * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    valuePolicy: valueScoringPolicy(),
    valueDecisions: new Map(),
    generatedAt,
    windowFrom,
    windowTo: generatedAt,
    sourceUpdatedAt: merged[2].closedAt as string,
    source: {
      provider: "github-graphql",
      fetchedAt: generatedAt,
      cutoffAt: generatedAt,
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
        resetAt: new Date(Date.parse(generatedAt) + 3_600_000).toISOString(),
      },
      counts: {
        mergedPullRequests: merged.length,
        detailedMergedPullRequests: merged.length,
        closedIssues: 0,
        detailedClosedIssues: 0,
        resolvedIssues: 0,
        openIssues: 0,
        openPullRequests: 0,
      },
      verificationWindow: { days: 35, from: windowFrom, to: generatedAt },
      evidenceVerification: {
        status: "complete",
        sourceCount: 0,
        artifactCount: 0,
        maxSources: 64,
        maxArtifacts: 64,
      },
    },
    mergedPullRequestOutcomes: mergedPullRequests.map((pull) => ({
      id: pull.id,
      number: pull.number,
      title: pull.title,
      url: pull.url,
      body: pull.body,
      createdAt: pull.createdAt,
      updatedAt: pull.updatedAt,
      mergedAt: pull.mergedAt as string,
      headRefOid: pull.headRefOid,
      author: pull.author,
      additions: pull.additions,
      deletions: pull.deletions,
      baseRefName: "main",
      commits: [{ oid: pull.headRefOid, author: pull.author }],
    })),
    mergedPullRequests,
    closedUnmergedPullRequests: [structuredClone(closed)],
    penalties,
    detailEligibleMergedPullRequestIds: mergedPullRequests.map(
      (pull) => pull.id,
    ),
    closedIssueCount: 0,
    resolvedIssues: [],
    openIssues: [],
    openPullRequests: [],
    verificationWindowFrom: windowFrom,
    verifiedEvidence: [],
    verifyRunReceipt: verifyRunReceiptSignature,
  };
}
