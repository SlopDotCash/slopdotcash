import { collectTargetRepositories } from "../../src/lib/repositories.mjs";
import { GitHubClient } from "./github";
import { registeredProject, registeredRepository } from "./registry";
import type { ReviewEnv } from "./review";
import { readValueDecision } from "./value-consumption";
import { collectValueEvidence, findRepository } from "./value-evidence";
import { collectValueGroup } from "./value-group-collection";
import {
  claimValueRequest,
  finishValueRequest,
  nextValueRetryAt,
  ownsValueRequest,
  resumeParkedValueRequests,
  type ValueOutcome,
} from "./value-processing";
import {
  assertValueInstallation,
  assertValueInstallationRepositories,
  loadValuePolicy,
  publishValueAssessment,
} from "./value-publication";
import type { ValueRequest } from "./value-requests";
import { assessValue } from "./value-review";
import { type ValueSettingsEnv, valueSettings } from "./value-settings";
import { claimValueSources, ownsValueSources } from "./value-source-leases";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import {
  consumeWorkUnitHistory,
  readWorkUnitHistory,
} from "./value-work-unit-consumption";
import {
  currentWorkUnitRecord,
  workUnitHistory,
} from "./value-work-unit-journal";
import { publishWorkUnitAssessment } from "./value-work-unit-publication";
import { assessWorkUnits } from "./value-work-unit-review";

export type ValueConsumerEnv = ReviewEnv &
  ValueSettingsEnv & {
    SLOPBOT_PRODUCER_REVISION?: string;
  };

/** Process one durable delivery with every current or previously grouped source.
 * Incomplete groups stay pending; a carrier never becomes an independent award.
 */
