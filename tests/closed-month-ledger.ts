/**
 * The complete ledger that `leaderboard:generate --cutoff` publishes after a
 * month without activity closes. It collects the target repositories of the
 * registry snapshot that the running checkout holds.
 */
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

export function closedMonthLedger(at: string, from: string): string {
  return JSON.stringify(
    createLeaderboardSnapshot({
      generatedAt: at,
      windowFrom: from,
      windowTo: at,
      sourceUpdatedAt: at,
      source: {
        provider: "github-graphql",
        fetchedAt: at,
        cutoffAt: at,
        repositoryId: "R_fixture",
        repositories: TARGET_REPOSITORIES.map((target) => ({
          id: target.id,
          repositoryId:
            target.role === "primary"
              ? "R_fixture"
              : `R_fixture_${target.name.replaceAll("-", "_")}`,
        })),
        requestCount: 1,
        searchSliceCount: 1,
        rateLimit: {
          cost: 1,
          limit: 5000,
          remaining: 4999,
          resetAt: new Date(Date.parse(at) + 3_600_000).toISOString(),
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
        verificationWindow: { days: 35, from, to: at },
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
      verificationWindowFrom: from,
      verifiedEvidence: [],
      evaluatedContributions: [],
    }),
  );
}

// A copied checkout writes its own ledger: <output> <cutoff> <window start>.
if (import.meta.main) {
  const [output, at, from] = process.argv.slice(2);
  await Bun.write(output, closedMonthLedger(at, from));
}
