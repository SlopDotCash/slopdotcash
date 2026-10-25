/** Call only through the configured journal authority. Hashes authenticate
 * bytes within that history; they do not authenticate an arbitrary web host.
 */
import {
  REGISTERED_REPOSITORIES,
  type TargetRepository,
} from "../../src/lib/repositories.mjs";
import { VALUE_RUBRIC_VERSION } from "../../src/lib/value-assessment";
import { sha256Hex } from "./github";
import { validValueContextSelections } from "./value-context";
import { isValueProducer } from "./value-producer";
import {
  prepareWorkUnitEvidence,
  type WorkUnitSource,
} from "./value-work-unit";
import {
  type WorkUnitRecord,
  type workUnitHistory,
  workUnitIdentity,
  workUnitSourceBindings,
} from "./value-work-unit-journal";
import { validateWorkUnitAssessment } from "./value-work-unit-review";

type Page = Awaited<ReturnType<typeof workUnitHistory>>;
type Row = Page["records"][number];
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const time = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const sourceKey = (source: {
  repositoryNodeId: string;
  pullRequestNodeId: string;
}) => JSON.stringify([source.repositoryNodeId, source.pullRequestNodeId]);

function assertRecord(
  value: WorkUnitRecord,
  repositories: readonly TargetRepository[],
) {
  if (
    value?.schemaVersion !== "slop-work-unit-record:v1" ||
    !digest(value.sourceDigest) ||
    !sha(value.producerRevision) ||
    !time(value.assessedAt) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    !Array.isArray(value.claims) ||
    !Array.isArray(value.units) ||
    !Array.isArray(value.supersedes) ||
    !Array.isArray(value.legacyPredecessors) ||
    ![...value.supersedes, ...value.legacyPredecessors].every(digest) ||
    new Set(value.supersedes).size !== value.supersedes.length ||
    new Set(value.legacyPredecessors).size !==
      value.legacyPredecessors.length ||
    (value.supersedes.length + value.legacyPredecessors.length === 0
      ? value.revisionReason !== null
      : typeof value.revisionReason !== "string" ||
        !value.revisionReason.trim())
  )
    throw new Error("Joint history record has invalid revision bindings");
  const ids = new Set<string>();
  for (const source of value.sources) {
    const repository = repositories.find((entry) =>
      [entry.id, ...entry.aliases].includes(source.repository),
    );
    const key = sourceKey(source);
    if (
      !repository ||
      repository.projectId !== value.projectId ||
      (repository.expectedNodeId !== null &&
        repository.expectedNodeId !== source.repositoryNodeId) ||
      typeof source.pullRequestNodeId !== "string" ||
      !source.pullRequestNodeId ||
      !Number.isSafeInteger(source.repositoryDatabaseId) ||
      source.repositoryDatabaseId <= 0 ||
      !Number.isSafeInteger(source.pullRequestNumber) ||
      source.pullRequestNumber <= 0 ||
      !sha(source.headSha) ||
      (source.mergeSha !== null && !sha(source.mergeSha)) ||
      !sha(source.policySha) ||
      !digest(source.sourceDigest) ||
      !time(source.occurredAt) ||
      (source.contextPaths !== undefined &&
        !validValueContextSelections(source.contextPaths)) ||
      ids.has(key)
    )
      throw new Error("Joint history source identity is invalid");
    const indirect = source.indirectAcceptance;
    if (
      indirect !== undefined &&
      (source.mergeSha !== null ||
        !sha(indirect.historicalHeadSha) ||
        !sha(indirect.integrationSha) ||
        !sha(indirect.acceptedTipSha) ||
        indirect.branch !== repository.integrationBranch ||
        !Number.isSafeInteger(indirect.observationRunId) ||
        indirect.observationRunId <= 0 ||
        !time(indirect.observedOnBranchAt) ||
        source.occurredAt !== indirect.observedOnBranchAt)
    )
      throw new Error("Joint indirect acceptance binding is invalid");
    ids.add(key);
  }
  if (
    value.claims.some((claim) => !claim || !digest(claim.id)) ||
    new Set(value.claims.map((claim) => claim.id)).size !== value.claims.length
  )
    throw new Error("Joint history claim identity is invalid");
}

/** Read the complete predecessor graph before collecting its current sources.
 * Missing sibling roots, forks and omitted pages are errors, never defaults.
 */
