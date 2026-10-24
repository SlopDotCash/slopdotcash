import {
  collectTargetRepositories,
  REGISTERED_REPOSITORIES,
  type TargetRepository,
} from "../../src/lib/repositories.mjs";
import type { Job } from "./contracts";
import { GitHubClient } from "./github";
import { registeredProject, requireRegisteredRepository } from "./registry";
import type { ReviewEnv } from "./review";
import { latestValueRecord } from "./value-journal";
import {
  assertValueInstallation,
  assertValueInstallationRepositories,
  type ValueClient,
  verifyCurrentValueSource,
} from "./value-publication";
import {
  prepareWorkUnitEvidence,
  type WorkUnitEvidence,
  type WorkUnitSource,
} from "./value-work-unit";
import {
  appendWorkUnitRecord,
  currentWorkUnitRecord,
  prepareWorkUnitRecord,
} from "./value-work-unit-journal";
import type { WorkUnitAssessmentResult } from "./value-work-unit-review";

type Result = WorkUnitAssessmentResult;

/** Reuse the single-source identity, complete-evidence and pinned-policy checks
 * for every member. No source may be added or silently dropped after inference.
 */
export async function verifyCurrentWorkUnitSource(
  github: ValueClient,
  supplied: WorkUnitEvidence,
  result: Pick<Result, "sourceDigest">,
  repositories: readonly TargetRepository[] = REGISTERED_REPOSITORIES,
) {
  const original = await prepareWorkUnitEvidence(
    supplied.sources,
    repositories,
  );
  if (
    original.sourceDigest !== supplied.sourceDigest ||
    original.sourceDigest !== result.sourceDigest
  )
    throw new Error("Joint assessment does not bind the supplied source group");
  const sources: WorkUnitSource[] = [];
  for (const [i, source] of original.sources.entries()) {
    sources.push(
      await verifyCurrentValueSource(
        github,
        source.evidence,
        {
          policySha: source.policy.sha,
          sourceDigest: original.sourceDigests[i].digest,
        },
        repositories,
      ),
    );
  }
  const current = await prepareWorkUnitEvidence(sources, repositories);
  if (
    current.limitations.length ||
    current.sourceDigest !== result.sourceDigest
  )
    throw new Error(
      "Joint source changed after assessment; a new assessment is required",
    );
  return current;
}

/** Only the service provides installation identity and deployed producer SHA.
 * This records a provisional score; it does not post, close, approve or pay.
 */
export async function publishWorkUnitAssessment(
  env: ReviewEnv,
  job: Pick<
    Job,
    "installationId" | "repositoryId" | "owner" | "repo" | "number" | "itemKind"
  >,
  result: Result,
  evidence: WorkUnitEvidence,
  producerRevision: string,
  supersedes: readonly string[],
  legacyPredecessors: readonly string[],
  revisionReason: string | null,
) {
  if (
    job.itemKind !== "pull_request" ||
    !evidence.sources.some(
      ({ evidence: source }) =>
        source.repositoryDatabaseId === job.repositoryId &&
        source.repository.toLowerCase() ===
          `${job.owner}/${job.repo}`.toLowerCase() &&
        source.pull.number === job.number,
    )
  )
    throw new Error("Joint publication job does not match a source member");
  const project = await registeredProject(env.SLOPBOT_DB, job);
  if (!project)
    throw new Error("Repository is not active in the Slop project registry");
  const repositories = collectTargetRepositories([project]);
  for (const { evidence: source } of evidence.sources) {
    const [owner, repo] = source.repository.split("/");
    await requireRegisteredRepository(env.SLOPBOT_DB, {
      owner,
      repo,
      repositoryId: source.repositoryDatabaseId,
    });
  }
  await assertValueInstallation(env.SLOPBOT_DB, job.installationId);
  const github = await GitHubClient.forInstallation(
    env.SLOPBOT_APP_ID,
    env.SLOPBOT_APP_PRIVATE_KEY,
    job.installationId,
  );
  await assertValueInstallationRepositories(
    github,
    evidence.sources.map((source) => source.evidence),
  );
  const current = await verifyCurrentWorkUnitSource(
    github,
    evidence,
    result,
    repositories,
  );
  const prepared = await prepareWorkUnitRecord(
    result,
    current,
    producerRevision,
    supersedes,
    legacyPredecessors,
    revisionReason,
    [project],
  );
  const replay = await env.SLOPBOT_DB.prepare(
    "SELECT assessment_key FROM slopbot_work_unit_journal WHERE assessment_key = ?",
  )
    .bind(prepared.assessmentKey)
    .first<{ assessment_key: string }>();
  if (!replay) {
    const expected = new Set<string>();
    const legacy = new Set<string>();
    for (const { evidence: source } of current.sources) {
      const previous = await currentWorkUnitRecord(
        env.SLOPBOT_DB,
        source.repositoryNodeId,
        source.pull.node_id,
      );
      if (previous) expected.add(previous.record_digest);
      const old = await latestValueRecord(
        env.SLOPBOT_DB,
        source.repositoryNodeId,
        source.pull.node_id,
      );
      if (old) legacy.add(old.record_digest);
    }
    if (
      JSON.stringify([...expected].sort()) !==
        JSON.stringify([...supersedes].sort()) ||
      JSON.stringify([...legacy].sort()) !==
        JSON.stringify([...legacyPredecessors].sort())
    )
      throw new Error(
        "Joint publication must supersede every current source record",
      );
  }
  // Recheck selection after source reads; the SQL append also checks suspension
  // atomically and rejects any competing predecessor or claim-owner revision.
  await assertValueInstallationRepositories(
    github,
    current.sources.map((source) => source.evidence),
  );
  for (const { evidence: source } of evidence.sources) {
    const [owner, repo] = source.repository.split("/");
    await requireRegisteredRepository(env.SLOPBOT_DB, {
      owner,
      repo,
      repositoryId: source.repositoryDatabaseId,
    });
  }
  await assertValueInstallation(env.SLOPBOT_DB, job.installationId);
  return appendWorkUnitRecord(env.SLOPBOT_DB, prepared, job.installationId);
}
