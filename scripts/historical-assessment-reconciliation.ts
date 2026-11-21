/** Classify a protected, complete journal read without replaying value or awards. */
import { canonicalJson } from "../src/lib/canonical-json";
import { validRepositoryPath } from "../src/lib/project-contracts";
import { sha256Hex } from "../src/lib/sha256";
import type { GitHubClient } from "../workers/slopbot/github";
import { validValueContextSelections } from "../workers/slopbot/value-context";
import type { ValueJournalRecord } from "../workers/slopbot/value-journal";
import { validMergeRecipe } from "../workers/slopbot/value-merge-profile";
import { isValueProducer } from "../workers/slopbot/value-producer";
import {
  type WorkUnitRecord,
  workUnitIdentity,
} from "../workers/slopbot/value-work-unit-journal";
import {
  type CurrentOwner,
  planOwnershipTransition,
} from "../workers/slopbot/verified-source-ownership";
import { completeClaimPartition } from "../workers/slopbot/verified-work-unit";
import type { HistoricalAssessmentCatalog } from "./historical-assessment-catalog";
import { isStandaloneHistoricalReview } from "./historical-closed-review-source";
import type { HistoricalPointsPacket } from "./reviewed-historical-points";

type SourceAudit = HistoricalPointsPacket["sourceAudit"];
type BoundSource = WorkUnitRecord["sources"][number] | ValueJournalRecord;
type StoredRow =
  | HistoricalAssessmentCatalog["joint"][number]
  | HistoricalAssessmentCatalog["legacy"][number];

type VerifiedClosedFinding =
  | "verified-closed-context"
  | "verified-standalone-closed-review";

export function isHistoricalClosedFinding(
  finding: SourceFinding,
): finding is VerifiedClosedFinding {
  return (
    finding === "verified-closed-context" ||
    finding === "verified-standalone-closed-review"
  );
}

type SourceFinding =
  | "audited-head"
  | "stale-head"
  | VerifiedClosedFinding
  | "conflicting-audit-binding"
  | "missing-from-merged-audit"
  | "outside-audit";

interface ScopedRecord {
  journal: "legacy" | "joint";
  digest: string;
  sequence: number;
  sources: {
    id: string;
    number: number;
    headSha: string;
    auditedHeadSha: string | null;
    occurredAt: string;
    finding: SourceFinding;
  }[];
}

type Blocker =
  | "incomplete-catalog"
  | "invalid-legacy-history"
  | "invalid-joint-history"
  | "conflicting-audit-binding"
  | "missing-from-merged-audit";

type Status =
  | "no-scoped-active-assessments"
  | "requires-value-replay"
  | "incomplete";
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const NODE = /^[A-Za-z0-9_=+/-]{1,256}$/u;
const PROJECT = /^[a-z0-9][a-z0-9-]{0,79}$/u;

function matches(value: unknown, expression: RegExp): value is string {
  return typeof value === "string" && expression.test(value);
}

