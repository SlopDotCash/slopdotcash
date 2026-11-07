import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type {
  GitHubActor,
  LeaderboardInput,
} from "../src/lib/leaderboard-types";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
  PLACEHOLDER_LINKED_ACCOUNT,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

function acceptedMerges() {
  const input = penaltyScoreInput([]);
  delete input.valuePolicy;
  delete input.valueDecisions;
  input.closedUnmergedPullRequests = [];
  input.penalties = [];
  input.mergedPullRequests = [];
  input.detailEligibleMergedPullRequestIds = [];
  input.source.counts.detailedMergedPullRequests = 0;
  input.mergedPullRequestOutcomes = input.mergedPullRequestOutcomes.map(
    (pull, index) => ({
      ...pull,
      commits:
        index === 0
          ? [
              ...(pull.commits ?? []),
              { oid: "b".repeat(40), author: PROJECT_OWNER },
            ]
          : pull.commits,
    }),
  );
  return input;
}

test("one accepted merge shares credit with both linked authors while distinct merges keep their credit", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const snapshot = createLeaderboardSnapshot(acceptedMerges());
  const shared = snapshot.ledger.filter(
    (event) => event.source.id === "PR_october",
  );
  expect(shared.map((event) => [event.actor.id, event.scoreThirds])).toEqual([
    [PENALIZED_AUTHOR.id, 2],
    [PROJECT_OWNER.id, 1],
  ]);
  expect(
    snapshot.ledger.find((event) => event.source.id === "PR_november")
      ?.scoreThirds,
  ).toBe(3);
  expect(
    snapshot.ledger.find((event) => event.source.id === "PR_owner")
      ?.scoreThirds,
  ).toBe(3);
  expect(
    snapshot.leaders.find((person) => person.actor.id === PENALIZED_AUTHOR.id)
      ?.scoreThirds,
  ).toBe(5);
  expect(
    snapshot.leaders.find((person) => person.actor.id === PROJECT_OWNER.id)
      ?.scoreThirds,
  ).toBe(4);
});

test("a second snapshot independently credits its accepted merges", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const first = createLeaderboardSnapshot(acceptedMerges());
  const second = createLeaderboardSnapshot(acceptedMerges());
  expect(second.ledger).toEqual(first.ledger);
  expect(second.leaders).toEqual(first.leaders);
});

test("a commit linked to the placeholder identity earns no merge credit", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = acceptedMerges();
  input.mergedPullRequestOutcomes = input.mergedPullRequestOutcomes.map(
    (pull) =>
      pull.id === "PR_november"
        ? {
            ...pull,
            commits: [
              ...(pull.commits ?? []),
              { oid: "c".repeat(40), author: PLACEHOLDER_LINKED_ACCOUNT },
            ],
          }
        : pull,
  );
  const snapshot = createLeaderboardSnapshot(input);
  expect(
    snapshot.ledger
      .filter((event) => event.source.id === "PR_november")
      .map((event) => [event.actor.id, event.scoreThirds]),
  ).toEqual([[PENALIZED_AUTHOR.id, 3]]);
  expect(
    snapshot.leaders.some(
      (person) => person.actor.id === PLACEHOLDER_LINKED_ACCOUNT.id,
    ),
  ).toBe(false);
});

const AUTOMATION_BOT: GitHubActor = {
  id: "BOT_kgDOautomation",
  login: "automation[bot]",
  avatarUrl: "https://avatars.githubusercontent.com/in/1?v=4",
  url: "https://github.com/apps/automation",
  kind: "Bot",
};

type ValueDecision =
  NonNullable<LeaderboardInput["valueDecisions"]> extends ReadonlyMap<
    string,
    infer V
  >
    ? V
    : never;

/** PR_november's merge credit under one recorded value assessment. */
function recordedAssessmentCredit(
  implementationActorNodeIds: string[],
  author?: GitHubActor,
) {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const pull = input.mergedPullRequests.find((row) => row.id === "PR_november");
  if (!pull?.mergedAt) throw new Error("missing fixture pull request");
  if (author) {
    pull.author = author;
    input.mergedPullRequestOutcomes = input.mergedPullRequestOutcomes.map(
      (outcome) =>
        outcome.id === pull.id
          ? { ...outcome, author, commits: [{ oid: pull.headRefOid, author }] }
          : outcome,
    );
  }
  input.detailEligibleMergedPullRequestIds = [];
  input.valueActors = new Map([
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR],
    [PLACEHOLDER_LINKED_ACCOUNT.id, PLACEHOLDER_LINKED_ACCOUNT],
  ]);
  const decision = {
    status: "assessed",
    implementationActorNodeIds,
    record: {
      pullRequestNodeId: pull.id,
      repository: "elizaOS/asi",
      headSha: pull.headRefOid,
      occurredAt: pull.mergedAt,
      assessment: { tier: "small", rationale: "bounded fix", reviews: [] },
    },
    assessment: { status: "assessed", tier: "small", reviews: [] },
    history: [
      {
        sequence: 1,
        record_digest: "e".repeat(64),
        record_json: "{}",
        recorded_at: "2026-11-05T01:00:00.000Z",
      },
    ],
    latestDigest: "d".repeat(64),
  };
  input.valueDecisions = new Map([
    [pull.id, decision as unknown as ValueDecision],
  ]);
  return createLeaderboardSnapshot(input)
    .ledger.filter(
      (event) =>
        event.source.id === pull.id && event.category === "merged-pull-request",
    )
    .map((event) => [event.actor.id, event.scoreThirds]);
}

test("a recorded assessment that names the placeholder account credits the author alone", () => {
  expect(
    recordedAssessmentCredit([
      PENALIZED_AUTHOR.id,
      PLACEHOLDER_LINKED_ACCOUNT.id,
    ]),
  ).toEqual([[PENALIZED_AUTHOR.id, 3]]);
});

// Collection lists a person who opens a pull request, so only a bot pull
// request can be left with no implementation actor.
test("a bot pull request whose only recorded actor is the placeholder account credits nobody", () => {
  expect(
    recordedAssessmentCredit([PLACEHOLDER_LINKED_ACCOUNT.id], AUTOMATION_BOT),
  ).toEqual([]);
});
