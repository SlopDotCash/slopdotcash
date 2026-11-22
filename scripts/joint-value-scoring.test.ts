/**
 * Joint work-unit scoring (PRD section 7). The work-unit producer gives a claim
 * no implementation actor when a bot opened the pull request and no
 * credit-eligible person authored the commit. A unit made only of such claims
 * has nobody to credit. The single pull request path skips that merge; the
 * joint path must do the same instead of failing the whole leaderboard.
 */
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
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
import { sha256Hex } from "../src/lib/sha256";
import {
  VALUE_RUBRIC_VERSION,
  type ValueAssessment,
} from "../src/lib/value-assessment";
import {
  AFTER_NOVEMBER,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import {
  type WorkUnitRecord,
  workUnitIdentity,
} from "../workers/slopbot/value-work-unit-journal";

beforeAll(() => setSystemTime(new Date(AFTER_NOVEMBER)));
afterAll(() => setSystemTime());

const HUMAN_CLAIM = "a".repeat(64);
const BOT_CLAIM = "b".repeat(64);
const OLD_PATH_CLAIM = "e".repeat(64);

function snapshotWithJointUnits(
  botClaimActors: string[],
  changedLines?: [number | undefined, number | undefined],
  options: {
    historicalCarrier?: boolean;
    missingCommit?: boolean;
    renamedHumanFile?: boolean;
    completionInOtherPR?: boolean;
    heldStatus?: "stale" | "incomplete" | "unresolved";
  } = {},
) {
  const input = penaltyScoreInput([], GENERATED_AT);
  const pull = input.mergedPullRequests.find(
    (record) => record.id === "PR_november",
  );
  if (!pull) throw new Error("fixture pull request missing");
  input.valueActors = new Map([
    [PENALIZED_AUTHOR.id, PENALIZED_AUTHOR],
    [PROJECT_OWNER.id, PROJECT_OWNER],
  ]);
  const unit = (workUnitId: string, claimId: string) => ({
    workUnitId,
    claimIds: [claimId],
    assessment: {
      status: "assessed",
      tier: "micro",
      rationale: "Fixture unit.",
      reviews: [],
    },
  });
  const claim = (id: string, implementationActorNodeIds: string[]) => ({
    id,
    commitSha: id.slice(0, 40),
    path: `src/${id[0]}.ts`,
    carrierPullRequestIds: [pull.id],
    creditPullRequestId: pull.id,
    implementationActorNodeIds: options.historicalCarrier
      ? [PROJECT_OWNER.id]
      : implementationActorNodeIds,
  });
  const decision = {
    status: "assessed",
    latestDigest: "d".repeat(64),
    history: [{ recorded_at: "2026-11-05T01:00:00.000Z" }],
    record: {
      sources: [{ pullRequestNodeId: pull.id, headSha: pull.headRefOid }],
      units: changedLines
        ? [
            {
              ...unit("wu_shared", HUMAN_CLAIM),
              claimIds: [
                HUMAN_CLAIM,
                ...(options.renamedHumanFile ? [OLD_PATH_CLAIM] : []),
                BOT_CLAIM,
              ],
              assessment: {
                status: "assessed",
                tier: "large",
                rationale: "Fixture shared unit.",
                reviews: [],
              },
            },
          ]
        : [unit("wu_human", HUMAN_CLAIM), unit("wu_dependency_bot", BOT_CLAIM)],
    },
    evidence: {
      claims: [
        claim(HUMAN_CLAIM, [PENALIZED_AUTHOR.id]),
        ...(options.renamedHumanFile
          ? [
              {
                ...claim(OLD_PATH_CLAIM, [PENALIZED_AUTHOR.id]),
                commitSha: HUMAN_CLAIM.slice(0, 40),
                path: "src/old.ts",
              },
            ]
          : []),
        claim(BOT_CLAIM, botClaimActors),
      ],
      sources: [
        {
          evidence: {
            repository: "SlopDotCash/asi",
            pull: {
              node_id: pull.id,
              number: pull.number,
              title: pull.title,
              html_url: pull.url,
              head: { sha: pull.headRefOid },
              updated_at: pull.updatedAt,
              merged_at: pull.mergedAt,
              closed_at: pull.closedAt,
              user: {
                node_id: options.historicalCarrier
                  ? PROJECT_OWNER.id
                  : PENALIZED_AUTHOR.id,
                type: "User",
              },
              base: { ref: "release" },
            },
            comments: [],
            reviews: [],
            ...(options.historicalCarrier || options.missingCommit
              ? {
                  implementationActorNodeIds: [PROJECT_OWNER.id],
                  commits: [HUMAN_CLAIM, BOT_CLAIM].map((id, index) => ({
                    sha:
                      options.missingCommit && index === 0
                        ? "f".repeat(40)
                        : id.slice(0, 40),
                    parents: [{ sha: "0".repeat(40) }],
                    author: {
                      node_id:
                        index === 0 ? PENALIZED_AUTHOR.id : PROJECT_OWNER.id,
                      type: "User",
                    },
                  })),
                }
              : {}),
            ...(changedLines
              ? {
                  commitAttribution: [HUMAN_CLAIM, BOT_CLAIM].map(
                    (id, index) => ({
                      sha: id.slice(0, 40),
                      limitations: [],
                      files: [
                        {
                          filename: `src/${id[0]}.ts`,
                          status: "modified",
                          additions: changedLines[index],
                          deletions: 0,
                          ...(options.renamedHumanFile && index === 0
                            ? {
                                status: "renamed",
                                previous_filename: "src/old.ts",
                              }
                            : {}),
                        },
                      ],
                    }),
                  ),
                }
              : {}),
          },
        },
      ],
    },
  };
  if (options.completionInOtherPR) {
    const completion = input.mergedPullRequests.find(
      (record) => record.id === "PR_owner",
    );
    if (!completion) throw new Error("completion fixture missing");
    const source = structuredClone(decision.evidence.sources[0]);
    source.evidence.pull = {
      ...source.evidence.pull,
      node_id: completion.id,
      number: completion.number,
      title: completion.title,
      html_url: completion.url,
      head: { sha: completion.headRefOid },
      updated_at: completion.updatedAt,
      merged_at: completion.mergedAt,
      closed_at: completion.closedAt,
    };
    decision.evidence.sources.push(source);
    decision.record.sources.push({
      pullRequestNodeId: completion.id,
      headSha: completion.headRefOid,
    });
    decision.evidence.claims[1].creditPullRequestId = completion.id;
    decision.evidence.claims[1].carrierPullRequestIds = [completion.id];
    decision.record.units[0].workUnitId = `wu_${"c".repeat(64)}`;
  }
  input.jointValueDecisions = new Map(
    decision.record.sources.map((source) => [
      source.pullRequestNodeId,
      (options.heldStatus
        ? { ...decision, status: options.heldStatus }
        : decision) as never,
    ]),
  );
  const retainedValueEvidence = JSON.stringify(decision);
  const snapshot = createLeaderboardSnapshot(input);
  expect(JSON.stringify(decision)).toBe(retainedValueEvidence);
  return snapshot;
}

const jointMerges = (snapshot: ReturnType<typeof createLeaderboardSnapshot>) =>
  snapshot.ledger
    .filter(
      (event) =>
        event.category === "merged-pull-request" &&
        event.source.id === "PR_november",
    )
    .map((event) => [event.workUnitId, event.actor.id, event.scoreThirds]);

test("a joint unit with only bot-authored claims scores nobody and keeps the other units", () => {
  expect(jointMerges(snapshotWithJointUnits([]))).toEqual([
    ["wu_human", PENALIZED_AUTHOR.id, 1],
  ]);
});

test("a joint unit with a verified implementation actor still scores", () => {
  expect(
    jointMerges(snapshotWithJointUnits([PENALIZED_AUTHOR.id])).sort(),
  ).toEqual([
    ["wu_dependency_bot", PENALIZED_AUTHOR.id, 1],
    ["wu_human", PENALIZED_AUTHOR.id, 1],
  ]);
});

test("a joint unit keeps its value and splits it by each author's claimed lines", () => {
  expect(
    jointMerges(snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10])),
  ).toEqual([
    ["wu_shared", PENALIZED_AUTHOR.id, 21.6],
    ["wu_shared", PROJECT_OWNER.id, 2.4],
  ]);
});

