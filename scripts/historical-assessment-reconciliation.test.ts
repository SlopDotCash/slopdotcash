import { expect, test } from "bun:test";
import { canonicalJson } from "../src/lib/canonical-json";
import { REGISTERED_REPOSITORIES } from "../src/lib/repositories.mjs";
import { sha256Hex } from "../src/lib/sha256";
import {
  VALUE_RUBRIC_VERSION,
  type ValueTier,
} from "../src/lib/value-assessment";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import type { WorkUnitRecord } from "../workers/slopbot/value-work-unit-journal";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";
import type {
  HistoricalAssessmentCatalog,
  JointAssessmentCatalogRow,
  LegacyAssessmentCatalogRow,
} from "./historical-assessment-catalog";
import {
  classifyHistoricalAssessmentScope,
  type HistoricalContextGitHub,
  historicalClosedContextBindings,
} from "./historical-assessment-reconciliation";
import { rebindHistoricalStandaloneReview } from "./historical-closed-review-source";
import type { HistoricalPointsPacket } from "./reviewed-historical-points";

const projectId = "eliza";
const sourceTime = "2026-10-18T15:00:00.000Z";
const recordedAt = "2026-11-10T00:00:00.000Z";
const audit: HistoricalPointsPacket["sourceAudit"] = {
  repository: "elizaOS/eliza",
  repositoryNodeId: "R_example",
  from: "2026-09-27T00:00:00.000Z",
  through: "2026-11-01T00:00:00.000Z",
  sources: [
    {
      id: "PR_audited",
      number: 9,
      headSha: "a".repeat(40),
      mergedAt: sourceTime,
    },
  ],
};
const producer = {
  rubricVersion: VALUE_RUBRIC_VERSION,
  producerRevision: "d".repeat(40),
  model: {
    provider: "surplus",
    reported: "gpt-6.1-sol",
    requested: "gpt-6.1-sol",
  },
  assessedAt: recordedAt,
};
const member = {
  repository: audit.repository,
  repositoryNodeId: audit.repositoryNodeId,
  repositoryDatabaseId: 1,
  pullRequestNodeId: audit.sources[0].id,
  pullRequestNumber: audit.sources[0].number,
  headSha: audit.sources[0].headSha,
  mergeSha: "b".repeat(40),
  occurredAt: sourceTime,
  policySha: "c".repeat(40),
  sourceDigest: "a".repeat(64),
};
const assessment = {
  status: "unresolved",
  rationale: "PRIVATE RAW EXPLANATION",
  reviews: [],
};

function legacy(
  sequence: number,
  source = member,
  supersedes: string | null = null,
): LegacyAssessmentCatalogRow {
  const record_json = JSON.stringify({
    schemaVersion: "slop-value-record:v1",
    projectId,
    ...source,
    ...producer,
    assessment,
    supersedes,
    revisionReason: supersedes ? "PRIVATE REVISION EXPLANATION" : null,
  });
  return {
    sequence,
    recorded_at: recordedAt,
    record_digest: sha256Hex(record_json),
    record_json,
    repository_node_id: source.repositoryNodeId,
    pull_request_node_id: source.pullRequestNodeId,
    head_sha: source.headSha,
    source_digest: source.sourceDigest,
    supersedes,
  };
}

function joint(
  sequence: number,
  sources: WorkUnitRecord["sources"],
  legacyPredecessors: string[] = [],
  supersedes: string[] = [],
): JointAssessmentCatalogRow {
  const source_digest = "b".repeat(64);
  const record_json = JSON.stringify({
    schemaVersion: "slop-work-unit-record:v1",
    projectId,
    sourceDigest: source_digest,
    sources,
    ...producer,
    claims: [],
    units: [],
    supersedes,
    legacyPredecessors,
    revisionReason:
      supersedes.length || legacyPredecessors.length
        ? "PRIVATE JOINT EXPLANATION"
        : null,
  });
  return {
    sequence,
    recorded_at: recordedAt,
    record_digest: sha256Hex(record_json),
    record_json,
    project_id: projectId,
    source_digest,
    source_keys_json: JSON.stringify(
      sources.map((s) => [s.repositoryNodeId, s.pullRequestNodeId]),
    ),
  };
}

