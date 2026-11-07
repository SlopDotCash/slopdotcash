/**
 * A current assessment can name a GitHub account that GitHub no longer
 * resolves (deleted or hidden after the merge). Publication must withhold
 * that one assessment as incomplete evidence and keep publishing every other
 * accepted outcome (PRD section 9, protocol/scoring-v2.md unassessed states),
 * instead of aborting the whole snapshot on the NOT_FOUND node.
 */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
  PullRequestRecord as PullRecord,
} from "../src/lib/leaderboard-types";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import {
  SourceNodeUnavailableError,
  unavailableRequestedIds,
} from "./source-availability";
import { hydrateValueActors } from "./value-ingestion";

beforeAll(() => setSystemTime(new Date(AFTER_NOVEMBER)));
afterAll(() => setSystemTime());

const VANISHED = "U_kgDOvanished";

function node(actor: GitHubActor) {
  return {
    __typename: "User",
    id: actor.id,
    login: actor.login,
    avatarUrl: actor.avatarUrl,
    url: actor.url,
  };
}

/** Answers like the leaderboard client: a NOT_FOUND node fails the batch. */
function graphqlWithVanished(vanished: readonly string[]) {
  const batches: string[][] = [];
  const graphql = async <T>(
    _query: string,
    variables: Record<string, unknown>,
  ) => {
    const ids = variables.ids as string[];
    batches.push(ids);
    const missing = ids.filter((id) => vanished.includes(id));
    if (missing.length)
      throw new SourceNodeUnavailableError(
        missing.map((nodeId) => ({ nodeId, reason: "NOT_FOUND" as const })),
      );
    return {
      nodes: ids.map((id) =>
        node(id === PROJECT_OWNER.id ? PROJECT_OWNER : PENALIZED_AUTHOR),
      ),
    } as T;
  };
  return { graphql, batches };
}

test("a vanished actor is returned and the rest of its batch still resolves", async () => {
  const { graphql, batches } = graphqlWithVanished([VANISHED]);
  const actors = new Map<string, GitHubActor>();
  const unresolved = await hydrateValueActors(
    graphql,
    new Set([PENALIZED_AUTHOR.id, VANISHED, PROJECT_OWNER.id]),
    actors,
  );
  expect(unresolved).toEqual([VANISHED]);
  expect([...actors.keys()].sort()).toEqual(
    [PENALIZED_AUTHOR.id, PROJECT_OWNER.id].sort(),
  );
  expect(actors.get(PROJECT_OWNER.id)).toEqual(PROJECT_OWNER);
  expect(batches).toEqual([
    [PENALIZED_AUTHOR.id, VANISHED, PROJECT_OWNER.id],
    [PENALIZED_AUTHOR.id, PROJECT_OWNER.id],
  ]);
});

test("every actor vanished leaves nothing to resolve", async () => {
  const { graphql, batches } = graphqlWithVanished([VANISHED]);
  const actors = new Map<string, GitHubActor>();
  expect(
    await hydrateValueActors(graphql, new Set([VANISHED]), actors),
  ).toEqual([VANISHED]);
  expect(actors.size).toBe(0);
  expect(batches).toEqual([[VANISHED]]);
});

test("an account GitHub did not resolve is not queried again in the same run", async () => {
  const { graphql, batches } = graphqlWithVanished([VANISHED]);
  const actors = new Map<string, GitHubActor>();
  const known = new Set<string>();
  expect(
    await hydrateValueActors(
      graphql,
      new Set([VANISHED, PROJECT_OWNER.id]),
      actors,
      known,
    ),
  ).toEqual([VANISHED]);
  expect(
    await hydrateValueActors(
      graphql,
      new Set([PENALIZED_AUTHOR.id, VANISHED]),
      actors,
      known,
    ),
  ).toEqual([VANISHED]);
  expect(
    await hydrateValueActors(graphql, new Set([VANISHED]), actors, known),
  ).toEqual([VANISHED]);
  expect(batches).toEqual([
    [VANISHED, PROJECT_OWNER.id],
    [PROJECT_OWNER.id],
    [PENALIZED_AUTHOR.id],
  ]);
  expect([...actors.keys()].sort()).toEqual(
    [PENALIZED_AUTHOR.id, PROJECT_OWNER.id].sort(),
  );
});

