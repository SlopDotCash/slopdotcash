import { afterEach, expect, setSystemTime, test } from "bun:test";
import { implementationCreditActors } from "../src/lib/commit-credit";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  awardForScore,
  latestPoints,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { fixture, policy, repository } from "../tests/value-binary-fixture";
import {
  integrated,
  makeOriginal,
  repository as retainedRepository,
} from "../tests/value-promotion-fixture";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import {
  RetainedAttributionIncompleteError,
  retainedCommitCreditSources,
} from "./retained-commit-credit";
import { loadValueInputs } from "./value-ingestion";

afterEach(() => setSystemTime());

test("opening a replacement PR does not take a share from its commit author", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const pull = input.mergedPullRequestOutcomes[1];
  pull.author = PROJECT_OWNER;
  pull.commits = [{ oid: pull.headRefOid as string, author: PENALIZED_AUTHOR }];
  input.mergedPullRequests[1].author = PROJECT_OWNER;
  const events = createLeaderboardSnapshot(input).ledger.filter(
    (event) => event.source.id === pull.id,
  );
  expect(events.map((event) => [event.actor.id, event.scoreThirds])).toEqual([
    [PENALIZED_AUTHOR.id, 1],
  ]);
});

test("base-sync merge authors do not take implementation credit", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const pull = input.mergedPullRequestOutcomes[1];
  pull.author = PROJECT_OWNER;
  pull.commits = [
    {
      oid: pull.headRefOid as string,
      author: PENALIZED_AUTHOR,
      parentCount: 1,
    },
    { oid: "f".repeat(40), author: PROJECT_OWNER, parentCount: 2 },
  ];
  input.mergedPullRequests[1].author = PROJECT_OWNER;
  expect(
    createLeaderboardSnapshot(input)
      .ledger.filter((event) => event.source.id === pull.id)
      .map((event) => event.actor.id),
  ).toEqual([PENALIZED_AUTHOR.id]);
});

test("a second accepted PR containing only previously credited implementation commits adds no fallback credit", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const first = input.mergedPullRequestOutcomes[0];
  const duplicate = input.mergedPullRequestOutcomes[1];
  const commits = [
    { oid: "f".repeat(40), author: PENALIZED_AUTHOR, parentCount: 1 },
  ];
  first.commits = commits;
  duplicate.commits = commits;
  const snapshot = createLeaderboardSnapshot(input);
  expect(snapshot.ledger.some((event) => event.source.id === first.id)).toBe(
    true,
  );
  expect(
    snapshot.ledger.some((event) => event.source.id === duplicate.id),
  ).toBe(false);
  expect(snapshot.source.counts.mergedPullRequests).toBe(
    input.mergedPullRequestOutcomes.length,
  );
});

test("incomplete historical parent evidence does not establish duplicate implementation", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const first = input.mergedPullRequestOutcomes[0];
  const duplicate = input.mergedPullRequestOutcomes[1];
  const commits = [{ oid: "f".repeat(40), author: PENALIZED_AUTHOR }];
  first.commits = commits;
  duplicate.commits = commits;
  expect(
    createLeaderboardSnapshot(input).ledger.some(
      (event) => event.source.id === duplicate.id,
    ),
  ).toBe(true);
});

test("commit count does not multiply an author's share; actual maintainer fixes still share credit", () => {
  expect(
    implementationCreditActors(PROJECT_OWNER, [
      PENALIZED_AUTHOR,
      PENALIZED_AUTHOR,
      PROJECT_OWNER,
    ]),
  ).toEqual([PROJECT_OWNER, PENALIZED_AUTHOR]);
  expect(implementationCreditActors(PROJECT_OWNER, [PENALIZED_AUTHOR])).toEqual(
    [PENALIZED_AUTHOR],
  );
});

test("unlinked and agent-authored commits retain the source creator fallback", () => {
  const agent = { id: "U_kgDOD-0LXg", kind: "User" };
  const bot = { id: "BOT_example", kind: "Bot" };
  expect(
    implementationCreditActors(PENALIZED_AUTHOR, [null, agent, bot]),
  ).toEqual([PENALIZED_AUTHOR]);
  expect(implementationCreditActors(bot, [null, agent])).toEqual([]);
  expect(implementationCreditActors(agent, [null])).toEqual([]);
  expect(implementationCreditActors(agent, [])).toEqual([]);
});

