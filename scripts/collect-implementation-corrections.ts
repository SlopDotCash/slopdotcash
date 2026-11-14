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
  type CorrectionSource,
  createPointsCorrectionBaseline,
  type PointsImplementationCorrectionCandidate,
  type PointsImplementationCorrectionManifest,
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
} from "../workers/slopbot/value-evidence";
import type {
  Pull,
  ValueEvidence,
} from "../workers/slopbot/value-evidence-types";
import {
  valueAdditionCount,
  valueDeletionCount,
} from "../workers/slopbot/value-patch";
import { retainedCopyBindings } from "../workers/slopbot/value-retained-copy";
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
export class CollectionBudgetExhausted extends Error {}

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
  private interruption: CollectionBudgetExhausted | null = null;
  constructor(
    readonly directory: string,
    readonly transport: typeof fetch,
    readonly requestBudget = 2000,
  ) {}
  assertUninterrupted(): void {
    if (this.interruption) throw this.interruption;
  }
  private interrupt(message: string): never {
    this.interruption ??= new CollectionBudgetExhausted(message);
    throw this.interruption;
  }
  readonly fetch: typeof fetch = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
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
      const key = digest(encode({ url: url.href, method, body }));
      const path = resolve(this.directory, "requests", `${key}.json`);
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
      if (this.requests >= this.requestBudget)
        this.interrupt(
          "Request budget reached; rerun the same baseline-bound campaign",
        );
      this.requests += 1;
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
      let parsed:
        | { errors?: unknown[]; data?: { rateLimit?: { cost: number } } }
        | undefined;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        /* Retain non-JSON failures exactly. */
      }
      this.reportedGraphqlCost += parsed?.data?.rateLimit?.cost ?? 0;
      await immutableBytes(
        resolve(this.directory, "objects", bodyDigest),
        bytes,
      );
      await immutableBytes(
        resolve(
          this.directory,
          "attempts",
          `${Date.now()}-${this.requests}-${key}-${randomUUID()}.json`,
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
      if (
        github &&
        (response.status === 429 ||
          (response.status === 403 &&
            response.headers.get("x-ratelimit-remaining") === "0") ||
          (response.status === 200 &&
            url.pathname === "/graphql" &&
            Array.isArray(parsed?.errors) &&
            parsed.errors.some(
              (error) =>
                typeof error === "object" &&
                error !== null &&
                "type" in error &&
                error.type === "RATE_LIMITED",
            )))
      )
        this.interrupt(
          "GitHub API quota exhausted; wait for quota recovery and rerun the same baseline-bound campaign",
        );
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
        (!parsed?.errors || recoverableStatistics)
      )
        await atomicJson(path, {
          status: response.status,
          headers,
          bodyDigest,
        });
      return new Response(bytes, {
        status: response.status,
        headers: response.headers,
      });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
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
      value.data && (!value.errors || statisticsFailure),
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
): CorrectionSource {
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
      if (commit.parents.length > 1)
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
          firstAcceptedSourceId: evidence.pull.merged_at
            ? (owners.get(
                `${evidence.repository.toLowerCase()}\0${commit.sha}`,
              ) ?? null)
            : null,
        };
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
): Promise<CorrectionSource[]> {
  const retained = await retainedCopyBindings(sources, {
    ordinaryCommitsOnly: true,
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
    // The canonical helper also requires one complete binding for every path.
    const canonical = await retainedCommitCreditSources(accepted, sources);
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

async function ordinaryRetainedProof(
  github: GitHubClient,
  read: SourceRead,
  owners: ReadonlyMap<string, string>,
): Promise<CorrectionSource[]> {
  const plain = ordinarySource(read, owners);
  const needsDiscovery = plain.commits.some(
    (c) =>
      c.parentCount <= 1 &&
      c.firstAcceptedSourceId === plain.sourceId &&
      !isCreditEligibleCommitAuthor(c.author),
  );
  if (!needsDiscovery) return [plain];
  const references = await collectValueReferenceEvidence(
    github,
    plain.repository,
    read.outcome.number,
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
  if (!originals.length) return [plain];
  const sources: WorkUnitSource[] = [];
  for (const number of [
    read.outcome.number,
    ...originals.map((p) => p.number),
  ]) {
    const evidence = await collectValueEvidence(
      github,
      plain.repository,
      number,
    );
    sources.push({
      evidence,
      policy: { sha: evidence.pull.base.sha, text: "" },
    });
  }
  const converted = await bindRetained(sources, owners);
  const accepted = converted.find((s) => s.sourceId === plain.sourceId);
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
  return converted;
}

export interface CollectionOptions {
  projects: string[];
  directory: string;
  month?: string;
  sampleSourceIds?: string[];
  candidateMonth?: string;
  before?: string;
  requestBudget?: number;
}
export interface CollectionDependencies {
  journal?: PointsJournal;
  token?: string;
  transport?: typeof fetch;
  now?: Date;
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

/** All public candidates are emitted, including held, unchanged and unselected
 * pools. A bounded sample can collect facts, but cannot assert ownership.
 */
export async function collectImplementationCorrections(
  options: CollectionOptions,
  dependencies: CollectionDependencies = {},
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
  const directory = resolve(options.directory);
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
  const cache = new CorrectionEvidenceCache(
    directory,
    dependencies.transport ?? fetch,
    options.requestBudget,
  );
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
  if (campaign) {
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
        encode(campaign.projects) === encode(options.projects) &&
        campaign.registryDigest === registryDigest,
      "Campaign baseline or canonical registry changed; use a new campaign directory",
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
    // The loader spans every month of this repository, so a month's raw
    // statistics requests depend on the months reconstructed before it.
    let earlierMonthMissing = false;
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
        requireThat(
          part || !earlierMonthMissing,
          "Collect earlier census months first; later months reuse their commit statistics",
        );
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
        if (part)
          requireThat(
            part.digest === digest(encode(payload)),
            "Cached census differs from reconstructed raw evidence",
          );
        else {
          part = { ...payload, digest: digest(encode(payload)) };
          await atomicJson(partPath, part);
        }
      }
      if (!part) {
        earlierMonthMissing = true;
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
  const selectedMonth = options.candidateMonth ?? options.month;
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
        requireThat(
          outcome.commits.at(-1)?.oid === outcome.headRefOid &&
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
    try {
      const sources = await ordinaryRetainedProof(github, read, owners);
      candidate.sourceIds = sources.map((s) => s.sourceId).sort();
      candidate.proof = { status: "complete", censusDigest, sources };
    } catch (error) {
      if (error instanceof CollectionBudgetExhausted) throw error;
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
        const sources = await bindRetained(decision.evidence.sources, owners);
        const selectedClaims = decision.evidence.claims.filter((claim) =>
          unit.claimIds.includes(claim.id),
        );
        requireThat(
          selectedClaims.length === unit.claimIds.length,
          "Grouped claim scope is incomplete",
        );
        candidate.proof = {
          status: "complete",
          censusDigest,
          sources,
          decisionDigest: decision.latestDigest,
          expectedClaimIds: [...unit.claimIds],
          claims: selectedClaims.map((claim) => ({
            id: claim.id,
            sourceId:
              claim.retainedCopy?.acceptancePullRequestId ??
              claim.creditPullRequestId,
            commitSha: claim.retainedCopy?.acceptedCommitSha ?? claim.commitSha,
            path: claim.path,
          })),
        };
      } catch (error) {
        if (error instanceof CollectionBudgetExhausted) throw error;
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
    registryDigest,
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
    requests: cache.requests,
    cacheHits: cache.cacheHits,
    reportedGraphqlCost: cache.reportedGraphqlCost,
    limitations: [...limitations].map(([id, reason]) => ({ id, reason })),
    manifestDigest: digest(encode(manifest)),
  };
  // Optional discovery helpers may catch errors; an interrupted pass cannot publish.
  cache.assertUninterrupted();
  await atomicJson(resolve(directory, "manifest.json"), manifest);
  await atomicJson(resolve(directory, "collection-receipt.json"), receipt);
  return { manifest, receipt };
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
    else if (argument === "--before") {
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
  const result = await collectImplementationCorrections(
    parseCollectionArguments(process.argv.slice(2)),
  );
  const { limitations, missingMonths, ...summary } = result.receipt;
  console.log(
    JSON.stringify({
      ...summary,
      missingMonthCount: missingMonths.length,
      limitationCount: limitations.length,
    }),
  );
}