test("a renamed file's old and new path claims split by its changed lines once", () => {
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
    renamedHumanFile: true,
  });
  expect(jointMerges(snapshot)).toEqual([
    ["wu_shared", PENALIZED_AUTHOR.id, 21.6],
    ["wu_shared", PROJECT_OWNER.id, 2.4],
  ]);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === "PR_november",
    ),
  ).toMatchObject({ status: "assessed" });
});

test("a shared joint unit with missing line evidence holds its sources", () => {
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, undefined]);
  expect(jointMerges(snapshot)).toEqual([]);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === "PR_november",
    ),
  ).toMatchObject({ status: "incomplete", recordDigest: null });
});

test("cross-branch primary authors replace historical carrier recipients without rewriting valuation", () => {
  expect(
    jointMerges(
      snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
        historicalCarrier: true,
      }),
    ),
  ).toEqual([
    ["wu_shared", PENALIZED_AUTHOR.id, 21.6],
    ["wu_shared", PROJECT_OWNER.id, 2.4],
  ]);
});

test("a historical claim with a missing source commit cannot reuse its carrier as recipient", () => {
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
    historicalCarrier: true,
    missingCommit: true,
  });
  expect(jointMerges(snapshot)).toEqual([]);
  expect(
    snapshot.valueAssessmentCoverage?.find(
      (item) => item.pullRequestId === "PR_november",
    ),
  ).toMatchObject({ status: "incomplete", recordDigest: null });
});