function catalog(
  legacy: LegacyAssessmentCatalogRow[] = [],
  joint: JointAssessmentCatalogRow[] = [],
): HistoricalAssessmentCatalog {
  return {
    heads: {
      jointThrough: 14,
      legacyThrough: 7,
      jointScopedCount: joint.length,
      legacyRepoCount: legacy.length,
      d1PointsDigest: "e".repeat(64),
      d1PointsCount: 123,
      enforcementGeneration: 13,
      registryRevision: 2,
      registryManifestSha256: "f".repeat(64),
    },
    legacy,
    joint,
  };
}

test("an integrity-checked empty historical assessment scope has a stable sanitized receipt", async () => {
  const receipt = await classifyHistoricalAssessmentScope(
    catalog(),
    audit,
    projectId,
  );
  expect(receipt.status).toBe("no-scoped-active-assessments");
  expect(receipt.scope.sourceAuditSha256).toBe(
    sha256Hex(JSON.stringify(audit)),
  );
  const { receiptSha256, ...bytes } = receipt;
  expect(receiptSha256).toBe(sha256Hex(canonicalJson(bytes)));
  const partial = catalog();
  partial.heads.legacyRepoCount = 1;
  expect(
    await classifyHistoricalAssessmentScope(partial, audit, projectId),
  ).toMatchObject({
    status: "incomplete",
    blockers: ["incomplete-catalog"],
  });
});

test("only active records survive ancestry and a verified migration, including cross-window joint members", async () => {
  const original = legacy(2);
  const first = joint(4, [member], [original.record_digest]);
  const second = joint(
    8,
    [
      { ...member, headSha: "1".repeat(40) },
      {
        ...member,
        pullRequestNodeId: "PR_recent",
        pullRequestNumber: 10,
        occurredAt: audit.through,
      },
    ],
    [original.record_digest],
    [first.record_digest],
  );
  const receipt = await classifyHistoricalAssessmentScope(
    catalog([original], [first, second]),
    audit,
    projectId,
  );
  expect(receipt.status).toBe("requires-value-replay");
  expect(receipt.counts).toMatchObject({
    activeLegacyRecords: 0,
    activeJointRecords: 1,
    relevantRecords: 1,
  });
  expect(receipt.records).toEqual([
    {
      journal: "joint",
      digest: second.record_digest,
      sequence: 8,
      sources: [
        {
          id: member.pullRequestNodeId,
          number: 9,
          headSha: "1".repeat(40),
          auditedHeadSha: member.headSha,
          occurredAt: sourceTime,
          finding: "stale-head",
        },
        {
          id: "PR_recent",
          number: 10,
          headSha: member.headSha,
          auditedHeadSha: null,
          occurredAt: audit.through,
          finding: "outside-audit",
        },
      ],
    },
  ]);
  expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
  const omitted = joint(8, [member], [], [first.record_digest]);
  expect(
    await classifyHistoricalAssessmentScope(
      catalog([original], [first, omitted]),
      audit,
      projectId,
    ),
  ).toMatchObject({
    status: "incomplete",
    blockers: ["invalid-joint-history"],
  });
  expect(
    await classifyHistoricalAssessmentScope(
      catalog([original], [second]),
      audit,
      projectId,
    ),
  ).toMatchObject({
    status: "incomplete",
    blockers: ["invalid-joint-history"],
  });
});

test("an active in-period record without exact audited identity never says empty", async () => {
  for (const [number, finding] of [
    [9, "conflicting-audit-binding"],
    [10, "missing-from-merged-audit"],
  ] as const) {
    const decision = legacy(1, {
      ...member,
      pullRequestNodeId: "PR_other",
      pullRequestNumber: number,
    });
    const receipt = await classifyHistoricalAssessmentScope(
      catalog([decision]),
      audit,
      projectId,
    );
    expect(receipt.status).toBe("incomplete");
    expect(receipt.blockers).toEqual([finding]);
    expect(receipt.records[0].sources[0].finding).toBe(finding);
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
  }
});

