/** Internal journal consumer. The database connection is the authority boundary;
 * a digest alone never authenticates records copied from an arbitrary host.
 */
import {
  REGISTERED_REPOSITORIES,
  type TargetRepository,
} from "../../src/lib/repositories.mjs";
import { VALUE_RUBRIC_VERSION } from "../../src/lib/value-assessment";
import { sha256Hex } from "./github";
import type { D1Database } from "./persistence";
import {
  type ValueContextSelection,
  validValueContextSelections,
} from "./value-context";
import {
  type ValueEvidence,
  valueEvidenceMatchesRepository,
} from "./value-evidence";
import {
  type StoredValueRecord,
  type ValueJournalRecord,
  valueHistory,
} from "./value-journal";
import { isValueProducer } from "./value-producer";
import { validateEvidenceAssessment, valueSourceDigest } from "./value-review";

type PublicRecord = Omit<StoredValueRecord, "assessment_key">;

/** A caller must resolve valid human ratifications before using a provisional
 * result. Missing, stale, incomplete and unresolved results have no numeric
 * value; they must not be converted to zero or a successful default tier.
 */
export async function readValueDecision(
  db: D1Database,
  evidence: ValueEvidence,
  policy: { sha: string; text: string },
  repositories: readonly TargetRepository[] = REGISTERED_REPOSITORIES,
) {
  return readValueDecisionFromHistory(
    (after) =>
      valueHistory(
        db,
        repositories.find((entry) =>
          [entry.id, ...entry.aliases].some(
            (id) => id.toLowerCase() === evidence.repository.toLowerCase(),
          ),
        )?.id ?? evidence.repository,
        evidence.pull.number,
        after,
      ),
    evidence,
    policy,
    undefined,
    repositories,
  );
}

export async function readValueDecisionFromHistory(
  loadPage: (
    after: number,
  ) => Promise<Awaited<ReturnType<typeof valueHistory>>>,
  evidence: ValueEvidence,
  policy: { sha: string; text: string },
  hydrateContext?: (
    evidence: ValueEvidence,
    paths: readonly ValueContextSelection[],
  ) => Promise<ValueEvidence>,
  repositories: readonly TargetRepository[] = REGISTERED_REPOSITORIES,
) {
  const history: PublicRecord[] = [];
  let cursor = 0;
  let more = true;
  const repository = repositories.find((entry) =>
    [entry.id, ...entry.aliases].some(
      (id) => id.toLowerCase() === evidence.repository.toLowerCase(),
    ),
  );
  if (!repository) throw new Error("Value source repository is not registered");
  let previous: PublicRecord | null = null;
  let latest: ValueJournalRecord | null = null;
  do {
    const page = await loadPage(cursor);
    for (const row of page.records) {
      if (
        !Number.isSafeInteger(row.sequence) ||
        row.sequence <= cursor ||
        typeof row.record_json !== "string" ||
        !/^[a-f0-9]{64}$/u.test(row.record_digest) ||
        (await sha256Hex(row.record_json)) !== row.record_digest ||
        !Number.isFinite(Date.parse(row.recorded_at))
      )
        throw new Error("Value history has invalid bytes or sequence");
      const record: ValueJournalRecord = JSON.parse(row.record_json);
      if (
        record?.schemaVersion !== "slop-value-record:v1" ||
        record.projectId !== repository.projectId ||
        record.repository !== repository.id ||
        record.repositoryNodeId !== evidence.repositoryNodeId ||
        record.repositoryDatabaseId !== evidence.repositoryDatabaseId ||
        record.pullRequestNodeId !== evidence.pull.node_id ||
        record.pullRequestNumber !== evidence.pull.number ||
        record.supersedes !== (previous?.record_digest ?? null) ||
        (previous === null
          ? record.revisionReason !== null
          : typeof record.revisionReason !== "string" ||
            !record.revisionReason.trim())
      )
        throw new Error("Value history identity or predecessor is invalid");
      history.push(row);
      previous = row;
      latest = record;
      cursor = row.sequence;
    }
    more = page.nextAfter !== null;
    if (!more) break;
    if (page.records.length === 0 || page.nextAfter !== cursor)
      throw new Error("Value history cursor did not advance");
  } while (more);

  const common = {
    history,
    latestDigest: previous?.record_digest ?? null,
    implementationActorNodeIds: [...evidence.implementationActorNodeIds],
  };
  if (!latest) return { ...common, status: "missing" as const };
  if (
    latest.contextPaths !== undefined &&
    !validValueContextSelections(latest.contextPaths)
  )
    throw new Error("Value history context selection is invalid");
  if (hydrateContext)
    evidence = await hydrateContext(evidence, latest.contextPaths ?? []);
  if (evidence.limitations.length || !policy.text.trim())
    return { ...common, status: "incomplete" as const };
  if (
    !valueEvidenceMatchesRepository(evidence, repository) ||
    evidence.pull.state !== "closed" ||
    latest.headSha !== evidence.pull.head.sha ||
    latest.mergeSha !== evidence.pull.merge_commit_sha ||
    latest.occurredAt !==
      (evidence.pull.merged_at ?? evidence.pull.closed_at) ||
    latest.policySha !== policy.sha ||
    policy.sha !== evidence.pull.base.sha ||
    latest.sourceDigest !== (await valueSourceDigest(evidence, policy)) ||
    latest.rubricVersion !== VALUE_RUBRIC_VERSION
  )
    return { ...common, status: "stale" as const };
  if (
    !/^[a-f0-9]{40}$/u.test(latest.producerRevision) ||
    !Number.isFinite(Date.parse(latest.assessedAt)) ||
    !isValueProducer(latest.model)
  )
    throw new Error("Current value record has invalid producer identity");
  const assessment = validateEvidenceAssessment(latest.assessment, evidence);
  if (!assessment)
    throw new Error(
      "Current value assessment does not validate against source",
    );
  return {
    ...common,
    status: assessment.status,
    record: latest,
    assessment,
  };
}
