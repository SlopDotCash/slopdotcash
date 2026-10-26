/** Internal source-bound journal. Call only after authenticated installation and
 * current-source checks. This module creates no GitHub action or payment.
 */

import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import type { ProjectDefinition, ProjectId } from "../../src/lib/projects.mjs";
import { collectTargetRepositories } from "../../src/lib/repositories.mjs";
import {
  VALUE_RUBRIC_VERSION,
  type ValueAssessment,
} from "../../src/lib/value-assessment";
import { sha256Hex } from "./github";
import {
  type ValueProducer,
  valueResultProducerIdentity,
} from "./value-producer";

export { valueProducerIdentity } from "./value-producer";

import type { D1Database } from "./persistence";
import {
  type ValueContextSelection,
  valueContextSelections,
} from "./value-context";
import {
  findRepository,
  type ValueEvidence,
  valueEvidenceMatchesRepository,
} from "./value-evidence";
import {
  type ValueAssessmentResult,
  validateEvidenceAssessment,
  valueSourceDigest,
} from "./value-review";

type AssessmentResult = ValueAssessmentResult;
export interface ValueJournalRecord {
  schemaVersion: "slop-value-record:v1";
  projectId: ProjectId;
  repository: string;
  repositoryNodeId: string;
  repositoryDatabaseId: number;
  pullRequestNodeId: string;
  pullRequestNumber: number;
  headSha: string;
  mergeSha: string | null;
  occurredAt: string;
  policySha: string;
  sourceDigest: string;
  contextPaths?: ValueContextSelection[];
  rubricVersion: string;
  producerRevision: string;
  assessedAt: string;
  supersedes: string | null;
  revisionReason: string | null;
  model: ValueProducer;
  assessment: ValueAssessment;
}
export interface StoredValueRecord {
  sequence: number;
  record_digest: string;
  assessment_key: string;
  record_json: string;
  recorded_at: string;
}
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;

export async function prepareValueRecord(
  result: AssessmentResult,
  evidence: ValueEvidence,
  policy: { sha: string; text: string },
  producerRevision: string,
  supersedes: string | null,
  revisionReason: string | null,
  projects: readonly ProjectDefinition[],
) {
  const registry = assertProjectRegistry(projects);
  const repositories = collectTargetRepositories(registry);
  const repository = findRepository(repositories, evidence.repository);
  const project = repository
    ? registry.find((entry) => entry.id === repository.projectId)
    : null;
  if (!repository || !project || project.status !== "active")
    throw new Error("Value source must belong to an active registered project");
  if (
    !SHA.test(producerRevision) ||
    !SHA.test(policy.sha) ||
    policy.sha !== evidence.pull.base.sha ||
    !policy.text.trim() ||
    (supersedes !== null && !DIGEST.test(supersedes))
  )
    throw new Error("Value record revision binding is invalid");
  if (
    evidence.limitations.length ||
    result.headSha !== evidence.pull.head.sha ||
    result.pullRequestNodeId !== evidence.pull.node_id ||
    result.policySha !== policy.sha ||
    result.rubricVersion !== VALUE_RUBRIC_VERSION ||
    result.sourceDigest !== (await valueSourceDigest(evidence, policy))
  )
    throw new Error(
      "Value result does not bind complete supplied source evidence",
    );
  if (
    (supersedes === null && revisionReason !== null) ||
    (supersedes !== null && !revisionReason?.trim())
  )
    throw new Error("A value successor requires an explicit change reason");
  if (!valueEvidenceMatchesRepository(evidence, repository))
    throw new Error(
      "Value source does not match its registered repository policy",
    );
  const assessment = validateEvidenceAssessment(result.verdict, evidence);
  const occurredAt = evidence.pull.merged_at ?? evidence.pull.closed_at;
  if (
    evidence.pull.state !== "closed" ||
    typeof occurredAt !== "string" ||
    !Number.isFinite(Date.parse(occurredAt))
  )
    throw new Error(
      "Value record requires a closed outcome with its occurrence date",
    );
  if (!assessment) throw new Error("Value result lacks a validated assessment");
  const model = valueResultProducerIdentity(result);
  const record: ValueJournalRecord = {
    schemaVersion: "slop-value-record:v1",
    projectId: project.id,
    repository: repository.id,
    repositoryNodeId: evidence.repositoryNodeId,
    repositoryDatabaseId: evidence.repositoryDatabaseId,
    pullRequestNodeId: evidence.pull.node_id,
    pullRequestNumber: evidence.pull.number,
    headSha: evidence.pull.head.sha,
    mergeSha: evidence.pull.merge_commit_sha,
    occurredAt,
    policySha: policy.sha,
    sourceDigest: result.sourceDigest,
    ...(evidence.contextFiles?.length
      ? { contextPaths: valueContextSelections(evidence) }
      : {}),
    rubricVersion: result.rubricVersion,
    producerRevision,
    assessedAt: result.assessedAt,
    supersedes,
    revisionReason,
    model,
    assessment,
  };
  // The exact UTF-8 JSON bytes are the digest contract. The public reader must
  // retain this string, not reserialize a parsed object before verification.
  const recordJson = JSON.stringify(record);
  const recordDigest = await sha256Hex(recordJson);
  const assessmentKey = await valueAssessmentKey(record);
  return { record, recordJson, recordDigest, assessmentKey };
}

