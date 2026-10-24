import { canonicalActorAvatarUrl } from "../src/lib/leaderboard";
/** Read only: no model calls, score publication or payment authority. */
import type {
  GitHubActor,
  LeaderboardInput,
  MergedPullRequestOutcome,
} from "../src/lib/leaderboard-types";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import type { GitHubClient } from "../workers/slopbot/github";
import { loadPolicy } from "../workers/slopbot/review";
import { readValueDecisionFromHistory } from "../workers/slopbot/value-consumption";
import {
  collectValueContext,
  type ValueContextSelection,
} from "../workers/slopbot/value-context";
import { collectValueEvidence } from "../workers/slopbot/value-evidence";
import type { valueHistory } from "../workers/slopbot/value-journal";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit";
import {
  consumeWorkUnitHistory,
  readWorkUnitHistory,
} from "../workers/slopbot/value-work-unit-consumption";
import type { workUnitHistory } from "../workers/slopbot/value-work-unit-journal";

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
  const url = new URL(
    kind === "joint" ? "/v1/work-unit-assessments" : "/v1/value-assessments",
    HISTORY_ORIGIN,
  );
  url.searchParams.set("repository", registered.id);
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
    body.repository !== registered.id ||
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

export async function fetchValueHistoryPage(
  repository: string,
  pull: number,
  after: number,
  transport: Fetch = fetch,
): Promise<Page> {
  const page = await fetchHistoryPage(
    "single",
    repository,
    pull,
    after,
    transport,
  );
  return { records: page.records, nextAfter: page.nextAfter };
}

export async function fetchWorkUnitHistoryPage(
  repository: string,
  pull: number,
  after: number,
  through: number | null,
  transport: Fetch = fetch,
): Promise<JointPage> {
  const page = await fetchHistoryPage(
    "joint",
    repository,
    pull,
    after,
    transport,
    through,
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
) {
  const valueDecisions = new Map<
    string,
    NonNullable<LeaderboardInput["valueDecisions"]> extends ReadonlyMap<
      string,
      infer V
    >
      ? V
      : never
  >();
  const jointValueDecisions = new Map<
    string,
    Awaited<ReturnType<typeof consumeWorkUnitHistory>>
  >();
  const valueActors = new Map<string, GitHubActor>();
  const publicRepositories = new Map<string, { id: number; node_id: string }>();
  const census = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  if (census.size !== outcomes.length)
    throw new Error("Value census repeats a source");
  const sourceCache = new Map<string, WorkUnitSource>();
  const observedGroups = new Map<string, string | null>();
  const groups = new Map<
    string,
    Awaited<ReturnType<typeof consumeWorkUnitHistory>>
  >();

  async function repositoryIdentity(repositoryId: string) {
    const repository = findRegisteredRepositoryById(repositoryId);
    if (!repository)
      throw new Error("Value outcome repository is not registered");
    let identity = publicRepositories.get(repository.id);
    if (!identity) {
      const live = await github.get<{
        id: number;
        node_id: string;
        private: boolean;
      }>(`/repos/${repository.owner}/${repository.name}`);
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
  ) {
    const cached = sourceCache.get(id);
    if (cached) {
      if (
        cached.evidence.repository.toLowerCase() !==
          repositoryId.toLowerCase() ||
        cached.evidence.pull.number !== number
      )
        throw new Error("Joint source identity changed between records");
      return {
        ...cached,
        evidence: await collectValueContext(
          github,
          cached.evidence,
          contextPaths,
        ),
      };
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
    return {
      ...collected,
      evidence: await collectValueContext(github, evidence, contextPaths),
    };
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
        const members: WorkUnitSource[] = [];
        const legacyDigests = new Map<string, string | null>();
        for (const member of bindings) {
          const collected = await source(
            member.repository,
            member.pullRequestNumber,
            member.pullRequestNodeId,
            member.contextPaths ?? [],
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
            ),
      collected.evidence,
      collected.policy,
      (evidence, paths) => collectValueContext(github, evidence, paths),
    );
    valueDecisions.set(outcome.id, decision);
    if (decision.status === "assessed")
      await hydrateActors(new Set(decision.implementationActorNodeIds));
  }
  return { valueDecisions, jointValueDecisions, valueActors };
}