test("collected evidence and joint claims both exclude a carrier with no authored change", async () => {
  const f = fixture({ textOnly: true, direct: true });
  const evidence = await collectValueEvidence(
    f.client,
    repository.id,
    1,
    repository,
  );
  expect(evidence.limitations).toEqual([]);
  expect(evidence.implementationActorNodeIds).toEqual(["U_author"]);
  const joint = await prepareWorkUnitEvidence(
    [{ evidence, policy }],
    [repository],
  );
  expect(joint.limitations).toEqual([]);
  expect(joint.claims.map((claim) => claim.implementationActorNodeIds)).toEqual(
    [["U_author"]],
  );
});

function retainedCase() {
  const original = makeOriginal();
  original.evidence.pull.merged_at = null;
  original.evidence.pull.merge_commit_sha = null;
  original.evidence.pull.merged_by = null;
  original.evidence.mergeCommitEvidence = null;
  original.evidence.commits[0].author = null;
  original.evidence.commitAttribution[0].actorNodeIds = [];
  const copy = structuredClone(original);
  const maintainer = {
    node_id: "U_maintainer",
    login: "maintainer",
    type: "User",
  };
  Object.assign(copy.evidence.pull, {
    node_id: "PR_copy",
    number: 2,
    html_url: `https://github.com/${retainedRepository.id}/pull/2`,
    user: maintainer,
    merged_by: maintainer,
    merged_at: "2026-10-02T10:00:00Z",
    closed_at: "2026-10-02T10:00:00Z",
    merge_commit_sha: integrated,
  });
  original.evidence.comments.push({
    node_id: "IC_retained",
    html_url: `https://github.com/${retainedRepository.id}/pull/1#issuecomment-1`,
    body: `Merged in ${integrated}.`,
    user: maintainer,
    created_at: "2026-10-02T11:00:00Z",
    updated_at: "2026-10-02T11:00:00Z",
  });
  return { original, copy };
}

test("verified retained copies assign an unlinked commit to the original PR creator", async () => {
  const { original, copy } = retainedCase();
  const joint = await prepareWorkUnitEvidence(
    [original, copy],
    [retainedRepository],
  );
  expect(joint.limitations).toEqual([]);
  expect(joint.claims).toHaveLength(1);
  expect(joint.claims[0]).toMatchObject({
    creditPullRequestId: "PR_original",
    implementationActorNodeIds: ["U_author"],
    retainedCopy: { acceptancePullRequestId: "PR_copy" },
  });
});

test("unassessed retained copies receive their original creator's minimum credit", async () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const { original, copy } = retainedCase();
  const sources = await retainedCommitCreditSources(copy, [original, copy]);
  const source = sources.get(copy.evidence.commits[0].sha);
  if (!source) throw new Error("Missing retained attribution proof");
  expect(source).toEqual({
    actorNodeId: "U_author",
    originalPullRequestId: "PR_original",
    originalPullRequestUrl: original.evidence.pull.html_url,
    originalCommitSha: original.evidence.commits[0].sha,
  });
  const input = penaltyScoreInput([]);
  const pull = input.mergedPullRequestOutcomes[1];
  pull.author = PROJECT_OWNER;
  pull.commits = [
    { oid: copy.evidence.commits[0].sha, author: null, parentCount: 1 },
  ];
  input.mergedPullRequests[1].author = PROJECT_OWNER;
  input.retainedCommitAuthors = new Map([
    [
      pull.id,
      new Map([
        [
          pull.commits[0].oid,
          {
            actor: PENALIZED_AUTHOR,
            originalPullRequestId: source.originalPullRequestId,
            originalPullRequestUrl: source.originalPullRequestUrl,
            originalCommitSha: source.originalCommitSha,
          },
        ],
      ]),
    ],
  ]);
  const events = createLeaderboardSnapshot(input).ledger.filter(
    (event) => event.source.id === pull.id,
  );
  expect(events.map((event) => [event.actor.id, event.scoreThirds])).toEqual([
    [PENALIZED_AUTHOR.id, 1],
  ]);
  expect(events[0].reason).toContain(original.evidence.pull.html_url);
});

