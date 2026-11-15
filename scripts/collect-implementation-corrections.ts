/** Trusted, read-only historical evidence collection (PRD section 7).
 * A month can be collected and resumed independently. No candidate becomes
 * complete until the entire repository ownership census is available.
 * This script never applies a correction or reads protected financial state.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { isCreditEligibleCommitAuthor } from "../src/lib/commit-credit";
import {
  commitCreditOwners,
  type MergedPullRequestOutcome,
  repositoryIdFromUrl,
} from "../src/lib/leaderboard";
import {
  assertPointsJournal,
  latestPoints,
  type PointRevision,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import {
  type CorrectionActor,
  type CorrectionClaim,
  type CorrectionSource,
  correctionClaimCommit,
  createPointsCorrectionBaseline,
  isOriginalContributorContext,
  isOriginalContributorFollowup,
  type OriginalContributorBinding,
  type OriginalContributorFollowup,
  originalContributorClaimScope,
  originalContributorPrecedesFollowups,
  type PointsImplementationCorrectionCandidate,
  type PointsImplementationCorrectionManifest,
  referencesOriginalContributorSource,
} from "../src/lib/points-implementation-corrections";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import {
  collectTargetRepositories,
  type TargetRepository,
} from "../src/lib/repositories.mjs";
import { GitHubClient } from "../workers/slopbot/github";
import {
  collectValueEvidence,
  collectValueReferenceEvidence,
  valueReferenceTimelineRequest,
} from "../workers/slopbot/value-evidence";
import type {
  Pull,
  ValueEvidence,
} from "../workers/slopbot/value-evidence-types";
import { mergeResolutionLineCounts } from "../workers/slopbot/value-merge-resolution";
import {
  valueAdditionCount,
  valueDeletionCount,
} from "../workers/slopbot/value-patch";
import { isConfirmedMissingPublicReference } from "../workers/slopbot/value-reference-query";
import { retainedCopyBindings } from "../workers/slopbot/value-retained-copy";
import { retainedAcknowledgements } from "../workers/slopbot/value-retained-reference";
import { valueSourceDigest } from "../workers/slopbot/value-review";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";
import {
  collectSearchReferences,
  commitStatisticsFailure,
  completeOutcomeCommits,
  GitHubGraphqlClient,
  type GraphqlExecutor,
  GraphqlUpstreamError,
  narrowedPageSize,
  type OutcomeCommitIdentity,
  OutcomeCommitLineLoader,
  parseActor,
  parseSearchReference,
  resolveGitHubToken,
} from "./generate-leaderboard";
import { loadPublishedPoints } from "./generate-points";
import {
  historicalDiscussionHasRateLimit,
  historicalDiscussionQuery,
  validateHistoricalDiscussion,
} from "./historical-discussion-evidence";
import { assertCorrectionRegistry } from "./points-correction-registry";
import { retainedCommitCreditSources } from "./retained-commit-credit";
import { fetchProjectRegistry } from "./sync-project-registry.mjs";
import { loadValueInputs, ValueFeedUnavailableError } from "./value-ingestion";

const RULE = "historical-implementation-allocation-v1" as const;
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const encode = (value: unknown) => JSON.stringify(value);
const canonicalTime = (value: string) => new Date(value).toISOString();
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export interface CorrectionPool {
  candidate: PointsImplementationCorrectionCandidate;
  totalPoints: number;
  predecessors: PointRevision[];
}

/** Inventory every current positive pool, retaining zero-valued predecessors.
 * Own-PR and grouped keys are intentionally distinct, matching the allocator.
 */
export function inventoryCorrectionPools(
  journal: PointsJournal,
  projects: readonly string[],
): CorrectionPool[] {
  assertPointsJournal(journal);
  const selected = new Set(projects);
  const groups = new Map<string, PointRevision[]>();
  for (const revision of latestPoints(journal).values()) {
    const award = revision.award;
    if (
      !selected.has(award.projectId) ||
      award.category !== "merged-pull-request"
    )
      continue;
    const own =
      award.key ===
      pointKey(award.projectId, award.actor.id, award.category, award.sourceId);
    const key = encode([
      award.projectId,
      award.sourceId,
      own ? null : award.workUnitId,
    ]);
    const rows = groups.get(key) ?? [];
    rows.push(revision);
    groups.set(key, rows);
  }
  const result: CorrectionPool[] = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => a.award.key.localeCompare(b.award.key));
    const totalPoints = rows.reduce((n, row) => n + row.award.amount, 0);
    if (totalPoints <= 0) continue;
    requireThat(
      Number.isSafeInteger(totalPoints),
      "Recorded pool total overflows",
    );
    const first = rows[0].award;
    requireThat(
      rows.every(
        ({ award }) =>
          award.sourceUrl === first.sourceUrl &&
          award.occurredAt === first.occurredAt &&
          award.workUnitId === first.workUnitId,
      ),
      "Recorded pool identities disagree",
    );
    const own =
      first.key ===
      pointKey(first.projectId, first.actor.id, first.category, first.sourceId);
    result.push({
      totalPoints,
      predecessors: rows,
      candidate: {
        id: `correction_${digest(key)}`,
        kind: own ? "pull-request" : "work-unit",
        projectId: first.projectId,
        sourceId: first.sourceId,
        sourceUrl: first.sourceUrl,
        occurredAt: first.occurredAt,
        workUnitId: first.workUnitId,
        sourceIds: [first.sourceId],
        expectedPredecessors: rows.map((row) => ({
          key: row.award.key,
          revisionId: row.id,
        })),
        proof: { status: "held" },
      },
    });
  }
  return result.sort((a, b) => a.candidate.id.localeCompare(b.candidate.id));
}

export function censusMonths(
  createdAt: string,
  through: string,
): { month: string; from: string; to: string }[] {
  const end = Math.floor(Date.parse(through) / 1000) * 1000;
  let start = Date.parse(createdAt);
  requireThat(
    Number.isFinite(start) && Number.isFinite(end) && start < end,
    "Invalid census interval",
  );
  start = Math.floor(start / 1000) * 1000;
  const months = [];
  while (start < end) {
    const date = new Date(start);
    const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const to = Math.min(end, next);
    months.push({
      month: date.toISOString().slice(0, 7),
      from: new Date(start).toISOString(),
      to: new Date(to).toISOString(),
    });
    start = to;
  }
  return months;
}

/** A budget checkpoint is explicit and safely resumable, never a partial pass. */
export class CollectionBudgetExhausted extends Error {
  constructor(
    readonly kind: "quota" | "request-budget",
    readonly newRequests: number,
    readonly reportedGraphqlCost: number,
    readonly retryAtMs?: number,
    readonly savedRequests = 0,
  ) {
    super(
      kind === "quota"
        ? "GitHub API quota exhausted; wait for quota recovery and rerun the same baseline-bound campaign"
        : "Request budget reached; rerun the same baseline-bound campaign",
    );
  }
}

interface GithubQuotaPayload {
  message?: unknown;
  errors?: unknown[];
  data?: { rateLimit?: { cost: number; resetAt?: unknown } };
}

type CollectionInterruption = {
  kind: CollectionBudgetExhausted["kind"];
  retryAtMs?: number;
};

function collectionStop(error: unknown): CollectionBudgetExhausted | null {
  const seen = new Set<Error>();
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof CollectionBudgetExhausted) return error;
    seen.add(error);
    error = error.cause;
  }
  return null;
}

function githubQuotaStop(
  response: Response,
  graphql: boolean,
  payload: GithubQuotaPayload | undefined,
  now: number,
): { retryAtMs?: number } | null {
  const retryAfter = response.headers.get("retry-after");
  const retrySeconds =
    retryAfter && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : NaN;
  const retryAt = now + retrySeconds * 1_000;
  const validRetryAfter = Number.isSafeInteger(retryAt);
  const primary =
    (response.status === 403 || response.status === 429) &&
    response.headers.get("x-ratelimit-remaining") === "0";
  const secondary =
    response.status === 403 &&
    (validRetryAfter ||
      (typeof payload?.message === "string" &&
        /secondary rate limit|abuse detection/iu.test(payload.message)));
  const graphqlLimited =
    response.status === 200 &&
    graphql &&
    Array.isArray(payload?.errors) &&
    payload.errors.some(
      (error) =>
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "RATE_LIMITED",
    );
  if (!primary && !graphqlLimited && response.status !== 429 && !secondary)
    return null;
  const reset = response.headers.get("x-ratelimit-reset");
  const headerReset =
    (primary || graphqlLimited) && reset && /^\d+$/u.test(reset)
      ? Number(reset) * 1_000
      : NaN;
  const graphReset =
    graphqlLimited && typeof payload?.data?.rateLimit?.resetAt === "string"
      ? Date.parse(payload.data.rateLimit.resetAt)
      : NaN;
  const future = (time: number) =>
    Number.isSafeInteger(time + 2_000) && time >= now;
  if (primary && !future(headerReset)) return {};
  const times = [retryAt, headerReset, graphReset].filter(future);
  if (times.length) return { retryAtMs: Math.max(...times) + 2_000 };
  if (response.status === 429 || graphqlLimited || secondary)
    return { retryAtMs: now + 60_000 };
  return {};
}

interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  bodyDigest: string;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function atomicJson(path: string, value: unknown) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${encode(value)}\n`);
  await rename(temporary, path);
}
/** Publish only a complete immutable file. An interrupted temporary write is
 * never visible at the digest path and cannot poison a resumed campaign.
 */
export async function immutableBytes(path: string, bytes: Uint8Array) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let failure: { error: unknown } | undefined;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      // link is an atomic create-if-absent operation on the same filesystem.
      // rename would overwrite an existing immutable digest path.
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      requireThat(
        digest(await readFile(path)) === digest(bytes),
        "Immutable cache bytes changed",
      );
    }
  } catch (error) {
    failure = { error };
  }
  try {
    await unlink(temporary);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !failure)
      failure = { error };
  }
  if (failure) throw failure.error;
}

/** Exact successful responses are frozen within one baseline-bound campaign.
 * Credentials and request headers are never persisted. Failed responses remain
 * raw evidence, but never become cache hits. Reuse does not spend live quota.
 */
export class CorrectionEvidenceCache {
  requests = 0;
  allowRequests = true;
  cacheHits = 0;
  reportedGraphqlCost = 0;
  private interruption: CollectionInterruption | null = null;
  private readonly inFlight = new Set<Promise<Response>>();
  private readonly savedRequests = new Set<string>();
  constructor(
    readonly directory: string,
    readonly transport: typeof fetch,
    readonly requestBudget = 2000,
    readonly now = Date.now,
  ) {}
  get stop(): CollectionBudgetExhausted | null {
    return this.interruption ? this.stopError(this.interruption) : null;
  }
  private stopError(interruption: CollectionInterruption) {
    return new CollectionBudgetExhausted(
      interruption.kind,
      this.requests,
      this.reportedGraphqlCost,
      interruption.retryAtMs,
      this.savedRequests.size,
    );
  }
  assertUninterrupted(): void {
    const stop = this.stop;
    if (stop) throw stop;
  }
  async settleReads(): Promise<void> {
    await Promise.allSettled(this.inFlight);
  }
  async hasSuccessfulRequest(url: string, method = "GET", body = "") {
    this.assertUninterrupted();
    return (
      (await readJson<CachedResponse>(
        this.requestPath(this.requestKey(url, method, body)),
      )) !== null
    );
  }
  private requestKey(url: string, method: string, body: string) {
    return digest(encode({ url, method, body }));
  }
  private requestPath(key: string) {
    return resolve(this.directory, "requests", `${key}.json`);
  }
  private interrupt(
    kind: CollectionBudgetExhausted["kind"],
    retryAtMs?: number,
  ): never {
    const existing = this.interruption;
    let interruption = existing ?? { kind, retryAtMs };
    if (kind === "request-budget") {
      interruption = { kind };
    } else if (existing?.kind === "quota") {
      interruption = {
        kind,
        retryAtMs:
          retryAtMs === undefined || existing.retryAtMs === undefined
            ? undefined
            : Math.max(retryAtMs, existing.retryAtMs),
      };
    }
    this.interruption = interruption;
    throw this.stopError(interruption);
  }
  readonly fetch: typeof fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const read = this.fetchEvidence(input, init);
      this.inFlight.add(read);
      const remove = () => {
        this.inFlight.delete(read);
      };
      void read.then(remove, remove);
      return read;
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  private async fetchEvidence(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) {
    this.assertUninterrupted();
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input));
    const method = (init.method ?? request?.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : "";
    requireThat(
      !url.username && !url.password && !url.hash,
      "Credential-bearing URL refused",
    );
    const github = url.origin === "https://api.github.com";
    const feed =
      url.origin === "https://slopbot.slop.cash" ||
      url.origin === "https://slop.cash";
    requireThat(
      (github &&
        (method === "GET" ||
          (method === "POST" &&
            url.pathname === "/graphql" &&
            !/\bmutation\b/u.test(JSON.parse(body).query)))) ||
        (feed && method === "GET"),
      "Only canonical read-only source requests are permitted",
    );
    const key = this.requestKey(url.href, method, body);
    const path = this.requestPath(key);
    const cached = await readJson<CachedResponse>(path);
    if (cached) {
      const bytes = await readFile(
        resolve(this.directory, "objects", cached.bodyDigest),
      );
      requireThat(
        digest(bytes) === cached.bodyDigest,
        "Cached response digest mismatch",
      );
      this.cacheHits += 1;
      return new Response(bytes, {
        status: cached.status,
        headers: cached.headers,
      });
    }
    requireThat(
      this.allowRequests,
      "Cached census is missing raw request evidence",
    );
    this.assertUninterrupted();
    if (this.requests >= this.requestBudget) this.interrupt("request-budget");
    const attempt = ++this.requests;
    const response = await this.transport(input, init);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const bodyDigest = digest(bytes);
    const headers = Object.fromEntries(
      [
        "content-type",
        "x-github-request-id",
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
        "retry-after",
      ].flatMap((name) => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }),
    );
    let parsed: GithubQuotaPayload | undefined;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      /* Retain non-JSON failures exactly. */
    }
    this.reportedGraphqlCost += parsed?.data?.rateLimit?.cost ?? 0;
    await immutableBytes(resolve(this.directory, "objects", bodyDigest), bytes);
    await immutableBytes(
      resolve(
        this.directory,
        "attempts",
        `${this.now()}-${attempt}-${key}-${randomUUID()}.json`,
      ),
      new TextEncoder().encode(
        encode({
          url: url.href,
          method,
          body,
          status: response.status,
          headers,
          bodyDigest,
        }),
      ),
    );
    if (github) {
      const quota = githubQuotaStop(
        response,
        url.pathname === "/graphql",
        parsed,
        this.now(),
      );
      if (quota) this.interrupt("quota", quota.retryAtMs);
    }
    const validJson = typeof parsed === "object" && parsed !== null;
    const completeGraphql =
      url.pathname !== "/graphql" ||
      (typeof parsed?.data === "object" && parsed.data !== null);
    const graphqlRequest =
      method === "POST" && url.pathname === "/graphql"
        ? JSON.parse(body)
        : null;
    const recoverableStatistics = graphqlRequest
      ? commitStatisticsFailure(
          graphqlRequest.query,
          parsed,
          graphqlRequest.variables ?? {},
        )
      : null;
    if (
      response.ok &&
      validJson &&
      completeGraphql &&
      (!parsed?.errors ||
        recoverableStatistics ||
        (graphqlRequest &&
          isConfirmedMissingPublicReference(
            graphqlRequest.query,
            graphqlRequest.variables ?? {},
            parsed,
          ))) &&
      (graphqlRequest?.query !== historicalDiscussionQuery ||
        historicalDiscussionHasRateLimit(parsed?.data))
    ) {
      await atomicJson(path, {
        status: response.status,
        headers,
        bodyDigest,
      });
      this.savedRequests.add(key);
    }
    return new Response(bytes, {
      status: response.status,
      headers: response.headers,
    });
  }
}

/** Keep cached rate snapshots outside the live client's budget accounting. */
function cachedExecutor(
  client: GitHubGraphqlClient,
  cache: CorrectionEvidenceCache,
): GraphqlExecutor {
  const requestPath = (query: string, variables: Record<string, unknown>) => {
    const body = encode({ query, variables });
    const key = digest(
      encode({ url: "https://api.github.com/graphql", method: "POST", body }),
    );
    return resolve(cache.directory, "requests", `${key}.json`);
  };
  const hasNodePartition = async (
    query: string,
    variables: Record<string, unknown>,
  ): Promise<boolean> => {
    if (await readJson<CachedResponse>(requestPath(query, variables)))
      return true;
    const ids = variables.ids;
    if (!Array.isArray(ids) || ids.length < 2) return false;
    const middle = Math.ceil(ids.length / 2);
    return (
      (await hasNodePartition(query, {
        ...variables,
        ids: ids.slice(0, middle),
      })) &&
      (await hasNodePartition(query, { ...variables, ids: ids.slice(middle) }))
    );
  };
  const execute = async (
    query: string,
    variables: Record<string, unknown> = {},
  ) => {
    let candidateVariables = variables as Parameters<
      typeof narrowedPageSize
    >[0];
    let cached: CachedResponse | null;
    for (;;) {
      cached = await readJson<CachedResponse>(
        requestPath(query, candidateVariables),
      );
      if (cached) break;
      // Canonical live retries can halve pageSize after a gateway failure.
      // Reuse only those exact request variants; the caller still validates
      // every cursor, total and final census digest from the retained bytes.
      const narrower = narrowedPageSize(candidateVariables);
      if (!narrower) {
        const splitNodeBatch =
          Array.isArray(variables.ids) && variables.ids.length > 1;
        if (
          !cache.allowRequests ||
          (splitNodeBatch && (await hasNodePartition(query, variables)))
        ) {
          // The live node loader can recover a failed batch by requesting its
          // halves. Let that same loader reconstruct cached halves in order.
          // A missing leaf remains an integrity failure, with no live read.
          if (splitNodeBatch)
            throw new GraphqlUpstreamError(
              "Cached node batch requires reconstruction from retained smaller batches",
              503,
            );
          throw new Error("Cached census is missing raw request evidence");
        }
        return client.execute(
          query,
          variables as Parameters<typeof client.execute>[1],
        );
      }
      candidateVariables = narrower;
    }
    const bytes = await readFile(
      resolve(cache.directory, "objects", cached.bodyDigest),
    );
    requireThat(
      digest(bytes) === cached.bodyDigest,
      "Cached GraphQL response digest mismatch",
    );
    const value = JSON.parse(bytes.toString());
    const statisticsFailure = commitStatisticsFailure(
      query,
      value,
      candidateVariables,
    );
    requireThat(
      value.data &&
        (!value.errors ||
          statisticsFailure ||
          isConfirmedMissingPublicReference(
            query,
            candidateVariables,
            value,
          )) &&
        (query !== historicalDiscussionQuery ||
          historicalDiscussionHasRateLimit(value.data)),
      "Cached GraphQL response is incomplete",
    );
    cache.cacheHits += 1;
    if (statisticsFailure) throw statisticsFailure;
    return value.data;
  };
  return {
    execute,
    compareCommitPage: client.compareCommitPage.bind(client),
    getRateLimit: client.getRateLimit.bind(client),
    getRequestCount: client.getRequestCount.bind(client),
    ensureBudget: client.ensureBudget.bind(client),
  };
}

const ACTOR = `fragment CorrectionActor on Actor { __typename login avatarUrl url ... on User { id } ... on Bot { id } ... on Mannequin { id } ... on Organization { id } }`;
const METADATA = `query CorrectionMetadata($ids:[ID!]!){nodes(ids:$ids){__typename ... on PullRequest {id number title url body createdAt updatedAt mergedAt state author{...CorrectionActor} additions deletions baseRefName baseRefOid headRefOid repository{id nameWithOwner isPrivate} mergeCommit{oid} commits(first:100){totalCount pageInfo{hasNextPage endCursor} nodes{commit{id oid parents{totalCount} author{user{...CorrectionActor}}}}}}} rateLimit{cost limit remaining resetAt}} ${ACTOR}`;
const PREFLIGHT = `query CorrectionRepository($owner:String!,$name:String!){repository(owner:$owner,name:$name){id nameWithOwner isPrivate createdAt} rateLimit{cost limit remaining resetAt}}`;

interface RepositoryMetadata {
  id: string;
  nameWithOwner: string;
  isPrivate: boolean;
  createdAt: string;
}
interface SourceMetadata {
  id: string;
  state: string;
  mergedAt: string;
  url: string;
  repository: RepositoryMetadata;
  mergeCommit: { oid: string } | null;
}

interface SourceRead {
  outcome: MergedPullRequestOutcome;
  repositoryNodeId: string;
}

/** REST aggregate counters do not depend on the separate file-pagination cap. */
async function recoverHistoricalCommitStatistics(
  github: Pick<GitHubClient, "get">,
  repository: TargetRepository,
  repositoryNodeId: string,
  expected: OutcomeCommitIdentity,
) {
  requireThat(
    repository.expectedNodeId === null ||
      repository.expectedNodeId === repositoryNodeId,
    "Commit statistics repository identity changed",
  );
  const name = `${repository.owner}/${repository.name}`;
  const path = `/repos/${name}/commits/${expected.oid}`;
  const value = await github.get<Record<string, unknown>>(path);
  requireThat(
    value &&
      value.node_id === expected.id &&
      value.sha === expected.oid &&
      value.url === `https://api.github.com${path}` &&
      value.html_url === `https://github.com/${name}/commit/${expected.oid}`,
    "REST commit identity changed",
  );
  const parents = value.parents;
  requireThat(
    Array.isArray(parents) &&
      parents.length === expected.parentCount &&
      parents.every(
        (parent) =>
          parent &&
          typeof parent === "object" &&
          typeof parent.sha === "string" &&
          /^[a-f0-9]{40}$/u.test(parent.sha),
      ) &&
      new Set(parents.map((parent) => parent.sha)).size === parents.length,
    "REST commit parents do not match the census",
  );
  const author =
    value.author === null
      ? null
      : (() => {
          requireThat(
            value.author &&
              typeof value.author === "object" &&
              !Array.isArray(value.author),
            "REST commit author is invalid",
          );
          const actor = value.author as Record<string, unknown>;
          return parseActor(
            {
              __typename: actor.type,
              id: actor.node_id,
              login: actor.login,
              avatarUrl: actor.avatar_url,
              url: actor.html_url,
            },
            "REST commit author",
          );
        })();
  requireThat(
    !author ||
      !expected.author ||
      (author.id === expected.author.id &&
        author.kind === expected.author.kind),
    "REST commit author differs from the census",
  );
  requireThat(
    value.stats &&
      typeof value.stats === "object" &&
      !Array.isArray(value.stats),
    "REST commit statistics are unavailable",
  );
  const stats = value.stats as Record<string, unknown>;
  requireThat(
    [stats.additions, stats.deletions, stats.total].every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) && Number(stats.additions) + Number(stats.deletions) === stats.total,
    "REST commit statistics do not reconcile",
  );
  return {
    additions: Number(stats.additions),
    deletions: Number(stats.deletions),
    author,
  };
}

function historicalCommitLineLoader(
  client: GraphqlExecutor,
  repository: TargetRepository,
  github: Pick<GitHubClient, "get">,
) {
  return new OutcomeCommitLineLoader(client, (repositoryNodeId, expected) =>
    recoverHistoricalCommitStatistics(
      github,
      repository,
      repositoryNodeId,
      expected,
    ),
  );
}

async function readSources(
  client: GraphqlExecutor,
  sources: readonly PointsImplementationCorrectionCandidate[],
  repository: TargetRepository,
  github: Pick<GitHubClient, "get">,
): Promise<{ complete: Map<string, SourceRead>; held: Map<string, string> }> {
  const complete = new Map<string, SourceRead>(),
    held = new Map<string, string>();
  const loader = historicalCommitLineLoader(client, repository, github);
  for (let offset = 0; offset < sources.length; offset += 20) {
    const batch = [
      ...new Map(
        sources.slice(offset, offset + 20).map((s) => [s.sourceId, s]),
      ).values(),
    ];
    const data = await client.execute(METADATA, {
      ids: batch.map((s) => s.sourceId),
    });
    requireThat(
      Array.isArray(data.nodes) && data.nodes.length === batch.length,
      "Metadata source count changed",
    );
    const staged: {
      candidate: PointsImplementationCorrectionCandidate;
      outcome: MergedPullRequestOutcome;
      identities: NonNullable<
        Awaited<ReturnType<typeof completeOutcomeCommits>>
      >;
      repositoryNodeId: string;
    }[] = [];
    for (const [index, candidate] of batch.entries()) {
      const node = data.nodes[index] as unknown as SourceMetadata | null;
      if (!node) {
        held.set(candidate.sourceId, "source-unavailable");
        continue;
      }
      requireThat(
        node.id === candidate.sourceId,
        "Metadata source identity changed",
      );
      const live = node.repository;
      requireThat(
        live?.isPrivate === false &&
          live.nameWithOwner.toLowerCase() ===
            `${repository.owner}/${repository.name}`.toLowerCase() &&
          typeof live.id === "string" &&
          (repository.expectedNodeId === null ||
            live.id === repository.expectedNodeId),
        "Repository identity changed",
      );
      if (
        node.state !== "MERGED" ||
        canonicalTime(node.mergedAt) !== candidate.occurredAt ||
        node.url !== candidate.sourceUrl
      ) {
        held.set(
          candidate.sourceId,
          "accepted-source-no-longer-matches-recorded-pool",
        );
        continue;
      }
      const reference = parseSearchReference(
        node,
        `data.nodes[${index}]`,
        "PullRequest",
        true,
      );
      requireThat(reference.outcome, "Merged source outcome missing");
      const identities = await completeOutcomeCommits(
        client,
        reference,
        repository,
      );
      requireThat(identities !== null, "Complete commit evidence missing");
      staged.push({
        candidate,
        outcome: reference.outcome,
        identities,
        repositoryNodeId: live.id,
      });
    }
    if (!staged.length) continue;
    requireThat(
      staged.every((s) => s.repositoryNodeId === staged[0].repositoryNodeId),
      "Batch spans repository identities",
    );
    const lines = await loader.hydrate(
      staged[0].repositoryNodeId,
      staged.flatMap((s) => s.identities),
    );
    let cursor = 0;
    for (const item of staged) {
      item.outcome.commits = lines.slice(
        cursor,
        cursor + item.identities.length,
      );
      cursor += item.identities.length;
      complete.set(item.candidate.sourceId, {
        outcome: item.outcome,
        repositoryNodeId: item.repositoryNodeId,
      });
    }
  }
  return { complete, held };
}

function actor(
  value: { id: string; login: string; kind: string } | null,
): CorrectionActor | null {
  return value ? { id: value.id, login: value.login, kind: value.kind } : null;
}
function ordinarySource(
  read: SourceRead,
  owners: ReadonlyMap<string, string>,
): CorrectionSource & { occurredAt: string } {
  const outcome = read.outcome;
  requireThat(
    outcome.headRefOid && outcome.commits,
    "Complete source outcome missing",
  );
  const repository = repositoryIdFromUrl(outcome.url);
  return {
    repository,
    repositoryNodeId: read.repositoryNodeId,
    sourceId: outcome.id,
    sourceUrl: outcome.url,
    headSha: outcome.headRefOid,
    occurredAt: canonicalTime(outcome.mergedAt),
    author: actor(outcome.author),
    complete: true,
    commitCount: outcome.commits.length,
    commits: outcome.commits.map((commit) => ({
      sha: commit.oid,
      parentCount: commit.parentCount ?? -1,
      author: actor(commit.author),
      additions: commit.additions ?? null,
      deletions: commit.deletions ?? null,
      firstAcceptedSourceId:
        owners.get(`${repository.toLowerCase()}\0${commit.oid}`) ?? null,
    })),
  };
}
function richSource(
  evidence: ValueEvidence,
  owners: ReadonlyMap<string, string>,
): CorrectionSource {
  requireThat(
    evidence.limitations.length === 0 &&
      evidence.commits.length === evidence.pull.commits,
    "Full retained source evidence unavailable",
  );
  const result: CorrectionSource = {
    repository: evidence.repository,
    repositoryNodeId: evidence.repositoryNodeId,
    sourceId: evidence.pull.node_id,
    sourceUrl: evidence.pull.html_url,
    headSha: evidence.pull.head.sha,
    occurredAt: evidence.pull.merged_at
      ? canonicalTime(evidence.pull.merged_at)
      : null,
    author: {
      id: evidence.pull.user.node_id,
      login: evidence.pull.user.login,
      kind: evidence.pull.user.type,
    },
    complete: true,
    commitCount: evidence.commits.length,
    commits: evidence.commits.map((commit) => {
      if (commit.parents.length > 1) {
        const resolutions = evidence.mergeResolutions?.filter(
          (item) => item.commitSha === commit.sha,
        );
        const resolution =
          resolutions?.length === 1 ? resolutions[0] : undefined;
        const files = resolution
          ? mergeResolutionLineCounts(resolution, commit)
          : null;
        return {
          sha: commit.sha,
          parentCount: commit.parents.length,
          author: commit.author
            ? {
                id: commit.author.node_id,
                login: commit.author.login,
                kind: commit.author.type,
              }
            : null,
          additions: null,
          deletions: null,
          ...(files?.length
            ? {
                files,
                mergeResolution: resolution,
                parentShas: commit.parents.map((parent) => parent.sha),
              }
            : {}),
          firstAcceptedSourceId: evidence.pull.merged_at
            ? (owners.get(
                `${evidence.repository.toLowerCase()}\0${commit.sha}`,
              ) ?? null)
            : null,
        };
      }
      if (evidence.pull.merged_at)
        requireThat(
          owners.has(`${evidence.repository.toLowerCase()}\0${commit.sha}`),
          "Grouped source is outside the complete ownership census",
        );
      const changes = evidence.commitAttribution.filter(
        (entry) => entry.sha === commit.sha,
      );
      requireThat(
        changes.length === 1 &&
          changes[0].limitations.length === 0 &&
          changes[0].files,
        "Complete commit files unavailable",
      );
      const files = changes[0].files.map((file) => ({
        path: file.filename,
        additions: valueAdditionCount(file),
        deletions: valueDeletionCount(file),
      }));
      requireThat(
        files.every(
          (file) =>
            Number.isSafeInteger(file.additions) &&
            file.additions >= 0 &&
            Number.isSafeInteger(file.deletions) &&
            file.deletions >= 0,
        ),
        "Invalid accepted file line counts",
      );
      return {
        sha: commit.sha,
        parentCount: commit.parents.length,
        author: commit.author
          ? {
              id: commit.author.node_id,
              login: commit.author.login,
              kind: commit.author.type,
            }
          : null,
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
        files,
        firstAcceptedSourceId: evidence.pull.merged_at
          ? (owners.get(
              `${evidence.repository.toLowerCase()}\0${commit.sha}`,
            ) ?? null)
          : null,
      };
    }),
  };
  return result;
}