function time(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value.replace(/(?<!\.\d{3})Z$/u, ".000Z")
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positive(value: unknown): value is number {
  return count(value) && value > 0;
}

function ensure(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid protected assessment journal");
}

function body(
  row: StoredRow,
  after: number,
  through: number,
): Record<string, unknown> {
  ensure(
    positive(row.sequence) &&
      row.sequence > after &&
      row.sequence <= through &&
      time(row.recorded_at) &&
      matches(row.record_digest, DIGEST) &&
      typeof row.record_json === "string" &&
      sha256Hex(row.record_json) === row.record_digest,
  );
  const value = JSON.parse(row.record_json) as unknown;
  ensure(object(value));
  return value;
}

function sourceKey(source: BoundSource) {
  return JSON.stringify([source.repositoryNodeId, source.pullRequestNodeId]);
}

function owner(value: string | undefined): CurrentOwner {
  return value ? { kind: "owned", digest: value } : { kind: "unowned" };
}

function sortedSet(values: string[]): string {
  return JSON.stringify([...new Set(values)].sort());
}

function boundSource(source: BoundSource, audit: SourceAudit): boolean {
  return (
    source != null &&
    typeof source.repository === "string" &&
    source.repository.toLowerCase() === audit.repository.toLowerCase() &&
    source.repositoryNodeId === audit.repositoryNodeId &&
    positive(source.repositoryDatabaseId) &&
    matches(source.pullRequestNodeId, NODE) &&
    positive(source.pullRequestNumber) &&
    matches(source.headSha, SHA) &&
    (source.mergeSha === null || matches(source.mergeSha, SHA)) &&
    matches(source.policySha, SHA) &&
    matches(source.sourceDigest, DIGEST) &&
    time(source.occurredAt) &&
    (source.contextPaths === undefined ||
      validValueContextSelections(source.contextPaths))
  );
}

function jointSourceExtras(source: WorkUnitRecord["sources"][number]): boolean {
  const indirect = source.indirectAcceptance;
  return (
    (source.mergeRecipe === undefined ||
      validMergeRecipe(source.mergeRecipe)) &&
    (indirect === undefined ||
      (indirect !== null &&
        source.mergeSha === null &&
        matches(indirect.historicalHeadSha, SHA) &&
        matches(indirect.integrationSha, SHA) &&
        matches(indirect.acceptedTipSha, SHA) &&
        typeof indirect.branch === "string" &&
        indirect.branch.length > 0 &&
        positive(indirect.observationRunId) &&
        indirect.observedOnBranchAt === source.occurredAt))
  );
}

function recordProducer(
  record: Pick<
    ValueJournalRecord,
    "model" | "producerRevision" | "assessedAt" | "rubricVersion"
  >,
) {
  return (
    isValueProducer(record.model) &&
    matches(record.producerRevision, SHA) &&
    time(record.assessedAt) &&
    matches(record.rubricVersion, /^slop-value-\d{4}-\d{2}-\d{2}$/u)
  );
}

function assessmentEnvelope(value: unknown): boolean {
  return (
    object(value) &&
    (value.status === "assessed" || value.status === "unresolved") &&
    Array.isArray(value.reviews)
  );
}

function legacyHistory(
  catalog: HistoricalAssessmentCatalog,
  audit: SourceAudit,
  projectId: string,
) {
  const current = new Map<
    string,
    {
      row: HistoricalAssessmentCatalog["legacy"][number];
      record: ValueJournalRecord;
    }
  >();
  const seen = new Set<string>();
  let after = 0;
  for (const row of catalog.legacy) {
    const record = body(
      row,
      after,
      catalog.heads.legacyThrough,
    ) as unknown as ValueJournalRecord;
    ensure(
      record.schemaVersion === "slop-value-record:v1" &&
        record.projectId === projectId &&
        boundSource(record, audit) &&
        record.repositoryNodeId === row.repository_node_id &&
        record.pullRequestNodeId === row.pull_request_node_id &&
        record.headSha === row.head_sha &&
        record.sourceDigest === row.source_digest &&
        record.supersedes === row.supersedes &&
        assessmentEnvelope(record.assessment) &&
        recordProducer(record) &&
        !seen.has(row.record_digest),
    );
    const key = sourceKey(record);
    const prior = current.get(key);
    ensure(
      record.supersedes === (prior?.row.record_digest ?? null) &&
        (prior
          ? prior.record.pullRequestNumber === record.pullRequestNumber &&
            prior.record.repositoryDatabaseId === record.repositoryDatabaseId &&
            typeof record.revisionReason === "string" &&
            record.revisionReason.trim()
          : record.revisionReason === null),
    );
    current.set(key, { row, record });
    seen.add(row.record_digest);
    after = row.sequence;
  }
  return current;
}

async function validateUnitIdentities(record: WorkUnitRecord) {
  const available = new Map(
    record.claims.map((claim, index) => [claim.id, index]),
  );
  const units = new Set<string>();
  for (const unit of record.units) {
    ensure(
      unit &&
        Array.isArray(unit.claimIds) &&
        unit.claimIds.every((claim) => matches(claim, DIGEST)) &&
        assessmentEnvelope(unit.assessment) &&
        unit.assessment.reviews.every(
          (review) => review && matches(review.sourceId, NODE),
        ) &&
        (unit.claimIds.length > 0 || unit.assessment.reviews.length > 0) &&
        unit.workUnitId === (await workUnitIdentity(unit)) &&
        !units.has(unit.workUnitId),
    );
    units.add(unit.workUnitId);
  }
  ensure(
    completeClaimPartition(
      available.size,
      record.units
        .filter((unit) => unit.claimIds.length)
        .map((unit) => unit.claimIds.map((id) => available.get(id) ?? -1)),
    ),
  );
}

async function jointHistory(
  catalog: HistoricalAssessmentCatalog,
  audit: SourceAudit,
  projectId: string,
  legacy: ReturnType<typeof legacyHistory>,
) {
  const records: {
    row: HistoricalAssessmentCatalog["joint"][number];
    record: WorkUnitRecord;
  }[] = [];
  const indices = new Map<string, number>();
  const sources = new Map<string, string>();
  const claims = new Map<string, string>();
  const used: boolean[] = [];
  let after = 0;
  for (const row of catalog.joint) {
    const record = body(
      row,
      after,
      catalog.heads.jointThrough,
    ) as unknown as WorkUnitRecord;
    ensure(
      record.schemaVersion === "slop-work-unit-record:v1" &&
        record.projectId === projectId &&
        record.projectId === row.project_id &&
        matches(record.sourceDigest, DIGEST) &&
        record.sourceDigest === row.source_digest &&
        Array.isArray(record.sources) &&
        record.sources.length > 0 &&
        record.sources.every(
          (source) => boundSource(source, audit) && jointSourceExtras(source),
        ) &&
        Array.isArray(record.claims) &&
        record.claims.every((claim) => claim && matches(claim.id, DIGEST)) &&
        new Set(record.claims.map(({ id }) => id)).size ===
          record.claims.length &&
        Array.isArray(record.units) &&
        Array.isArray(record.supersedes) &&
        Array.isArray(record.legacyPredecessors) &&
        [...record.supersedes, ...record.legacyPredecessors].every((parent) =>
          matches(parent, DIGEST),
        ) &&
        new Set(record.supersedes).size === record.supersedes.length &&
        new Set(record.legacyPredecessors).size ===
          record.legacyPredecessors.length &&
        (record.supersedes.length + record.legacyPredecessors.length
          ? typeof record.revisionReason === "string" &&
            record.revisionReason.trim()
          : record.revisionReason === null) &&
        recordProducer(record) &&
        !indices.has(row.record_digest),
    );
    const keys = record.sources.map(sourceKey);
    const index = JSON.parse(row.source_keys_json) as unknown;
    ensure(
      Array.isArray(index) &&
        index.length === keys.length &&
        index.every(
          (key) =>
            Array.isArray(key) &&
            key.length === 2 &&
            key.every((part) => matches(part, NODE)),
        ) &&
        new Set(keys).size === keys.length &&
        sortedSet(index.map((key) => JSON.stringify(key))) === sortedSet(keys),
    );
    const inherited = keys.flatMap((key) => {
      const predecessor = legacy.get(key)?.row.record_digest;
      return predecessor ? [predecessor] : [];
    });
    ensure(sortedSet(record.legacyPredecessors) === sortedSet(inherited));
    await validateUnitIdentities(record);
    const plan = planOwnershipTransition(
      projectId,
      row.record_digest,
      record.supersedes.map((digest) => {
        const index = indices.get(digest) ?? -1;
        const parent = records[index]?.record;
        return {
          digest,
          index,
          record: parent
            ? {
                kind: "stored",
                projectId: parent.projectId,
                sourceKeys: parent.sources.map(sourceKey),
              }
            : { kind: "missing" },
        };
      }),
      used,
      keys.map((key) => ({ key, owner: owner(sources.get(key)) })),
      record.claims.map(({ id: key }) => ({
        key,
        owner: owner(claims.get(key)),
      })),
      record.supersedes.length
        ? [...claims].map(([key, digest]) => ({ key, owner: digest }))
        : [],
    );
    ensure(plan.kind === "ready");
    for (const parent of plan.retire) used[parent] = true;
    for (const key of plan.removeClaims) claims.delete(key);
    for (const key of plan.setSources) sources.set(key, plan.owner);
    for (const key of plan.setClaims) claims.set(key, plan.owner);
    indices.set(row.record_digest, records.length);
    records.push({ row, record });
    used.push(false);
    after = row.sequence;
  }
  return { sources, active: records.filter((_, index) => !used[index]) };
}

export type HistoricalContextGitHub = Pick<GitHubClient, "graphql" | "get">;

type ClosedLifecycle = {
  __typename: string;
  id: string;
  number: number;
  state: string;
  closed: boolean;
  merged: boolean;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
  closedAt: string | null;
  headRefOid: string;
  repository: {
    id: string;
    databaseId: number;
    isPrivate: boolean;
    nameWithOwner: string;
  };
};

type RestLifecycle = {
  number: number;
  node_id: string;
  state: string;
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  closed_at: string | null;
  head: { sha: string };
  base: { repo: { node_id: string; id: number; private: boolean } };
};

const CLOSED_CONTEXT_QUERY =
  "query HistoricalClosedContext($ids:[ID!]!){nodes(ids:$ids){__typename ... on PullRequest{id number state closed merged mergedAt mergeCommit{oid} closedAt headRefOid repository{id databaseId isPrivate nameWithOwner}}}}";

async function verifyClosedContexts(
  candidates: readonly {
    source: WorkUnitRecord["sources"][number];
    standalone: boolean;
  }[],
  github: HistoricalContextGitHub,
) {
  const verified = new Map<string, VerifiedClosedFinding>();
  for (let offset = 0; offset < candidates.length; offset += 30) {
    const batch = candidates.slice(offset, offset + 30);
    const result = await github.graphql<{ nodes: (ClosedLifecycle | null)[] }>(
      CLOSED_CONTEXT_QUERY,
      { ids: batch.map(({ source }) => source.pullRequestNodeId) },
    );
    ensure(
      Array.isArray(result?.nodes) && result.nodes.length === batch.length,
    );
    for (const [index, { source, standalone }] of batch.entries()) {
      const observed = result.nodes[index];
      if (
        observed?.__typename !== "PullRequest" ||
        observed.id !== source.pullRequestNodeId ||
        observed.number !== source.pullRequestNumber ||
        observed.state !== "CLOSED" ||
        observed.closed !== true ||
        observed.merged !== false ||
        observed.mergedAt !== null ||
        observed.mergeCommit !== null ||
        !time(observed.closedAt) ||
        Date.parse(observed.closedAt) !== Date.parse(source.occurredAt) ||
        observed.headRefOid !== source.headSha ||
        observed.repository?.id !== source.repositoryNodeId ||
        observed.repository.databaseId !== source.repositoryDatabaseId ||
        observed.repository.isPrivate !== false ||
        observed.repository.nameWithOwner?.toLowerCase() !==
          source.repository.toLowerCase()
      )
        continue;
      // REST can retain GitHub's test-merge identifier on an unmerged PR.
      // Keep the stored identifier and require the same immutable REST source
      // and explicit non-acceptance, alongside GraphQL's null actual merge.
      if (standalone || source.mergeSha !== null) {
        const rest = await github.get<RestLifecycle>(
          `/repos/${source.repository}/pulls/${source.pullRequestNumber}`,
        );
        if (
          rest?.number !== source.pullRequestNumber ||
          rest.node_id !== source.pullRequestNodeId ||
          rest.state !== "closed" ||
          rest.merged !== false ||
          rest.merged_at !== null ||
          rest.merge_commit_sha !== source.mergeSha ||
          !time(rest.closed_at) ||
          Date.parse(rest.closed_at) !== Date.parse(source.occurredAt) ||
          rest.head?.sha !== source.headSha ||
          rest.base?.repo?.node_id !== source.repositoryNodeId ||
          rest.base.repo.id !== source.repositoryDatabaseId ||
          rest.base.repo.private !== false
        )
          continue;
      }
      verified.set(
        source.pullRequestNodeId,
        standalone
          ? "verified-standalone-closed-review"
          : "verified-closed-context",
      );
    }
  }
  return verified;
}

export function historicalClosedContextBindings(
  receipt: Pick<HistoricalAssessmentReceipt, "records">,
) {
  return new Map(
    receipt.records.flatMap(({ digest, sources }) =>
      sources
        .filter(({ finding }) => isHistoricalClosedFinding(finding))
        .map(
          ({ id, number, headSha, occurredAt, finding }) =>
            [
              id,
              {
                digest,
                number,
                headSha,
                occurredAt,
                ...(finding === "verified-standalone-closed-review"
                  ? { standaloneReview: true as const }
                  : {}),
              },
            ] as const,
        ),
    ),
  );
}

function scopedRecord(
  journal: ScopedRecord["journal"],
  row: StoredRow,
  sources: readonly BoundSource[],
  audit: SourceAudit,
  byId: ReadonlyMap<string, SourceAudit["sources"][number]>,
  byNumber: ReadonlyMap<number, SourceAudit["sources"][number]>,
  verifiedClosed?: ReadonlyMap<string, VerifiedClosedFinding>,
): ScopedRecord {
  return {
    journal,
    digest: row.record_digest,
    sequence: row.sequence,
    sources: sources
      .map((source) => {
        const audited =
          byId.get(source.pullRequestNodeId) ??
          byNumber.get(source.pullRequestNumber);
        const occurredAt = new Date(source.occurredAt).toISOString();
        const finding: SourceFinding = audited
          ? audited.id !== source.pullRequestNodeId ||
            audited.number !== source.pullRequestNumber ||
            audited.mergedAt !== occurredAt
            ? "conflicting-audit-binding"
            : audited.headSha === source.headSha
              ? "audited-head"
              : "stale-head"
          : occurredAt >= audit.from && occurredAt < audit.through
            ? (verifiedClosed?.get(source.pullRequestNodeId) ??
              "missing-from-merged-audit")
            : "outside-audit";
        return {
          id: source.pullRequestNodeId,
          number: source.pullRequestNumber,
          headSha: source.headSha,
          auditedHeadSha: audited?.headSha ?? null,
          occurredAt,
          finding,
        };
      })
      .sort((left, right) => left.number - right.number),
  };
}

/** Raw records remain local. Only an integrity-checked empty scope can say empty. */
export async function classifyHistoricalAssessmentScope(
  catalog: HistoricalAssessmentCatalog,
  audit: SourceAudit,
  projectId: string,
  github?: HistoricalContextGitHub,
) {
  ensure(
    matches(projectId, PROJECT) &&
      validRepositoryPath(audit.repository) &&
      !audit.repository
        .split("/")
        .some((part) => part === "." || part === "..") &&
      matches(audit.repositoryNodeId, NODE) &&
      audit.from === "2026-09-27T00:00:00.000Z" &&
      audit.through === "2026-11-01T00:00:00.000Z" &&
      Array.isArray(audit.sources) &&
      audit.sources.length > 0,
  );
  const byId = new Map<string, SourceAudit["sources"][number]>();
  const byNumber = new Map<number, SourceAudit["sources"][number]>();
  for (const { id, number, headSha, mergedAt } of audit.sources) {
    ensure(
      matches(id, NODE) &&
        positive(number) &&
        matches(headSha, SHA) &&
        time(mergedAt) &&
        new Date(mergedAt).toISOString() === mergedAt &&
        mergedAt >= audit.from &&
        mergedAt < audit.through &&
        !byId.has(id) &&
        !byNumber.has(number),
    );
    const entry = { id, number, headSha, mergedAt };
    byId.set(id, entry);
    byNumber.set(number, entry);
  }
  const {
    jointThrough,
    legacyThrough,
    jointScopedCount,
    legacyRepoCount,
    d1PointsDigest,
    d1PointsCount,
    enforcementGeneration,
    registryRevision,
    registryManifestSha256,
  } = catalog.heads;
  ensure(
    count(jointThrough) &&
      count(legacyThrough) &&
      count(jointScopedCount) &&
      count(legacyRepoCount) &&
      jointScopedCount <= jointThrough &&
      legacyRepoCount <= legacyThrough &&
      matches(d1PointsDigest, DIGEST) &&
      count(d1PointsCount) &&
      count(enforcementGeneration) &&
      positive(registryRevision) &&
      matches(registryManifestSha256, DIGEST),
  );
  const boundary = {
    repository: audit.repository,
    repositoryNodeId: audit.repositoryNodeId,
    from: audit.from,
    through: audit.through,
  };
  const scope = {
    projectId,
    ...boundary,
    sourceAuditSha256: sha256Hex(
      JSON.stringify({
        ...boundary,
        sources: [...byNumber.values()].sort((a, b) => a.number - b.number),
      }),
    ),
  };
  const heads = {
    jointThrough,
    legacyThrough,
    jointScopedCount,
    legacyRepoCount,
    d1PointsDigest,
    d1PointsCount,
    enforcementGeneration,
    registryRevision,
    registryManifestSha256,
  };
  function receipt(
    status: Status,
    records: ScopedRecord[],
    blockers: Blocker[],
    activeLegacyCount = 0,
    activeJointCount = 0,
  ) {
    const result = {
      schemaVersion: "1" as const,
      status,
      scope,
      heads,
      counts: {
        auditedSources: byId.size,
        activeLegacyRecords: activeLegacyCount,
        activeJointRecords: activeJointCount,
        relevantRecords: records.length,
      },
      records,
      blockers,
    };
    return { ...result, receiptSha256: sha256Hex(canonicalJson(result)) };
  }
  if (
    !Array.isArray(catalog.legacy) ||
    !Array.isArray(catalog.joint) ||
    catalog.legacy.length !== legacyRepoCount ||
    catalog.joint.length !== jointScopedCount
  )
    return receipt("incomplete", [], ["incomplete-catalog"]);
  let legacy: ReturnType<typeof legacyHistory>;
  try {
    legacy = legacyHistory(catalog, audit, projectId);
  } catch {
    return receipt("incomplete", [], ["invalid-legacy-history"]);
  }
  let joint: Awaited<ReturnType<typeof jointHistory>>;
  try {
    joint = await jointHistory(catalog, audit, projectId, legacy);
  } catch {
    return receipt("incomplete", [], ["invalid-joint-history"]);
  }
  const activeLegacy = [...legacy.entries()]
    .filter(([key]) => !joint.sources.has(key))
    .map(([, value]) => value);
  const jointSources = joint.active.map(({ row, record }) => ({
    row,
    record,
    initial: scopedRecord("joint", row, record.sources, audit, byId, byNumber),
  }));
  const verifiedClosed = github
    ? await verifyClosedContexts(
        jointSources.flatMap(({ initial, record }) => {
          const standalone =
            initial.sources.length === 1 &&
            initial.sources[0].finding === "missing-from-merged-audit" &&
            isStandaloneHistoricalReview(record);
          if (
            !standalone &&
            !initial.sources.some(
              ({ finding }) =>
                finding === "audited-head" || finding === "stale-head",
            )
          )
            return [];
          const missing = new Set(
            initial.sources
              .filter(({ finding }) => finding === "missing-from-merged-audit")
              .map(({ id }) => id),
          );
          return record.sources
            .filter(
              (source) =>
                missing.has(source.pullRequestNodeId) &&
                source.indirectAcceptance === undefined,
            )
            .map((source) => ({ source, standalone }));
        }),
        github,
      )
    : undefined;
  const relevant = [
    ...activeLegacy.map(({ row, record }) =>
      scopedRecord("legacy", row, [record], audit, byId, byNumber),
    ),
    ...jointSources.map(({ row, record, initial }) =>
      verifiedClosed?.size
        ? scopedRecord(
            "joint",
            row,
            record.sources,
            audit,
            byId,
            byNumber,
            verifiedClosed,
          )
        : initial,
    ),
  ].filter(({ sources }) =>
    sources.some(({ finding }) => finding !== "outside-audit"),
  );
  const blockers: Blocker[] = [];
  for (const finding of [
    "conflicting-audit-binding",
    "missing-from-merged-audit",
  ] as const) {
    if (
      relevant.some(({ sources }) =>
        sources.some((source) => source.finding === finding),
      )
    )
      blockers.push(finding);
  }
  return receipt(
    blockers.length
      ? "incomplete"
      : relevant.length
        ? "requires-value-replay"
        : "no-scoped-active-assessments",
    relevant,
    blockers,
    activeLegacy.length,
    joint.active.length,
  );
}

export type HistoricalAssessmentReceipt = Awaited<
  ReturnType<typeof classifyHistoricalAssessmentScope>
>;
