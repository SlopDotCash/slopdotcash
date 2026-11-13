import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  createLeaderboardSnapshot,
  repositoryIdFromUrl,
} from "../src/lib/leaderboard";
import {
  AFTER_NOVEMBER,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

function sharedOutcome(
  options: { tiny?: boolean; zero?: boolean; baseRefName?: string } = {},
) {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const pull = input.mergedPullRequestOutcomes[options.tiny ? 1 : 0];
  if (options.baseRefName) pull.baseRefName = options.baseRefName;
  pull.author = PROJECT_OWNER;
  pull.commits = [
    {
      oid: pull.headRefOid as string,
      author: PENALIZED_AUTHOR,
      additions: options.zero ? 0 : 9,
      deletions: 0,
      parentCount: 1,
    },
    {
      oid: "a".repeat(40),
      author: PROJECT_OWNER,
      additions: options.zero ? 0 : 1,
      deletions: 0,
      parentCount: 1,
    },
  ];
  const detailed = input.mergedPullRequests.find(
    (record) => record.id === pull.id,
  );
  if (!detailed) throw new Error("missing shared fixture");
  detailed.author = PROJECT_OWNER;
  return { input, pull };
}

function retainCarrierValuation({
  input,
  pull,
}: ReturnType<typeof sharedOutcome>) {
  input.valueActors = new Map([[PROJECT_OWNER.id, PROJECT_OWNER]]);
  input.valueDecisions = new Map([
    ...(input.valueDecisions ?? []),
    [
      pull.id,
      {
        status: "assessed",
        latestDigest: "d".repeat(64),
        history: [{ recorded_at: pull.mergedAt }],
        implementationActorNodeIds: [PROJECT_OWNER.id],
        record: {
          pullRequestNodeId: pull.id,
          repository: repositoryIdFromUrl(pull.url),
          headSha: pull.headRefOid,
          occurredAt: pull.mergedAt,
          assessment: {
            tier: "large",
            rationale: "Retained value assessed before attribution correction.",
            reviews: [],
          },
        },
      } as never,
    ],
  ]);
}

test("a complete synchronization-only range cannot award its PR creator", () => {
  const { input, pull } = sharedOutcome();
  for (const commit of pull.commits ?? []) commit.parentCount = 2;
  const snapshot = createLeaderboardSnapshot(input);
  expect(
    snapshot.ledger.filter(
      (event) =>
        event.source.id === pull.id && event.category === "merged-pull-request",
    ),
  ).toEqual([]);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (row) => row.pullRequestId === pull.id,
    )?.status,
  ).toBe("incomplete");
});

test("accepted PR value is preserved while authors share by changed lines", () => {
  const { input, pull } = sharedOutcome();
  const snapshot = createLeaderboardSnapshot(input);
  const events = snapshot.ledger.filter((event) => event.source.id === pull.id);
  expect(events.map((event) => [event.actor.id, event.scoreThirds])).toEqual([
    [PENALIZED_AUTHOR.id, 2.7],
    [PROJECT_OWNER.id, 0.3],
  ]);
  expect(events.reduce((sum, event) => sum + (event.scoreThirds ?? 0), 0)).toBe(
    3,
  );
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === pull.id,
    )?.implementationAllocation,
  ).toEqual({
    rule: "changed-lines-v1",
    totalScoreThirds: 3,
    weights: [
      {
        actorNodeId: PENALIZED_AUTHOR.id,
        actorLogin: PENALIZED_AUTHOR.login,
        changedLines: "9",
      },
      {
        actorNodeId: PROJECT_OWNER.id,
        actorLogin: PROJECT_OWNER.login,
        changedLines: "1",
      },
    ],
  });
});

test("a minimum-value PR does not gain points for multiple contributors", () => {
  const { input, pull } = sharedOutcome({ tiny: true });
  const events = createLeaderboardSnapshot(input).ledger.filter(
    (event) => event.source.id === pull.id,
  );
  expect(events.map((event) => [event.actor.id, event.scoreThirds])).toEqual([
    [PENALIZED_AUTHOR.id, 0.9],
    [PROJECT_OWNER.id, 0.1],
  ]);
});

for (const baseRefName of ["release", "feature/import-fix"]) {
  test(`PRs targeting ${baseRefName} use the same verified line allocation`, () => {
    const { input, pull } = sharedOutcome({ baseRefName });
    const snapshot = createLeaderboardSnapshot(input);
    expect(
      snapshot.ledger
        .filter((event) => event.source.id === pull.id)
        .map((event) => [event.actor.id, event.scoreThirds]),
    ).toEqual([
      [PENALIZED_AUTHOR.id, 2.7],
      [PROJECT_OWNER.id, 0.3],
    ]);
    expect(
      snapshot.valueAssessmentCoverage?.find(
        (item) => item.pullRequestId === pull.id,
      )?.implementationAllocation,
    ).toMatchObject({ rule: "changed-lines-v1", totalScoreThirds: 3 });
  });
}