async function bindRetained(
  sources: readonly WorkUnitSource[],
  owners: ReadonlyMap<string, string>,
  acceptedSubset = false,
): Promise<CorrectionSource[]> {
  const retained = await retainedCopyBindings(sources, {
    ordinaryCommitsOnly: true,
    acceptedSubset,
  });
  requireThat(
    retained.limitations.length === 0,
    "Retained-copy evidence is incomplete or ambiguous",
  );
  const converted = sources.map((source) =>
    richSource(source.evidence, owners),
  );
  for (const accepted of sources.filter(
    (source) => source.evidence.pull.merged_at,
  )) {
    // Each credited commit still requires a complete accepted-path binding.
    const canonical = await retainedCommitCreditSources(accepted, sources, {
      acceptedSubset,
    });
    for (const [sha, binding] of canonical) {
      const target = converted
        .find((s) => s.sourceId === accepted.evidence.pull.node_id)
        ?.commits.find((c) => c.sha === sha);
      requireThat(target, "Retained binding target disappeared");
      const paths = [...retained.bindings.values()].filter(
        (b) =>
          b.integration.evidence.pull.node_id ===
            accepted.evidence.pull.node_id && b.acceptedCommitSha === sha,
      );
      target.retainedCopy = {
        originalSourceId: binding.originalPullRequestId,
        originalCommitSha: binding.originalCommitSha,
        boundPaths: paths.map((p) => p.path).sort(),
        bindingDigest: digest(
          encode(
            paths.map((p) => ({
              original: p.original.evidence,
              originalCommitSha: p.originalCommitSha,
              accepted: p.integration.evidence,
              acceptedCommitSha: p.acceptedCommitSha,
              path: p.path,
              preexistingCommitShas: p.preexistingCommitShas,
            })),
          ),
        ),
      };
    }
  }
  return converted;
}

interface HistoricalOrdinaryProof {
  sources: CorrectionSource[];
  originalContributor?: OriginalContributorBinding;
  originalContributorParts?: OriginalContributorBinding[];
}

function firstAcceptedOrdinary(source: CorrectionSource) {
  return source.commits.filter(
    (commit) =>
      commit.parentCount <= 1 &&
      commit.firstAcceptedSourceId === source.sourceId,
  );
}

/** A broad later integration must not make an earlier accepted native PR look
 * like copied work just because the integration PR was opened first. Keep the
 * larger pool held. Release only the smaller source after exact native ancestry
 * and its original author followed by carrier-authored commits are verified. */
export async function nativeOriginalBeforePromotion(
  github: Pick<GitHubClient, "get">,
  larger: MergedPullRequestOutcome,
  original: MergedPullRequestOutcome,
  owners: ReadonlyMap<string, string>,
): Promise<boolean> {
  const repository = repositoryIdFromUrl(larger.url);
  const originalUrl = new URL(original.url);
  if (
    originalUrl.hostname !== "github.com" ||
    originalUrl.pathname.split("/").slice(1, 3).join("/").toLowerCase() !==
      repository.toLowerCase()
  )
    return false;
  const commits = original.commits;
  const largerShas = new Set(larger.commits?.map((commit) => commit.oid));
  if (
    !verifiedHuman(larger.author) ||
    !verifiedHuman(original.author) ||
    larger.author.id === original.author.id ||
    Date.parse(original.mergedAt) > Date.parse(larger.mergedAt) ||
    !Number.isFinite(Date.parse(original.mergedAt)) ||
    !Number.isFinite(Date.parse(larger.mergedAt)) ||
    larger.baseRefName === original.baseRefName ||
    !commits?.length ||
    !larger.commits ||
    commits.length >= larger.commits.length ||
    !original.headRefOid ||
    !larger.headRefOid ||
    commits.some(
      (commit) =>
        commit.parentCount !== 1 ||
        !largerShas.has(commit.oid) ||
        owners.get(`${repository.toLowerCase()}\0${commit.oid}`) !==
          original.id,
    )
  )
    return false;
  const [large, small] = await Promise.all(
    [larger, original].map((outcome) =>
      github.get<Pull & { created_at: string }>(
        `/repos/${repository}/pulls/${outcome.number}`,
      ),
    ),
  );
  for (const [index, outcome] of [larger, original].entries()) {
    const pull = [large, small][index];
    if (
      !pull ||
      pull.node_id !== outcome.id ||
      pull.html_url !== outcome.url ||
      pull.number !== outcome.number ||
      pull.state !== "closed" ||
      pull.merged_at !== outcome.mergedAt ||
      pull.head.sha !== outcome.headRefOid ||
      pull.base.ref !== outcome.baseRefName ||
      pull.user.node_id !== outcome.author?.id ||
      pull.updated_at !== outcome.updatedAt ||
      pull.commits !== outcome.commits?.length ||
      !pull.merge_commit_sha
    )
      return false;
  }
  if (!large || !small?.merge_commit_sha) return false;
  const merge = await github.get<{ sha: string; parents: { sha: string }[] }>(
    `/repos/${repository}/git/commits/${small.merge_commit_sha}`,
  );
  if (
    merge?.sha !== small.merge_commit_sha ||
    merge.parents.length !== 2 ||
    merge.parents[1].sha !== original.headRefOid ||
    merge.parents[0].sha === merge.parents[1].sha
  )
    return false;
  const ancestry = await github.get<{
    status: string;
    behind_by: number;
    base_commit: { sha: string };
    merge_base_commit: { sha: string };
  }>(
    `/repos/${repository}/compare/${small.merge_commit_sha}...${larger.headRefOid}?per_page=100&page=1`,
  );
  if (
    !ancestry ||
    !["ahead", "identical"].includes(ancestry.status) ||
    ancestry.behind_by !== 0 ||
    ancestry.base_commit?.sha !== small.merge_commit_sha ||
    ancestry.merge_base_commit?.sha !== small.merge_commit_sha
  )
    return false;
  const native = new Map<
    string,
    {
      sha: string;
      parents: { sha: string }[];
      author: { node_id: string } | null;
    }
  >();
  for (const commit of commits) {
    const value = await github.get<{
      sha: string;
      parents: { sha: string }[];
      author: { node_id: string } | null;
    }>(`/repos/${repository}/commits/${commit.oid}?per_page=100&page=1`);
    if (
      !value ||
      value.sha !== commit.oid ||
      value.parents.length !== 1 ||
      value.author?.node_id !== commit.author?.id ||
      ![original.author.id, larger.author.id].includes(
        value.author?.node_id ?? "",
      )
    )
      return false;
    native.set(value.sha, value);
  }
  let current = original.headRefOid;
  const visited = new Set<string>();
  let originalSeen = false;
  while (native.has(current)) {
    if (visited.has(current)) return false;
    visited.add(current);
    const commit = native.get(current);
    if (!commit) return false;
    if (commit.author?.node_id === original.author.id) originalSeen = true;
    // Walking backward, every carrier follow-up must descend an original
    // anchor. An earlier carrier commit would precede the initiator instead.
    else if (originalSeen) return false;
    current = commit.parents[0].sha;
  }
  return originalSeen && visited.size === native.size;
}

export async function mirroredOctoberSources(
  github: Pick<GitHubClient, "get">,
  outcomes: readonly MergedPullRequestOutcome[],
  owners: ReadonlyMap<string, string>,
) {
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const held = new Set<string>();
  const nativePairs = new Map<string, Promise<boolean>>();
  for (const donor of outcomes) {
    if (!donor.mergedAt?.startsWith("2026-10-") || !verifiedHuman(donor.author))
      continue;
    const repository = repositoryIdFromUrl(donor.url).toLowerCase();
    for (const commit of donor.commits ?? []) {
      if (commit.parentCount !== 1 || commit.author?.id !== donor.author.id)
        continue;
      const ownerId = owners.get(`${repository}\0${commit.oid}`);
      const carrier = ownerId ? byId.get(ownerId) : undefined;
      if (
        carrier &&
        carrier.number > donor.number &&
        carrier.mergedAt !== null &&
        carrier.mergedAt <= donor.mergedAt &&
        carrier.author?.id !== donor.author.id
      ) {
        // GitHub can mark a submitted PR merged after a replacement accepts its
        // exact commits. Reconcile the two pools together before credit changes.
        held.add(donor.id);
        const pair = `${donor.id}\0${carrier.id}`;
        let nativeOriginal = nativePairs.get(pair);
        if (!nativeOriginal) {
          nativeOriginal = nativeOriginalBeforePromotion(
            github,
            donor,
            carrier,
            owners,
          ).catch(() => false);
          nativePairs.set(pair, nativeOriginal);
        }
        if (!(await nativeOriginal)) held.add(carrier.id);
      }
    }
  }
  return held;
}

function verifiedHuman(
  value: CorrectionActor | null,
): value is CorrectionActor {
  return value?.kind === "User" && isCreditEligibleCommitAuthor(value);
}

function matchRetainedAcceptedSource(
  plain: CorrectionSource,
  accepted: CorrectionSource | undefined,
) {
  requireThat(
    accepted?.headSha === plain.headSha &&
      accepted.occurredAt === plain.occurredAt &&
      accepted.repositoryNodeId === plain.repositoryNodeId,
    "Retained accepted source identity changed",
  );
  requireThat(
    accepted.commits.length === plain.commits.length &&
      accepted.commits.every((commit, index) => {
        const expected = plain.commits[index];
        return (
          commit.sha === expected.sha &&
          commit.parentCount === expected.parentCount &&
          (commit.parentCount > 1 ||
            (commit.additions === expected.additions &&
              commit.deletions === expected.deletions))
        );
      }),
    "Retained accepted commit lines differ from the canonical census",
  );
  return accepted;
}

async function authenticateOriginalFollowupParents(
  github: Pick<GitHubClient, "get">,
  source: CorrectionSource,
  evidence: ValueEvidence,
): Promise<void> {
  for (const [index, commit] of evidence.commits.entries()) {
    const parentShas = commit.parents.map(({ sha }) => sha);
    requireThat(
      /^[a-f0-9]{40}$/u.test(commit.sha) &&
        parentShas.every((parent) => /^[a-f0-9]{40}$/u.test(parent)) &&
        new Set(parentShas).size === parentShas.length &&
        !parentShas.includes(commit.sha),
      "October original Git parent evidence is malformed",
    );
    const immutable = await github.get<{
      sha: string;
      parents: { sha: string }[];
    }>(`/repos/${source.repository}/git/commits/${commit.sha}`);
    requireThat(
      immutable?.sha === commit.sha &&
        Array.isArray(immutable.parents) &&
        encode(immutable.parents.map((parent) => parent?.sha)) ===
          encode(parentShas),
      "October original Git parent evidence is unavailable or inconsistent",
    );
    source.commits[index].parentShas = parentShas;
  }
}

type NativeComparison = {
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  base_commit: { sha: string };
  merge_base_commit: { sha: string };
  commits: { sha: string; parents: { sha: string }[] }[];
};

async function nativeComparison(
  github: Pick<GitHubClient, "get">,
  repository: string,
  base: string,
  head: string,
  page = 1,
): Promise<NativeComparison> {
  const result = await github.get<NativeComparison>(
    `/repos/${repository}/compare/${base}...${head}?per_page=100&page=${page}`,
  );
  requireThat(
    result?.base_commit?.sha === base &&
      /^[a-f0-9]{40}$/u.test(result.merge_base_commit?.sha ?? "") &&
      Number.isSafeInteger(result.ahead_by) &&
      result.ahead_by >= 0 &&
      Number.isSafeInteger(result.behind_by) &&
      result.behind_by >= 0 &&
      Number.isSafeInteger(result.total_commits) &&
      result.total_commits >= 0 &&
      Array.isArray(result.commits),
    "October exact source comparison is incomplete",
  );
  return result;
}

async function authenticateNativeAcceptedRange(
  github: Pick<GitHubClient, "get">,
  source: CorrectionSource,
  evidence: ValueEvidence,
  merge: { sha: string; parents: { sha: string }[] },
  requiredShas: readonly string[],
) {
  const comparison = (base: string, head: string, page = 1) =>
    nativeComparison(github, source.repository, base, head, page);
  const expected = new Map(
    evidence.commits.map((commit) => [commit.sha, commit]),
  );
  const acceptedRange: NativeComparison[] = [];
  const observed = new Set<string>();
  let acceptedCount: number | null = null;
  for (
    let page = 1;
    page <= Math.ceil((acceptedCount ?? expected.size + 1) / 100);
    page++
  ) {
    const range = await comparison(merge.parents[0].sha, merge.sha, page);
    requireThat(
      range.status === "ahead" &&
        range.behind_by === 0 &&
        range.merge_base_commit.sha === merge.parents[0].sha &&
        range.total_commits > 0 &&
        range.total_commits <= expected.size + 1 &&
        (acceptedCount === null || range.total_commits === acceptedCount) &&
        range.ahead_by === range.total_commits &&
        range.commits.length ===
          Math.min(100, range.total_commits - (page - 1) * 100),
      "October exact accepted range differs from the complete census",
    );
    acceptedCount = range.total_commits;
    for (const commit of range.commits) {
      const canonical =
        commit.sha === merge.sha ? merge : expected.get(commit.sha);
      requireThat(
        canonical &&
          !observed.has(commit.sha) &&
          Array.isArray(commit.parents) &&
          encode(commit.parents.map(({ sha }) => sha)) ===
            encode(canonical.parents.map(({ sha }) => sha)),
        "October exact accepted range has an unknown or repeated Git object",
      );
      observed.add(commit.sha);
    }
    acceptedRange.push(range);
  }
  requireThat(
    observed.size === acceptedCount &&
      observed.has(merge.sha) &&
      requiredShas.every((sha) => observed.has(sha)) &&
      source.commits.every(
        (commit) =>
          !correctionClaimCommit(commit) ||
          commit.firstAcceptedSourceId !== source.sourceId ||
          observed.has(commit.sha),
      ),
    "October exact accepted range is incomplete",
  );
  await authenticateOriginalFollowupParents(github, source, evidence);
  // GitHub's PR list can retain commits that reached the base while the PR was
  // open. Authenticate every omitted object and prove its frontier already
  // belongs to the native first parent. The complete PR census stays retained.
  const omitted = new Map(
    source.commits
      .filter((commit) => !observed.has(commit.sha))
      .map((commit) => [commit.sha, commit]),
  );
  const nonHeads = new Set(
    [...omitted.values()].flatMap((commit) =>
      (commit.parentShas ?? []).filter((parent) => omitted.has(parent)),
    ),
  );
  const retainedBaseRanges: NativeComparison[] = [];
  const inherited = new Set<string>();
  for (const commit of omitted.values()) {
    if (nonHeads.has(commit.sha)) continue;
    const baseRange = await comparison(commit.sha, merge.parents[0].sha);
    requireThat(
      ["ahead", "identical"].includes(baseRange.status) &&
        baseRange.behind_by === 0 &&
        baseRange.merge_base_commit.sha === commit.sha,
      "October omitted PR commit is not in the native accepted base",
    );
    retainedBaseRanges.push(baseRange);
    const pending = [commit.sha];
    for (const id of pending) {
      if (inherited.has(id)) continue;
      inherited.add(id);
      pending.push(
        ...(omitted.get(id)?.parentShas ?? []).filter((parent) =>
          omitted.has(parent),
        ),
      );
    }
  }
  requireThat(
    inherited.size === omitted.size,
    "October omitted PR ancestry is incomplete",
  );
  return { acceptedRange, retainedBaseRanges };
}