test("a source absorbed into another PR's joint unit retains the value decision on its zero award", () => {
  const before = createLeaderboardSnapshot(penaltyScoreInput([], GENERATED_AT));
  const original = before.ledger.find(
    (event) => event.source.id === "PR_november",
  );
  if (!original) throw new Error("original award missing");
  const empty: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const journal = appendPointAwards(
    empty,
    [awardForScore(original)],
    "a".repeat(64),
    before.ruleVersion,
    GENERATED_AT,
  );
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
    completionInOtherPR: true,
  });
  assertLeaderboardSnapshot(snapshot);
  const result = applyPointsSnapshot(
    journal,
    snapshot,
    "b".repeat(64),
    GENERATED_AT,
  );
  expect(
    applyPointsSnapshot(journal, snapshot, "b".repeat(64), GENERATED_AT, {
      preserveHeldImplementation: true,
    }),
  ).toEqual(result);
  const removed = latestPoints(result).get(awardForScore(original).key);
  expect(removed?.award.amount).toBe(0);
  expect(removed?.decision?.sourceId).toBe(`value:${"d".repeat(64)}`);
  expect(removed?.decision?.reason).toContain("superseded");
  expect(
    [...latestPoints(result).values()]
      .filter((row) => row.award.workUnitId === `wu_${"c".repeat(64)}`)
      .reduce((sum, row) => sum + row.award.amount, 0),
  ).toBe(240);
  expect(
    applyPointsSnapshot(result, snapshot, "c".repeat(64), GENERATED_AT)
      .revisions,
  ).toEqual(result.revisions);
  for (const status of ["missing", "stale", "incomplete"] as const) {
    const held = structuredClone(snapshot);
    const coverage = held.valueAssessmentCoverage?.find(
      (row) => row.pullRequestId === original.source.id,
    );
    if (!coverage) throw new Error("source coverage missing");
    coverage.status = status;
    coverage.recordDigest = null;
    const retained = applyPointsSnapshot(
      journal,
      held,
      "e".repeat(64),
      GENERATED_AT,
    );
    expect(latestPoints(retained).get(awardForScore(original).key)).toEqual(
      latestPoints(journal).get(awardForScore(original).key),
    );
  }
  const unrelated = structuredClone(snapshot);
  const coverage = unrelated.valueAssessmentCoverage?.find(
    (row) => row.pullRequestId === original.source.id,
  );
  if (!coverage) throw new Error("source coverage missing");
  coverage.recordDigest = "f".repeat(64);
  const withoutBinding = applyPointsSnapshot(
    journal,
    unrelated,
    "e".repeat(64),
    GENERATED_AT,
  );
  expect(
    latestPoints(withoutBinding).get(awardForScore(original).key)?.decision,
  ).toBeUndefined();
});