test("closed joint context requires an audited merge anchor and matching GitHub lifecycle proofs", async () => {
  const context = {
    ...member,
    pullRequestNodeId: "PR_context",
    pullRequestNumber: 10,
  };
  const observed = {
    __typename: "PullRequest",
    id: context.pullRequestNodeId,
    number: context.pullRequestNumber,
    state: "CLOSED",
    closed: true,
    merged: false,
    mergedAt: null,
    mergeCommit: null,
    closedAt: sourceTime,
    headRefOid: context.headSha,
    repository: {
      id: audit.repositoryNodeId,
      databaseId: context.repositoryDatabaseId,
      isPrivate: false,
      nameWithOwner: audit.repository,
    },
  };
  const rest = {
    number: context.pullRequestNumber,
    node_id: context.pullRequestNodeId,
    state: "closed",
    merged: false,
    merged_at: null,
    merge_commit_sha: context.mergeSha,
    closed_at: sourceTime,
    head: { sha: context.headSha },
    base: {
      repo: {
        node_id: audit.repositoryNodeId,
        id: context.repositoryDatabaseId,
        private: false,
      },
    },
  };
  const github = (
    node: unknown = observed,
    pull: unknown = rest,
  ): HistoricalContextGitHub => ({
    async graphql<T>(_query: string, variables: Record<string, unknown>) {
      expect(variables.ids).toEqual([context.pullRequestNodeId]);
      return { nodes: [node] } as T;
    },
    async get<T>(path: string) {
      expect(path).toBe("/repos/elizaOS/eliza/pulls/10");
      return pull as T;
    },
  });
  const combined = catalog([], [joint(1, [member, context])]);
  const receipt = await classifyHistoricalAssessmentScope(
    combined,
    audit,
    projectId,
    github(),
  );
  expect(receipt.status).toBe("requires-value-replay");
  expect(receipt.counts.auditedSources).toBe(1);
  expect(receipt.records[0].sources.map(({ finding }) => finding)).toEqual([
    "audited-head",
    "verified-closed-context",
  ]);
  for (const check of [
    github(null),
    github({ ...observed, state: "MERGED", merged: true }),
    github({ ...observed, closedAt: "2026-10-19T15:00:00.000Z" }),
    github(observed, null),
    github(observed, { ...rest, merge_commit_sha: "0".repeat(40) }),
    github(observed, { ...rest, merged: true }),
  ]) {
    expect(
      await classifyHistoricalAssessmentScope(
        combined,
        audit,
        projectId,
        check,
      ),
    ).toMatchObject({
      status: "incomplete",
      blockers: ["missing-from-merged-audit"],
    });
  }
  expect(
    await classifyHistoricalAssessmentScope(
      catalog([], [joint(1, [context])]),
      audit,
      projectId,
      github(),
    ),
  ).toMatchObject({
    status: "incomplete",
    blockers: ["missing-from-merged-audit"],
  });
});