/** An identical Git object needs no textual acknowledgement of a rewrite.
 * Authenticate the native merge range and its parent order before retaining
 * the complete evidence in the cache and its digest in the correction proof.
 */
async function exactOctoberOriginalContributorProof(
  github: Pick<GitHubClient, "get">,
  accepted: CorrectionSource,
  originalSource: CorrectionSource,
  integration: WorkUnitSource,
  original: WorkUnitSource,
  allowMergedOriginal = false,
  scopedClaims?: readonly CorrectionClaim[],
): Promise<HistoricalOrdinaryProof | null> {
  // Scoped units start at their first retained contributor commit. A later
  // original head can already include maintainer repairs to that same work.
  const retainedOriginal = originalSource.commits.find((commit) => {
    const nativeAcceptance = accepted.commits.some(
      (copy) =>
        copy.sha === commit.sha &&
        copy.firstAcceptedSourceId === accepted.sourceId &&
        copy.author?.id === commit.author?.id,
    );
    if (!scopedClaims)
      return commit.sha === originalSource.headSha && nativeAcceptance;
    return (
      nativeAcceptance &&
      commit.parentCount <= 1 &&
      (commit.author === null ||
        commit.author.id === originalSource.author?.id) &&
      scopedClaims.some(
        (claim) =>
          claim.commitSha === commit.sha &&
          claim.sourceId === accepted.sourceId,
      )
    );
  });
  const anchor =
    retainedOriginal ??
    (scopedClaims
      ? originalSource.commits.find(
          (commit) =>
            commit.sha === originalSource.headSha &&
            commit.parentCount === 2 &&
            verifiedHuman(commit.author) &&
            (commit.author.id === originalSource.author?.id ||
              commit.author.id === accepted.author?.id) &&
            accepted.commits.some(
              (copy) =>
                copy.sha === commit.sha &&
                copy.firstAcceptedSourceId === accepted.sourceId &&
                copy.author?.id === commit.author?.id,
            ),
        )
      : undefined);
  if (
    !anchor ||
    (anchor.parentCount !== 1 && !(scopedClaims && anchor.parentCount === 2)) ||
    (anchor.parentCount === 2 && !verifiedHuman(anchor.author)) ||
    (anchor.author?.id !== originalSource.author?.id &&
      !(
        scopedClaims &&
        (anchor.author === null || anchor.author.id === accepted.author?.id)
      )) ||
    !accepted.commits.some(
      (commit) =>
        (commit.parentCount <= 1 ||
          (scopedClaims && commit.parentCount === 2)) &&
        commit.firstAcceptedSourceId === accepted.sourceId &&
        commit.sha === anchor.sha &&
        commit.author?.id === anchor.author?.id,
    )
  )
    return null;
  const originalPull = original.evidence.pull;
  const acceptedPull = integration.evidence.pull;
  const references = (source: ValueEvidence, target: Pull) =>
    source.relatedPullRequests.some(
      (reference) =>
        reference.id === target.node_id &&
        reference.number === target.number &&
        reference.url === target.html_url &&
        reference.repository.toLowerCase() ===
          accepted.repository.toLowerCase(),
    );
  requireThat(
    accepted.occurredAt?.startsWith("2026-10-") &&
      (originalSource.occurredAt === null ||
        (allowMergedOriginal &&
          originalSource.occurredAt >= accepted.occurredAt &&
          (scopedClaims !== undefined ||
            originalSource.commits.every(
              (commit) =>
                (commit.parentCount <= 1 ||
                  (scopedClaims && commit.parentCount === 2)) &&
                commit.firstAcceptedSourceId === accepted.sourceId &&
                accepted.commits.some(
                  (copy) =>
                    copy.sha === commit.sha &&
                    copy.author?.id === commit.author?.id &&
                    copy.author?.kind === commit.author?.kind,
                ),
            )))) &&
      original.evidence.repositoryDatabaseId ===
        integration.evidence.repositoryDatabaseId &&
      (scopedClaims !== undefined ||
        references(integration.evidence, originalPull) ||
        references(original.evidence, acceptedPull)),
    "October exact source lacks a same-repository resolved PR reference",
  );
  const pulls = await Promise.all(
    [originalPull, acceptedPull].map((pull) =>
      github.get<Pull & { created_at: string }>(
        `/repos/${accepted.repository}/pulls/${pull.number}`,
      ),
    ),
  );
  for (const [index, expected] of [originalPull, acceptedPull].entries()) {
    const current = pulls[index];
    requireThat(
      current?.node_id === expected.node_id &&
        current.number === expected.number &&
        current.html_url === expected.html_url &&
        current.state === expected.state &&
        current.head.sha === expected.head.sha &&
        current.merge_commit_sha === expected.merge_commit_sha &&
        current.merged_at === expected.merged_at &&
        current.updated_at === expected.updated_at &&
        current.user.node_id === expected.user.node_id &&
        Number.isFinite(Date.parse(current.created_at)),
      "October exact source changed during collection",
    );
  }
  requireThat(
    Date.parse(pulls[0]?.created_at ?? "") <
      Date.parse(
        scopedClaims
          ? (pulls[1]?.merged_at ?? "")
          : (pulls[1]?.created_at ?? ""),
      ),
    "October exact original must precede acceptance",
  );
  const mergeSha = acceptedPull.merge_commit_sha;
  const merge = await github.get<{
    sha: string;
    parents: { sha: string }[];
  }>(`/repos/${accepted.repository}/git/commits/${mergeSha}`);
  requireThat(
    merge &&
      /^[a-f0-9]{40}$/u.test(mergeSha ?? "") &&
      merge.sha === mergeSha &&
      Array.isArray(merge.parents) &&
      merge.parents.length === 2 &&
      merge.parents.every(({ sha }) => /^[a-f0-9]{40}$/u.test(sha)) &&
      merge.parents[0].sha !== merge.parents[1].sha &&
      merge.parents[1].sha === accepted.headSha &&
      integration.evidence.mergeCommitEvidence?.sha === merge.sha &&
      encode(
        integration.evidence.mergeCommitEvidence.parents.map(({ sha }) => sha),
      ) === encode(merge.parents.map(({ sha }) => sha)),
    "October exact source lacks a pinned native merge",
  );
  const comparison = (base: string, head: string, page = 1) =>
    nativeComparison(github, accepted.repository, base, head, page);
  const firstParent = await comparison(anchor.sha, merge.parents[0].sha);
  const secondParent = await comparison(anchor.sha, merge.parents[1].sha);
  const isAncestor = (result: NativeComparison) =>
    ["ahead", "identical"].includes(result.status) &&
    result.behind_by === 0 &&
    result.merge_base_commit.sha === anchor.sha;
  requireThat(
    !isAncestor(firstParent) &&
      ["behind", "diverged"].includes(firstParent.status) &&
      firstParent.behind_by > 0 &&
      isAncestor(secondParent),
    "October exact original was not newly accepted through the PR head",
  );
  const { acceptedRange, retainedBaseRanges } =
    await authenticateNativeAcceptedRange(
      github,
      accepted,
      integration.evidence,
      merge,
      [anchor.sha, ...(scopedClaims ?? []).map((claim) => claim.commitSha)],
    );
  if (scopedClaims)
    await authenticateOriginalFollowupParents(
      github,
      originalSource,
      original.evidence,
    );
  requireThat(
    scopedClaims
      ? originalContributorClaimScope(
          originalSource,
          accepted,
          scopedClaims,
          [],
          anchor.sha,
        )
      : originalContributorPrecedesFollowups(
          { ...accepted, author: originalSource.author },
          accepted.author,
        ),
    "October exact accepted source has an unverified contributor or follow-up",
  );
  const files = accepted.commits.find(
    (commit) => commit.sha === anchor.sha,
  )?.files;
  const boundPaths =
    scopedClaims && anchor.parentCount === 2
      ? [...new Set(scopedClaims.map((claim) => claim.path))].sort()
      : files?.map((file) => file.path).sort();
  requireThat(
    boundPaths?.length,
    "October exact original lacks complete file evidence",
  );
  return {
    sources: [accepted, originalSource],
    originalContributor: {
      exactAcceptance: true,
      ...(scopedClaims
        ? { claimIds: scopedClaims.map((claim) => claim.id) }
        : {}),
      originalSourceId: originalSource.sourceId,
      originalCommitSha: anchor.sha,
      acceptedCommitSha: anchor.sha,
      boundPaths,
      bindingDigest: digest(
        encode({
          original: await valueSourceDigest(original.evidence, original.policy),
          accepted: await valueSourceDigest(
            integration.evidence,
            integration.policy,
          ),
          ...(scopedClaims ? { claims: scopedClaims } : {}),
          pulls,
          merge,
          firstParent,
          secondParent,
          acceptedRange,
          ...(retainedBaseRanges.length ? { retainedBaseRanges } : {}),
        }),
      ),
    },
  };
}

/** Bind a reviewed single-origin unit inside a multi-origin native merge. */
export async function octoberOriginalContributorUnitProof(
  github: Pick<GitHubClient, "get">,
  accepted: CorrectionSource,
  original: WorkUnitSource,
  integration: WorkUnitSource,
  owners: ReadonlyMap<string, string>,
  claims: readonly CorrectionClaim[],
  followups: readonly WorkUnitSource[] = [],
): Promise<HistoricalOrdinaryProof> {
  const source = richSource(original.evidence, owners);
  const canonical = matchRetainedAcceptedSource(
    accepted,
    richSource(integration.evidence, owners),
  );
  const proof = await exactOctoberOriginalContributorProof(
    github,
    canonical,
    source,
    integration,
    original,
    true,
    claims.filter((claim) => claim.sourceId === accepted.sourceId),
  );
  requireThat(proof, "Reviewed unit lacks native original-head acceptance");
  if (!followups.length) {
    requireThat(
      claims.every((claim) => claim.sourceId === accepted.sourceId),
      "Reviewed unit lacks complete follow-up sources",
    );
    return proof;
  }
  const authenticated = proof.sources.find(
    (item) => item.sourceId === accepted.sourceId,
  );
  requireThat(
    authenticated && proof.originalContributor && verifiedHuman(source.author),
    "Native accepted proof disappeared",
  );
  const followupSources: CorrectionSource[] = [];
  const bindings: OriginalContributorFollowup[] = [];
  const nativeAcceptance: unknown[] = [];
  for (const followup of followups) {
    const converted = richSource(followup.evidence, owners);
    bindings.push(
      await originalContributorFollowupProof(
        github,
        authenticated,
        converted,
        followup.evidence,
        followup.policy,
        claims.filter((claim) => claim.sourceId === converted.sourceId),
        (evidence) => nativeAcceptance.push(evidence),
        {
          anchorSha: proof.originalContributor.originalCommitSha,
          origin: source.author,
        },
      ),
    );
    followupSources.push(converted);
  }
  requireThat(
    originalContributorClaimScope(
      source,
      authenticated,
      claims,
      followupSources.map((followup, index) => ({
        source: followup,
        binding: bindings[index],
      })),
      proof.originalContributor.originalCommitSha,
    ),
    "Reviewed native unit has an unverified selected follow-up",
  );
  return {
    sources: [...proof.sources, ...followupSources],
    originalContributor: {
      ...proof.originalContributor,
      claimIds: claims.map((claim) => claim.id),
      followups: bindings,
      bindingDigest: digest(
        encode({
          original: proof.originalContributor.bindingDigest,
          claims,
          followups: bindings,
          nativeAcceptance,
          followupSourceDigests: await Promise.all(
            followups.map((followup) =>
              valueSourceDigest(followup.evidence, followup.policy),
            ),
          ),
        }),
      ),
    },
  };
}

/** Preserve one person's unit across independently verified originating PRs. */
export async function octoberOriginalContributorPartsProof(
  github: Pick<GitHubClient, "get">,
  sourceEvidence: readonly WorkUnitSource[],
  owners: ReadonlyMap<string, string>,
  claims: readonly CorrectionClaim[],
  originatingClaims: ReadonlyMap<string, readonly string[]>,
  completionSourceId: string,
): Promise<HistoricalOrdinaryProof> {
  requireThat(
    originatingClaims.size >= 2,
    "Native unit needs multiple originals",
  );
  const originals = [...originatingClaims.keys()].map((id) => {
    const source = sourceEvidence.find(
      (item) => item.evidence.pull.node_id === id,
    );
    requireThat(
      source && source.evidence.pull.user.type === "User",
      "Native unit original identity is unavailable",
    );
    return source;
  });
  const originId = originals[0].evidence.pull.user.node_id;
  requireThat(
    originals.every((source) => source.evidence.pull.user.node_id === originId),
    "Native unit has different originating contributors",
  );
  const sources = sourceEvidence.map((source) => {
    const converted = richSource(source.evidence, owners);
    return {
      ...converted,
      commits: converted.commits.map((commit) => {
        const original = source.evidence.commits.find(
          (item) => item.sha === commit.sha,
        );
        requireThat(original, "Native original commit disappeared");
        return {
          ...commit,
          parentShas: original.parents.map((parent) => parent.sha),
        };
      }),
    };
  });
  const graph = new Map<string, string[]>();
  for (const source of sources)
    for (const commit of source.commits) {
      const parents = commit.parentShas;
      requireThat(parents, "Native original partition lacks parent edges");
      const previous = graph.get(commit.sha);
      requireThat(
        !previous || encode(previous) === encode(parents),
        "Native original partition has inconsistent parent edges",
      );
      graph.set(commit.sha, parents);
    }
  const reaches = (head: string, ancestor: string) => {
    const pending = [head];
    const seen = new Set<string>();
    for (const sha of pending) {
      if (sha === ancestor) return true;
      if (seen.has(sha)) continue;
      seen.add(sha);
      pending.push(...(graph.get(sha) ?? []));
    }
    return false;
  };
  const partition = new Map<string, CorrectionClaim[]>();
  const assigned = new Set<string>();
  for (const [id, claimIds] of originatingClaims) {
    const ownClaims = claims.filter((claim) => claimIds.includes(claim.id));
    requireThat(
      ownClaims.length === claimIds.length &&
        ownClaims.length > 0 &&
        ownClaims.every((claim) => !assigned.has(claim.id)),
      "Native original claims overlap or are unavailable",
    );
    for (const claim of ownClaims) assigned.add(claim.id);
    partition.set(id, ownClaims);
  }
  for (const claim of claims) {
    if (assigned.has(claim.id)) continue;
    const matching = [...partition]
      .filter(([, originalClaims]) =>
        originalClaims.some((original) =>
          reaches(claim.commitSha, original.commitSha),
        ),
      )
      .sort(
        ([leftId, leftClaims], [rightId, rightClaims]) =>
          Number(rightClaims.some((original) => original.path === claim.path)) -
            Number(
              leftClaims.some((original) => original.path === claim.path),
            ) || leftId.localeCompare(rightId),
      );
    requireThat(
      matching.length > 0,
      "Native follow-up lacks an originating ancestor",
    );
    // Every partition has the same authenticated recipient. The selected
    // ancestry proof changes neither the unit's value nor its beneficiary.
    matching[0][1].push(claim);
  }
  const authenticated = new Map<string, CorrectionSource>();
  const parts: OriginalContributorBinding[] = [];
  for (const original of originals) {
    const selected = partition.get(original.evidence.pull.node_id);
    requireThat(selected?.length, "Native original partition disappeared");
    const accepted = sources
      .filter((source) =>
        selected.some((claim) => claim.sourceId === source.sourceId),
      )
      .sort(
        (left, right) =>
          (left.occurredAt ?? "").localeCompare(right.occurredAt ?? "") ||
          left.sourceId.localeCompare(right.sourceId),
      )[0];
    const integration = sourceEvidence.find(
      (source) => source.evidence.pull.node_id === accepted?.sourceId,
    );
    requireThat(
      accepted && integration && accepted.author?.id !== originId,
      "Native original partition lacks an accepted carrier",
    );
    const followups = sourceEvidence.filter(
      (source) =>
        source.evidence.pull.node_id !== accepted.sourceId &&
        (selected.some(
          (claim) => claim.sourceId === source.evidence.pull.node_id,
        ) ||
          (source.evidence.pull.node_id === completionSourceId &&
            source.evidence.pull.node_id !== original.evidence.pull.node_id &&
            (source.evidence.pull.user.node_id === originId ||
              source.evidence.pull.user.node_id === accepted.author?.id) &&
            source.evidence.pull.merged_at !== null &&
            originatingClaims
              .get(original.evidence.pull.node_id)
              ?.some((claimId) => {
                const claim = claims.find((item) => item.id === claimId);
                return (
                  claim &&
                  reaches(source.evidence.pull.head.sha, claim.commitSha)
                );
              }) &&
            Date.parse(source.evidence.pull.merged_at) >=
              Date.parse(accepted.occurredAt ?? ""))),
    );
    const proof = await octoberOriginalContributorUnitProof(
      github,
      accepted,
      original,
      integration,
      owners,
      selected,
      followups,
    );
    requireThat(
      proof.originalContributor,
      "Native original partition proof is missing",
    );
    parts.push({
      ...proof.originalContributor,
      acceptedSourceId: accepted.sourceId,
    });
    for (const source of proof.sources)
      authenticated.set(source.sourceId, source);
  }
  return {
    sources: sources.map(
      (source) => authenticated.get(source.sourceId) ?? source,
    ),
    originalContributorParts: parts,
  };
}