test("the snapshot publishes exact unit memberships from hash-pinned stale history", async () => {
  const input = penaltyScoreInput([], GENERATED_AT);
  const repository = findRegisteredRepositoryById("SlopDotCash/asi");
  const collected = input.source.repositories.find(
    (row) => row.id === repository?.id,
  );
  if (!repository || !collected) throw new Error("Fixture repository missing");
  collected.repositoryId = repository.expectedNodeId ?? collected.repositoryId;
  const sources = input.mergedPullRequestOutcomes.map((pull) => {
    if (!pull.headRefOid || !pull.mergedAt)
      throw new Error("Fixture source acceptance missing");
    return {
      repository: repository.id,
      repositoryNodeId: collected.repositoryId,
      repositoryDatabaseId: 42,
      pullRequestNodeId: pull.id,
      pullRequestNumber: pull.number,
      headSha: pull.headRefOid,
      mergeSha: pull.headRefOid,
      occurredAt: pull.mergedAt,
      policySha: "0".repeat(40),
      sourceDigest: sha256Hex(pull.id),
    };
  });
  const claims: WorkUnitRecord["claims"] = sources.map((source) => ({
    id: sha256Hex(source.pullRequestNodeId),
    repositoryNodeId: source.repositoryNodeId,
    commitSha: source.headSha,
    path: "src/fix.ts",
    carrierPullRequestIds: [source.pullRequestNodeId],
    creditPullRequestId: source.pullRequestNodeId,
    implementationActorNodeIds: [PENALIZED_AUTHOR.id],
  }));
  const evidence = "Complete fixture claim scope.";
  const assessment: ValueAssessment = {
    status: "assessed",
    tier: "micro",
    rationale: evidence,
    dimensions: {
      alignment: evidence,
      impact: evidence,
      complexity: evidence,
      verification: evidence,
      maintenance: evidence,
      overlap: evidence,
    },
    evidenceUrls: [input.mergedPullRequests[0].url],
    relatedPullRequests: [],
    limitations: [],
    reviews: [],
  };
  const units = await Promise.all(
    [["PR_november", "PR_owner"], ["PR_october"]].map(async (members) => {
      const unit = { claimIds: members.map(sha256Hex).sort(), assessment };
      return { ...unit, workUnitId: await workUnitIdentity(unit) };
    }),
  );
  const record: WorkUnitRecord = {
    schemaVersion: "slop-work-unit-record:v1",
    projectId: repository.projectId,
    sourceDigest: sha256Hex(JSON.stringify(sources)),
    sources,
    claims,
    units,
    rubricVersion: VALUE_RUBRIC_VERSION,
    producerRevision: "1".repeat(40),
    assessedAt: GENERATED_AT,
    supersedes: [],
    legacyPredecessors: [],
    revisionReason: null,
    model: {
      provider: "surplus",
      requested: "gpt-6.1-sol",
      reported: "gpt-6.1-sol",
    },
  };
  const recordJson = JSON.stringify(record);
  const recordDigest = sha256Hex(recordJson);
  const row = {
    sequence: 1,
    record_digest: recordDigest,
    record_json: recordJson,
    recorded_at: GENERATED_AT,
  };
  const carrierClaim = claims.find(
    (claim) => claim.creditPullRequestId === "PR_november",
  );
  if (!carrierClaim) throw new Error("Fixture carrier claim missing");
  const newClaim = {
    ...carrierClaim,
    id: sha256Hex("additional-implementation-claim"),
    path: "src/second-fix.ts",
  };
  const successorUnit = {
    ...units[0],
    claimIds: [...units[0].claimIds, newClaim.id].sort(),
  };
  successorUnit.workUnitId = await workUnitIdentity(successorUnit);
  const successorJson = JSON.stringify({
    ...record,
    claims: [...claims, newClaim],
    units: [successorUnit, units[1]],
    supersedes: [recordDigest],
  } satisfies WorkUnitRecord);
  const successorDigest = sha256Hex(successorJson);
  const decision = {
    status: "stale" as const,
    history: [
      row,
      {
        ...row,
        sequence: 2,
        record_digest: successorDigest,
        record_json: successorJson,
      },
    ],
    throughSequence: 2,
    latestDigest: successorDigest,
  };
  input.jointValueDecisions = new Map(
    sources.map((source) => [source.pullRequestNodeId, decision]),
  );

  const snapshot = createLeaderboardSnapshot(input);
  assertLeaderboardSnapshot(snapshot);
  const coverage = new Map(
    snapshot.valueAssessmentCoverage?.map((entry) => [
      entry.pullRequestId,
      entry,
    ]),
  );
  const memberships = new Map(
    snapshot.reviewedImplementationUnits?.map(({ pullRequestId, units }) => [
      pullRequestId,
      units,
    ]),
  );
  const shared = memberships.get("PR_november");
  const independent = memberships.get("PR_october");
  if (!shared || !independent)
    throw new Error("Fixture unit membership missing");
  for (const source of ["PR_november", "PR_owner"])
    expect(coverage.get(source)).toMatchObject({
      status: "stale",
      recordDigest: successorDigest,
    });
  const previous = shared.find(
    (member) => member.recordDigest === recordDigest,
  );
  const successor = shared.find(
    (member) => member.recordDigest === successorDigest,
  );
  expect(shared).toEqual(memberships.get("PR_owner") ?? []);
  expect(previous?.workUnitId).toBe(units[0].workUnitId);
  expect(successor?.workUnitId).toBe(successorUnit.workUnitId);
  expect(successor?.workUnitId).not.toBe(previous?.workUnitId);
  expect(successor?.groupId).toBe(previous?.groupId);
  expect(independent.map((member) => member.workUnitId)).toEqual([
    units[1].workUnitId,
    units[1].workUnitId,
  ]);
  expect(independent[0].groupId).toBe(independent[1].groupId);
  expect(shared[0].groupId).not.toBe(independent[0].groupId);
  shared.push(shared[0]);
  expect(() => assertLeaderboardSnapshot(snapshot)).toThrow(
    "unique and consistent",
  );

  row.record_json = JSON.stringify({ ...record, projectId: "eliza" });
  expect(() => createLeaderboardSnapshot(input)).toThrow(
    "record digest does not match",
  );
});

