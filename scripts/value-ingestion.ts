import { type DeploymentTier, deploymentOrigins } from "../src/lib/deployment";
import { canonicalActorAvatarUrl } from "../src/lib/leaderboard";
/** Read only: no model calls, score publication or payment authority. */
import type {
  GitHubActor,
  HeldWorkUnit,
  LeaderboardInput,
  MergedPullRequestOutcome,
  PenaltyFeedRecord,
  PenaltyHistoryRecord,
} from "../src/lib/leaderboard-types";
import { findIngestedProjectByRepositoryId } from "../src/lib/projects.mjs";
import {
  findRegisteredRepositoryById,
  REGISTERED_REPOSITORIES,
} from "../src/lib/repositories.mjs";
import { assertPenaltyHistory } from "../src/lib/score-penalties";
import type { GitHubClient } from "../workers/slopbot/github";
import type { PublishedPenaltyHistory as PublishedPenaltyRow } from "../workers/slopbot/penalties";
import { loadPolicy } from "../workers/slopbot/review";
import { readValueDecisionFromHistory } from "../workers/slopbot/value-consumption";
import {
  collectValueContext,
  type ValueContextSelection,
} from "../workers/slopbot/value-context";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import type { valueHistory } from "../workers/slopbot/value-journal";
import type { ValueMergeRecipe } from "../workers/slopbot/value-merge-profile";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit";
import {
  consumeWorkUnitHistory,
  readWorkUnitHistory,
} from "../workers/slopbot/value-work-unit-consumption";
import type { workUnitHistory } from "../workers/slopbot/value-work-unit-journal";
import { fetchProjectRegistry } from "./sync-project-registry.mjs";
import {
  hydrateValueMergeSource,
  type PublicMergeRepository,
} from "./value-merge-ingestion";

type JointPage = Awaited<ReturnType<typeof workUnitHistory>>;
const HISTORY_ORIGIN = "https://slopbot.slop.cash";
type Page = Awaited<ReturnType<typeof valueHistory>>;
type Fetch = typeof fetch;

/**
 * The hosted value feed did not answer: a transport failure, a timeout, or a
 * retryable HTTP status. Owner decision D2: the release keeps the last
 * published snapshot with its stale label and retries on the next run. It
 * never falls back to legacy scoring. Integrity failures stay plain errors.
 */
export class ValueFeedUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The hosted value feed is unavailable", { cause });
    this.name = "ValueFeedUnavailableError";
  }
}

/** Process exit status for a value feed outage (EX_TEMPFAIL). */
export const VALUE_FEED_UNAVAILABLE_EXIT_CODE = 75;

/** Any failure to read an answered body (interrupted, reset or timed out) is
 * an outage. Malformed JSON in a complete body is an integrity failure and
 * stops the publication. */
async function readFeedJson<T>(response: Response): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ValueFeedUnavailableError(error);
  }
  return JSON.parse(text) as T;
}

/** The fixed HTTPS origin, not a digest supplied by an arbitrary URL, is the
 * publication authority. Test callers can inject a transport, never a new URL.
 */