export async function octoberOriginalContributorProof(
  github: Pick<GitHubClient, "get">,
  plain: CorrectionSource,
  sources: readonly WorkUnitSource[],
  owners: ReadonlyMap<string, string>,
  allowMergedOriginal = false,
): Promise<HistoricalOrdinaryProof> {
  requireThat(
    sources.length === 2,
    "October replacement needs one original PR",
  );
  const [integration, original] = sources;
  const originalSource = richSource(original.evidence, owners);
  const originalActor = originalSource.author;
  const carrier = plain.author;
  const originalCommits = originalSource.commits.filter(
    (c) => c.parentCount <= 1,
  );
  requireThat(
    original.evidence.pull.state === "closed" &&
      (originalSource.occurredAt === null ||
        (allowMergedOriginal &&
          plain.occurredAt !== null &&
          originalSource.occurredAt >= plain.occurredAt)) &&
      originalSource.repositoryNodeId === plain.repositoryNodeId &&
      originalSource.repository.toLowerCase() ===
        plain.repository.toLowerCase() &&
      verifiedHuman(originalActor) &&
      verifiedHuman(carrier) &&
      originalActor.id !== carrier.id &&
      originalSource.commits.some(
        (commit) => commit.sha === originalSource.headSha,
      ) &&
      new Set(originalSource.commits.map((commit) => commit.sha)).size ===
        originalSource.commits.length,
    "October replacement does not have a sole verified original contributor",
  );
  if (originalCommits.some((commit) => commit.author?.id === carrier.id))
    await authenticateOriginalFollowupParents(
      github,
      originalSource,
      original.evidence,
    );
  requireThat(
    originalContributorPrecedesFollowups(originalSource, carrier),
    "October replacement does not have a verified original contributor preceding every carrier follow-up",
  );
  const accepted = matchRetainedAcceptedSource(
    plain,
    richSource(integration.evidence, owners),
  );
  requireThat(
    accepted.author?.id === carrier.id &&
      accepted.author?.kind === carrier.kind &&
      accepted.commits.every(
        (commit, index) =>
          !commit.author ||
          (commit.author.id === plain.commits[index].author?.id &&
            commit.author.kind === plain.commits[index].author?.kind),
      ),
    "Retained accepted commit author differs from the canonical census",
  );
  const exact = await exactOctoberOriginalContributorProof(
    github,
    accepted,
    originalSource,
    integration,
    original,
    allowMergedOriginal,
  );
  if (exact) return exact;
  requireThat(
    originalSource.occurredAt === null,
    "Merged original requires exact first acceptance proof",
  );
  // The rich original proof captures merge parents but does not fetch merger
  // line totals. A shared SHA can carry its already verified census totals.
  const canonicalCommits = new Map(
    plain.commits.map((commit) => [commit.sha, commit]),
  );
  for (const commit of originalSource.commits) {
    const canonical = canonicalCommits.get(commit.sha);
    if (!canonical || commit.parentCount <= 1) continue;
    requireThat(
      canonical.parentCount === commit.parentCount &&
        canonical.author?.id === commit.author?.id &&
        canonical.author?.kind === commit.author?.kind,
      "Shared October merge disagrees with the canonical census",
    );
    commit.additions = canonical.additions;
    commit.deletions = canonical.deletions;
  }
  const retained = await retainedCopyBindings(sources, {
    ordinaryCommitsOnly: true,
    octoberOriginalCredit: true,
  });
  requireThat(
    retained.limitations.length === 0,
    "October retained-copy evidence is incomplete or ambiguous",
  );
  const ordinary = firstAcceptedOrdinary(plain);
  const acceptedWithFiles = new Map(
    accepted.commits.map((commit) => [commit.sha, commit]),
  );
  const candidates = ordinary.toSorted((a, b) => a.sha.localeCompare(b.sha));
  for (const commit of candidates) {
    if (
      (commit.author !== null &&
        (!verifiedHuman(commit.author) ||
          commit.author.id !== originalActor.id)) ||
      ordinary.some(
        (other) =>
          other !== commit &&
          (!verifiedHuman(other.author) ||
            (other.author.id !== originalActor.id &&
              other.author.id !== carrier.id)),
      )
    )
      continue;
    const files = acceptedWithFiles.get(commit.sha)?.files;
    const bindings = [...retained.bindings.values()].filter(
      (binding) =>
        binding.integration === integration &&
        binding.original === original &&
        binding.acceptedCommitSha === commit.sha,
    );
    const originalCommitSha = bindings[0]?.originalCommitSha;
    const boundPaths = bindings.map((binding) => binding.path).sort();
    if (
      !originalCommitSha ||
      !files?.length ||
      bindings.some(
        (binding) => binding.originalCommitSha !== originalCommitSha,
      ) ||
      bindings.length !== files.length ||
      !files.every((file) => boundPaths.includes(file.path))
    )
      continue;
    return {
      sources: [
        {
          ...plain,
          commits: plain.commits.map((other) =>
            other === commit ? { ...commit, files } : other,
          ),
        },
        originalSource,
      ],
      originalContributor: {
        originalSourceId: originalSource.sourceId,
        originalCommitSha,
        acceptedCommitSha: commit.sha,
        boundPaths,
        bindingDigest: digest(
          encode(
            bindings.map((binding) => ({
              original: binding.original.evidence,
              originalCommitSha: binding.originalCommitSha,
              accepted: binding.integration.evidence,
              acceptedCommitSha: binding.acceptedCommitSha,
              path: binding.path,
              preexistingCommitShas: binding.preexistingCommitShas,
            })),
          ),
        ),
      },
    };
  }
  throw new Error(
    "October replacement lacks an exact first-accepted original commit binding",
  );
}

/** A later merge marker must not hide the carrier's first acceptance. */
export function isMergedOriginalContributor(
  accepted: CorrectionSource | undefined,
  donor: CorrectionSource | undefined,
): boolean {
  return !!(
    accepted &&
    donor &&
    verifiedHuman(accepted.author) &&
    verifiedHuman(donor.author) &&
    accepted.author.id !== donor.author.id &&
    accepted.occurredAt !== null &&
    donor.occurredAt !== null &&
    donor.occurredAt >= accepted.occurredAt &&
    donor.commits.length > 0 &&
    donor.commits.every(
      (commit) =>
        commit.parentCount <= 1 &&
        commit.firstAcceptedSourceId === accepted.sourceId &&
        accepted.commits.some(
          (copy) =>
            copy.sha === commit.sha &&
            copy.author?.id === commit.author?.id &&
            copy.author?.kind === commit.author?.kind,
        ),
    )
  );
}

/** Restore reported merge counters from the complete immutable ownership census. */
export function restoreCanonicalMergeCounts(
  sources: readonly CorrectionSource[],
  outcomes: ReadonlyMap<string, MergedPullRequestOutcome>,
): void {
  for (const source of sources) {
    const outcome = outcomes.get(source.sourceId);
    for (const commit of source.commits) {
      if (commit.parentCount <= 1) continue;
      const canonical = outcome?.commits?.find(
        (item) => item.oid === commit.sha,
      );
      if (!canonical) continue;
      requireThat(
        canonical.parentCount === commit.parentCount &&
          (canonical.author?.id ?? null) === (commit.author?.id ?? null) &&
          (canonical.author?.kind ?? null) === (commit.author?.kind ?? null) &&
          (commit.additions === null ||
            commit.additions === canonical.additions) &&
          (commit.deletions === null ||
            commit.deletions === canonical.deletions),
        "Canonical merge identity or counters disagree",
      );
      commit.additions = canonical.additions ?? null;
      commit.deletions = canonical.deletions ?? null;
    }
  }
}

/** Resolve semantic origin claims to their authenticated first acceptance. */
export function firstAcceptedCorrectionClaims(
  claims: readonly CorrectionClaim[],
  sources: readonly CorrectionSource[],
): CorrectionClaim[] {
  return claims.map((claim) => {
    const origin = sources.find((source) => source.sourceId === claim.sourceId);
    const originalCommit = origin?.commits.find(
      (commit) => commit.sha === claim.commitSha,
    );
    requireThat(
      origin && originalCommit,
      "Grouped claim origin lacks the exact commit",
    );
    requireThat(
      originalCommit.files?.some((file) => file.path === claim.path),
      "Grouped claim origin lacks the exact path",
    );
    const carriers = sources.filter(
      (source) =>
        source.repositoryNodeId === origin.repositoryNodeId &&
        originalCommit.firstAcceptedSourceId === source.sourceId &&
        source.commits.some(
          (commit) =>
            commit.sha === claim.commitSha &&
            commit.author?.id === originalCommit.author?.id &&
            commit.author?.kind === originalCommit.author?.kind &&
            correctionClaimCommit(commit) &&
            commit.firstAcceptedSourceId === source.sourceId &&
            commit.files?.some((file) => file.path === claim.path),
        ),
    );
    requireThat(
      carriers.length === 1,
      "Grouped claim has no unique first acceptance",
    );
    return { ...claim, sourceId: carriers[0].sourceId };
  });
}

/** Compare every retained field against the complete provider representation. */
function matchesRetainedProjection(
  actual: unknown,
  expected: unknown,
): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) =>
        matchesRetainedProjection(actual[index], value),
      )
    );
  if (expected !== null && typeof expected === "object")
    return (
      actual !== null &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(expected).every(
        ([key, value]) =>
          Object.hasOwn(actual, key) &&
          matchesRetainedProjection(
            (actual as Record<string, unknown>)[key],
            value,
          ),
      )
    );
  return actual === expected;
}

/** Retain authenticated ancestry for accepted same-carrier follow-up sources. */
export async function originalContributorFollowupProof(
  github: Pick<GitHubClient, "get">,
  accepted: CorrectionSource,
  source: CorrectionSource,
  evidence: ValueEvidence,
  policy: { sha: string; text: string },
  claims?: readonly CorrectionClaim[],
  retainNativeAcceptance?: (evidence: {
    merge: { sha: string; parents: { sha: string }[] };
    acceptedRange: NativeComparison[];
    retainedBaseRanges: NativeComparison[];
  }) => void,
  scoped?: { anchorSha: string; origin: CorrectionActor },
): Promise<OriginalContributorFollowup> {
  const reference = evidence.relatedPullRequests.find(
    (target) =>
      target.id === accepted.sourceId &&
      target.url === accepted.sourceUrl &&
      target.repository.toLowerCase() === accepted.repository.toLowerCase(),
  );
  const acknowledgement = reference
    ? retainedAcknowledgements(evidence).find(
        (record) =>
          record.user?.type === "User" &&
          record.user.node_id === accepted.author?.id &&
          referencesOriginalContributorSource(
            record.body,
            reference.repository,
            reference.number,
          ),
      )
    : undefined;
  if (
    claims === undefined &&
    reference &&
    (referencesOriginalContributorSource(
      evidence.pull.body ?? "",
      reference.repository,
      reference.number,
    ) ||
      acknowledgement)
  ) {
    const current = await github.get<Pull>(
      `/repos/${source.repository}/pulls/${evidence.pull.number}`,
    );
    requireThat(
      current && matchesRetainedProjection(current, evidence.pull),
      "Accepted follow-up statement changed during collection",
    );
    if (acknowledgement) {
      const isComment = "created_at" in acknowledgement;
      const path = isComment
        ? `/repos/${source.repository}/issues/comments/${acknowledgement.html_url.split("issuecomment-")[1]}`
        : `/repos/${source.repository}/pulls/${evidence.pull.number}/reviews/${acknowledgement.id}`;
      const currentRecord = await github.get<Record<string, unknown>>(path);
      requireThat(
        matchesRetainedProjection(currentRecord, acknowledgement),
        "Accepted follow-up acknowledgement changed during collection",
      );
    }
    const retained = {
      sourceDigest: await valueSourceDigest(evidence, policy),
      pull: current,
      target: reference,
      ...(acknowledgement ? { acknowledgement } : {}),
    };
    const binding = {
      sourceId: source.sourceId,
      ancestorSha: accepted.headSha,
      commits: [],
      reference: { ...retained, digest: digest(encode(retained)) },
    };
    requireThat(
      isOriginalContributorFollowup(source, accepted, binding),
      "Invalid accepted follow-up statement",
    );
    return binding;
  }
  if (claims) {
    const current = await github.get<Pull>(
      `/repos/${source.repository}/pulls/${evidence.pull.number}`,
    );
    requireThat(
      current && matchesRetainedProjection(current, evidence.pull),
      "Selected native follow-up changed during collection",
    );
    const merge = evidence.mergeCommitEvidence;
    requireThat(
      merge &&
        merge.sha === evidence.pull.merge_commit_sha &&
        merge.parents.length === 2 &&
        merge.parents[1].sha === source.headSha,
      "Selected follow-up lacks a pinned native merge",
    );
    const currentMerge = await github.get<{
      sha: string;
      parents: { sha: string }[];
    }>(`/repos/${source.repository}/git/commits/${merge.sha}`);
    requireThat(
      currentMerge?.sha === merge.sha &&
        Array.isArray(currentMerge.parents) &&
        encode(currentMerge.parents.map((parent) => parent.sha)) ===
          encode(merge.parents.map((parent) => parent.sha)),
      "Selected follow-up native merge changed",
    );
    const acceptance = await authenticateNativeAcceptedRange(
      github,
      source,
      evidence,
      merge,
      claims.map((claim) => claim.commitSha),
    );
    retainNativeAcceptance?.({ merge: currentMerge, ...acceptance });
  } else {
    await authenticateOriginalFollowupParents(github, source, evidence);
  }
  const ancestorSha = scoped?.anchorSha ?? accepted.headSha;
  const commits: OriginalContributorFollowup["commits"] = [];
  let total = 0;
  for (let page = 1; page === 1 || commits.length < total; page++) {
    const result = await github.get<{
      status: string;
      ahead_by: number;
      behind_by: number;
      total_commits: number;
      merge_base_commit: { sha: string };
      commits: { sha: string; parents: { sha: string }[] }[];
    }>(
      `/repos/${source.repository}/compare/${ancestorSha}...${source.headSha}?per_page=100&page=${page}`,
    );
    requireThat(
      result &&
        result.status === "ahead" &&
        result.behind_by === 0 &&
        result.merge_base_commit?.sha === ancestorSha &&
        Number.isSafeInteger(result.total_commits) &&
        result.total_commits > 0 &&
        result.ahead_by === result.total_commits &&
        (page === 1 || result.total_commits === total) &&
        result.commits.length ===
          Math.min(100, result.total_commits - (page - 1) * 100),
      "Follow-up does not descend from the complete accepted source",
    );
    total = result.total_commits;
    commits.push(
      ...result.commits.map((commit) => ({
        sha: commit.sha,
        parentShas: commit.parents.map((parent) => parent.sha),
      })),
    );
  }
  for (const commit of commits) {
    const immutable = await github.get<{
      sha: string;
      parents: { sha: string }[];
    }>(`/repos/${source.repository}/git/commits/${commit.sha}`);
    requireThat(
      immutable?.sha === commit.sha &&
        Array.isArray(immutable.parents) &&
        encode(immutable.parents.map((parent) => parent.sha)) ===
          encode(commit.parentShas),
      "Follow-up comparison parent graph disagrees with immutable Git objects",
    );
  }
  const binding = {
    sourceId: source.sourceId,
    ancestorSha,
    commits,
  };
  requireThat(
    isOriginalContributorFollowup(source, accepted, binding, claims, scoped),
    "Invalid accepted follow-up source",
  );
  return binding;
}