test("standalone closure needs one exact review-only joint source and independent lifecycle reads", async () => {
  const source = {
    ...member,
    pullRequestNodeId: "PR_closed_review",
    pullRequestNumber: 10,
    mergeSha: null,
  };
  const reviewId = "PRR_review";
  const unit = {
    claimIds: [],
    workUnitId: `wu_${sha256Hex(JSON.stringify(["reviews", [reviewId]]))}`,
    assessment: {
      ...assessment,
      status: "assessed",
      tier: null as ValueTier | null,
      reviews: [{ sourceId: reviewId, tier: "triage" }],
    },
  };
  function reviewRecord(sources = [source], units = [unit]) {
    const base = joint(1, sources);
    const record_json = JSON.stringify({
      ...JSON.parse(base.record_json),
      units,
    });
    return { ...base, record_json, record_digest: sha256Hex(record_json) };
  }
  const observed = {
    __typename: "PullRequest",
    id: source.pullRequestNodeId,
    number: source.pullRequestNumber,
    state: "CLOSED",
    closed: true,
    merged: false,
    mergedAt: null,
    mergeCommit: null,
    closedAt: sourceTime,
    headRefOid: source.headSha,
    repository: {
      id: audit.repositoryNodeId,
      databaseId: source.repositoryDatabaseId,
      isPrivate: false,
      nameWithOwner: audit.repository,
    },
  };
  const rest = {
    number: source.pullRequestNumber,
    node_id: source.pullRequestNodeId,
    state: "closed",
    merged: false,
    merged_at: null,
    merge_commit_sha: null,
    closed_at: sourceTime,
    head: { sha: source.headSha },
    base: {
      repo: {
        node_id: audit.repositoryNodeId,
        id: source.repositoryDatabaseId,
        private: false,
      },
    },
  };
  let reads = 0;
  function github(
    node: unknown = observed,
    pull: unknown = rest,
  ): HistoricalContextGitHub {
    return {
      async graphql<T>(_query: string, variables: Record<string, unknown>) {
        expect(variables.ids).toEqual([source.pullRequestNodeId]);
        reads++;
        return { nodes: [node] } as T;
      },
      async get<T>(path: string) {
        expect(path).toBe("/repos/elizaOS/eliza/pulls/10");
        reads++;
        return pull as T;
      },
    };
  }
  const candidate = reviewRecord();
  const verified = await classifyHistoricalAssessmentScope(
    catalog([], [candidate]),
    audit,
    projectId,
    github(),
  );
  expect(reads).toBe(2);
  expect(verified.status).toBe("requires-value-replay");
  expect(verified.counts.auditedSources).toBe(1);
  expect(verified.records[0].sources[0].finding).toBe(
    "verified-standalone-closed-review",
  );
  expect(
    historicalClosedContextBindings(verified).get(source.pullRequestNodeId),
  ).toMatchObject({
    digest: candidate.record_digest,
    standaloneReview: true,
  });
  for (const check of [
    github({ ...observed, headRefOid: "f".repeat(40) }),
    github({ ...observed, merged: true }),
    github({ ...observed, closedAt: "2026-10-19T15:00:00.000Z" }),
    github(observed, null),
    github(observed, { ...rest, merged_at: sourceTime }),
  ]) {
    expect(
      await classifyHistoricalAssessmentScope(
        catalog([], [candidate]),
        audit,
        projectId,
        check,
      ),
    ).toMatchObject({
      status: "incomplete",
      blockers: ["missing-from-merged-audit"],
    });
  }
  for (const refused of [
    reviewRecord(
      [source],
      [{ ...unit, assessment: { ...unit.assessment, tier: "small" } }],
    ),
    reviewRecord([
      source,
      {
        ...source,
        pullRequestNodeId: "PR_other_closed",
        pullRequestNumber: 11,
      },
    ]),
  ]) {
    reads = 0;
    expect(
      await classifyHistoricalAssessmentScope(
        catalog([], [refused]),
        audit,
        projectId,
        github(),
      ),
    ).toMatchObject({
      status: "incomplete",
      blockers: ["missing-from-merged-audit"],
    });
    expect(reads).toBe(0);
  }
});

