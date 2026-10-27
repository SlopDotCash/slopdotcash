/**
 * SCR-04: an integration-branch pull request shares merge credit with the
 * authors of the commits it owns. A merge commit, such as GitHub's "Update
 * branch", is not primary authorship, so its author gets no shared credit.
 */
import { afterAll, expect, setSystemTime, test } from "bun:test";
import type {
  GitHubActor,
  LeaderboardInput,
  MergedPullRequestOutcome,
} from "../src/lib/leaderboard";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import {
  collectSearchReferences,
  type GraphqlExecutor,
} from "./generate-leaderboard";

const REPO_URL = "https://github.com/SlopDotCash/slopdotcash";
const AT = "2026-10-19T12:00:00.000Z";
const FROM = "2026-09-14T12:00:00.000Z";
const HEAD = "a".repeat(40);

// The scorer refuses a snapshot generated in the future of the wall clock.
setSystemTime(new Date(AT));
afterAll(() => setSystemTime());

function actor(login: string, id: string): GitHubActor {
  return {
    id,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/${id.length}?v=4`,
    url: `https://github.com/${login}`,
    kind: "User",
  };
}

function input(partial: Partial<LeaderboardInput>): LeaderboardInput {
  return {
    generatedAt: AT,
    windowFrom: FROM,
    windowTo: AT,
    sourceUpdatedAt: AT,
    source: {
      provider: "github-graphql",
      fetchedAt: AT,
      cutoffAt: AT,
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
      rateLimit: { cost: 1, limit: 5000, remaining: 4999, resetAt: AT },
      counts: {
        mergedPullRequests: 0,
        detailedMergedPullRequests: 0,
        closedIssues: 0,
        detailedClosedIssues: 0,
        resolvedIssues: 0,
        openIssues: 0,
        openPullRequests: 0,
      },
      verificationWindow: { days: 35, from: FROM, to: AT },
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
    reviewedMergedPullRequests: [],
    detailEligibleMergedPullRequestIds: [],
    closedIssueCount: 0,
    resolvedIssues: [],
    openIssues: [],
    openPullRequests: [],
    verificationWindowFrom: FROM,
    verifiedEvidence: [],
    evaluatedContributions: [],
    ...partial,
  };
}

function outcome(
  number: number,
  author: GitHubActor,
  mergedAt: string,
  baseRefName: string,
  commits: MergedPullRequestOutcome["commits"],
): MergedPullRequestOutcome {
  return {
    id: `PR_${number}`,
    number,
    title: `PR ${number}`,
    url: `${REPO_URL}/pull/${number}`,
    body: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: mergedAt,
    mergedAt,
    author,
    additions: 1,
    deletions: 1,
    baseRefName,
    commits,
  };
}

const lala = actor("lalalune", "MDQ6VXNlcjE4NjMzMjY0");
const sam = actor("sam", "U_sam");

function merges(snapshot: ReturnType<typeof createLeaderboardSnapshot>) {
  return snapshot.ledger
    .filter((entry) => entry.category === "merged-pull-request")
    .map((entry) => `${entry.id} ${entry.actor.login} ${entry.scoreThirds}`)
    .sort();
}

async function collectOutcomes(outcomes: MergedPullRequestOutcome[]) {
  const repository = TARGET_REPOSITORIES.find(
    (target) => target.id === "SlopDotCash/slopdotcash",
  );
  if (!repository) throw new Error("Slop fixture repository is missing");
  const nodes = outcomes.map((value) => ({
    ...value,
    __typename: "PullRequest",
    state: "MERGED",
    baseRefOid: "b".repeat(40),
    headRefOid: HEAD,
    author: value.author && { ...value.author, __typename: value.author.kind },
    commits: {
      totalCount: value.commits?.length ?? 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: (value.commits ?? []).map((commit) => ({
        commit: {
          oid: commit.oid,
          parents: { totalCount: commit.parentCount ?? 1 },
          author: {
            user: commit.author && {
              ...commit.author,
              __typename: commit.author.kind,
            },
          },
        },
      })),
    },
  }));
  const client: GraphqlExecutor = {
    execute: async () => ({
      search: {
        issueCount: nodes.length,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes,
      },
    }),
    getRequestCount: () => 1,
    getRateLimit: () => ({
      cost: 1,
      limit: 5000,
      remaining: 4999,
      consumedDuringRun: 1,
      resetAt: AT,
    }),
  };
  const references = await collectSearchReferences(
    client,
    repository,
    new Date(FROM),
    new Date(AT),
    "merged",
    "is:pr is:merged",
    "PullRequest",
    { searchSliceCount: 0 },
  );
  return references.flatMap((reference) =>
    reference.outcome ? [reference.outcome] : [],
  );
}

test("an integration-branch pull request still shares credit with the committers it owns", () => {
  const theirs = { oid: "d1".repeat(20), author: sam };
  const mine = { oid: "d2".repeat(20), author: lala };
  const snapshot = createLeaderboardSnapshot(
    input({
      mergedPullRequestOutcomes: [
        outcome(900, lala, "2026-10-18T10:00:00.000Z", "development", [
          theirs,
          mine,
        ]),
      ],
    }),
  );
  expect(merges(snapshot)).toEqual([
    "PR_900:merged lalalune 2",
    "PR_900:merged:U_sam sam 1",
  ]);
});

test("a branch-sync merge commit adds no merge credit actor", async () => {
  // Live shapes: SlopDotCash/slopdotcash#688 and the Dependabot pull request
  // elizaOS/eliza#37164. A maintainer's only commit in each is a two-parent
  // merge of the integration branch into the pull request branch.
  const dependabot: GitHubActor = {
    ...actor("dependabot", "BOT_kgDOAAAAAA"),
    kind: "Bot",
  };
  const collected = await collectOutcomes([
    outcome(902, sam, "2026-10-18T10:00:00.000Z", "development", [
      { oid: "f1".repeat(20), author: sam, parentCount: 1 },
      { oid: "f2".repeat(20), author: lala, parentCount: 2 },
    ]),
    outcome(903, dependabot, "2026-10-18T11:00:00.000Z", "development", [
      { oid: "f3".repeat(20), author: dependabot, parentCount: 1 },
      { oid: "f4".repeat(20), author: lala, parentCount: 2 },
    ]),
  ]);
  const snapshot = createLeaderboardSnapshot(
    input({ mergedPullRequestOutcomes: collected }),
  );
  expect(merges(snapshot)).toEqual(["PR_902:merged sam 3"]);
});