export async function consumeValueRequest(
  env: ValueConsumerEnv,
  job: ValueRequest,
) {
  const db = env.SLOPBOT_DB;
  const claim = await claimValueRequest(db, job.deliveryId);
  if (!claim) return "not-claimed";
  const finish = async (outcome: ValueOutcome, terminal = false) => {
    await finishValueRequest(
      db,
      claim,
      outcome,
      // A blocked outcome backs off with this delivery's own attempt count
      // instead of retrying at a flat hour forever (#1411 B12); a transient
      // `retry` keeps the one-hour cadence.
      // A parked request has no retry time until its project is active.
      terminal || outcome === "parked"
        ? null
        : await nextValueRetryAt(db, claim.deliveryId, outcome),
    );
    return outcome;
  };
  const finishBlocked = (reason: string | null) =>
    reason === "attempts"
      ? finish("attempts-exhausted", true)
      : finish(reason === "budget" ? "budget" : "authority");
  try {
    const project = await registeredProject(db, job);
    // A paused, retired or unregistered project parks the request without a
    // retry time; resumeParkedValueRequests wakes it on reactivation.
    if (!project) return await finish("parked");
    const repositories = collectTargetRepositories([project]);
    await assertValueInstallation(db, job.installationId);
    const settings = valueSettings(env);
    const revision = env.SLOPBOT_PRODUCER_REVISION;
    if (
      !settings ||
      !revision ||
      !/^[a-f0-9]{40}$/.test(revision) ||
      !env.SURPLUS_API_KEY
    )
      return await finish("budget");
    const { monthly, maximum, start } = settings;
    const repository = findRepository(repositories, `${job.owner}/${job.repo}`);
    if (!repository) return await finish("authority");
    const github = await GitHubClient.forInstallation(
      env.SLOPBOT_APP_ID,
      env.SLOPBOT_APP_PRIVATE_KEY,
      job.installationId,
    );
    const identity = await github.get<{
      id: number;
      node_id: string;
      private: boolean;
    }>(`/repos/${repository.id}`);
    if (!identity || identity.private || identity.id !== job.repositoryId)
      return await finish("authority");
    const membership = [
      { repositoryDatabaseId: identity.id, repositoryNodeId: identity.node_id },
    ];
    await assertValueInstallationRepositories(github, membership);
    const read = await github.request<{
      state: string;
      merged_at: string | null;
      closed_at: string | null;
    }>("GET", `/repos/${repository.id}/pulls/${job.number}`);
    // The installation reads this public repository, so a 404 means GitHub
    // has no such pull request (deleted, or never one). Record it and stop.
    if (read.status === 404) return await finish("missing", true);
    const pull = read.data;
    if (!pull) return await finish("source-incomplete");
    if (pull.state !== "closed") return await finish("open", true);
    const occurred = Date.parse(pull.merged_at ?? pull.closed_at ?? "");
    if (!Number.isFinite(occurred)) return await finish("source-incomplete");
    // Historical work is handled by the subscription intake, never this API
    // route. A later reopen or close sends a new delivery with its own request.
    if (occurred < start) return await finish("historical", true);
    let evidence = await collectValueEvidence(
      github,
      repository.id,
      job.number,
      repository,
    );
    if (evidence.limitations.length) return await finish("source-incomplete");
    const policy = await loadValuePolicy(
      github,
      job.owner,
      job.repo,
      evidence.pull.base.sha,
    );
    const sources = await collectValueGroup(
      db,
      github,
      { evidence, policy },
      async (source) => {
        if (!(await ownsValueRequest(db, claim))) return false;
        const [owner, repo] = source.repository.split("/");
        if (
          !(await registeredRepository(db, {
            owner,
            repo,
            repositoryId: source.repositoryDatabaseId,
          }))
        )
          return false;
        await assertValueInstallation(db, job.installationId);
        await assertValueInstallationRepositories(github, [source]);
        return true;
      },
      start,
      repositories,
    );
    if (!sources) return await finish("source-incomplete");
    evidence = sources[0].evidence;
    const scopes = sources.map(({ evidence: source }) => ({
      repositoryDatabaseId: source.repositoryDatabaseId,
      pullRequestNumber: source.pull.number,
    }));
    if (!(await claimValueSources(db, claim, scopes)))
      return await finish("retry");
    const mayCall = async () => {
      if (
        !(await ownsValueRequest(db, claim)) ||
        !(await ownsValueSources(db, claim, scopes))
      )
        return false;
      for (const { evidence: source } of sources) {
        const [owner, repo] = source.repository.split("/");
        if (
          !(await registeredRepository(db, {
            owner,
            repo,
            repositoryId: source.repositoryDatabaseId,
          }))
        )
          return false;
      }
      await assertValueInstallation(db, job.installationId);
      await assertValueInstallationRepositories(
        github,
        sources.map((s) => s.evidence),
      );
      return true;
    };
    const decisions = await Promise.all(
      sources.map((s) =>
        readValueDecision(db, s.evidence, s.policy, repositories),
      ),
    );
    const previousGroups = await Promise.all(
      sources.map((s) =>
        currentWorkUnitRecord(
          db,
          s.evidence.repositoryNodeId,
          s.evidence.pull.node_id,
        ),
      ),
    );
    if (sources.length > 1 || previousGroups.some(Boolean)) {
      const joint = await prepareWorkUnitEvidence(sources, repositories);
      if (joint.limitations.length) return await finish("source-incomplete");
      const legacy = new Map(
        sources.map((s, i) => [
          s.evidence.pull.node_id,
          decisions[i].latestDigest,
        ]),
      );
      const supersedes = [
        ...new Set(previousGroups.flatMap((r) => (r ? [r.record_digest] : []))),
      ].sort();
      // Validate every existing root, including a sibling group being joined.
      for (const source of sources) {
        const history = await readWorkUnitHistory(
          (after, through) =>
            workUnitHistory(
              db,
              source.evidence.repository,
              source.evidence.pull.number,
              after,
              through,
              source.evidence.repositoryNodeId,
            ),
          {
            repositoryNodeId: source.evidence.repositoryNodeId,
            pullRequestNodeId: source.evidence.pull.node_id,
          },
          repositories,
        );
        const decision = await consumeWorkUnitHistory(
          history,
          sources,
          legacy,
          repositories,
        );
        if (decision.status === "assessed" || decision.status === "unresolved")
          return await finish("current", true);
      }
      const result = await assessWorkUnits(env, joint, mayCall, {
        db,
        installationId: job.installationId,
        attemptId: `value:${crypto.randomUUID()}`,
        maximumMicroUsd: maximum,
        approvedMonthlyMicroUsd: monthly,
      });
      if (result.blocked) return await finishBlocked(result.blockReason);
      if (!result.verdict) return await finish("retry");
      if (!(await mayCall())) return await finish("authority");
      const legacyPredecessors = [
        ...new Set(
          decisions.flatMap((d) => (d.latestDigest ? [d.latestDigest] : [])),
        ),
      ].sort();
      await publishWorkUnitAssessment(
        env,
        { ...job, itemKind: "pull_request" },
        result,
        joint,
        revision,
        supersedes,
        legacyPredecessors,
        supersedes.length || legacyPredecessors.length
          ? "Source group changed; automatic provisional reassessment"
          : null,
      );
      return await finish("published", true);
    }
    const current = decisions[0];
    if (current.status === "assessed" || current.status === "unresolved")
      return await finish("current", true);
    const result = await assessValue(env, evidence, policy, mayCall, {
      db,
      installationId: job.installationId,
      attemptId: `value:${crypto.randomUUID()}`,
      maximumMicroUsd: maximum,
      approvedMonthlyMicroUsd: monthly,
    });
    if (result.blocked) return await finishBlocked(result.blockReason);
    if (!result.verdict) return await finish("retry");
    if (!(await mayCall())) return await finish("authority");
    await publishValueAssessment(
      env,
      { ...job, itemKind: "pull_request" },
      result,
      evidence,
      revision,
      current.latestDigest,
      current.latestDigest
        ? "Source changed; automatic provisional reassessment"
        : null,
    );
    return await finish("published", true);
  } catch (error) {
    // Do not persist or log provider/source exception bodies. A lost lease also
    // refuses this transition, leaving recovery to the new owner or the lease expiry.
    console.error(
      JSON.stringify({
        event: "value_request_retry",
        delivery: job.deliveryId,
        kind: error instanceof Error ? error.name : "unknown",
      }),
    );
    return await finish("retry");
  }
}