test("standalone replay subtracts only one strictly later verified public reference and binds both digests", async () => {
  const repository = REGISTERED_REPOSITORIES.find(
    (repo) => repo.projectId === projectId,
  );
  if (!repository) throw Error("Expected fixture repository");
  const repositoryNodeId = repository.expectedNodeId ?? audit.repositoryNodeId;
  const policy = { sha: member.policySha, text: "Review policy" };
  const url = `https://github.com/${repository.id}/pull/10`;
  const reference = {
    repository: repository.id,
    id: "PR_later",
    number: 11,
    url: `https://github.com/${repository.id}/pull/11`,
  };
  const earlier: WorkUnitSource = {
    policy,
    evidence: {
      repository: repository.id,
      repositoryNodeId,
      repositoryDatabaseId: member.repositoryDatabaseId,
      repositoryPolicy: repository,
      collectedAt: recordedAt,
      pull: {
        node_id: "PR_closed_review",
        number: 10,
        html_url: url,
        title: "One source",
        body: null,
        user: { node_id: "MDQ6VXNlcjE=", login: "one", type: "User" },
        state: "closed",
        merged_at: null,
        closed_at: sourceTime,
        merge_commit_sha: null,
        updated_at: sourceTime,
        merged_by: null,
        head: { sha: member.headSha },
        base: { sha: policy.sha, ref: repository.integrationBranch },
        changed_files: 0,
        comments: 0,
        review_comments: 0,
        commits: 0,
      },
      files: [],
      mergeCommitEvidence: null,
      commits: [],
      reviews: [],
      comments: [],
      reviewComments: [],
      limitations: [],
      evidenceUrls: [url],
      eligibleReviewIds: [],
      implementationActorNodeIds: [],
      commitAttribution: [],
      relatedPullRequests: [],
    },
  };
  const prepared = await prepareWorkUnitEvidence(
    [earlier],
    REGISTERED_REPOSITORIES,
  );
  const row = {
    ...producer,
    sources: [
      {
        ...member,
        repository: repository.id,
        repositoryNodeId,
        pullRequestNodeId: earlier.evidence.pull.node_id,
        pullRequestNumber: 10,
        mergeSha: null,
        sourceDigest: prepared.sourceDigests[0].digest,
      },
    ],
    units: [
      {
        claimIds: [],
        assessment: {
          status: "assessed",
          tier: null,
          reviews: [{ sourceId: "PRR_review" }],
        },
      },
    ],
    claims: [],
    sourceDigest: prepared.sourceDigest,
  } as unknown as WorkUnitRecord;
  const current = {
    ...earlier,
    evidence: {
      ...earlier.evidence,
      relatedPullRequests: [reference],
      evidenceUrls: [url, reference.url],
    },
  };
  const observed = {
    __typename: "PullRequest",
    id: reference.id,
    number: reference.number,
    url: reference.url,
    createdAt: "2026-11-11T00:00:00Z",
    repository: {
      id: repositoryNodeId,
      databaseId: member.repositoryDatabaseId,
      isPrivate: false,
      nameWithOwner: repository.id,
    },
  };
  const github = (node = observed) => ({
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      expect(query).toContain("createdAt");
      expect(variables).toEqual({ id: reference.id });
      return { node } as T;
    },
  });
  await expect(
    rebindHistoricalStandaloneReview(current, row, github()),
  ).resolves.toEqual(earlier);
  for (const wrong of [
    { ...observed, id: "PR_other" },
    { ...observed, createdAt: recordedAt },
    { ...observed, repository: { ...observed.repository, isPrivate: true } },
  ]) {
    await expect(
      rebindHistoricalStandaloneReview(current, row, github(wrong)),
    ).resolves.toBe(current);
  }
  for (const wrong of [
    { ...row, sourceDigest: "0".repeat(64) },
    { ...row, sources: [{ ...row.sources[0], sourceDigest: "0".repeat(64) }] },
  ]) {
    await expect(
      rebindHistoricalStandaloneReview(current, wrong, github()),
    ).resolves.toBe(current);
  }
});

test("a broken raw or indexed predecessor chain never produces a ready receipt", async () => {
  const first = legacy(2);
  const second = legacy(3, member, "e".repeat(64));
  for (const rows of [
    [first, second],
    [{ ...first, record_json: `${first.record_json} ` }],
    [{ ...first, pull_request_node_id: "PR_other" }],
  ]) {
    const receipt = await classifyHistoricalAssessmentScope(
      catalog(rows),
      audit,
      projectId,
    );
    expect(receipt.status).toBe("incomplete");
    expect(receipt.blockers).toEqual(["invalid-legacy-history"]);
  }
});