test.each(["stale", "incomplete", "unresolved"] as const)(
  "historical replay retains a joint award with %s coverage and an ordinary minimum on its completion",
  (heldStatus) => {
    const assessed = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
      completionInOtherPR: true,
    });
    assertLeaderboardSnapshot(assessed);
    const held = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
      completionInOtherPR: true,
      heldStatus,
    });
    assertLeaderboardSnapshot(held);
    const joint = assessed.ledger.find(
      (event) =>
        event.category === "merged-pull-request" &&
        event.id.includes(":joint:"),
    );
    if (!joint) throw new Error("assessed joint award missing");
    expect(
      held.valueAssessmentCoverage?.find(
        (row) => row.pullRequestId === joint.source.id,
      ),
    ).toMatchObject({ status: heldStatus, recordDigest: "d".repeat(64) });
    expect(
      held.ledger.some(
        (event) =>
          event.category === "merged-pull-request" &&
          event.source.id === joint.source.id &&
          !event.id.includes(":joint:") &&
          event.scoreDecisionSourceId === undefined,
      ),
    ).toBe(true);
    const empty: PointsJournal = {
      schemaVersion: "1",
      ruleVersion: "slop-points-v1",
      generatedAt: GENERATED_AT,
      coverage: [],
      revisions: [],
    };
    const baseline = applyPointsSnapshot(
      empty,
      assessed,
      "a".repeat(64),
      GENERATED_AT,
    );
    const key = awardForScore(joint).key;
    const earlier = latestPoints(baseline).get(key);
    expect(earlier?.award.amount).toBeGreaterThan(0);
    const rolling = applyPointsSnapshot(
      baseline,
      held,
      "b".repeat(64),
      GENERATED_AT,
    );
    expect(latestPoints(rolling).get(key)?.award.amount).toBe(0);
    const historical = applyPointsSnapshot(
      baseline,
      held,
      "b".repeat(64),
      GENERATED_AT,
      { preserveHeldImplementation: true },
    );
    expect(latestPoints(historical).get(key)).toEqual(earlier);
  },
);