/** Combine a verified ordinary replacement with its complete grouped path scope. */
export function groupedOriginalContributorProof(
  accepted: CorrectionSource,
  original: HistoricalOrdinaryProof,
  claims: readonly CorrectionClaim[],
  contextSources: readonly CorrectionSource[] = [],
  followups: readonly OriginalContributorFollowup[] = [],
): HistoricalOrdinaryProof {
  const originalAccepted = original.sources.find(
    (source) => source.sourceId === accepted.sourceId,
  );
  matchRetainedAcceptedSource(accepted, originalAccepted);
  requireThat(
    originalAccepted &&
      original.sources.length === 2 &&
      original.originalContributor &&
      originalAccepted.sourceId === accepted.sourceId &&
      originalAccepted.sourceUrl === accepted.sourceUrl &&
      originalAccepted.author?.id === accepted.author?.id &&
      originalAccepted.author?.kind === accepted.author?.kind &&
      originalAccepted.commits.every(
        (commit, index) =>
          commit.author?.id === accepted.commits[index].author?.id &&
          commit.author?.kind === accepted.commits[index].author?.kind &&
          commit.firstAcceptedSourceId ===
            accepted.commits[index].firstAcceptedSourceId,
      ) &&
      contextSources.every(
        (source) =>
          isOriginalContributorContext(source, accepted) ||
          isOriginalContributorFollowup(
            source,
            accepted,
            followups.find((item) => item.sourceId === source.sourceId),
          ),
      ),
    "Grouped original credit requires one accepted replacement",
  );
  const acceptedSources = [
    accepted,
    ...contextSources.filter((source) =>
      followups.some((item) => item.sourceId === source.sourceId),
    ),
  ];
  requireThat(
    followups.length === acceptedSources.length - 1 &&
      new Set(followups.map((item) => item.sourceId)).size ===
        followups.length &&
      claims.every((claim) =>
        acceptedSources.some((source) => source.sourceId === claim.sourceId),
      ),
    "Grouped original credit requires one accepted replacement with complete follow-up scope",
  );
  requireThat(
    claims.length > 0 &&
      new Set(claims.map((claim) => claim.id)).size === claims.length &&
      claims.every((claim) =>
        acceptedSources.some(
          (source) =>
            source.sourceId === claim.sourceId &&
            source.commits.some(
              (commit) =>
                commit.sha === claim.commitSha &&
                correctionClaimCommit(commit) &&
                commit.firstAcceptedSourceId === source.sourceId &&
                commit.files?.some((file) => file.path === claim.path),
            ),
        ),
      ) &&
      acceptedSources.every((source) =>
        source.commits.every(
          (commit) =>
            commit.parentCount > 1 ||
            commit.firstAcceptedSourceId !== source.sourceId ||
            (commit.files !== undefined && commit.files.length > 0),
        ),
      ),
    "Grouped original credit does not cover the canonical selected claims",
  );
  const originals = new Map(
    originalAccepted.commits.map((commit) => [commit.sha, commit]),
  );
  return {
    sources: [
      {
        ...accepted,
        commits: accepted.commits.map((commit) => ({
          ...commit,
          ...(commit.parentCount > 1
            ? {
                additions: originals.get(commit.sha)?.additions ?? null,
                deletions: originals.get(commit.sha)?.deletions ?? null,
              }
            : {}),
          ...(originals.get(commit.sha)?.parentShas
            ? { parentShas: originals.get(commit.sha)?.parentShas }
            : {}),
        })),
      },
      ...original.sources.filter(
        (source) => source.sourceId !== accepted.sourceId,
      ),
      ...contextSources,
    ],
    originalContributor: {
      ...original.originalContributor,
      ...(followups.length ? { followups: [...followups] } : {}),
    },
  };
}

async function ordinaryRetainedProof(
  github: GitHubClient,
  read: SourceRead,
  owners: ReadonlyMap<string, string>,
  discussion: {
    cache: CorrectionEvidenceCache;
    executor: GraphqlExecutor;
    allowNew: boolean;
  },
  octoberOriginalCredit: boolean,
): Promise<HistoricalOrdinaryProof> {
  const plain = ordinarySource(read, owners);
  const ordinary = firstAcceptedOrdinary(plain);
  const hasUnlinked = ordinary.some(
    (commit) => !isCreditEligibleCommitAuthor(commit.author),
  );
  const otherAuthors = new Set(
    ordinary.flatMap(({ author }) =>
      octoberOriginalCredit &&
      verifiedHuman(author) &&
      author.id !== plain.author?.id
        ? [author.id]
        : [],
    ),
  );
  if (!hasUnlinked && !otherAuthors.size) return { sources: [plain] };
  let readDiscussion: Parameters<typeof collectValueReferenceEvidence>[3];
  {
    const { cache, executor, allowNew } = discussion;
    const number = read.outcome.number;
    const repository = plain.repository;
    const [owner, name] = repository.split("/");
    const variables = { owner, name, number };
    const graphqlUrl = "https://api.github.com/graphql";
    const graphRequest = encode({
      query: historicalDiscussionQuery,
      variables,
    });
    const root = `https://api.github.com/repos/${repository}`;
    const pull = `${root}/pulls/${number}`;
    const suffix = "?per_page=100&page=1";
    const hasEnvelope = await cache.hasSuccessfulRequest(
      graphqlUrl,
      "POST",
      graphRequest,
    );
    const oldAnchors =
      !hasEnvelope && allowNew
        ? await Promise.all([
            cache.hasSuccessfulRequest(pull),
            cache.hasSuccessfulRequest(`${pull}/reviews${suffix}`),
            cache.hasSuccessfulRequest(
              `${root}/issues/${number}/comments${suffix}`,
            ),
            cache.hasSuccessfulRequest(`${pull}/comments${suffix}`),
            cache.hasSuccessfulRequest(
              graphqlUrl,
              "POST",
              encode(valueReferenceTimelineRequest(repository, number, null)),
            ),
          ])
        : [];
    if (hasEnvelope || (allowNew && !oldAnchors.some(Boolean))) {
      readDiscussion = async (restPull) => {
        let envelope: unknown;
        try {
          envelope = await executor.execute(
            historicalDiscussionQuery,
            variables,
          );
        } catch (error) {
          cache.assertUninterrupted();
          if (hasEnvelope) throw error;
          if (
            !(await cache.hasSuccessfulRequest(
              graphqlUrl,
              "POST",
              graphRequest,
            ))
          )
            return null;
          // The live client can stop after recording a complete response and
          // charging its cost. Use exactly that observation in this pass too.
          envelope = await executor.execute(
            historicalDiscussionQuery,
            variables,
          );
        }
        cache.assertUninterrupted();
        if (!historicalDiscussionHasRateLimit(envelope)) return null;
        return validateHistoricalDiscussion(
          envelope,
          {
            id: plain.sourceId,
            number,
            repository,
            repositoryNodeId: plain.repositoryNodeId,
            url: plain.sourceUrl,
            headSha: plain.headSha,
            mergedAt: plain.occurredAt,
          },
          restPull,
        );
      };
    }
  }
  const references = await collectValueReferenceEvidence(
    github,
    plain.repository,
    read.outcome.number,
    readDiscussion,
  );
  requireThat(
    references.pull.node_id === plain.sourceId &&
      references.pull.head.sha === plain.headSha &&
      canonicalTime(references.pull.merged_at ?? "") === plain.occurredAt &&
      references.limitations.length === 0,
    "Retained-source discovery is incomplete or stale",
  );
  const originals: Pull[] = [];
  for (const reference of references.references) {
    if (
      reference.repository.toLowerCase() !== plain.repository.toLowerCase() ||
      reference.number >= read.outcome.number
    )
      continue;
    const pull = await github.get<Pull>(
      `/repos/${plain.repository}/pulls/${reference.number}`,
    );
    requireThat(
      pull?.node_id === reference.id &&
        pull.html_url === reference.url &&
        pull.number === reference.number,
      "Retained original identity unavailable",
    );
    if (pull.state === "closed" && pull.merged_at === null)
      originals.push(pull);
  }
  const possibleOriginals = octoberOriginalCredit
    ? originals.filter(
        (pull) =>
          pull.user.node_id !== plain.author?.id &&
          (hasUnlinked || otherAuthors.has(pull.user.node_id)),
      )
    : [];
  requireThat(
    possibleOriginals.length <= 1,
    "October replacement names competing original PRs",
  );
  const selected = possibleOriginals.length
    ? possibleOriginals
    : hasUnlinked
      ? originals
      : [];
  if (!selected.length) return { sources: [plain] };
  const sources: WorkUnitSource[] = [];
  for (const expected of [references.pull, ...selected]) {
    const evidence = await collectValueEvidence(
      github,
      plain.repository,
      expected.number,
    );
    requireThat(
      evidence.pull.node_id === expected.node_id &&
        evidence.pull.head.sha === expected.head.sha &&
        evidence.pull.updated_at === expected.updated_at,
      "Retained source changed during evidence collection",
    );
    sources.push({
      evidence,
      policy: { sha: evidence.pull.base.sha, text: "" },
    });
  }
  if (possibleOriginals.length)
    return octoberOriginalContributorProof(github, plain, sources, owners);
  const converted = await bindRetained(sources, owners);
  const accepted = matchRetainedAcceptedSource(
    plain,
    converted.find((source) => source.sourceId === plain.sourceId),
  );
  // References are inputs to ambiguity checks. Only actual retained bindings
  // extend the correction proof beyond the canonical accepted commit census.
  const commits = plain.commits.map((commit, index) => {
    const { author, files, retainedCopy } = accepted.commits[index];
    // A null observation cannot erase an independently resolved author.
    if (author || retainedCopy)
      requireThat(
        author?.id === commit.author?.id &&
          author?.kind === commit.author?.kind,
        "Retained accepted commit author differs from the canonical census",
      );
    return retainedCopy ? { ...commit, files, retainedCopy } : commit;
  });
  const originalIds = new Set(
    commits.flatMap((commit) =>
      commit.retainedCopy ? [commit.retainedCopy.originalSourceId] : [],
    ),
  );
  if (!originalIds.size) return { sources: [plain] };

  const boundSources = converted.filter((source) =>
    originalIds.has(source.sourceId),
  );
  requireThat(
    boundSources.length === originalIds.size &&
      boundSources.every((source) =>
        source.commits.some((commit) => commit.sha === source.headSha),
      ),
    "Retained original commit census does not reach the source head",
  );
  return { sources: [{ ...plain, commits }, ...boundSources] };
}

export interface CollectionOptions {
  projects: string[];
  directory: string;
  month?: string;
  sampleSourceIds?: string[];
  candidateMonth?: string;
  octoberOriginalCredit?: boolean;
  before?: string;
  requestBudget?: number;
  resumeForSeconds?: number;
  graphqlDiscussions?: boolean;
}
export interface CollectionDependencies {
  journal?: PointsJournal;
  token?: string;
  transport?: typeof fetch;
  now?: Date;
  quotaNow?: () => number;
  registry?: Awaited<ReturnType<typeof fetchProjectRegistry>>;
}
interface RepositoryPlan {
  repository: TargetRepository;
  nodeId: string;
  createdAt: string;
  months: ReturnType<typeof censusMonths>;
}
interface Campaign {
  schemaVersion: "1";
  baseline: ReturnType<typeof createPointsCorrectionBaseline>;
  through: string;
  before: string;
  initialSearchPageSize?: number;
  octoberOriginalCredit?: boolean;
  projects: string[];
  registryDigest: string;
  repositories: RepositoryPlan[];
}
interface CensusPart {
  repositoryNodeId: string;
  from: string;
  to: string;
  outcomes: MergedPullRequestOutcome[];
  digest: string;
}

export async function collectImplementationCorrections(
  options: CollectionOptions,
  dependencies: CollectionDependencies = {},
) {
  return collectPass(options, dependencies);
}

async function collectPass(
  options: CollectionOptions,
  dependencies: CollectionDependencies,
  priorUsage?: { requests: number; reportedGraphqlCost: number },
) {
  const cache = new CorrectionEvidenceCache(
    resolve(options.directory),
    dependencies.transport ?? fetch,
    options.requestBudget,
    dependencies.quotaNow,
  );
  try {
    return await collectWithEvidenceCache(
      options,
      dependencies,
      cache,
      priorUsage,
    );
  } catch (error) {
    const stop = collectionStop(error);
    // A Promise.all rejection can leave sibling source reads in progress.
    // The next pass may replay their evidence only after those reads settle.
    await cache.settleReads();
    throw stop ? (cache.stop ?? stop) : error;
  }
}

/** All public candidates are emitted, including held, unchanged and unselected
 * pools. A bounded sample can collect facts, but cannot assert ownership.
 */
