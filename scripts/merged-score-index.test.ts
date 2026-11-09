import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
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