test("a source's earlier joint award retains the value decision on its zero when another PR's joint unit absorbs the source", () => {
  const before = createLeaderboardSnapshot(penaltyScoreInput([], GENERATED_AT));
  const original = before.ledger.find(
    (event) => event.source.id === "PR_november",
  );
  if (!original) throw new Error("original award missing");
  // The source first completed its own joint unit, so its award key names
  // that unit instead of being the ordinary source key.
  const ordinary = awardForScore(original);
  const earlierUnit = `wu_${"e".repeat(64)}`;
  const earlierJoint = {
    ...ordinary,
    key: pointKey(
      ordinary.projectId,
      ordinary.actor.id,
      ordinary.category,
      ordinary.sourceId,
      earlierUnit,
    ),
    workUnitId: earlierUnit,
  };
  const empty: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const journal = appendPointAwards(
    empty,
    [earlierJoint],
    "a".repeat(64),
    before.ruleVersion,
    GENERATED_AT,
    new Map([
      [
        earlierJoint.key,
        {
          sourceId: `value:${"9".repeat(64)}`,
          effectiveAt: GENERATED_AT,
          reason: "Earlier joint assessment of this source alone.",
        },
      ],
    ]),
  );
  const snapshot = snapshotWithJointUnits([PROJECT_OWNER.id], [90, 10], {
    completionInOtherPR: true,
  });
  assertLeaderboardSnapshot(snapshot);
  const result = applyPointsSnapshot(
    journal,
    snapshot,
    "b".repeat(64),
    GENERATED_AT,
  );
  const removed = latestPoints(result).get(earlierJoint.key);
  expect(removed?.award.amount).toBe(0);
  // A reviewed historical packet can select only value-decided changes, so
  // without this decision the earlier unit's award stays beside the new one.
  expect(removed?.decision?.sourceId).toBe(`value:${"d".repeat(64)}`);
  expect(removed?.decision?.reason).toContain("superseded");
  expect(
    [...latestPoints(result).values()]
      .filter((row) => row.award.workUnitId === `wu_${"c".repeat(64)}`)
      .reduce((sum, row) => sum + row.award.amount, 0),
  ).toBe(240);
  expect(
    applyPointsSnapshot(result, snapshot, "c".repeat(64), GENERATED_AT)
      .revisions,
  ).toEqual(result.revisions);
  const unrelated = structuredClone(snapshot);
  const coverage = unrelated.valueAssessmentCoverage?.find(
    (row) => row.pullRequestId === original.source.id,
  );
  if (!coverage) throw new Error("source coverage missing");
  coverage.recordDigest = "f".repeat(64);
  expect(
    latestPoints(
      applyPointsSnapshot(journal, unrelated, "e".repeat(64), GENERATED_AT),
    ).get(earlierJoint.key)?.decision?.sourceId,
  ).not.toBe(`value:${"d".repeat(64)}`);
});