async function collectWithEvidenceCache(
  options: CollectionOptions,
  dependencies: CollectionDependencies,
  cache: CorrectionEvidenceCache,
  priorUsage = { requests: 0, reportedGraphqlCost: 0 },
) {
  requireThat(
    options.projects.length > 0 &&
      new Set(options.projects).size === options.projects.length,
    "Select distinct project IDs",
  );
  requireThat(
    !options.before || canonicalTime(options.before) === options.before,
    "Use a canonical UTC --before instant",
  );
  requireThat(
    !options.month || /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(options.month),
    "Invalid census month",
  );
  requireThat(
    !options.candidateMonth ||
      /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(options.candidateMonth),
    "Invalid candidate month",
  );
  requireThat(
    !options.sampleSourceIds ||
      (options.sampleSourceIds.length <= 50 &&
        new Set(options.sampleSourceIds).size ===
          options.sampleSourceIds.length),
    "Sample must contain at most 50 distinct source IDs",
  );
  const currentJournal = dependencies.journal ?? (await loadPublishedPoints());
  requireThat(currentJournal, "Published baseline journal unavailable");
  assertPointsJournal(currentJournal);
  const { directory } = cache;
  let campaign = await readJson<Campaign>(resolve(directory, "campaign.json"));
  let journal = currentJournal;
  if (campaign) {
    const saved = await readJson<PointsJournal>(
      resolve(directory, "baseline-journal.json"),
    );
    requireThat(
      saved &&
        encode(createPointsCorrectionBaseline(saved)) ===
          encode(campaign.baseline),
      "Frozen baseline journal is unavailable or changed",
    );
    requireThat(
      currentJournal.revisions.length >= campaign.baseline.revisionCount &&
        digest(
          encode(
            currentJournal.revisions
              .slice(0, campaign.baseline.revisionCount)
              .map((r) => r.id),
          ),
        ) === campaign.baseline.revisionIdsDigest,
      "Current journal no longer contains the campaign baseline prefix",
    );
    journal = saved;
  }
  const pools = inventoryCorrectionPools(journal, options.projects);
  const registry = dependencies.registry ?? (await fetchProjectRegistry());
  const repositories = collectTargetRepositories(
    assertProjectRegistry(registry.projects),
  ).filter((r) => options.projects.includes(r.projectId));
  requireThat(
    options.projects.every((id) =>
      repositories.some((r) => r.projectId === id),
    ),
    "Only active canonical-registry projects may be collected",
  );
  const baseline = createPointsCorrectionBaseline(journal);
  const token = dependencies.token ?? (await resolveGitHubToken());
  // The cache is outside the live client's accounting, so replaying old raw
  // observations cannot reset the current quota to an older, larger balance.
  const client = new GitHubGraphqlClient(token, cache.fetch);
  const executor = cachedExecutor(client, cache);
  const github = GitHubClient.forToken(token, cache.fetch);
  const registryDigest = digest(encode(registry));
  const through =
    campaign?.through ??
    new Date(
      Math.floor((dependencies.now ?? new Date()).getTime() / 1000) * 1000,
    ).toISOString();
  requireThat(
    canonicalTime(through) === through &&
      (!campaign ||
        (campaign.schemaVersion === "1" && campaign.through === through)),
    "Campaign schema or collection time is invalid",
  );
  const octoberOriginalCredit = options.octoberOriginalCredit === true;
  if (campaign) {
    requireThat(
      (campaign.octoberOriginalCredit ?? false) === octoberOriginalCredit,
      "October original credit policy differs from the frozen campaign",
    );
    requireThat(
      typeof campaign.before === "string" &&
        canonicalTime(campaign.before) === campaign.before,
      "Campaign cutoff is missing or invalid; use a new campaign directory",
    );
    requireThat(
      options.before === undefined || options.before === campaign.before,
      "Explicit resume cutoff differs from the frozen campaign",
    );
    requireThat(
      encode(campaign.baseline) === encode(baseline) &&
        encode(campaign.projects) === encode(options.projects),
      "Campaign baseline or selected projects changed; use a new campaign directory",
    );
    assertCorrectionRegistry(
      campaign.registryDigest,
      campaign.through,
      campaign.projects,
      registry,
    );
  }
  const plans: RepositoryPlan[] = [];
  // Rebuild the frozen scope under the current collector, including when a
  // reviewed main ancestor produced the checkpoint. Never replace its original
  // repository observation with a live read during resume.
  cache.allowRequests = campaign === null;
  try {
    for (const repository of repositories) {
      const data = await executor.execute(PREFLIGHT, {
        owner: repository.owner,
        name: repository.name,
      });
      const live = data.repository as unknown as RepositoryMetadata;
      requireThat(
        live?.isPrivate === false &&
          live.nameWithOwner.toLowerCase() ===
            `${repository.owner}/${repository.name}`.toLowerCase() &&
          typeof live.id === "string" &&
          typeof live.createdAt === "string" &&
          Number.isFinite(Date.parse(live.createdAt)) &&
          Date.parse(live.createdAt) <= Date.parse(through) &&
          (repository.expectedNodeId === null ||
            live.id === repository.expectedNodeId),
        "Canonical public repository identity unavailable",
      );
      plans.push({
        repository,
        nodeId: live.id,
        createdAt: live.createdAt,
        months: censusMonths(live.createdAt, through),
      });
    }
  } finally {
    cache.allowRequests = true;
  }
  if (campaign) {
    requireThat(
      encode(campaign.repositories) === encode(plans),
      "Campaign repository scope or monthly partition differs from its raw evidence",
    );
  } else {
    campaign = {
      schemaVersion: "1",
      baseline,
      through,
      initialSearchPageSize: 50,
      ...(octoberOriginalCredit ? { octoberOriginalCredit } : {}),
      before:
        options.before ??
        new Date(Date.parse(through) - 35 * 24 * 60 * 60 * 1000).toISOString(),
      projects: options.projects,
      registryDigest,
      repositories: plans,
    };
    await atomicJson(resolve(directory, "baseline-journal.json"), journal);
    await atomicJson(resolve(directory, "campaign.json"), campaign);
  }
  // Fieldless campaigns predate this optimization and keep their exact
  // original request shape for raw-cache reconstruction.
  const initialSearchPageSize = campaign.initialSearchPageSize ?? 100;
  requireThat(
    initialSearchPageSize === 50 || initialSearchPageSize === 100,
    "Invalid frozen historical search page size",
  );
  const limitations = new Map<string, string>();
  const allOutcomes: MergedPullRequestOutcome[] = [];
  const missingMonths: string[] = [];
  const partDigests: string[] = [];
  for (const plan of campaign.repositories) {
    const loader = historicalCommitLineLoader(
      executor,
      plan.repository,
      github,
    );
    for (const interval of plan.months) {
      const partPath = resolve(
        directory,
        "census",
        digest(plan.repository.id),
        `${interval.month}.json`,
      );
      let part = await readJson<CensusPart>(partPath);
      if (
        part ||
        options.month === interval.month ||
        (!options.month && !options.sampleSourceIds)
      ) {
        cache.allowRequests = part === null;
        let references: Awaited<ReturnType<typeof collectSearchReferences>>;
        try {
          references = await collectSearchReferences(
            executor,
            plan.repository,
            new Date(interval.from),
            new Date(interval.to),
            "merged",
            "is:pr is:merged",
            "PullRequest",
            { searchSliceCount: 0 },
            loader,
            plan.nodeId,
            initialSearchPageSize,
          );
        } finally {
          cache.allowRequests = true;
        }
        const outcomes = references.map((reference) => {
          requireThat(
            reference.outcome && reference.outcome.commits !== null,
            "Census member lacks complete commit evidence",
          );
          return reference.outcome;
        });
        const payload = {
          repositoryNodeId: plan.nodeId,
          from: interval.from,
          to: interval.to,
          outcomes,
        };
        if (part) {
          requireThat(
            part.digest === digest(encode(payload)),
            "Cached census differs from reconstructed raw evidence",
          );
          // Keep the loader's shared commit records, as a fresh pass does, so
          // a later month's verified author link still repairs this month.
          part = { ...part, outcomes };
        } else {
          part = { ...payload, digest: digest(encode(payload)) };
          await atomicJson(partPath, part);
        }
      }
      if (!part) {
        missingMonths.push(`${plan.repository.id}:${interval.month}`);
        continue;
      }
      const payload = {
        repositoryNodeId: part.repositoryNodeId,
        from: part.from,
        to: part.to,
        outcomes: part.outcomes,
      };
      requireThat(
        part.repositoryNodeId === plan.nodeId &&
          part.from === interval.from &&
          part.to === interval.to &&
          digest(encode(payload)) === part.digest,
        "Census checkpoint identity or digest changed",
      );
      partDigests.push(part.digest);
      allOutcomes.push(...part.outcomes);
    }
  }
  requireThat(
    new Set(allOutcomes.map((o) => o.id)).size === allOutcomes.length,
    "Monthly census repeats a source",
  );
  const ownershipComplete = missingMonths.length === 0;
  const owners = ownershipComplete
    ? commitCreditOwners(allOutcomes)
    : new Map<string, string>();
  const mirroredOctober =
    octoberOriginalCredit && ownershipComplete
      ? await mirroredOctoberSources(github, allOutcomes, owners)
      : new Set<string>();
  cache.assertUninterrupted();
  const censusDigest = digest(
    encode({
      repositories: campaign.repositories.map((r) => ({
        id: r.repository.id,
        nodeId: r.nodeId,
      })),
      through: campaign.through,
      partDigests,
    }),
  );
  const selectedMonth =
    options.candidateMonth ??
    options.month ??
    (octoberOriginalCredit ? "2026-10" : undefined);
  const selected = pools.filter(
    ({ candidate }) =>
      candidate.occurredAt < campaign.before &&
      (!options.sampleSourceIds ||
        options.sampleSourceIds.includes(candidate.sourceId)) &&
      (!selectedMonth || candidate.occurredAt.startsWith(selectedMonth)),
  );
  if (options.sampleSourceIds)
    requireThat(
      options.sampleSourceIds.every((id) =>
        pools.some((p) => p.candidate.sourceId === id),
      ),
      "Sample contains a source outside the positive pool inventory",
    );
  const outcomesById = new Map(
    allOutcomes.map((outcome) => [outcome.id, outcome]),
  );
  const reads = new Map<string, SourceRead>();
  for (const plan of campaign.repositories) {
    const targets = selected
      .map((p) => p.candidate)
      .filter(
        (c) =>
          repositoryIdFromUrl(c.sourceUrl).toLowerCase() ===
          plan.repository.id.toLowerCase(),
      );
    if (ownershipComplete) {
      // The canonical census already parsed every accepted PR and hydrated its
      // complete immutable commit list. Reuse those raw-verified observations
      // rather than repeating the same metadata and statistics requests.
      for (const candidate of targets) {
        const outcome = outcomesById.get(candidate.sourceId);
        if (!outcome) {
          limitations.set(candidate.sourceId, "source-unavailable");
          continue;
        }
        if (
          outcome.url !== candidate.sourceUrl ||
          canonicalTime(outcome.mergedAt) !== candidate.occurredAt
        ) {
          limitations.set(
            candidate.sourceId,
            "accepted-source-no-longer-matches-recorded-pool",
          );
          continue;
        }
        requireThat(
          outcome.id === candidate.sourceId &&
            repositoryIdFromUrl(outcome.url).toLowerCase() ===
              plan.repository.id.toLowerCase() &&
            typeof outcome.headRefOid === "string" &&
            /^[a-f0-9]{40}$/u.test(outcome.headRefOid) &&
            outcome.commits !== null,
          "Complete census source identity or commit evidence is invalid",
        );
        if (outcome.commits.length === 0) {
          limitations.set(
            candidate.sourceId,
            "accepted-source-commit-list-empty",
          );
          continue;
        }
        // GitHub's complete PR commit listing can put the head before ancestors.
        requireThat(
          outcome.commits.some((commit) => commit.oid === outcome.headRefOid) &&
            new Set(outcome.commits.map((commit) => commit.oid)).size ===
              outcome.commits.length &&
            outcome.commits.every(
              (commit) =>
                /^[a-f0-9]{40}$/u.test(commit.oid) &&
                Number.isSafeInteger(commit.parentCount) &&
                Number(commit.parentCount) >= 0 &&
                Number.isSafeInteger(commit.additions) &&
                Number(commit.additions) >= 0 &&
                Number.isSafeInteger(commit.deletions) &&
                Number(commit.deletions) >= 0,
            ),
          "Complete census source identity or commit evidence is invalid",
        );
        reads.set(candidate.sourceId, {
          outcome,
          repositoryNodeId: plan.nodeId,
        });
      }
      continue;
    }
    const loaded = await readSources(
      executor,
      targets,
      plan.repository,
      github,
    );
    for (const [id, value] of loaded.complete) {
      requireThat(
        value.repositoryNodeId === plan.nodeId,
        "Source repository differs from census",
      );
      reads.set(id, value);
    }
    for (const [id, value] of loaded.held) limitations.set(id, value);
  }
  for (const pool of selected) {
    const candidate = pool.candidate;
    const read = reads.get(candidate.sourceId);
    if (!ownershipComplete) {
      limitations.set(candidate.id, "repository-ownership-census-incomplete");
      continue;
    }
    if (!read) {
      limitations.set(
        candidate.id,
        limitations.get(candidate.sourceId) ?? "source-unavailable",
      );
      continue;
    }
    if (candidate.kind === "work-unit") continue;
    if (
      candidate.occurredAt.startsWith("2026-10-") &&
      mirroredOctober.has(candidate.sourceId)
    ) {
      limitations.set(
        candidate.id,
        "October replacement shares accepted commits with a merged donor PR",
      );
      continue;
    }
    try {
      const proof = await ordinaryRetainedProof(
        github,
        read,
        owners,
        { cache, executor, allowNew: options.graphqlDiscussions === true },
        octoberOriginalCredit && candidate.occurredAt.startsWith("2026-10-"),
      );
      candidate.sourceIds = proof.sources.map((s) => s.sourceId).sort();
      candidate.proof = { status: "complete", censusDigest, ...proof };
    } catch (error) {
      cache.assertUninterrupted();
      limitations.set(
        candidate.id,
        error instanceof Error
          ? error.message
          : "retained-source-evidence-unavailable",
      );
    }
  }
  const grouped = ownershipComplete
    ? selected.filter(
        (p) =>
          p.candidate.kind === "work-unit" && reads.has(p.candidate.sourceId),
      )
    : [];
  if (grouped.length) {
    // Attribution is resolved below from the complete owner map. Disabling the
    // helper's separate attribution loop avoids a second whole-history pass.
    let input: Awaited<ReturnType<typeof loadValueInputs>> | null = null;
    try {
      input = await loadValueInputs(
        {
          get: github.get.bind(github),
          fileText: github.fileText.bind(github),
          graphql: executor.execute as GitHubClient["graphql"],
        },
        [
          ...new Map(
            grouped.map((p) => [
              p.candidate.sourceId,
              (() => {
                const source = reads.get(p.candidate.sourceId);
                requireThat(source, "Grouped source disappeared");
                return source.outcome;
              })(),
            ]),
          ).values(),
        ] as Parameters<typeof loadValueInputs>[1],
        cache.fetch,
        undefined,
        [],
      );
    } catch (error) {
      cache.assertUninterrupted();
      if (!(error instanceof ValueFeedUnavailableError)) throw error;
      for (const pool of grouped)
        limitations.set(pool.candidate.id, "grouped-history-feed-unavailable");
    }
    for (const pool of grouped) {
      const candidate = pool.candidate;
      if (candidate.kind !== "work-unit") continue;
      if (input === null) continue;
      const decision = input.jointValueDecisions.get(candidate.sourceId);
      const knownHeld = input.heldWorkUnits.find((unit) =>
        unit.sourceNodeIds.includes(candidate.sourceId),
      );
      if (knownHeld) candidate.sourceIds = [...knownHeld.sourceNodeIds].sort();
      if (decision?.status !== "assessed") {
        limitations.set(candidate.id, "grouped-retained-decision-unavailable");
        continue;
      }
      candidate.sourceIds = decision.evidence.sources
        .map((s) => s.evidence.pull.node_id)
        .sort();
      const unit = decision.record.units.find(
        (u) => u.workUnitId === candidate.workUnitId,
      );
      if (
        !unit ||
        !pool.predecessors.every(
          (row) => row.decision?.sourceId === `value:${decision.latestDigest}`,
        )
      ) {
        limitations.set(
          candidate.id,
          "grouped-decision-does-not-match-recorded-pool",
        );
        continue;
      }
      try {
        requireThat(
          decision.latestDigest !== null,
          "Grouped decision digest unavailable",
        );
        // The assessed record already bounds claims to its reviewed accepted subset.
        let sources = await bindRetained(
          decision.evidence.sources,
          owners,
          true,
        );
        restoreCanonicalMergeCounts(sources, outcomesById);
        const selectedClaims = decision.evidence.claims.filter((claim) =>
          unit.claimIds.includes(claim.id),
        );
        requireThat(
          selectedClaims.length === unit.claimIds.length,
          "Grouped claim scope is incomplete",
        );
        const claims = firstAcceptedCorrectionClaims(
          selectedClaims.map((claim) => ({
            id: claim.id,
            sourceId:
              claim.retainedCopy?.acceptancePullRequestId ??
              claim.creditPullRequestId,
            commitSha: claim.retainedCopy?.acceptedCommitSha ?? claim.commitSha,
            path: claim.path,
          })),
          sources,
        );
        let originalContributor: HistoricalOrdinaryProof["originalContributor"];
        let originalContributorParts: OriginalContributorBinding[] | undefined;
        const claimedSources = sources
          .filter((source) =>
            claims.some((claim) => claim.sourceId === source.sourceId),
          )
          .sort(
            (a, b) =>
              (a.occurredAt ?? "").localeCompare(b.occurredAt ?? "") ||
              a.sourceId.localeCompare(b.sourceId),
          );
        const accepted = claimedSources[0];
        const donors = sources.filter((source) =>
          isMergedOriginalContributor(accepted, source),
        );
        const mergedDonor = donors.length === 1 ? donors[0] : undefined;
        const closedOriginals = sources.filter(
          (source) =>
            source.occurredAt === null &&
            source.author?.id !== accepted?.author?.id,
        );
        const closedOriginal =
          closedOriginals.length === 1 ? closedOriginals[0] : undefined;
        const origin = mergedDonor ?? closedOriginal;
        const followupSources = claimedSources.slice(1);
        const candidateSources = new Set(
          claimedSources.map((source) => source.sourceId),
        );
        const originalCandidate =
          accepted &&
          (sources.length === 1 || origin) &&
          sources.every(
            (source) =>
              candidateSources.has(source.sourceId) ||
              source.sourceId === origin?.sourceId ||
              isOriginalContributorContext(source, accepted),
          );
        if (
          octoberOriginalCredit &&
          candidate.occurredAt.startsWith("2026-10-") &&
          originalCandidate &&
          accepted &&
          (candidateSources.has(candidate.sourceId) ||
            candidate.sourceId === mergedDonor?.sourceId)
        ) {
          const acceptedOutcome = outcomesById.get(accepted.sourceId);
          const read =
            reads.get(accepted.sourceId) ??
            (acceptedOutcome
              ? {
                  outcome: acceptedOutcome,
                  repositoryNodeId: accepted.repositoryNodeId,
                }
              : undefined);
          requireThat(
            read,
            "Grouped accepted source disappeared from the complete census",
          );
          requireThat(accepted, "Grouped accepted source disappeared");
          const original =
            origin && (mergedDonor || followupSources.length > 0)
              ? await octoberOriginalContributorProof(
                  github,
                  accepted,
                  [
                    ...decision.evidence.sources.filter(
                      (s) => s.evidence.pull.node_id === accepted.sourceId,
                    ),
                    ...decision.evidence.sources.filter(
                      (s) => s.evidence.pull.node_id === origin.sourceId,
                    ),
                  ],
                  owners,
                  Boolean(mergedDonor),
                )
              : await ordinaryRetainedProof(
                  github,
                  read,
                  owners,
                  {
                    cache,
                    executor,
                    allowNew: options.graphqlDiscussions === true,
                  },
                  true,
                );
          if (original.originalContributor) {
            const followups: OriginalContributorFollowup[] = [];
            for (const followup of followupSources) {
              const retained = decision.evidence.sources.find(
                (source) => source.evidence.pull.node_id === followup.sourceId,
              );
              requireThat(retained, "Accepted follow-up evidence disappeared");
              followups.push(
                await originalContributorFollowupProof(
                  github,
                  accepted,
                  followup,
                  retained.evidence,
                  retained.policy,
                ),
              );
            }
            const groupedOriginal = groupedOriginalContributorProof(
              accepted,
              original,
              claims,
              sources.filter(
                (source) =>
                  !original.sources.some(
                    (item) => item.sourceId === source.sourceId,
                  ),
              ),
              followups,
            );
            sources = groupedOriginal.sources;
            originalContributor = groupedOriginal.originalContributor;
            if (
              originalContributor &&
              accepted.sourceId !== candidate.sourceId
            ) {
              originalContributor = {
                ...originalContributor,
                acceptedSourceId: accepted.sourceId,
              };
            }
          }
        }
        if (
          !originalContributor &&
          octoberOriginalCredit &&
          accepted &&
          candidate.occurredAt.startsWith("2026-10-") &&
          claimedSources.length > 0
        ) {
          const originalIds = new Set(
            selectedClaims.map((claim) => claim.creditPullRequestId),
          );
          for (const claimed of claimedSources)
            originalIds.delete(claimed.sourceId);
          if (originalIds.size === 1) {
            const originalId = [...originalIds][0];
            const original = decision.evidence.sources.find(
              (source) => source.evidence.pull.node_id === originalId,
            );
            const integration = decision.evidence.sources.find(
              (source) => source.evidence.pull.node_id === accepted.sourceId,
            );
            requireThat(
              original && integration,
              "Original unit evidence disappeared",
            );
            if (
              original.evidence.pull.user.type === "User" &&
              original.evidence.pull.user.node_id !== accepted.author?.id
            ) {
              const proof = await octoberOriginalContributorUnitProof(
                github,
                accepted,
                original,
                integration,
                owners,
                claims,
                decision.evidence.sources.filter((source) =>
                  followupSources.some(
                    (followup) =>
                      followup.sourceId === source.evidence.pull.node_id,
                  ),
                ),
              );
              const authenticated = new Map(
                proof.sources.map((source) => [source.sourceId, source]),
              );
              sources = sources.map(
                (source) => authenticated.get(source.sourceId) ?? source,
              );
              originalContributor = proof.originalContributor;
              if (
                originalContributor &&
                accepted.sourceId !== candidate.sourceId
              )
                originalContributor = {
                  ...originalContributor,
                  acceptedSourceId: accepted.sourceId,
                };
            }
          }
        }
        if (
          !originalContributor &&
          octoberOriginalCredit &&
          candidate.occurredAt.startsWith("2026-10-")
        ) {
          const originatingClaims = new Map<string, string[]>();
          for (const claim of selectedClaims) {
            const original = sources.find(
              (source) => source.sourceId === claim.creditPullRequestId,
            );
            const acceptedClaim = claims.find((item) => item.id === claim.id);
            const carrier = sources.find(
              (source) => source.sourceId === acceptedClaim?.sourceId,
            );
            if (!carrier) continue;
            let verifiedOriginal = original;
            if (
              !verifiedOriginal ||
              verifiedOriginal.author?.id === carrier.author?.id
            ) {
              const retainedOriginals = sources.filter(
                (source) =>
                  source.sourceId !== carrier.sourceId &&
                  verifiedHuman(source.author) &&
                  source.author.id !== carrier.author?.id &&
                  source.commits.some(
                    (commit) =>
                      commit.sha === claim.commitSha &&
                      (commit.author === null ||
                        commit.author.id === source.author?.id),
                  ),
              );
              if (retainedOriginals.length === 1)
                verifiedOriginal = retainedOriginals[0];
            }
            if (
              !verifiedOriginal ||
              verifiedOriginal.author?.id === carrier.author?.id ||
              !verifiedOriginal.commits.some(
                (commit) => commit.sha === claim.commitSha,
              )
            )
              continue;
            const ids = originatingClaims.get(verifiedOriginal.sourceId) ?? [];
            ids.push(claim.id);
            originatingClaims.set(verifiedOriginal.sourceId, ids);
          }
          if (originatingClaims.size >= 2) {
            const proof = await octoberOriginalContributorPartsProof(
              github,
              decision.evidence.sources,
              owners,
              claims,
              originatingClaims,
              candidate.sourceId,
            );
            sources = proof.sources;
            restoreCanonicalMergeCounts(sources, outcomesById);
            originalContributorParts = proof.originalContributorParts;
          }
        }
        candidate.sourceIds = sources.map((s) => s.sourceId).sort();
        candidate.proof = {
          status: "complete",
          censusDigest,
          sources,
          decisionDigest: decision.latestDigest,
          expectedClaimIds: [...unit.claimIds],
          claims,
          ...(originalContributor ? { originalContributor } : {}),
          ...(originalContributorParts ? { originalContributorParts } : {}),
        };
      } catch (error) {
        cache.assertUninterrupted();
        limitations.set(
          candidate.id,
          error instanceof Error ? error.message : "grouped-proof-incomplete",
        );
      }
    }
  }
  for (const pool of pools)
    if (
      pool.candidate.proof.status === "held" &&
      !limitations.has(pool.candidate.id)
    )
      limitations.set(
        pool.candidate.id,
        limitations.get(pool.candidate.sourceId) ??
          (selected.includes(pool)
            ? "evidence-unresolved"
            : "outside-reviewed-candidate-scope"),
      );
  const manifest: PointsImplementationCorrectionManifest = {
    schemaVersion: "1",
    rule: RULE,
    generatedAt: campaign.through,
    baseline,
    candidates: pools.map((p) => p.candidate),
  };
  const receipt = {
    schemaVersion: "slop-implementation-correction-collection-v1",
    through: campaign.through,
    before: campaign.before,
    projects: campaign.projects,
    registryDigest: campaign.registryDigest,
    censusDigest,
    ownershipComplete,
    initialSearchPageSize,
    missingMonths,
    totalPositivePools: pools.length,
    selectedPools: selected.length,
    completeProofs: pools.filter((p) => p.candidate.proof.status === "complete")
      .length,
    heldProofs: pools.filter((p) => p.candidate.proof.status === "held").length,
    sourceFactsCollected: reads.size,
    requests: priorUsage.requests + cache.requests,
    cacheHits: cache.cacheHits,
    reportedGraphqlCost:
      priorUsage.reportedGraphqlCost + cache.reportedGraphqlCost,
    limitations: [...limitations].map(([id, reason]) => ({ id, reason })),
    manifestDigest: digest(encode(manifest)),
  };
  // Optional discovery helpers may catch errors; an interrupted pass cannot publish.
  cache.assertUninterrupted();
  await atomicJson(resolve(directory, "manifest.json"), manifest);
  await atomicJson(resolve(directory, "collection-receipt.json"), receipt);
  return { manifest, receipt };
}