test("unacknowledged or incomplete retained copies cannot silently fall back to the carrier", async () => {
  const { original, copy } = retainedCase();
  copy.evidence.relatedPullRequests = [
    {
      id: original.evidence.pull.node_id,
      number: original.evidence.pull.number,
      url: original.evidence.pull.html_url,
      repository: retainedRepository.id,
    },
  ];
  original.evidence.comments = [];
  await expect(
    retainedCommitCreditSources(copy, [original, copy]),
  ).rejects.toThrow("authenticated retention acknowledgement");
  original.evidence.limitations.push("Missing complete patch");
  await expect(
    retainedCommitCreditSources(copy, [original, copy]),
  ).rejects.toBeInstanceOf(RetainedAttributionIncompleteError);
});

test("one incomplete attribution holds its score while the complete census and other work refresh", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const before = createLeaderboardSnapshot(penaltyScoreInput([]));
  const input = penaltyScoreInput([], "2026-11-20T01:00:00.000Z");
  input.implementationAttributionHolds = new Map([
    ["PR_november", ["Accepted merge proof needs reconciliation"]],
  ]);
  const current = createLeaderboardSnapshot(input);
  assertLeaderboardSnapshot(current);
  expect(current.source.counts.mergedPullRequests).toBe(
    before.source.counts.mergedPullRequests,
  );
  expect(
    current.ledger.some((event) => event.source.id === "PR_november"),
  ).toBe(false);
  expect(current.ledger.some((event) => event.source.id === "PR_owner")).toBe(
    true,
  );
  expect(
    current.valueAssessmentCoverage?.find(
      (row) => row.pullRequestId === "PR_november",
    ),
  ).toMatchObject({ status: "incomplete" });
  const empty: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const journal = applyPointsSnapshot(
    empty,
    before,
    "a".repeat(64),
    before.generatedAt,
  );
  const refreshed = applyPointsSnapshot(
    journal,
    current,
    "b".repeat(64),
    current.generatedAt,
  );
  const held = (value: PointsJournal) =>
    [...latestPoints(value).values()].filter(
      (revision) => revision.award.sourceId === "PR_november",
    );
  expect(held(refreshed)).toEqual(held(journal));
});

test("an attribution hold preserves prior joint value instead of revoking its assessment", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([], "2026-11-20T01:00:00.000Z");
  const previousSnapshot = createLeaderboardSnapshot(penaltyScoreInput([]));
  const event = previousSnapshot.ledger.find(
    (entry) => entry.source.id === "PR_november",
  );
  if (!event) throw new Error("Missing accepted source");
  const workUnitId = `wu_${"c".repeat(64)}`;
  const prior = {
    ...awardForScore(event),
    key: pointKey(
      "asi",
      event.actor.id,
      event.category,
      event.source.id,
      workUnitId,
    ),
    workUnitId,
    amount: 90,
  };
  const empty: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const priorDigest = "d".repeat(64);
  const journal = appendPointAwards(
    empty,
    [prior],
    "a".repeat(64),
    previousSnapshot.ruleVersion,
    GENERATED_AT,
    new Map([
      [
        prior.key,
        {
          sourceId: `value:${priorDigest}`,
          effectiveAt: GENERATED_AT,
          reason: "Retained joint assessment",
        },
      ],
    ]),
  );
  input.valueDecisions = new Map([
    [
      event.source.id,
      {
        status: "incomplete",
        history: [],
        latestDigest: priorDigest,
        implementationActorNodeIds: [event.actor.id],
      },
    ],
  ]);
  input.implementationAttributionHolds = new Map([
    [event.source.id, ["Accepted merge proof needs reconciliation"]],
  ]);
  const current = createLeaderboardSnapshot(input);
  const coverage = current.valueAssessmentCoverage?.find(
    (row) => row.pullRequestId === event.source.id,
  );
  expect(coverage).toMatchObject({ status: "incomplete", recordDigest: null });
  assertLeaderboardSnapshot(current);
  const refreshed = applyPointsSnapshot(
    journal,
    current,
    "b".repeat(64),
    current.generatedAt,
  );
  expect(latestPoints(refreshed).get(prior.key)).toEqual(
    latestPoints(journal).get(prior.key),
  );
});