// One joint unit over two pull requests by two authors. Each claim is carried
// by its own pull request only. A maintainer can ratify the first one.
const SECOND_CLAIM = "c".repeat(64);
const THIRD_CLAIM = "f".repeat(64);
const MAINTAINER = {
  ...PROJECT_OWNER,
  id: "MDQ6VXNlcjQ0",
  login: "maintainer",
  url: "https://github.com/maintainer",
};
const CO_AUTHOR = {
  ...PROJECT_OWNER,
  id: "MDQ6VXNlcjQ1",
  login: "co-author",
  url: "https://github.com/co-author",
};
function ratifiedSiblingSnapshot(
  ratifyFirst: boolean,
  // How the census describes the second pull request's commits. The last two
  // also add a third pull request whose claim is a second unit of the group.
  second: "one-author" | "sync-only" | "two-authors" = "one-author",
  previousSquashes = false,
) {
  const input = penaltyScoreInput([], GENERATED_AT);
  if (previousSquashes) {
    input.previousAcceptedOrdinaryOwners = new Map(
      input.mergedPullRequestOutcomes
        .filter(({ id }) => id === "PR_november" || id === "PR_owner")
        .flatMap(({ commits }) =>
          (commits ?? []).map(({ oid }) => [
            `slopdotcash/asi\0${oid}`,
            "PR_earlier_accepted",
          ]),
        ),
    );
  }
  for (const outcome of input.mergedPullRequestOutcomes) {
    outcome.commits =
      outcome.commits?.map((commit) => ({
        ...commit,
        parentCount: 1,
        additions: 1,
        deletions: 0,
      })) ?? null;
  }
  const pulls = ["PR_november", "PR_owner"].map((id) => {
    const pull = input.mergedPullRequests.find((record) => record.id === id);
    if (!pull) throw new Error("fixture pull request missing");
    return pull;
  });
  const authors = [PENALIZED_AUTHOR, PROJECT_OWNER];
  const claimIds = [HUMAN_CLAIM, SECOND_CLAIM];
  const outcome = input.mergedPullRequestOutcomes.find(
    (record) => record.id === "PR_owner",
  );
  if (!outcome) throw new Error("fixture outcome missing");
  if (second === "sync-only")
    outcome.commits = [
      { oid: pulls[1].headRefOid, author: PROJECT_OWNER, parentCount: 2 },
    ];
  if (second === "two-authors")
    // No collected parent counts: the line weights are unavailable.
    outcome.commits = [
      { oid: pulls[1].headRefOid, author: PROJECT_OWNER },
      { oid: "e".repeat(40), author: CO_AUTHOR },
    ];
  if (second !== "one-author") {
    const third = {
      ...structuredClone(pulls[0]),
      id: "PR_third",
      number: 11,
      url: pulls[0].url.replace(/\d+$/u, "11"),
      headRefOid: "1".repeat(40),
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-14T00:00:00.000Z",
      mergedAt: "2026-11-14T00:00:00.000Z",
      closedAt: "2026-11-14T00:00:00.000Z",
    };
    input.mergedPullRequests.push(third);
    input.mergedPullRequestOutcomes.push({
      ...structuredClone(outcome),
      id: third.id,
      number: third.number,
      url: third.url,
      createdAt: third.createdAt,
      updatedAt: third.updatedAt,
      mergedAt: third.mergedAt,
      headRefOid: third.headRefOid,
      author: third.author,
      commits: [{ oid: third.headRefOid, author: third.author }],
    });
    input.detailEligibleMergedPullRequestIds?.push(third.id);
    input.source.counts.mergedPullRequests += 1;
    input.source.counts.detailedMergedPullRequests += 1;
    input.sourceUpdatedAt = third.closedAt;
    pulls.push(third);
    authors.push(PENALIZED_AUTHOR);
    claimIds.push(THIRD_CLAIM);
  }
  input.valueActors = new Map(authors.map((actor) => [actor.id, actor]));
  if (ratifyFirst)
    pulls[0].comments.push({
      id: "IC_ratification",
      artifactId: pulls[0].id,
      kind: "comment",
      url: `${pulls[0].url}#issuecomment-1`,
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:00.000Z",
      author: MAINTAINER,
      authorAssociation: "MEMBER",
      body: `\`\`\`slop-score\n${JSON.stringify({
        schemaVersion: "1",
        ruleVersion: "slop-score-v2",
        projectId: "asi",
        pullRequestNodeId: pulls[0].id,
        headSha: pulls[0].headRefOid,
        workUnitId: "wu_ratified_fix",
        tier: "micro",
        scoreThirds: 1,
        proposalReviewNodeIds: [],
        coRatifierNodeIds: [],
        reason: "Maintainer correction of the first pull request only.",
        supersedes: null,
      })}\n\`\`\``,
    });
  const unit = (id: string, unitClaimIds: string[], tier: string) => ({
    workUnitId: `wu_${id}`,
    claimIds: unitClaimIds,
    assessment: {
      status: "assessed",
      tier,
      rationale: "Fixture shared unit.",
      reviews: [],
    },
  });
  const decision = {
    status: "assessed",
    latestDigest: "d".repeat(64),
    history: [{ recorded_at: "2026-11-14T01:00:00.000Z" }],
    record: {
      sources: pulls.map((pull) => ({
        pullRequestNodeId: pull.id,
        headSha: pull.headRefOid,
      })),
      units: [
        unit(SECOND_CLAIM, claimIds.slice(0, 2), "large"),
        ...(claimIds.length > 2
          ? [unit(THIRD_CLAIM, claimIds.slice(2), "micro")]
          : []),
      ],
    },
    evidence: {
      claims: pulls.map((pull, index) => ({
        id: claimIds[index],
        commitSha: claimIds[index].slice(0, 40),
        path: `src/${claimIds[index][0]}.ts`,
        carrierPullRequestIds: [pull.id],
        creditPullRequestId: pull.id,
        implementationActorNodeIds: [authors[index].id],
      })),
      sources: pulls.map((pull, index) => ({
        evidence: {
          repository: "SlopDotCash/asi",
          pull: {
            node_id: pull.id,
            number: pull.number,
            title: pull.title,
            html_url: pull.url,
            head: { sha: pull.headRefOid },
            updated_at: pull.updatedAt,
            merged_at: pull.mergedAt,
            closed_at: pull.closedAt,
            user: { node_id: authors[index].id, type: "User" },
            base: { ref: "release" },
          },
          comments: [],
          reviews: [],
          commitAttribution: [
            {
              sha: claimIds[index].slice(0, 40),
              limitations: [],
              files: [
                {
                  filename: `src/${claimIds[index][0]}.ts`,
                  status: "modified",
                  additions: 10,
                  deletions: 0,
                },
              ],
            },
          ],
        },
      })),
    },
  };
  input.jointValueDecisions = new Map(
    pulls.map((pull) => [pull.id, decision as never]),
  );
  const snapshot = createLeaderboardSnapshot(input);
  assertLeaderboardSnapshot(snapshot);
  return snapshot;
}
const novemberMerges = (
  snapshot: ReturnType<typeof createLeaderboardSnapshot>,
) =>
  snapshot.ledger
    .filter(
      (event) =>
        event.category === "merged-pull-request" &&
        event.occurredAt >= "2026-11-01",
    )
    .map((event) => [event.source.id, event.actor.id, event.scoreThirds])
    .sort();