export async function readWorkUnitHistory(
  loadPage: (after: number, through: number | null) => Promise<Page>,
  target: { repositoryNodeId: string; pullRequestNodeId: string },
  repositories: readonly TargetRepository[] = REGISTERED_REPOSITORIES,
) {
  const history: Row[] = [];
  const records = new Map<string, { row: Row; record: WorkUnitRecord }>();
  const currentSources = new Map<string, string>();
  const currentClaims = new Map<string, string>();
  const used = new Set<string>();
  let after = 0;
  let through: number | null = null;
  let total: number | null = null;
  for (;;) {
    const page = await loadPage(after, through);
    if (
      !Number.isSafeInteger(page.throughSequence) ||
      page.throughSequence < after ||
      !Number.isSafeInteger(page.totalRecords) ||
      page.totalRecords < 0 ||
      (through !== null && through !== page.throughSequence) ||
      (total !== null && total !== page.totalRecords) ||
      !Array.isArray(page.records) ||
      page.records.length > 100
    )
      throw new Error("Joint history pagination boundary changed");
    through = page.throughSequence;
    total = page.totalRecords;
    for (const row of page.records) {
      if (
        !Number.isSafeInteger(row.sequence) ||
        row.sequence <= after ||
        row.sequence > through ||
        !digest(row.record_digest) ||
        typeof row.record_json !== "string" ||
        (await sha256Hex(row.record_json)) !== row.record_digest ||
        !time(row.recorded_at) ||
        records.has(row.record_digest)
      )
        throw new Error("Joint history has invalid bytes or sequence");
      const record = JSON.parse(row.record_json) as WorkUnitRecord;
      assertRecord(record, repositories);
      const predecessors = new Set(record.supersedes);
      const members = new Set(record.sources.map(sourceKey));
      for (const previous of predecessors) {
        const parent = records.get(previous)?.record;
        if (
          !parent ||
          used.has(previous) ||
          parent.projectId !== record.projectId ||
          parent.sources.some((source) => !members.has(sourceKey(source)))
        )
          throw new Error(
            "Joint history has a missing, forked or incomplete predecessor",
          );
      }
      for (const key of members) {
        const owner = currentSources.get(key);
        if (owner && !predecessors.has(owner))
          throw new Error("Joint history omits current source ownership");
      }
      for (const claim of record.claims) {
        const owner = currentClaims.get(claim.id);
        if (owner && !predecessors.has(owner))
          throw new Error("Joint history duplicates a current claim");
      }
      for (const previous of predecessors) {
        used.add(previous);
        for (const [key, owner] of currentClaims)
          if (owner === previous) currentClaims.delete(key);
      }
      for (const key of members) currentSources.set(key, row.record_digest);
      for (const claim of record.claims)
        currentClaims.set(claim.id, row.record_digest);
      records.set(row.record_digest, { row, record });
      history.push(row);
      after = row.sequence;
    }
    if (page.nextAfter === null) break;
    if (page.records.length === 0 || page.nextAfter !== after)
      throw new Error("Joint history cursor did not advance");
  }
  if (history.length !== total)
    throw new Error("Joint history coverage is incomplete");
  const currentDigest = currentSources.get(sourceKey(target));
  if (!currentDigest) {
    if (history.length)
      throw new Error("Joint history does not contain the requested source");
    return { history, throughSequence: through, current: null };
  }
  const current = records.get(currentDigest);
  if (!current) throw new Error("Joint history current record is missing");
  const ancestors = new Set<string>();
  const pending = [currentDigest];
  while (pending.length) {
    const id = pending.pop();
    if (!id || ancestors.has(id)) continue;
    ancestors.add(id);
    const parent = records.get(id);
    if (!parent) throw new Error("Joint history ancestor is missing");
    pending.push(...parent.record.supersedes);
  }
  if (ancestors.size !== history.length)
    throw new Error("Joint history contains unrelated records");
  return { history, throughSequence: through, current };
}

/** Legacy digests must come from verified per-source history reads. The caller
 * must still apply human ratifications and external-prize acceptance first.
 */
export async function consumeWorkUnitHistory(
  history: Awaited<ReturnType<typeof readWorkUnitHistory>>,
  sources: readonly WorkUnitSource[],
  legacyDigests: ReadonlyMap<string, string | null>,
  repositories: readonly TargetRepository[] = REGISTERED_REPOSITORIES,
) {
  const common = {
    history: history.history,
    throughSequence: history.throughSequence,
    latestDigest: history.current?.row.record_digest ?? null,
  };
  if (!history.current) return { ...common, status: "missing" as const };
  const evidence = await prepareWorkUnitEvidence(sources, repositories);
  if (evidence.limitations.length)
    return { ...common, status: "incomplete" as const };
  const record = history.current.record;
  if (
    record.sourceDigest !== evidence.sourceDigest ||
    record.rubricVersion !== VALUE_RUBRIC_VERSION
  )
    return { ...common, status: "stale" as const };
  const currentLegacy: string[] = [];
  for (const source of evidence.sources) {
    const id = source.evidence.pull.node_id;
    const value = legacyDigests.get(id);
    if (value === undefined)
      throw new Error("Joint decision lacks verified legacy history");
    if (value !== null) {
      if (!digest(value))
        throw new Error("Joint legacy history digest is invalid");
      currentLegacy.push(value);
    }
  }
  if (
    JSON.stringify([...new Set(currentLegacy)].sort()) !==
    JSON.stringify(record.legacyPredecessors)
  )
    return { ...common, status: "stale" as const };
  if (
    JSON.stringify(record.sources) !==
      JSON.stringify(workUnitSourceBindings(evidence, repositories)) ||
    JSON.stringify(record.claims) !== JSON.stringify(evidence.claims) ||
    !isValueProducer(record.model)
  )
    throw new Error(
      "Current joint record does not bind its sources or producer",
    );
  const assessment = validateWorkUnitAssessment(
    {
      units: record.units.map(({ claimIds, assessment }) => ({
        claimIds,
        assessment,
      })),
    },
    evidence,
  );
  if (!assessment)
    throw new Error(
      "Current joint assessment does not validate against source",
    );
  for (const [i, unit] of assessment.units.entries())
    if ((await workUnitIdentity(unit)) !== record.units[i].workUnitId)
      throw new Error("Current joint work-unit identity is invalid");
  return {
    ...common,
    status: assessment.units.every(
      (unit) => unit.assessment.status === "assessed",
    )
      ? ("assessed" as const)
      : ("unresolved" as const),
    record,
    evidence,
    assessment,
  };
}