test("an unavailable node the batch did not request still fails closed", async () => {
  const graphql = async () => {
    throw new SourceNodeUnavailableError([
      { nodeId: "PR_elsewhere", reason: "NOT_FOUND" },
    ]);
  };
  await expect(
    hydrateValueActors(graphql, new Set([PROJECT_OWNER.id]), new Map()),
  ).rejects.toBeInstanceOf(SourceNodeUnavailableError);
  expect(
    unavailableRequestedIds(
      new SourceNodeUnavailableError([
        { nodeId: VANISHED, reason: "NOT_FOUND" },
        { nodeId: VANISHED, reason: "NOT_FOUND" },
      ]),
      [VANISHED],
    ),
  ).toEqual([VANISHED]);
  expect(
    unavailableRequestedIds(new Error("rate limited"), [VANISHED]),
  ).toEqual([]);
});

test("other GraphQL failures still stop the publication", async () => {
  const graphql = async () => {
    throw new Error("GitHub GraphQL safety budget exceeded");
  };
  await expect(
    hydrateValueActors(graphql, new Set([PROJECT_OWNER.id]), new Map()),
  ).rejects.toThrow("safety budget");
});

type ValueDecision =
  NonNullable<LeaderboardInput["valueDecisions"]> extends ReadonlyMap<
    string,
    infer V
  >
    ? V
    : never;

/** The November fixture merge, scored with one journal decision. */
function scoreWith(decision: (pull: PullRecord) => Record<string, unknown>) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const pull = input.mergedPullRequests.find(
    (record) => record.id === "PR_november",
  );
  if (!pull?.mergedAt) throw new Error("fixture pull request missing");
  input.detailEligibleMergedPullRequestIds = [];
  input.valueDecisions = new Map([
    [pull.id, decision(pull) as unknown as ValueDecision],
  ]);
  return { pull, snapshot: createLeaderboardSnapshot(input) };
}

test("the withheld assessment keeps the accepted merge at the one-third minimum", () => {
  const digest = "d".repeat(64);
  const history = [
    {
      sequence: 1,
      record_digest: digest,
      record_json: "{}",
      recorded_at: "2026-11-05T01:00:00.000Z",
    },
  ];
  // The snapshot cannot score an assessed decision whose actor never resolved.
  expect(() =>
    scoreWith((pull) => ({
      status: "assessed",
      implementationActorNodeIds: [PENALIZED_AUTHOR.id, VANISHED],
      record: {
        pullRequestNodeId: pull.id,
        repository: "elizaOS/asi",
        headSha: pull.headRefOid,
        occurredAt: pull.mergedAt,
        assessment: { tier: "medium", reviews: [] },
      },
      assessment: { status: "assessed", tier: "medium", reviews: [] },
      history,
      latestDigest: digest,
    })),
  ).toThrow("Value implementation actor lacks a verified GitHub identity");
  // Withheld as incomplete, the same census publishes with the minimum credit.
  const { pull, snapshot } = scoreWith(() => ({
    status: "incomplete",
    implementationActorNodeIds: [PENALIZED_AUTHOR.id, VANISHED],
    history,
    latestDigest: digest,
  }));
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (row) => row.pullRequestId === pull.id,
    ),
  ).toMatchObject({ status: "incomplete", recordDigest: digest });
  expect(
    snapshot.ledger
      .filter((event) => event.source.id === pull.id)
      .map((event) => [event.category, event.actor.id, event.scoreThirds]),
  ).toEqual([["merged-pull-request", PENALIZED_AUTHOR.id, 1]]);
});
