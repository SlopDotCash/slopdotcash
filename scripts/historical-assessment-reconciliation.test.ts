import { expect, test } from "bun:test";
import { canonicalJson } from "../src/lib/canonical-json";
import { sha256Hex } from "../src/lib/sha256";
import { VALUE_RUBRIC_VERSION } from "../src/lib/value-assessment";
import type {
  HistoricalAssessmentCatalog,
  JointAssessmentCatalogRow,
  LegacyAssessmentCatalogRow,
} from "./historical-assessment-catalog";
import {
  classifyHistoricalAssessmentScope,
  type HistoricalContextGitHub,
} from "./historical-assessment-reconciliation";
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
  sources: (typeof member)[],
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