test("a later promotion cannot score commits already accepted on another branch", () => {
  const { input, pull } = sharedOutcome({ baseRefName: "release" });
  const later = input.mergedPullRequestOutcomes[1];
  later.baseRefName = "main";
  later.commits = structuredClone(pull.commits);
  const snapshot = createLeaderboardSnapshot(input);
  expect(snapshot.ledger.some((event) => event.source.id === pull.id)).toBe(
    true,
  );
  expect(snapshot.ledger.some((event) => event.source.id === later.id)).toBe(
    false,
  );
});

test("complete zero-line changes preserve equal sharing and the existing total", () => {
  const { input, pull } = sharedOutcome({ zero: true });
  const events = createLeaderboardSnapshot(input).ledger.filter(
    (event) => event.source.id === pull.id,
  );
  expect(
    events
      .map((event) => [event.actor.id, event.scoreThirds])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  ).toEqual([
    [PENALIZED_AUTHOR.id, 1.5],
    [PROJECT_OWNER.id, 1.5],
  ]);
});

test("missing multi-author line evidence holds the source instead of guessing shares", () => {
  const { input, pull } = sharedOutcome();
  if (!pull.commits) throw new Error("missing shared commits");
  delete pull.commits[1].additions;
  const snapshot = createLeaderboardSnapshot(input);
  expect(snapshot.ledger.some((event) => event.source.id === pull.id)).toBe(
    false,
  );
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === pull.id,
    ),
  ).toMatchObject({ status: "incomplete", recordDigest: null });
});

test("a retained carrier-only valuation cannot hide missing multi-author line evidence", () => {
  const source = sharedOutcome({ tiny: true });
  retainCarrierValuation(source);
  if (!source.pull.commits) throw new Error("missing shared commits");
  delete source.pull.commits[0].additions;
  const snapshot = createLeaderboardSnapshot(source.input);
  expect(
    snapshot.ledger.some((event) => event.source.id === source.pull.id),
  ).toBe(false);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === source.pull.id,
    ),
  ).toMatchObject({ status: "incomplete", recordDigest: null });
});

test("a sole current author keeps the retained PR value when line counts are unavailable", () => {
  const source = sharedOutcome({ tiny: true });
  retainCarrierValuation(source);
  if (!source.pull.commits) throw new Error("missing shared commits");
  source.pull.commits = [source.pull.commits[0]];
  delete source.pull.commits[0].additions;
  const snapshot = createLeaderboardSnapshot(source.input);
  expect(
    snapshot.ledger
      .filter((event) => event.source.id === source.pull.id)
      .map((event) => [event.actor.id, event.scoreThirds]),
  ).toEqual([[PENALIZED_AUTHOR.id, 24]]);
});

test("missing commit-parent evidence cannot publish a weighted allocation proof", () => {
  const { input, pull } = sharedOutcome();
  if (!pull.commits) throw new Error("missing shared commits");
  delete pull.commits[0].parentCount;
  const held = createLeaderboardSnapshot(input);
  expect(held.ledger.some((event) => event.source.id === pull.id)).toBe(false);
  pull.commits = [pull.commits[0]];
  const single = createLeaderboardSnapshot(input);
  expect(
    single.ledger
      .filter((event) => event.source.id === pull.id)
      .map((event) => [event.actor.id, event.scoreThirds]),
  ).toEqual([[PENALIZED_AUTHOR.id, 3]]);
  expect(
    single.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === pull.id,
    )?.implementationAllocation,
  ).toBeUndefined();
});

test("splitting an author's same changed lines into more commits does not change their share", () => {
  const { input, pull } = sharedOutcome();
  const before = createLeaderboardSnapshot(input).ledger.filter(
    (event) => event.source.id === pull.id,
  );
  if (!pull.commits) throw new Error("missing shared commits");
  pull.commits[0].additions = 4;
  pull.commits.push({
    oid: "b".repeat(40),
    author: PENALIZED_AUTHOR,
    additions: 5,
    deletions: 0,
    parentCount: 1,
  });
  const after = createLeaderboardSnapshot(input).ledger.filter(
    (event) => event.source.id === pull.id,
  );
  expect(after.map((event) => [event.actor.id, event.scoreThirds])).toEqual(
    before.map((event) => [event.actor.id, event.scoreThirds]),
  );
});
