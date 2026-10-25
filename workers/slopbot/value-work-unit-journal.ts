import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import {
  findProject,
  type ProjectDefinition,
} from "../../src/lib/projects.mjs";
import {
  collectTargetRepositories,
  REGISTERED_REPOSITORIES,
  type TargetRepository,
} from "../../src/lib/repositories.mjs";
import { VALUE_RUBRIC_VERSION } from "../../src/lib/value-assessment";
import { sha256Hex } from "./github";
import type { D1Database } from "./persistence";
import {
  type ValueContextSelection,
  valueContextSelections,
} from "./value-context";
import type { StoredValueRecord } from "./value-journal";
import { type ValueMergeRecipe, validMergeRecipe } from "./value-merge-profile";
import {
  type ValueProducer,
  valueResultProducerIdentity,
} from "./value-producer";
import {
  prepareWorkUnitEvidence,
  type WorkUnitEvidence,
} from "./value-work-unit";
import {
  validateWorkUnitAssessment,
  type WorkUnitAssessment,
  type WorkUnitAssessmentResult,
} from "./value-work-unit-review";

export interface WorkUnitRecord {
  schemaVersion: "slop-work-unit-record:v1";
  projectId: string;
  sourceDigest: string;
  sources: {
    repository: string;
    repositoryNodeId: string;
    repositoryDatabaseId: number;
    pullRequestNodeId: string;
    pullRequestNumber: number;
    headSha: string;
    mergeSha: string | null;
    indirectAcceptance?: {
      historicalHeadSha: string;
      integrationSha: string;
      acceptedTipSha: string;
      branch: string;
      observationRunId: number;
      observedOnBranchAt: string;
    };
    occurredAt: string;
    policySha: string;
    sourceDigest: string;
    contextPaths?: ValueContextSelection[];
    mergeRecipe?: ValueMergeRecipe;
  }[];
  claims: WorkUnitEvidence["claims"];
  units: (WorkUnitAssessment["units"][number] & { workUnitId: string })[];
  rubricVersion: string;
  producerRevision: string;
  assessedAt: string;
  supersedes: string[];
  legacyPredecessors: string[];
  revisionReason: string | null;
  model: ValueProducer;
}

const DIGEST = /^[a-f0-9]{64}$/u;

export async function prepareWorkUnitRecord(
  result: WorkUnitAssessmentResult,
  supplied: WorkUnitEvidence,
  producerRevision: string,
  supersedes: readonly string[],
  legacyPredecessors: readonly string[],
  revisionReason: string | null,
  projects?: readonly ProjectDefinition[],
) {
  // Internal callers may supply the independently fetched D1 registry. Never
  // derive project authority from the model result or captured source policy.
  const registry =
    projects === undefined ? null : assertProjectRegistry(projects);
  const repositories =
    registry === null
      ? REGISTERED_REPOSITORIES
      : collectTargetRepositories(registry);
  // Recompute bindings instead of trusting caller-supplied claims or recipients.
  const evidence = await prepareWorkUnitEvidence(
    supplied.sources,
    repositories,
  );
  const project =
    registry === null
      ? findProject(evidence.projectId)
      : registry.find((entry) => entry.id === evidence.projectId);
  if (project?.status !== "active")
    throw new Error("Joint value source must belong to an active project");
  if (
    !/^[a-f0-9]{40}$/u.test(producerRevision) ||
    evidence.sourceDigest !== supplied.sourceDigest ||
    result.sourceDigest !== evidence.sourceDigest ||
    result.rubricVersion !== VALUE_RUBRIC_VERSION ||
    [...supersedes, ...legacyPredecessors].some(
      (digest) => !DIGEST.test(digest),
    ) ||
    new Set(supersedes).size !== supersedes.length ||
    new Set(legacyPredecessors).size !== legacyPredecessors.length ||
    (supersedes.length + legacyPredecessors.length === 0
      ? revisionReason !== null
      : !revisionReason?.trim())
  )
    throw new Error(
      "Joint value revision binding or predecessor reason is invalid",
    );
  const assessment = validateWorkUnitAssessment(result.verdict, evidence);
  if (!assessment) throw new Error("Joint value assessment does not validate");
  const model = valueResultProducerIdentity(result);
  const sources = workUnitSourceBindings(evidence, repositories);
  const units: WorkUnitRecord["units"] = [];
  for (const unit of assessment.units) {
    units.push({ ...unit, workUnitId: await workUnitIdentity(unit) });
  }
  units.sort((a, b) =>
    a.workUnitId < b.workUnitId ? -1 : a.workUnitId > b.workUnitId ? 1 : 0,
  );
  const record: WorkUnitRecord = {
    schemaVersion: "slop-work-unit-record:v1",
    projectId: project.id,
    sourceDigest: evidence.sourceDigest,
    sources,
    claims: evidence.claims,
    units,
    rubricVersion: result.rubricVersion,
    producerRevision,
    assessedAt: result.assessedAt,
    supersedes: [...supersedes].sort(),
    legacyPredecessors: [...legacyPredecessors].sort(),
    revisionReason,
    model,
  };
  const recordJson = JSON.stringify(record);
  return {
    record,
    recordJson,
    recordDigest: await sha256Hex(recordJson),
    assessmentKey: await workUnitAssessmentKey(record),
  };
}