/** The second author's Points for that merge after the snapshot is applied. */
function secondAuthorPointsAfter(
  snapshot: ReturnType<typeof createLeaderboardSnapshot>,
) {
  const before = createLeaderboardSnapshot(penaltyScoreInput([], GENERATED_AT));
  const original = before.ledger.find(
    (event) => event.source.id === "PR_owner",
  );
  if (!original) throw new Error("original award missing");
  const journal = appendPointAwards(
    {
      schemaVersion: "1",
      ruleVersion: "slop-points-v1",
      generatedAt: GENERATED_AT,
      coverage: [],
      revisions: [],
    },
    [awardForScore(original)],
    "a".repeat(64),
    before.ruleVersion,
    GENERATED_AT,
  );
  expect(
    latestPoints(journal).get(awardForScore(original).key)?.award.amount,
  ).toBe(10);
  return latestPoints(
    applyPointsSnapshot(journal, snapshot, "b".repeat(64), GENERATED_AT),
  ).get(awardForScore(original).key)?.award.amount;
}

test("a maintainer ratification of one joint member leaves the other member its merge minimum", () => {
  // Unratified, the unit scores once and splits by claimed lines.
  expect(novemberMerges(ratifiedSiblingSnapshot(false))).toEqual([
    ["PR_owner", PENALIZED_AUTHOR.id, 12],
    ["PR_owner", PROJECT_OWNER.id, 12],
  ]);
  // The ratification re-scores the first pull request and withholds the
  // unit. The second author's own accepted merge keeps the minimum.
  const ratified = ratifiedSiblingSnapshot(true);
  expect(novemberMerges(ratified)).toEqual([
    ["PR_november", PENALIZED_AUTHOR.id, 1],
    ["PR_owner", PROJECT_OWNER.id, 1],
  ]);
  // Points the second author already holds for that merge are not zeroed.
  expect(secondAuthorPointsAfter(ratified)).toBe(10);
  expect(ratifiedSiblingSnapshot(true, "one-author", true)).toEqual(ratified);
  expect(ratifiedSiblingSnapshot(false, "one-author", true)).toEqual(
    ratifiedSiblingSnapshot(false),
  );
});

// Without proof of who implemented it, the per-pull-request path holds a
// merge: its Points stay as they are and nothing new is awarded. A withheld
// member is held the same way, and the hold does not stop the other unit.
for (const [second, name] of [
  ["sync-only", "made only of synchronization merges"],
  ["two-authors", "without line evidence for its two authors"],
] as const)
  test(`a withheld joint member ${name} holds its Points and the group's other unit still scores`, () => {
    expect(novemberMerges(ratifiedSiblingSnapshot(false, second))).toEqual([
      ["PR_owner", PENALIZED_AUTHOR.id, 12],
      ["PR_owner", PROJECT_OWNER.id, 12],
      ["PR_third", PENALIZED_AUTHOR.id, 1],
    ]);
    const ratified = ratifiedSiblingSnapshot(true, second);
    expect(novemberMerges(ratified)).toEqual([
      ["PR_november", PENALIZED_AUTHOR.id, 1],
      ["PR_third", PENALIZED_AUTHOR.id, 1],
    ]);
    expect(
      ratified.valueAssessmentCoverage?.find(
        (row) => row.pullRequestId === "PR_owner",
      ),
    ).toMatchObject({ status: "incomplete", recordDigest: null });
    expect(secondAuthorPointsAfter(ratified)).toBe(10);
  });