function valueAssessmentKey(record: ValueJournalRecord) {
  return sha256Hex(
    JSON.stringify([
      "slop-value-assessment:v1",
      record.repositoryNodeId,
      record.pullRequestNodeId,
      record.sourceDigest,
      record.rubricVersion,
      record.producerRevision,
    ]),
  );
}

/** Retry returns the first stored result for this exact source and producer.
 * Unique roots/successors prevent concurrent requests from forking history.
 */
export async function appendValueRecord(
  db: D1Database,
  prepared: Awaited<ReturnType<typeof prepareValueRecord>>,
  installationId: number | null = null,
): Promise<StoredValueRecord> {
  const { record, recordJson, recordDigest, assessmentKey } = prepared;
  if (
    JSON.stringify(record) !== recordJson ||
    (await sha256Hex(recordJson)) !== recordDigest ||
    (await valueAssessmentKey(record)) !== assessmentKey
  )
    throw new Error("Value journal bytes do not match their digest");
  await db
    .prepare(`INSERT INTO slopbot_value_journal
    (record_digest, assessment_key, repository_node_id, pull_request_node_id,
     head_sha, source_digest, supersedes, record_json, recorded_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM slopbot_value_journal WHERE assessment_key = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM slopbot_installations
        WHERE installation_id = ? AND removed_at IS NULL AND suspended_at IS NULL))
    ON CONFLICT(assessment_key) DO NOTHING`)
    .bind(
      recordDigest,
      assessmentKey,
      record.repositoryNodeId,
      record.pullRequestNodeId,
      record.headSha,
      record.sourceDigest,
      record.supersedes,
      recordJson,
      new Date().toISOString(),
      assessmentKey,
      installationId,
      installationId,
    )
    .run();
  const stored = await db
    .prepare(`SELECT sequence, record_digest, assessment_key, record_json, recorded_at
    FROM slopbot_value_journal WHERE assessment_key = ?`)
    .bind(assessmentKey)
    .first<StoredValueRecord>();
  if (!stored)
    throw new Error("Value journal append did not produce a stored record");
  return stored;
}

export async function latestValueRecord(
  db: D1Database,
  repositoryNodeId: string,
  pullRequestNodeId: string,
) {
  return db
    .prepare(`SELECT sequence, record_digest, assessment_key, record_json, recorded_at
    FROM slopbot_value_journal WHERE repository_node_id = ? AND pull_request_node_id = ?
    ORDER BY sequence DESC LIMIT 1`)
    .bind(repositoryNodeId, pullRequestNodeId)
    .first<StoredValueRecord>();
}

/** Public history contains exact record bytes and their digests. This is not a
 * current-score endpoint: consumers must check source revisions and human decisions.
 */
export async function valueHistory(
  db: D1Database,
  repository: string,
  pullRequestNumber: number,
  afterSequence: number,
  repositoryNodeId?: string,
) {
  const identity =
    repositoryNodeId === undefined
      ? "json_extract(record_json, '$.repository')"
      : "repository_node_id";
  const row = await db
    .prepare(`SELECT json_group_array(json_object(
    'sequence', sequence, 'record_digest', record_digest,
    'record_json', record_json, 'recorded_at', recorded_at)) AS records_json
    FROM (SELECT sequence, record_digest, record_json, recorded_at
      FROM slopbot_value_journal
      WHERE ${identity} = ?
        AND json_extract(record_json, '$.pullRequestNumber') = ?
        AND sequence > ? ORDER BY sequence LIMIT 101)`)
    .bind(repositoryNodeId ?? repository, pullRequestNumber, afterSequence)
    .first<{ records_json: string }>();
  if (!row) throw new Error("Value history read failed");
  const records = JSON.parse(row.records_json) as Omit<
    StoredValueRecord,
    "assessment_key"
  >[];
  const page = records.slice(0, 100);
  return {
    records: page,
    nextAfter: records.length > 100 ? page[page.length - 1].sequence : null,
  };
}