export function workUnitSourceBindings(
  evidence: WorkUnitEvidence,
  repositories: readonly TargetRepository[] = REGISTERED_REPOSITORIES,
): WorkUnitRecord["sources"] {
  return evidence.sources.map(
    ({ evidence: source, policy, mergeRecipe }, i) => {
      if (mergeRecipe !== undefined && !validMergeRecipe(mergeRecipe))
        throw new Error("Invalid merge reconstruction recipe");
      const occurredAt =
        source.pull.merged_at ??
        source.indirectAcceptance?.observedOnBranchAt ??
        source.pull.closed_at;
      const repository = repositories.find((entry) =>
        [entry.id, ...entry.aliases].some(
          (id) => id.toLowerCase() === source.repository.toLowerCase(),
        ),
      );
      if (!repository)
        throw new Error("Joint source repository is unregistered");
      if (occurredAt === null)
        throw new Error("Joint source lacks occurrence date");
      return {
        repository: repository.id,
        repositoryNodeId: source.repositoryNodeId,
        repositoryDatabaseId: source.repositoryDatabaseId,
        pullRequestNodeId: source.pull.node_id,
        pullRequestNumber: source.pull.number,
        headSha: source.pull.head.sha,
        mergeSha: source.pull.merge_commit_sha,
        ...(source.indirectAcceptance
          ? {
              indirectAcceptance: {
                historicalHeadSha: source.indirectAcceptance.historicalHeadSha,
                integrationSha: source.indirectAcceptance.integrationSha,
                acceptedTipSha: source.indirectAcceptance.acceptedTipSha,
                branch: source.indirectAcceptance.branch,
                observationRunId: source.indirectAcceptance.observationRunId,
                observedOnBranchAt:
                  source.indirectAcceptance.observedOnBranchAt,
              },
            }
          : {}),
        occurredAt,
        policySha: policy.sha,
        sourceDigest: evidence.sourceDigests[i].digest,
        ...(mergeRecipe ? { mergeRecipe } : {}),
        ...(source.contextFiles?.length
          ? { contextPaths: valueContextSelections(source) }
          : {}),
      };
    },
  );
}

export function workUnitIdentity(unit: WorkUnitAssessment["units"][number]) {
  const identity = unit.claimIds.length
    ? ["implementation", [...unit.claimIds].sort()]
    : [
        "reviews",
        unit.assessment.reviews.map((review) => review.sourceId).sort(),
      ];
  return sha256Hex(JSON.stringify(identity)).then((digest) => `wu_${digest}`);
}

function workUnitAssessmentKey(record: WorkUnitRecord) {
  return sha256Hex(
    JSON.stringify([
      "slop-work-unit-assessment:v1",
      record.sourceDigest,
      record.rubricVersion,
      record.producerRevision,
    ]),
  );
}

/** One INSERT and its triggers form one transaction, including all source,
 * claim and predecessor indexes. A conflict cannot leave partial publication.
 */
export async function appendWorkUnitRecord(
  db: D1Database,
  prepared: Awaited<ReturnType<typeof prepareWorkUnitRecord>>,
  installationId: number | null = null,
): Promise<StoredValueRecord> {
  const { record, recordJson, recordDigest, assessmentKey } = prepared;
  if (
    JSON.stringify(record) !== recordJson ||
    (await sha256Hex(recordJson)) !== recordDigest ||
    (await workUnitAssessmentKey(record)) !== assessmentKey
  )
    throw new Error("Joint value journal bytes do not match their digest");
  await db
    .prepare(
      `INSERT INTO slopbot_work_unit_journal
    (record_digest, assessment_key, project_id, source_digest, record_json, recorded_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM slopbot_work_unit_journal WHERE assessment_key = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM slopbot_installations
        WHERE installation_id = ? AND removed_at IS NULL AND suspended_at IS NULL))`,
    )
    .bind(
      recordDigest,
      assessmentKey,
      record.projectId,
      record.sourceDigest,
      recordJson,
      new Date().toISOString(),
      assessmentKey,
      installationId,
      installationId,
    )
    .run();
  const stored = await db
    .prepare(
      `SELECT sequence, record_digest, assessment_key, record_json, recorded_at
    FROM slopbot_work_unit_journal WHERE assessment_key = ?`,
    )
    .bind(assessmentKey)
    .first<StoredValueRecord>();
  if (!stored)
    throw new Error(
      "Joint value journal append did not produce a stored record",
    );
  return stored;
}