test("attribution uncertainty does not erase an unavailable joint source's retained digest", () => {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const input = penaltyScoreInput([]);
  const digest = "d".repeat(64);
  input.implementationAttributionHolds = new Map([
    ["PR_november", ["Accepted merge proof needs reconciliation"]],
  ]);
  const unavailable = {
    status: "unresolved",
    sourceUnavailable: true,
    latestDigest: digest,
    history: [],
    throughSequence: 1,
  } as const;
  input.jointValueDecisions = new Map([
    ["PR_november", unavailable as never],
    ["PR_missing", unavailable as never],
  ]);
  input.source.heldWorkUnits = [
    {
      recordDigest: digest,
      sourceNodeIds: ["PR_november", "PR_missing"],
      unavailableNodeIds: ["PR_missing"],
    },
  ];
  input.source.unavailableSources = [
    { nodeId: "PR_missing", reason: "NOT_FOUND" },
  ];
  input.source.counts.unavailableSources = 1;
  input.source.counts.unavailableMergedPullRequests = 0;
  input.source.counts.heldWorkUnits = 1;
  const current = createLeaderboardSnapshot(input);
  assertLeaderboardSnapshot(current);
  expect(
    current.valueAssessmentCoverage?.find(
      (row) => row.pullRequestId === "PR_november",
    ),
  ).toMatchObject({ status: "unresolved", recordDigest: digest });
});

for (const incomplete of [false, true]) {
  test(`historical attribution keeps ${incomplete ? "incomplete" : "complete"} ordinary unlinked work without requesting a value assessment`, async () => {
    const f = fixture({ textOnly: true, direct: true });
    const target = findRegisteredRepositoryById("SlopDotCash/asi");
    if (!target?.expectedNodeId) throw new Error("Missing registered fixture");
    const remap = <T>(value: T): T =>
      JSON.parse(
        JSON.stringify(value)
          .replaceAll(repository.id, target.id)
          .replaceAll('"R_binary"', JSON.stringify(target.expectedNodeId)),
      );
    let pullReads = 0;
    const github = {
      ...f.client,
      async get<T>(path: string): Promise<T | null> {
        const value = await f.client.get<unknown>(
          path
            .replaceAll(`${target.owner}/${target.name}`, repository.id)
            .replaceAll(target.id, repository.id),
        );
        if (path.endsWith("/pulls/1") && ++pullReads > 1 && incomplete)
          (value as { updated_at: string }).updated_at = "2026-10-16T18:00:00Z";
        if (path.includes("/pulls/1/commits?")) {
          const commits = value as { author: unknown }[];
          for (const commit of commits) commit.author = null;
        }
        return remap(value) as T | null;
      },
      async graphql<T>(): Promise<T> {
        return remap(await f.client.graphql<T>());
      },
    };
    const transport = Object.assign(
      async () => {
        throw new Error(
          "Historical attribution must not request assessment history",
        );
      },
      { preconnect: fetch.preconnect },
    );
    const result = await loadValueInputs(github, [], transport, undefined, [
      {
        id: f.pull.node_id,
        number: f.pull.number,
        url: f.pull.html_url.replace(repository.id, target.id),
        headRefOid: f.pull.head.sha,
        mergedAt: f.pull.merged_at,
        updatedAt: f.pull.updated_at,
        baseRefName: "release",
        commits: [{ oid: f.pull.head.sha, author: null, parentCount: 1 }],
      },
    ]);
    expect(f.calls).toContain(`/repos/${repository.id}/pulls/1`);
    expect(result.valueDecisions.size).toBe(0);
    expect(result.retainedCommitAuthors.size).toBe(0);
  });
}

test("retained attribution does not hydrate unlinked commits already accepted on another branch", async () => {
  const read = async (): Promise<never> => {
    throw new Error("Already accepted commits must not hydrate attribution");
  };
  const transport = Object.assign(read, { preconnect: fetch.preconnect });
  const common = {
    url: "https://github.com/SlopDotCash/asi/pull/1",
    number: 1,
    headRefOid: "a".repeat(40),
    updatedAt: "2026-10-02T00:00:00Z",
  };
  const result = await loadValueInputs(
    { get: read, graphql: read, fileText: read },
    [],
    transport,
    undefined,
    [
      {
        ...common,
        id: "PR_first_acceptance",
        mergedAt: "2026-10-01T00:00:00Z",
        baseRefName: "release",
        commits: [
          { oid: common.headRefOid, author: PENALIZED_AUTHOR, parentCount: 1 },
        ],
      },
      {
        ...common,
        id: "PR_later_promotion",
        url: "https://github.com/elizaOS/asi/pull/2",
        number: 2,
        mergedAt: "2026-10-02T00:00:00Z",
        baseRefName: "main",
        commits: [{ oid: common.headRefOid, author: null, parentCount: 1 }],
      },
    ],
  );
  expect(result.retainedCommitAuthors.size).toBe(0);
  expect(result.implementationAttributionHolds.size).toBe(0);
});