/** Opt-in command runner; each pass rebuilds the campaign from retained evidence. */
export async function collectWithQuotaResume(
  options: CollectionOptions,
  dependencies: CollectionDependencies = {},
  runtime: {
    now: () => number;
    wait: (ms: number) => Promise<unknown>;
  } = { now: Date.now, wait: (ms) => Bun.sleep(ms) },
) {
  if (options.resumeForSeconds === undefined)
    return collectImplementationCorrections(options, dependencies);
  const started = runtime.now();
  const deadline = started + options.resumeForSeconds * 1_000;
  const scopedDependencies = {
    ...dependencies,
    now: dependencies.now ?? new Date(started),
    quotaNow: runtime.now,
  };
  let remaining = options.requestBudget ?? 2000;
  const usage = { requests: 0, reportedGraphqlCost: 0 };
  let consecutiveQuotaRefusals = 0;
  for (;;) {
    try {
      return await collectPass(
        { ...options, requestBudget: remaining },
        scopedDependencies,
        usage,
      );
    } catch (error) {
      if (!(error instanceof CollectionBudgetExhausted)) throw error;
      usage.requests += error.newRequests;
      usage.reportedGraphqlCost += error.reportedGraphqlCost;
      const deferred = new CollectionBudgetExhausted(
        error.kind,
        usage.requests,
        usage.reportedGraphqlCost,
        error.retryAtMs,
      );
      if (error.kind !== "quota" || error.retryAtMs === undefined)
        throw deferred;
      remaining -= error.newRequests;
      consecutiveQuotaRefusals =
        error.savedRequests === 0 ? consecutiveQuotaRefusals + 1 : 0;
      const now = runtime.now();
      const next = Math.max(now + 2_000, error.retryAtMs);
      if (remaining <= 0 || consecutiveQuotaRefusals >= 3 || next >= deadline)
        throw deferred;
      console.warn(
        `Historical evidence checkpoint saved after ${usage.requests} requests; resuming after GitHub quota at ${new Date(next).toISOString()}`,
      );
      await runtime.wait(next - now);
      if (runtime.now() >= deadline) throw deferred;
    }
  }
}

export function parseCollectionArguments(
  args: readonly string[],
): CollectionOptions {
  const result: CollectionOptions = { projects: [], directory: "" };
  for (let i = 0; i < args.length; i++) {
    const argument = args[i],
      value = args[++i];
    requireThat(value, `Missing value for ${argument}`);
    if (argument === "--project") result.projects.push(value);
    else if (argument === "--output") result.directory = value;
    else if (argument === "--month") result.month = value;
    else if (argument === "--candidate-month") result.candidateMonth = value;
    else if (argument === "--october-original-credit") {
      requireThat(
        value === "true" || value === "false",
        "Invalid October original credit flag",
      );
      result.octoberOriginalCredit = value === "true";
    } else if (argument === "--before") {
      requireThat(
        canonicalTime(value) === value,
        "Use a canonical UTC --before instant",
      );
      result.before = value;
    } else if (argument === "--sample")
      result.sampleSourceIds = value.split(",");
    else if (argument === "--request-budget") {
      result.requestBudget = Number(value);
      requireThat(
        Number.isSafeInteger(result.requestBudget) && result.requestBudget > 0,
        "Invalid request budget",
      );
    } else if (argument === "--graphql-discussions") {
      requireThat(
        value === "true" || value === "false",
        "Invalid GraphQL discussion option",
      );
      result.graphqlDiscussions = value === "true";
    } else if (argument === "--resume-for-seconds") {
      result.resumeForSeconds = Number(value);
      requireThat(
        Number.isSafeInteger(result.resumeForSeconds) &&
          result.resumeForSeconds > 0 &&
          result.resumeForSeconds <= 18_000,
        "Invalid quota resume duration (maximum five hours)",
      );
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  requireThat(
    result.projects.length && result.directory,
    "Use --project <registered-id> --output <campaign-directory>",
  );
  requireThat(
    !result.month || /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(result.month),
    "Invalid census month",
  );
  requireThat(
    !result.candidateMonth ||
      /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(result.candidateMonth),
    "Invalid candidate month",
  );
  return result;
}

if (import.meta.main) {
  const options = parseCollectionArguments(process.argv.slice(2));
  try {
    const result = await collectWithQuotaResume(options);
    const { limitations, missingMonths, ...summary } = result.receipt;
    console.log(
      JSON.stringify({
        ...summary,
        missingMonthCount: missingMonths.length,
        limitationCount: limitations.length,
      }),
    );
  } catch (error) {
    if (
      options.resumeForSeconds === undefined ||
      !(error instanceof CollectionBudgetExhausted)
    )
      throw error;
    console.error(
      `${error.message} (${error.newRequests} requests, ${error.reportedGraphqlCost} reported GraphQL points in this invocation)`,
    );
    process.exitCode = 75;
  }
}