async function fetchHistoryPage(
  kind: "single" | "joint",
  repository: string,
  pull: number,
  after: number,
  transport: Fetch,
  through: number | null = null,
  repositoryNodeId?: string,
) {
  const registered = findRegisteredRepositoryById(repository);
  if (
    !registered ||
    !Number.isSafeInteger(pull) ||
    pull < 1 ||
    !Number.isSafeInteger(after) ||
    after < 0 ||
    (kind === "joint" && after > 0 && through === null) ||
    (through !== null && (!Number.isSafeInteger(through) || through < after))
  )
    throw new Error("Invalid value-history source query");
  const project = findIngestedProjectByRepositoryId(registered.id);
  // Each project's primary repository has an immutable D1 authority pin.
  // Secondary repositories retain the existing registered-name read path.
  const pinnedNodeId =
    project?.repositories[0].id === registered.id
      ? project.authority.repositoryNodeId
      : null;
  if (
    repositoryNodeId !== undefined &&
    pinnedNodeId !== null &&
    repositoryNodeId !== pinnedNodeId
  )
    throw new Error(
      "Value-history repository identity differs from the registry",
    );
  const immutableRead = repositoryNodeId !== undefined && pinnedNodeId !== null;
  const url = new URL(
    kind === "joint" ? "/v1/work-unit-assessments" : "/v1/value-assessments",
    HISTORY_ORIGIN,
  );
  url.searchParams.set(
    immutableRead ? "repositoryNodeId" : "repository",
    immutableRead ? repositoryNodeId : registered.id,
  );
  url.searchParams.set("pull", String(pull));
  url.searchParams.set("after", String(after));
  if (through !== null) url.searchParams.set("through", String(through));
  let response: Response;
  try {
    response = await transport(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ValueFeedUnavailableError(error);
  }
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  )
    throw new ValueFeedUnavailableError(`HTTP ${response.status}`);
  if (response.status !== 200 || response.redirected || !response.body)
    throw new Error("Authoritative value history is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let result: Awaited<ReturnType<typeof reader.read>>;
    try {
      result = await reader.read();
    } catch (error) {
      throw new ValueFeedUnavailableError(error);
    }
    if (result.done) break;
    size += result.value.byteLength;
    if (size > 8 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Value history response exceeds its page bound");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    body?.schemaVersion !==
      (kind === "joint"
        ? "slop-work-unit-history:v1"
        : "slop-value-history:v1") ||
    (immutableRead
      ? body.repositoryNodeId !== repositoryNodeId
      : body.repository !== registered.id) ||
    body.pullRequestNumber !== pull ||
    !Array.isArray(body.records) ||
    body.records.length > 100 ||
    !(
      body.nextAfter === null ||
      (Number.isSafeInteger(body.nextAfter) && body.nextAfter > after)
    )
  )
    throw new Error("Value history page has invalid identity or pagination");
  if (
    kind === "joint" &&
    (!Number.isSafeInteger(body.throughSequence) ||
      body.throughSequence < after ||
      (through !== null && body.throughSequence !== through) ||
      !Number.isSafeInteger(body.totalRecords) ||
      body.totalRecords < body.records.length)
  )
    throw new Error("Joint value history has an invalid snapshot boundary");
  return body;
}

/**
 * Reads every unreversed debit of one project from the fixed hosted origin
 * (PRD section 7). An outage keeps the last published snapshot, like the
 * value feed; a malformed page fails the publication.
 */
export async function fetchProjectPenalties(
  projectId: string,
  transport: Fetch = fetch,
): Promise<PenaltyFeedRecord[]> {
  return (await fetchPenaltyRecords(projectId, transport, false)).records;
}

export async function fetchProjectPenaltyHistory(
  projectId: string,
  transport: Fetch = fetch,
): Promise<PenaltyHistoryRecord[]> {
  const { records } = await fetchPenaltyRecords(projectId, transport, true);
  assertPenaltyHistory(records, [projectId]);
  return records;
}

/**
 * The projects the fixed penalty feed knows, or null when it knows every
 * registered project. Slopbot and the production registry API read the same
 * D1 project table. A staging build syncs its registry from staging but reads
 * this production feed, which answers HTTP 400 for a project that only
 * staging lists. That project has no feed record. A listed project still
 * fails closed.
 */
export async function penaltyFeedProjects(
  tier: DeploymentTier,
): Promise<ReadonlySet<string> | null> {
  if (tier === "production") return null;
  const { projects } = await fetchProjectRegistry(
    deploymentOrigins("production").site,
  );
  const ids = projects.map((project) => (project as { id?: unknown })?.id);
  if (ids.some((id) => typeof id !== "string"))
    throw new Error("Production project registry lists an invalid project");
  return new Set(ids as string[]);
}

/** During the first release the deployed Worker can still serve only v1
 * active rows. Those remain usable, but cannot establish any reversal. */
export async function fetchProjectPenaltyState(
  projectId: string,
  transport: Fetch = fetch,
): Promise<{
  penalties: PenaltyFeedRecord[];
  history: PenaltyHistoryRecord[] | null;
}> {
  const result = await fetchPenaltyRecords(projectId, transport, true, true);
  if (!result.history) return { penalties: result.records, history: null };
  assertPenaltyHistory(result.records, [projectId]);
  return {
    penalties: result.records.filter((row) => row.reversedAt === null),
    history: result.records,
  };
}

async function fetchPenaltyRecords(
  projectId: string,
  transport: Fetch,
  history: boolean,
  allowLegacy = false,
): Promise<{ records: PenaltyFeedRecord[]; history: boolean }> {
  if (!REGISTERED_REPOSITORIES.some((entry) => entry.projectId === projectId))
    throw new Error("Penalty source project is not registered");
  const records: PenaltyFeedRecord[] = [];
  let after = "";
  let schema: string | undefined;
  for (;;) {
    const url = new URL("/v1/penalties", HISTORY_ORIGIN);
    url.searchParams.set("project", projectId);
    url.searchParams.set("after", after);
    if (history) url.searchParams.set("history", "1");
    let response: Response;
    try {
      response = await transport(url, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new ValueFeedUnavailableError(error);
    }
    // A Slopbot release without this route (404) is an outage too: keep the
    // last published snapshot instead of publishing scores without debits.
    if (
      response.status === 404 ||
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    )
      throw new ValueFeedUnavailableError(`HTTP ${response.status}`);
    if (response.status !== 200 || response.redirected)
      throw new Error("Authoritative penalty feed is unavailable");
    const body = await readFeedJson<{
      schemaVersion?: unknown;
      project?: unknown;
      records?: unknown;
      nextAfter?: unknown;
    }>(response);
    if (
      !(
        body?.schemaVersion ===
          (history ? "slop-penalty-history:v1" : "slop-penalties:v1") ||
        (allowLegacy && body?.schemaVersion === "slop-penalties:v1")
      ) ||
      (schema !== undefined && schema !== body.schemaVersion) ||
      body.project !== projectId ||
      !Array.isArray(body.records) ||
      body.records.length > 100 ||
      !(
        body.nextAfter === null ||
        (typeof body.nextAfter === "string" && body.nextAfter > after)
      )
    )
      throw new Error("Penalty feed page has invalid identity or pagination");
    schema = String(body.schemaVersion);
    for (const row of body.records as PublishedPenaltyRow[]) {
      if (
        typeof row?.item_node_id !== "string" ||
        row.item_node_id <= after ||
        (body.nextAfter !== null && row.item_node_id > body.nextAfter)
      )
        throw new Error("Penalty feed page is out of order");
      records.push({
        itemNodeId: row.item_node_id,
        authorGithubId: row.author_github_id,
        category: row.category,
        tableVersion: row.table_version,
        debitThirds: row.debit_thirds,
        period: row.period,
        recordedAt: row.recorded_at,
        ...(schema === "slop-penalty-history:v1"
          ? { projectId, reversedAt: row.reversed_at, reversal: row.reversal }
          : {}),
      });
    }
    if (body.nextAfter === null)
      return { records, history: schema === "slop-penalty-history:v1" };
    // The cursor must be the page's last record, or rows between are skipped.
    if (body.nextAfter !== records.at(-1)?.itemNodeId)
      throw new Error("Penalty feed cursor skips records");
    after = body.nextAfter;
  }
}

export async function fetchValueHistoryPage(
  repository: string,
  pull: number,
  after: number,
  transport: Fetch = fetch,
  repositoryNodeId?: string,
): Promise<Page> {
  const page = await fetchHistoryPage(
    "single",
    repository,
    pull,
    after,
    transport,
    null,
    repositoryNodeId,
  );
  return { records: page.records, nextAfter: page.nextAfter };
}

export async function fetchWorkUnitHistoryPage(
  repository: string,
  pull: number,
  after: number,
  through: number | null,
  transport: Fetch = fetch,
  repositoryNodeId?: string,
): Promise<JointPage> {
  const page = await fetchHistoryPage(
    "joint",
    repository,
    pull,
    after,
    transport,
    through,
    repositoryNodeId,
  );
  return {
    records: page.records,
    nextAfter: page.nextAfter,
    throughSequence: page.throughSequence,
    totalRecords: page.totalRecords,
  };
}

export async function loadValueInputs(
  github: Pick<GitHubClient, "get" | "graphql" | "fileText">,
  outcomes: readonly (Pick<
    MergedPullRequestOutcome,
    "id" | "url" | "number" | "headRefOid" | "updatedAt"
  > & { mergedAt: string | null; closedAt?: string | null })[],
  transport: Fetch = fetch,
  unavailableJointSources?: (
    ids: readonly string[],
  ) => Promise<readonly string[]>,
) {
  const heldWorkUnits: HeldWorkUnit[] = [];
  const valueDecisions = new Map<
    string,
    NonNullable<LeaderboardInput["valueDecisions"]> extends ReadonlyMap<
      string,
      infer V
    >
      ? V
      : never
  >();
  type JointDecision =
    NonNullable<LeaderboardInput["jointValueDecisions"]> extends ReadonlyMap<
      string,
      infer V
    >
      ? V
      : never;
  const jointValueDecisions = new Map<string, JointDecision>();
  const valueActors = new Map<string, GitHubActor>();
  const publicRepositories = new Map<string, PublicMergeRepository>();
  const census = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  if (census.size !== outcomes.length)
    throw new Error("Value census repeats a source");
  const sourceCache = new Map<string, WorkUnitSource>();
  const observedGroups = new Map<string, string | null>();
  const groups = new Map<string, JointDecision>();

  async function repositoryIdentity(repositoryId: string) {
    const repository = findRegisteredRepositoryById(repositoryId);
    if (!repository)
      throw new Error("Value outcome repository is not registered");
    let identity = publicRepositories.get(repository.id);
    if (!identity) {
      const live = await github.get<PublicMergeRepository>(
        `/repos/${repository.owner}/${repository.name}`,
      );
      if (
        live?.private !== false ||
        (repository.expectedNodeId !== null &&
          live.node_id !== repository.expectedNodeId)
      )
        throw new Error(
          "Value ingestion requires the registered public repository",
        );
      identity = live;
      publicRepositories.set(repository.id, identity);
    }
    return { repository, identity };
  }

  async function source(
    repositoryId: string,
    number: number,
    id: string,
    contextPaths: readonly ValueContextSelection[] = [],
    recipe?: ValueMergeRecipe,
  ) {
    const hydrate = async (raw: WorkUnitSource) => {
      const collected = {
        ...raw,
        evidence: await collectValueContext(github, raw.evidence, contextPaths),
      };
      return recipe
        ? hydrateValueMergeSource(
            collected,
            recipe,
            (await repositoryIdentity(repositoryId)).identity,
          )
        : collected;
    };
    const cached = sourceCache.get(id);
    if (cached) {
      if (
        cached.evidence.repository.toLowerCase() !==
          repositoryId.toLowerCase() ||
        cached.evidence.pull.number !== number
      )
        throw new Error("Joint source identity changed between records");
      return hydrate(cached);
    }
    const { repository, identity } = await repositoryIdentity(repositoryId);
    const evidence = await collectValueEvidence(github, repository.id, number);
    const outcome = census.get(id);
    if (
      evidence.repositoryNodeId !== identity.node_id ||
      evidence.repositoryDatabaseId !== identity.id ||
      evidence.pull.node_id !== id ||
      (outcome &&
        (evidence.pull.head.sha !== outcome.headRefOid ||
          evidence.pull.merged_at !== outcome.mergedAt ||
          (outcome.mergedAt === null &&
            evidence.pull.closed_at !== outcome.closedAt) ||
          Date.parse(evidence.pull.updated_at) !==
            Date.parse(outcome.updatedAt)))
    )
      throw new Error("Value source changed after the outcome census");
    const files = await loadPolicy(
      github,
      repository.owner,
      repository.name,
      evidence.pull.base.sha,
    );
    const policy = {
      sha: evidence.pull.base.sha,
      text: files.some((file) => file.truncated)
        ? ""
        : files.map((file) => `${file.path}\n${file.text}`).join("\n\n"),
    };
    const collected = { evidence, policy };
    sourceCache.set(id, collected);
    return hydrate(collected);
  }

  async function legacy(collected: WorkUnitSource) {
    const id = collected.evidence.pull.node_id;
    const cached = valueDecisions.get(id);
    if (cached) return cached;
    const decision = await readValueDecisionFromHistory(
      (after) =>
        fetchValueHistoryPage(
          collected.evidence.repository,
          collected.evidence.pull.number,
          after,
          transport,
          collected.evidence.repositoryNodeId,
        ),
      sourceCache.get(id)?.evidence ?? collected.evidence,
      collected.policy,
      (evidence, paths) => collectValueContext(github, evidence, paths),
    );
    valueDecisions.set(id, decision);
    return decision;
  }

  async function hydrateActors(actorIds: ReadonlySet<string>) {
    const missing = [...actorIds].filter((id) => !valueActors.has(id));
    for (let offset = 0; offset < missing.length; offset += 100) {
      const ids = missing.slice(offset, offset + 100);
      const result = await github.graphql<{
        nodes: ({
          __typename: string;
          id: string;
          login: string;
          avatarUrl: string;
          url: string;
        } | null)[];
      }>(
        "query($ids:[ID!]!){nodes(ids:$ids){__typename ... on User{id login avatarUrl url} ... on Bot{id login avatarUrl url}} rateLimit{cost limit remaining resetAt}}",
        { ids },
      );
      if (!Array.isArray(result.nodes) || result.nodes.length !== ids.length)
        throw new Error("Value coauthor identities are incomplete");
      for (const [index, actor] of result.nodes.entries()) {
        if (!actor || actor.id !== ids[index] || actor.__typename !== "User")
          throw new Error(
            "Value coauthor is not a resolved GitHub User identity",
          );
        valueActors.set(actor.id, {
          id: actor.id,
          login: actor.login,
          avatarUrl: canonicalActorAvatarUrl(actor.avatarUrl),
          url: actor.url,
          kind: "User",
        });
      }
    }
  }

  for (const outcome of outcomes) {
    const [owner, repo] = new URL(outcome.url).pathname
      .split("/")
      .filter(Boolean);
    const { repository, identity } = await repositoryIdentity(
      `${owner}/${repo}`,
    );
    const graph = await readWorkUnitHistory(
      (after, through) =>
        fetchWorkUnitHistoryPage(
          repository.id,
          outcome.number,
          after,
          through,
          transport,
          identity.node_id,
        ),
      { repositoryNodeId: identity.node_id, pullRequestNodeId: outcome.id },
    );
    const groupDigest = graph.current?.row.record_digest ?? null;
    if (
      observedGroups.has(outcome.id) &&
      observedGroups.get(outcome.id) !== groupDigest
    )
      throw new Error("Joint value history changed during snapshot collection");
    observedGroups.set(outcome.id, groupDigest);
    if (graph.current) {
      const bindings = graph.current.record.sources;
      for (const member of bindings) {
        if (
          observedGroups.has(member.pullRequestNodeId) &&
          observedGroups.get(member.pullRequestNodeId) !== groupDigest
        )
          throw new Error(
            "Joint members disagree about their current decision",
          );
        observedGroups.set(member.pullRequestNodeId, groupDigest);
      }
      let decision = groups.get(graph.current.row.record_digest);
      if (!decision) {
        // Only probe members outside the complete live census. NOT_FOUND is
        // classified by the caller; transport, permission and partial responses throw.
        const references = bindings
          .filter((member) => !census.has(member.pullRequestNodeId))
          .map((member) => member.pullRequestNodeId);
        const unavailable =
          references.length && unavailableJointSources
            ? await unavailableJointSources(references)
            : [];
        if (unavailable.length) {
          if (unavailable.some((id) => !references.includes(id)))
            throw new Error("Unavailable joint source was not requested");
          decision = {
            status: "unresolved" as const,
            sourceUnavailable: true,
            history: graph.history,
            throughSequence: graph.throughSequence,
            latestDigest: graph.current.row.record_digest,
          };
          heldWorkUnits.push({
            recordDigest: graph.current.row.record_digest,
            sourceNodeIds: bindings
              .map((member) => member.pullRequestNodeId)
              .sort(),
            unavailableNodeIds: [...new Set(unavailable)].sort(),
          });
          groups.set(graph.current.row.record_digest, decision);
          for (const member of bindings)
            jointValueDecisions.set(member.pullRequestNodeId, decision);
          continue;
        }
        const members: WorkUnitSource[] = [];
        const legacyDigests = new Map<string, string | null>();
        for (const member of bindings) {
          const collected = await source(
            member.repository,
            member.pullRequestNumber,
            member.pullRequestNodeId,
            member.contextPaths ?? [],
            member.mergeRecipe,
          );
          members.push(collected);
          legacyDigests.set(
            member.pullRequestNodeId,
            (await legacy(collected)).latestDigest,
          );
        }
        decision = await consumeWorkUnitHistory(graph, members, legacyDigests);
        groups.set(graph.current.row.record_digest, decision);
        if (decision.status === "assessed") {
          const actors = new Set(
            decision.evidence.claims.flatMap(
              (claim) => claim.implementationActorNodeIds,
            ),
          );
          const positiveReviews = new Set(
            decision.assessment.units.flatMap((unit) =>
              unit.assessment.reviews
                .filter((review) => review.tier !== "none")
                .map((review) => review.sourceId),
            ),
          );
          for (const member of decision.evidence.sources)
            for (const review of member.evidence.reviews)
              if (positiveReviews.has(review.node_id) && review.user)
                actors.add(review.user.node_id);
          await hydrateActors(actors);
        }
      }
      for (const member of bindings)
        jointValueDecisions.set(member.pullRequestNodeId, decision);
      continue;
    }
    const first = await fetchValueHistoryPage(
      repository.id,
      outcome.number,
      0,
      transport,
      identity.node_id,
    );
    if (first.records.length === 0 && first.nextAfter === null) {
      valueDecisions.set(outcome.id, {
        status: "missing",
        history: [],
        latestDigest: null,
        implementationActorNodeIds: [],
      });
      continue;
    }
    const collected = await source(repository.id, outcome.number, outcome.id);
    const decision = await readValueDecisionFromHistory(
      (after) =>
        after === 0
          ? Promise.resolve(first)
          : fetchValueHistoryPage(
              repository.id,
              outcome.number,
              after,
              transport,
              identity.node_id,
            ),
      collected.evidence,
      collected.policy,
      (evidence, paths) => collectValueContext(github, evidence, paths),
    );
    valueDecisions.set(outcome.id, decision);
    if (decision.status === "assessed")
      await hydrateActors(new Set(decision.implementationActorNodeIds));
  }
  return { valueDecisions, jointValueDecisions, valueActors, heldWorkUnits };
}

const ACCOUNT_BAN_FEED = "https://slop.cash/api/v1/project-account-bans";

/**
 * PRD section 8: a banned account receives no new contribution or review
 * credit. The public feed lists immutable GitHub IDs and ban start times
 * only. Each ID resolves to the GitHub node ID that score events carry. An
 * unanswered feed keeps the last published snapshot (owner decision D2); a
 * malformed one stops publication.
 */
export async function loadParticipationBans(
  github: Pick<GitHubClient, "get">,
  transport: Fetch = fetch,
): Promise<Map<string, string>> {
  let response: Response;
  try {
    response = await transport(ACCOUNT_BAN_FEED, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ValueFeedUnavailableError(error);
  }
  // 404 covers the release window before the route is deployed.
  if (
    response.status === 404 ||
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  )
    throw new ValueFeedUnavailableError(`HTTP ${response.status}`);
  if (response.status !== 200 || response.redirected)
    throw new Error("The account ban feed is unavailable");
  const body = await readFeedJson<{ schemaVersion?: unknown; bans?: unknown }>(
    response,
  );
  if (
    body?.schemaVersion !== "slop-account-bans:v1" ||
    !Array.isArray(body.bans) ||
    body.bans.length > 10_000
  )
    throw new Error("The account ban feed has an invalid shape");
  const bans = new Map<string, string>();
  const seen = new Set<string>();
  for (const ban of body.bans as { githubId?: unknown; bannedAt?: unknown }[]) {
    if (
      typeof ban?.githubId !== "string" ||
      !/^[1-9][0-9]{0,19}$/u.test(ban.githubId) ||
      seen.has(ban.githubId) ||
      typeof ban.bannedAt !== "string" ||
      Number.isNaN(Date.parse(ban.bannedAt))
    )
      throw new Error("The account ban feed has an invalid record");
    seen.add(ban.githubId);
    const account = await github.get<{ id: number; node_id: string }>(
      `/user/${ban.githubId}`,
    );
    // A deleted account has no node ID, so no new event can carry it.
    if (account === null) continue;
    if (
      String(account.id) !== ban.githubId ||
      typeof account.node_id !== "string"
    )
      throw new Error("GitHub returned a different account for a ban");
    bans.set(account.node_id, new Date(ban.bannedAt).toISOString());
  }
  return bans;
}