/** The next due request. Requests are ordered by the time they became due: a
 * new request when it was received, a waiting request at its retry time and an
 * abandoned claim when its lease expired. A failed request therefore waits
 * behind newer work. Concurrent schedulers may select the same row; the
 * durable lease allows only one to process it.
 */
function nextValueRequest(db: ValueConsumerEnv["SLOPBOT_DB"]) {
  return db
    .prepare(
      `SELECT r.delivery_id AS deliveryId,r.installation_id AS installationId,
       r.repository_id AS repositoryId,r.owner,r.repo,r.pull_request_number AS number
     FROM slopbot_value_requests r LEFT JOIN slopbot_value_processing p
       ON p.delivery_id=r.delivery_id
     WHERE (p.delivery_id IS NULL
       OR (p.state='waiting' AND p.retry_at<=?1)
       OR (p.state='running' AND p.lease_until<=?1))
       AND NOT EXISTS (
         SELECT 1 FROM slopbot_value_processing busy
         JOIN slopbot_value_requests other ON other.delivery_id=busy.delivery_id
         WHERE busy.state='running' AND busy.lease_until>?1
           AND other.repository_id=r.repository_id
           AND other.pull_request_number=r.pull_request_number
       )
     ORDER BY COALESCE(p.retry_at,p.lease_until,r.received_at),r.delivery_id
     LIMIT 1`,
    )
    .bind(new Date().toISOString())
    .first<ValueRequest>();
}

const RUN_REQUESTS = 10;
const RUN_MS = 4 * 60 * 1000;

/** Processes due requests until none remain, ten are processed or four
 * minutes have passed. The limits keep one scheduled run inside its
 * five-minute interval and the per-invocation D1 query limit. Each outcome
 * settles the earlier deliveries for its PR under the same installation and
 * repository name, so a run usually covers ten PRs.
 */
export async function consumePendingValueRequests(env: ValueConsumerEnv) {
  const started = Date.now();
  await resumeParkedValueRequests(env.SLOPBOT_DB, (repository) =>
    registeredRepository(env.SLOPBOT_DB, repository),
  );
  const outcomes: string[] = [];
  while (outcomes.length < RUN_REQUESTS && Date.now() - started < RUN_MS) {
    const job = await nextValueRequest(env.SLOPBOT_DB);
    if (!job) break;
    outcomes.push(await consumeValueRequest(env, job));
  }
  return outcomes;
}