/** The current complete record, not a projection copied once for every PR. */
export async function currentWorkUnitRecord(
  db: D1Database,
  repositoryNodeId: string,
  pullRequestNodeId: string,
) {
  return db
    .prepare(
      `SELECT j.sequence, j.record_digest, j.assessment_key, j.record_json, j.recorded_at
    FROM slopbot_work_unit_journal j
    JOIN slopbot_work_unit_sources s ON s.record_digest = j.record_digest
    WHERE s.repository_node_id = ? AND s.pull_request_node_id = ?
      AND NOT EXISTS (SELECT 1 FROM slopbot_work_unit_predecessors p WHERE p.predecessor_digest = j.record_digest)`,
    )
    .bind(repositoryNodeId, pullRequestNodeId)
    .first<StoredValueRecord>();
}

/** Include sibling roots when later revisions combine groups. A fixed sequence
 * bound prevents a new merge from adding old ancestors behind a page cursor.
 */
export async function workUnitHistory(
  db: D1Database,
  repository: string,
  pullRequestNumber: number,
  afterSequence: number,
  throughSequence: number | null = null,
  repositoryNodeId?: string,
) {
  if (
    !Number.isSafeInteger(afterSequence) ||
    afterSequence < 0 ||
    (afterSequence > 0 && throughSequence === null) ||
    (throughSequence !== null &&
      (!Number.isSafeInteger(throughSequence) ||
        throughSequence < afterSequence))
  )
    throw new Error("Joint history requires a stable sequence boundary");
  const identity =
    repositoryNodeId === undefined ? "repository" : "repositoryNodeId";
  const row = await db
    .prepare(
      `WITH RECURSIVE
    bounds AS (SELECT COALESCE(MAX(sequence), 0) AS maximum,
      COALESCE(?, MAX(sequence), 0) AS through_sequence FROM slopbot_work_unit_journal),
    lineage(record_digest) AS (
      SELECT j.record_digest FROM slopbot_work_unit_journal j, bounds b
      WHERE j.sequence <= b.through_sequence AND EXISTS (
        SELECT 1 FROM json_each(j.record_json, '$.sources') s
        WHERE json_extract(s.value, '$.${identity}') = ?
          AND json_extract(s.value, '$.pullRequestNumber') = ?)
      UNION
      SELECT p.predecessor_digest FROM slopbot_work_unit_predecessors p
      JOIN lineage l ON p.record_digest = l.record_digest
    )
    SELECT b.maximum, b.through_sequence,
      (SELECT COUNT(*) FROM lineage) AS total_records,
      (SELECT json_group_array(json_object('sequence', sequence,
        'record_digest', record_digest, 'record_json', record_json, 'recorded_at', recorded_at))
       FROM (SELECT j.sequence, j.record_digest, j.record_json, j.recorded_at
         FROM slopbot_work_unit_journal j JOIN lineage l ON l.record_digest = j.record_digest
         WHERE j.sequence > ? ORDER BY j.sequence LIMIT 101)) AS records_json
    FROM bounds b`,
    )
    .bind(
      throughSequence,
      repositoryNodeId ?? repository,
      pullRequestNumber,
      afterSequence,
    )
    .first<{
      maximum: number;
      through_sequence: number;
      total_records: number;
      records_json: string;
    }>();
  if (!row || row.through_sequence > row.maximum)
    throw new Error("Joint history sequence boundary is unavailable");
  const records = JSON.parse(row.records_json) as Omit<
    StoredValueRecord,
    "assessment_key"
  >[];
  const page = records.slice(0, 100);
  return {
    records: page,
    nextAfter: records.length > 100 ? page[page.length - 1].sequence : null,
    throughSequence: row.through_sequence,
    totalRecords: row.total_records,
  };
}
