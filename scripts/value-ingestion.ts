import { isCreditEligibleCommitAuthor } from "../src/lib/commit-credit";
import { type DeploymentTier, deploymentOrigins } from "../src/lib/deployment";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { workUnitCreditActorIds } from "../src/lib/implementation-lines";
import {
  canonicalActorAvatarUrl,
  repositoryIdFromUrl,
} from "../src/lib/leaderboard";
/** Read only: no model calls, score publication or payment authority. */
import type {
  GitHubActor,
  HeldWorkUnit,
  LeaderboardInput,
  MergedPullRequestOutcome,
  PenaltyFeedRecord,
  PenaltyHistoryRecord,
} from "../src/lib/leaderboard-types";
import { repositoryIdentity } from "../src/lib/project-repositories.mjs";
import { findIngestedProjectByRepositoryId } from "../src/lib/projects.mjs";
import {
  findRegisteredRepositoryById,
  REGISTERED_REPOSITORIES,
} from "../src/lib/repositories.mjs";
import { assertPenaltyHistory } from "../src/lib/score-penalties";
import type { GitHubClient } from "../workers/slopbot/github";
import type { PublishedPenaltyHistory as PublishedPenaltyRow } from "../workers/slopbot/penalties";
import { loadPolicy } from "../workers/slopbot/review";
import { publicationCommitPages } from "../workers/slopbot/value-commit-pages";
import { readValueDecisionFromHistory } from "../workers/slopbot/value-consumption";
import {
  collectValueContext,
  type ValueContextSelection,
} from "../workers/slopbot/value-context";
import {
  type CompleteValueReferenceDiscussion,
  collectValueEvidence,
  collectValueReferenceEvidence,
} from "../workers/slopbot/value-evidence";
import type {
  Pull,
  RelatedPullRequest,
} from "../workers/slopbot/value-evidence-types";
import type { valueHistory } from "../workers/slopbot/value-journal";
import type { ValueMergeRecipe } from "../workers/slopbot/value-merge-profile";
import {
  consumeWorkUnitHistory,
  readWorkUnitHistory,
} from "../workers/slopbot/value-work-unit-consumption";
import type { workUnitHistory } from "../workers/slopbot/value-work-unit-journal";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";
import {
  AttributionRecorder,
  canonicalJson,
  revalidateAttributionEntries,
} from "./attribution-memo";
import {
  type AttributionLog,
  type AttributionMemoEntry,
  type AttributionMemoFence,
  type AttributionMemoResult,
  type CollectionMemoSession,
  collectionMemoStatsLines,
  watchAttribution,
} from "./collection-memo";
import { rebindHistoricalStandaloneReview } from "./historical-closed-review-source";
import type { ValueReferenceDiscussionSource } from "./historical-discussion-evidence";
import type { HistoricalClosedContextBindings } from "./historical-merged-replay";
import {
  RetainedAttributionIncompleteError,
  retainedCommitCreditSources,
} from "./retained-commit-credit";
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

/**
 * Waits between attempts of one feed read after an outage, from
 * SLOP_VALUE_FEED_RETRY_DELAYS_MS (comma-separated milliseconds). Unset means
 * one attempt. The release collector sets it: a single 503 among thousands of
 * history pages otherwise restarts a five-hour collection (19 November 2026).
 * Only an outage is retried; an integrity failure still stops at once.
 */
function feedRetryDelays(): number[] {
  const raw = process.env.SLOP_VALUE_FEED_RETRY_DELAYS_MS?.trim();
  if (!raw) return [];
  const delays = raw.split(",").map((part) => Number(part.trim()));
  if (
    delays.length > 10 ||
    delays.some((delay) => !Number.isSafeInteger(delay) || delay < 0)
  )
    throw new Error("SLOP_VALUE_FEED_RETRY_DELAYS_MS is invalid");
  return delays;
}

/**
 * How many first history pages are read at once before the sequential
 * history loop of loadValueInputs, from SLOP_VALUE_FEED_CONCURRENCY (an
 * integer from 1 to 16). Unset, empty or 1 means no read-ahead: every page is
 * read in order, one at a time. The release collector sets it: about 9,000
 * outcomes each cost two small feed reads, which took 80 to 100 minutes of
 * pure waiting when read one after another (operator decision, 21 November
 * 2026).
 */
function valueFeedConcurrency(): number {
  const raw = process.env.SLOP_VALUE_FEED_CONCURRENCY?.trim();
  if (!raw) return 1;
  if (!/^[0-9]{1,2}$/u.test(raw))
    throw new Error("SLOP_VALUE_FEED_CONCURRENCY is invalid");
  return Number(raw);
}

async function withFeedRetry<T>(read: () => Promise<T>): Promise<T> {
  const delays = feedRetryDelays();
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (
        !(error instanceof ValueFeedUnavailableError) ||
        attempt >= delays.length
      )
        throw error;
      console.warn(
        JSON.stringify({
          event: "value_feed_retry",
          attempt: attempt + 1,
          delayMs: delays[attempt],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/** A native fetch body may fulfill with a prefix after its request expires. */
function assertFeedDeadline(signal: AbortSignal): void {
  if (signal.aborted) throw new ValueFeedUnavailableError(signal.reason);
}

/** Any failure to read an answered body (interrupted, reset or timed out) is
 * an outage. Malformed JSON in a complete body is an integrity failure and
 * stops the publication. */
async function readFeedJson<T>(
  response: Response,
  signal: AbortSignal,
): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ValueFeedUnavailableError(error);
  }
  assertFeedDeadline(signal);
  return JSON.parse(text) as T;
}

/** Reads one authoritative Slopbot JSON feed. A transport failure, timeout,
 * 404 (a release without the route), 408, 429 or 5xx is an outage that keeps
 * the last published snapshot; any other non-200 answer or a redirect is an
 * integrity failure reported as `unavailable`. */
function fetchAuthoritativeFeed<T>(
  url: URL | string,
  transport: Fetch,
  unavailable: string,
): Promise<T> {
  return withFeedRetry(() =>
    fetchAuthoritativeFeedOnce<T>(url, transport, unavailable),
  );
}

async function fetchAuthoritativeFeedOnce<T>(
  url: URL | string,
  transport: Fetch,
  unavailable: string,
): Promise<T> {
  const signal = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await transport(url, {
      redirect: "manual",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new ValueFeedUnavailableError(error);
  }
  assertFeedDeadline(signal);
  if (
    response.status === 404 ||
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  )
    throw new ValueFeedUnavailableError(`HTTP ${response.status}`);
  if (response.status !== 200 || response.redirected)
    throw new Error(unavailable);
  return readFeedJson<T>(response, signal);
}

/** The fixed HTTPS origin, not a digest supplied by an arbitrary URL, is the
 * publication authority. Test callers can inject a transport, never a new URL.
 */
function fetchHistoryPage(
  kind: "single" | "joint",
  repository: string,
  pull: number,
  after: number,
  transport: Fetch,
  through: number | null = null,
  repositoryNodeId?: string,
) {
  return withFeedRetry(() =>
    fetchHistoryPageOnce(
      kind,
      repository,
      pull,
      after,
      transport,
      through,
      repositoryNodeId,
    ),
  );
}

async function fetchHistoryPageOnce(
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
  // Appended repositories carry their own pinned node id in their entry.
  const pinnedNodeId = project
    ? (repositoryIdentity(project, registered.id)?.nodeId ?? null)
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
  const signal = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await transport(url, {
      redirect: "manual",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new ValueFeedUnavailableError(error);
  }
  assertFeedDeadline(signal);
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
  assertFeedDeadline(signal);
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
    // A Slopbot release without this route (404) is an outage too: keep the
    // last published snapshot instead of publishing scores without debits.
    const body = await fetchAuthoritativeFeed<{
      schemaVersion?: unknown;
      project?: unknown;
      records?: unknown;
      nextAfter?: unknown;
    }>(url, transport, "Authoritative penalty feed is unavailable");
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

type AttributionOutcome = Pick<
  MergedPullRequestOutcome,
  "id" | "url" | "number" | "headRefOid" | "updatedAt"
> & {
  mergedAt: string | null;
  closedAt?: string | null;
  commits?: MergedPullRequestOutcome["commits"];
  baseRefName?: string;
};

export interface ValueInputProgress {
  phase: "commit-attributions" | "value-histories";
  completed: number;
  total: number;
}

/** Reuse of commit attributions from the previous trusted collection. */
export interface AttributionMemoContext {
  session: CollectionMemoSession;
  /** Seeds the audit sample, so one cutoff always audits the same sources. */
  cutoffAt: string;
  /** Slow-attribution and reuse-count lines; the default is stderr. */
  log?: AttributionLog;
}

type ValueGithub = Pick<GitHubClient, "get" | "graphql" | "fileText"> & {
  readReferenceDiscussion?: (
    source: ValueReferenceDiscussionSource,
    pull: Pull,
  ) => Promise<CompleteValueReferenceDiscussion | null>;
};

export async function loadValueInputs(
  liveGithub: ValueGithub,
  outcomes: readonly AttributionOutcome[],
  transport: Fetch = fetch,
  unavailableJointSources?: (
    ids: readonly string[],
  ) => Promise<readonly string[]>,
  attributionOutcomes: readonly AttributionOutcome[] = outcomes,
  onProgress: (progress: ValueInputProgress) => void = () => {},
  memo?: AttributionMemoContext,
  feedConcurrency: number = valueFeedConcurrency(),
  historicalClosedContexts?: HistoricalClosedContextBindings,
) {
  if (
    !Number.isSafeInteger(feedConcurrency) ||
    feedConcurrency < 1 ||
    feedConcurrency > 16
  )
    throw new Error("SLOP_VALUE_FEED_CONCURRENCY is invalid");
  // While an attribution is computed live, every read passes through its
  // recorder so the next collection can tell whether the answer still holds.
  let recorder: AttributionRecorder | null = null;
  const github: ValueGithub = {
    get: async <T>(path: string) => {
      const current = recorder;
      try {
        const value = await liveGithub.get<T>(path);
        current?.observeGet(path, value);
        return value;
      } catch (error) {
        current?.observeError();
        throw error;
      }
    },
    graphql: async <T>(query: string, variables: Record<string, unknown>) => {
      const current = recorder;
      try {
        const value = await liveGithub.graphql<T>(query, variables);
        current?.observeGraphql(query, variables, value);
        return value;
      } catch (error) {
        current?.observeError();
        throw error;
      }
    },
    fileText: async (...args: Parameters<GitHubClient["fileText"]>) => {
      const current = recorder;
      current?.observeFile(args[0], args[1], args[3]);
      try {
        return await liveGithub.fileText(...args);
      } catch (error) {
        current?.observeError();
        throw error;
      }
    },
    readReferenceDiscussion: liveGithub.readReferenceDiscussion
      ? async (source, pull) => {
          const current = recorder;
          try {
            const discussion = await liveGithub.readReferenceDiscussion?.(
              source,
              pull,
            );
            if (discussion) current?.observeIncoming(discussion.timeline);
            return discussion ?? null;
          } catch (error) {
            current?.observeError();
            throw error;
          }
        }
      : undefined,
  };
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
  const implementationAttributionHolds = new Map<string, readonly string[]>();
  const retainedCommitAuthors = new Map<
    string,
    Map<
      string,
      {
        actor: GitHubActor;
        originalPullRequestId: string;
        originalPullRequestUrl: string;
        originalCommitSha: string;
      }
    >
  >();
  const publicRepositories = new Map<string, PublicMergeRepository>();
  const census = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  if (census.size !== outcomes.length)
    throw new Error("Value census repeats a source");
  const attributionIds = new Set<string>();
  for (const outcome of attributionOutcomes) {
    if (attributionIds.has(outcome.id))
      throw new Error("Attribution census repeats a source");
    attributionIds.add(outcome.id);
    const prior = census.get(outcome.id);
    if (
      prior &&
      ["url", "number", "headRefOid", "updatedAt", "mergedAt", "closedAt"].some(
        (field) =>
          prior[field as keyof AttributionOutcome] !==
          outcome[field as keyof AttributionOutcome],
      )
    )
      throw new Error("Attribution census disagrees with the value census");
    census.set(outcome.id, outcome);
  }
  const acceptedCommitOwners = new Map<string, string>();
  const acceptedOutcomes = [...census.values()]
    .filter((outcome) => outcome.mergedAt !== null)
    .sort(
      (left, right) =>
        Date.parse(left.mergedAt as string) -
          Date.parse(right.mergedAt as string) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  for (const outcome of acceptedOutcomes) {
    const repositoryId = repositoryIdFromUrl(outcome.url).toLowerCase();
    for (const commit of outcome.commits ?? []) {
      const key = `${repositoryId}\0${commit.oid}`;
      if (!acceptedCommitOwners.has(key))
        acceptedCommitOwners.set(key, outcome.id);
    }
  }
  const sourceCache = new Map<string, WorkUnitSource>();
  const commitPages = publicationCommitPages();
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
    const { repository, identity } = await repositoryIdentity(repositoryId);
    const client = commitPages(github);
    const hydrate = async (raw: WorkUnitSource) => {
      const collected = {
        ...raw,
        evidence: await collectValueContext(github, raw.evidence, contextPaths),
      };
      return hydrateValueMergeSource(
        collected,
        recipe,
        identity,
        client,
        repository,
      );
    };
    const cached = sourceCache.get(id);
    if (cached) {
      recorder?.observePull(cached.evidence.pull);
      if (
        cached.evidence.repository.toLowerCase() !==
          repository.id.toLowerCase() ||
        cached.evidence.repositoryNodeId !== identity.node_id ||
        cached.evidence.repositoryDatabaseId !== identity.id ||
        cached.evidence.pull.number !== number
      )
        throw new Error("Joint source identity changed between records");
      return hydrate(cached);
    }
    const evidence = await collectValueEvidence(client, repository.id, number);
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

  // Every feed read of this phase, ahead of or in the history loop, shares one limit.
  let feedReads = 0;
  const feedQueue: (() => void)[] = [];
  async function feedRead<T>(read: () => Promise<T>): Promise<T> {
    if (feedConcurrency > 1) {
      if (feedReads >= feedConcurrency)
        await new Promise<void>((resolve) => feedQueue.push(resolve));
      else feedReads += 1;
    }
    try {
      return await read();
    } finally {
      if (feedConcurrency > 1) {
        const following = feedQueue.shift();
        if (following) following();
        else feedReads -= 1;
      }
    }
  }

  async function legacy(collected: WorkUnitSource) {
    const id = collected.evidence.pull.node_id;
    const cached = valueDecisions.get(id);
    if (cached) return cached;
    const decision = await readValueDecisionFromHistory(
      (after) =>
        feedRead(() =>
          fetchValueHistoryPage(
            collected.evidence.repository,
            collected.evidence.pull.number,
            after,
            transport,
            collected.evidence.repositoryNodeId,
          ),
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
      const result = await liveGithub.graphql<{
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
          // An app account served in User shape (BOT_ node ID) is a Bot.
          kind: actor.id.startsWith("BOT_") ? "Bot" : "User",
        });
      }
    }
  }

  type RetainedAuthor = {
    actor: GitHubActor;
    originalPullRequestId: string;
    originalPullRequestUrl: string;
    originalCommitSha: string;
  };
  type AttributionAnswer =
    | { kind: "none" }
    | { kind: "hold"; limitations: readonly string[] }
    | {
        kind: "authors";
        authors: Map<string, RetainedAuthor>;
        bindings: Extract<
          AttributionMemoResult,
          { kind: "authors" }
        >["authors"];
      };

  // attribution-rules: begin retained-authors
  // Every branch credits primary authors. Read retained-copy evidence only
  // for known ordinary unlinked commits first accepted by this PR; a later
  // promotion cannot trigger another attribution pass for imported work.
  function eligibleCommitShasFor(outcome: (typeof outcomes)[number]) {
    if (!outcome.mergedAt) return new Set<string>();
    const creditRepositoryId = repositoryIdFromUrl(outcome.url).toLowerCase();
    return new Set(
      (outcome.commits ?? [])
        .filter(
          (commit) =>
            commit.parentCount !== undefined &&
            commit.parentCount <= 1 &&
            !isCreditEligibleCommitAuthor(commit.author) &&
            acceptedCommitOwners.get(`${creditRepositoryId}\0${commit.oid}`) ===
              outcome.id,
        )
        .map((commit) => commit.oid),
    );
  }

  async function resolveRetainedAuthors(
    outcome: (typeof outcomes)[number],
    repositoryId: string,
    eligibleCommitShas: ReadonlySet<string>,
  ): Promise<AttributionAnswer> {
    const mergedAt = outcome.mergedAt;
    if (!mergedAt || eligibleCommitShas.size === 0) return { kind: "none" };
    const { identity } = await repositoryIdentity(repositoryId);
    const assertAttributionSource = (pull: Pull) => {
      if (
        pull.node_id !== outcome.id ||
        pull.number !== outcome.number ||
        pull.html_url !== outcome.url ||
        pull.head.sha !== outcome.headRefOid ||
        pull.merged_at !== mergedAt ||
        Date.parse(pull.updated_at) !== Date.parse(outcome.updatedAt)
      )
        throw new Error("Attribution source changed after the outcome census");
    };
    const readReferenceDiscussion = github.readReferenceDiscussion;
    const discovery = await collectValueReferenceEvidence(
      github,
      repositoryId,
      outcome.number,
      readReferenceDiscussion
        ? (pull) => {
            assertAttributionSource(pull);
            const headSha = outcome.headRefOid;
            if (!headSha) return Promise.resolve(null);
            return readReferenceDiscussion(
              {
                repository: repositoryId,
                repositoryNodeId: identity.node_id,
                id: outcome.id,
                number: outcome.number,
                url: outcome.url,
                headSha,
                mergedAt,
              },
              pull,
            );
          }
        : undefined,
    );
    assertAttributionSource(discovery.pull);
    if (discovery.limitations.length)
      return { kind: "hold", limitations: discovery.limitations };
    const originalCandidates = new Map<string, boolean>();
    async function isOriginal(reference: RelatedPullRequest) {
      if (
        reference.repository.toLowerCase() !== repositoryId.toLowerCase() ||
        reference.number >= outcome.number
      )
        return false;
      const cached = originalCandidates.get(reference.id);
      if (cached !== undefined) return cached;
      const pull = await github.get<Pull>(
        `/repos/${repositoryId}/pulls/${reference.number}`,
      );
      if (
        !pull ||
        pull.node_id !== reference.id ||
        pull.number !== reference.number ||
        pull.html_url !== reference.url
      )
        throw new Error("Original attribution source identity is unavailable");
      const original = pull.state === "closed" && pull.merged_at === null;
      originalCandidates.set(reference.id, original);
      return original;
    }
    let hasOriginal = false;
    for (const reference of discovery.references)
      if (await isOriginal(reference)) hasOriginal = true;
    // Most unlinked commits have no replaced submission. Do not collect every
    // historical commit patch merely to discover that no claim can be made.
    if (!hasOriginal) return { kind: "none" };
    // A manual release may defer the retained-copy comparison, which can read
    // thousands of tree pages for one pull request. A held source keeps its
    // prior journal row and is not memoized, so the next collection resolves
    // it live (operator decision, 20 November 2026).
    if (process.env.SLOP_DEFER_RETAINED_ATTRIBUTION === "1")
      return {
        kind: "hold",
        limitations: ["Retained attribution deferred for this collection"],
      };
    const accepted = await source(repositoryId, outcome.number, outcome.id);
    const sources = [accepted];
    for (const reference of accepted.evidence.relatedPullRequests) {
      if (!(await isOriginal(reference))) continue;
      const original = await source(
        repositoryId,
        reference.number,
        reference.id,
      );
      if (
        original.evidence.pull.state === "closed" &&
        !original.evidence.pull.merged_at
      )
        sources.push(original);
    }
    // Without an original-source candidate, unlinked work keeps the ordinary
    // source-creator fallback. Its provisional minimum needs no value review.
    if (sources.length === 1) return { kind: "none" };
    let bindings: Awaited<ReturnType<typeof retainedCommitCreditSources>>;
    try {
      bindings = await retainedCommitCreditSources(accepted, sources);
    } catch (error) {
      if (!(error instanceof RetainedAttributionIncompleteError)) throw error;
      return { kind: "hold", limitations: error.limitations };
    }
    const eligibleBindings = [...bindings].filter(([sha]) =>
      eligibleCommitShas.has(sha),
    );
    await hydrateActors(
      new Set(eligibleBindings.map(([, entry]) => entry.actorNodeId)),
    );
    const authors = new Map<string, RetainedAuthor>();
    const memoBindings: Extract<
      AttributionMemoResult,
      { kind: "authors" }
    >["authors"] = [];
    for (const [sha, binding] of eligibleBindings) {
      const actor = valueActors.get(binding.actorNodeId);
      if (!actor || !isCreditEligibleCommitAuthor(actor))
        throw new Error("Retained source creator identity is unavailable");
      authors.set(sha, {
        actor,
        originalPullRequestId: binding.originalPullRequestId,
        originalPullRequestUrl: binding.originalPullRequestUrl,
        originalCommitSha: binding.originalCommitSha,
      });
      memoBindings.push([
        sha,
        binding.actorNodeId,
        binding.originalPullRequestId,
        binding.originalPullRequestUrl,
        binding.originalCommitSha,
      ]);
    }
    return authors.size
      ? { kind: "authors", authors, bindings: memoBindings }
      : { kind: "none" };
  }

  function memoResult(answer: AttributionAnswer): AttributionMemoResult | null {
    if (answer.kind === "hold") return null;
    return answer.kind === "none"
      ? { kind: "none" }
      : { kind: "authors", authors: answer.bindings };
  }
  // attribution-rules: end retained-authors

  /** The live computation, recorded for the next collection. */
  async function liveAttribution(
    outcome: (typeof outcomes)[number],
    repositoryId: string,
    eligibleCommitShas: ReadonlySet<string>,
  ): Promise<AttributionAnswer> {
    if (eligibleCommitShas.size === 0 || !outcome.mergedAt)
      return { kind: "none" };
    const registered = findRegisteredRepositoryById(repositoryId);
    const active = new AttributionRecorder(
      registered
        ? [
            repositoryId,
            registered.id,
            `${registered.owner}/${registered.name}`,
            ...registered.aliases,
          ]
        : [repositoryId],
    );
    recorder = active;
    let answer: AttributionAnswer;
    try {
      answer = await resolveRetainedAuthors(
        outcome,
        repositoryId,
        eligibleCommitShas,
      );
    } finally {
      recorder = null;
    }
    if (memo && outcome.headRefOid) {
      const { identity } = await repositoryIdentity(repositoryId);
      const entry = active.entry(
        outcome.id,
        attributionFence(outcome, identity.node_id, eligibleCommitShas),
        memoResult(answer),
      );
      if (entry) memo.session.next.set(outcome.id, entry);
      else memo.session.noteNotReusable(active.reasons);
    }
    return answer;
  }

  function attributionFence(
    outcome: (typeof outcomes)[number],
    repositoryNodeId: string,
    eligibleCommitShas: ReadonlySet<string>,
  ): AttributionMemoFence {
    return {
      number: outcome.number,
      url: outcome.url,
      headRefOid: outcome.headRefOid as string,
      mergedAt: new Date(outcome.mergedAt as string).toISOString(),
      updatedAt: new Date(outcome.updatedAt).toISOString(),
      repositoryNodeId,
      eligibleCommitShas: [...eligibleCommitShas].sort(),
    };
  }

  /** A reused answer: actors are re-read live, exactly as the live path does. */
  async function reusedAttribution(
    entry: AttributionMemoEntry,
  ): Promise<AttributionAnswer | null> {
    if (entry.result.kind === "none") return { kind: "none" };
    await hydrateActors(
      new Set(entry.result.authors.map((author) => author[1])),
    );
    const authors = new Map<string, RetainedAuthor>();
    for (const [sha, actorNodeId, id, url, original] of entry.result.authors) {
      const actor = valueActors.get(actorNodeId);
      if (!actor || !isCreditEligibleCommitAuthor(actor)) return null;
      authors.set(sha, {
        actor,
        originalPullRequestId: id,
        originalPullRequestUrl: url,
        originalCommitSha: original,
      });
    }
    return { kind: "authors", authors, bindings: entry.result.authors };
  }

  // Attribution applies to the complete merge census, including historical
  // work. Only the policy-selected outcomes below read assessment history.
  onProgress({
    phase: "commit-attributions",
    completed: 0,
    total: attributionOutcomes.length,
  });
  const repositoryOf = (outcome: (typeof outcomes)[number]) => {
    const [owner, repo] = new URL(outcome.url).pathname
      .split("/")
      .filter(Boolean);
    return `${owner}/${repo}`;
  };
  const eligible = new Map(
    attributionOutcomes.map((outcome) => [
      outcome.id,
      eligibleCommitShasFor(outcome),
    ]),
  );
  // Incremental collection: an earlier answer is reused only when the live
  // census and every recorded input still match. Everything else is live.
  const reusable = new Map<string, AttributionMemoEntry>();
  if (memo?.session.prior.size) {
    const candidates: AttributionMemoEntry[] = [];
    for (const outcome of attributionOutcomes) {
      const entry = memo.session.prior.get(outcome.id);
      const shas = eligible.get(outcome.id) ?? new Set<string>();
      if (!entry || shas.size === 0 || !outcome.mergedAt || !outcome.headRefOid)
        continue;
      const repositoryId = repositoryOf(outcome);
      const { identity } = await repositoryIdentity(repositoryId);
      if (
        canonicalJson(entry.fence) ===
        canonicalJson(attributionFence(outcome, identity.node_id, shas))
      )
        candidates.push(entry);
      else memo.session.stats.fenceMisses += 1;
    }
    const valid = await revalidateAttributionEntries(
      liveGithub.graphql.bind(liveGithub) as Parameters<
        typeof revalidateAttributionEntries
      >[0],
      candidates,
    );
    for (const entry of candidates) {
      if (valid.has(entry.outcomeId)) reusable.set(entry.outcomeId, entry);
      else memo.session.stats.fenceMisses += 1;
    }
  }
  // Audit sample: recompute some reusable answers live first. One difference
  // discards every reuse in this run.
  const answers = new Map<string, AttributionAnswer>();
  if (memo)
    for (const outcome of attributionOutcomes) {
      const entry = reusable.get(outcome.id);
      if (!entry || !memo.session.audits(outcome.id, memo.cutoffAt)) continue;
      const done = watchAttribution(
        `${repositoryOf(outcome)}#${outcome.number}`,
        memo.log,
      );
      const answer = await liveAttribution(
        outcome,
        repositoryOf(outcome),
        eligible.get(outcome.id) as Set<string>,
      );
      done(answer.kind === "hold" ? "audited, hold" : "audited");
      answers.set(outcome.id, answer);
      memo.session.stats.audited += 1;
      if (canonicalJson(memoResult(answer)) !== canonicalJson(entry.result)) {
        memo.session.stats.auditMismatches += 1;
        reusable.clear();
      }
    }
  for (const [index, outcome] of attributionOutcomes.entries()) {
    const repositoryId = repositoryOf(outcome);
    const shas = eligible.get(outcome.id) ?? new Set<string>();
    let answer = answers.get(outcome.id);
    const entry = reusable.get(outcome.id);
    // An audited answer was timed above; this pass only takes it.
    const done = answer
      ? null
      : watchAttribution(`${repositoryId}#${outcome.number}`, memo?.log);
    let how = "computed live";
    if (!answer && entry) {
      const reused = await reusedAttribution(entry);
      if (reused && memo) {
        answer = reused;
        how = "reused from the memo";
        memo.session.next.set(outcome.id, entry);
        memo.session.stats.reused += 1;
      }
    }
    if (!answer) {
      answer = await liveAttribution(outcome, repositoryId, shas);
      if (memo && shas.size) memo.session.stats.live += 1;
    }
    done?.(answer.kind === "hold" ? `${how}, hold` : how);
    if (answer.kind === "hold")
      implementationAttributionHolds.set(outcome.id, answer.limitations);
    else if (answer.kind === "authors")
      retainedCommitAuthors.set(outcome.id, answer.authors);
    onProgress({
      phase: "commit-attributions",
      completed: index + 1,
      total: attributionOutcomes.length,
    });
  }
  // Reported here, not only after a written snapshot, so a collection that
  // fails in a later phase has still said what it reused.
  if (memo)
    (memo.log?.write ?? ((line: string) => void process.stderr.write(line)))(
      collectionMemoStatsLines(memo.session),
    );

  // First history pages read ahead of the loop below, keyed by the outcome's
  // position and the exact arguments of its first read. The loop takes each
  // page at most once and reads every other page itself.
  type Warmed = {
    joint: Promise<JointPage | null>;
    single: Promise<Page | null>;
  };
  const warmed = new Map<string, Warmed>();
  const firstPageKey = (
    index: number,
    repositoryId: string,
    pull: number,
    repositoryNodeId: string,
  ) => JSON.stringify([index, repositoryId, pull, repositoryNodeId]);
  const emptyJointPage = (page: JointPage) =>
    page.records.length === 0 &&
    page.nextAfter === null &&
    page.totalRecords === 0;
  function takeWarmed(key: string): Warmed | undefined {
    const pages = warmed.get(key);
    warmed.delete(key);
    return pages;
  }

  // The read-ahead runs beside the loop and stays at most this many outcomes
  // in front of it, so a page it reads is never older than the loop's last
  // few outcomes. Reading every page before the loop let a record published
  // or replaced during the loop be decided from the page read before it.
  const readAheadWindow = 2 * feedConcurrency;
  let loopIndex = -1;
  let readAheadOpen = true;
  let readAheadWaiters: (() => void)[] = [];
  function moveLoop(index: number) {
    loopIndex = index;
    const waiting = readAheadWaiters;
    readAheadWaiters = [];
    for (const resume of waiting) resume();
  }

  /**
   * Reads the first joint page of each outcome, and the first single page
   * where that joint history is empty, a bounded number at a time and at most
   * readAheadWindow outcomes ahead of the loop. It only saves waiting: it
   * calls the same readers with the arguments the loop uses and decides
   * nothing. A read that fails here is dropped, logged and ends the
   * read-ahead, so the loop repeats that read in its own turn and its failure
   * surfaces there, in order, as without it.
   */
  type Target = { repositoryId: string; nodeId: string } | null;
  async function readAheadTargets() {
    const targets: Target[] = [];
    const unresolved = new Set<string>();
    // Resolve each repository once, in outcome order, before any feed read.
    for (const outcome of outcomes) {
      let target: Target = null;
      try {
        const [owner, repo] = new URL(outcome.url).pathname
          .split("/")
          .filter(Boolean);
        const route = `${owner}/${repo}`;
        if (!unresolved.has(route))
          try {
            const { repository, identity } = await repositoryIdentity(route);
            target = { repositoryId: repository.id, nodeId: identity.node_id };
          } catch {
            unresolved.add(route);
          }
      } catch {
        // The loop reports an outcome URL it cannot read.
      }
      targets.push(target);
    }
    return targets;
  }
  async function warmFirstHistoryPages(targets: readonly Target[]) {
    let next = 0;
    let pages = 0;
    let dropped: { outcome: number; error: string } | null = null;
    const drop = (index: number, error: unknown) => {
      readAheadOpen = false;
      dropped ??= {
        outcome: index,
        error: error instanceof Error ? error.name : typeof error,
      };
      return null;
    };
    const worker = async () => {
      while (readAheadOpen && next < outcomes.length) {
        if (next > loopIndex + readAheadWindow) {
          await new Promise<void>((resume) => readAheadWaiters.push(resume));
          continue;
        }
        const index = next++;
        const target = targets[index];
        // The loop reads its current and earlier outcomes itself.
        if (!target || index <= loopIndex) continue;
        const pull = outcomes[index].number;
        const joint = feedRead(() =>
          fetchWorkUnitHistoryPage(
            target.repositoryId,
            pull,
            0,
            null,
            transport,
            target.nodeId,
          ),
        ).then(
          (page) => {
            pages += 1;
            return page;
          },
          (error) => drop(index, error),
        );
        // The loop reads the single history only after an empty joint one.
        const single = joint.then((page) =>
          readAheadOpen && page && emptyJointPage(page)
            ? feedRead(() =>
                fetchValueHistoryPage(
                  target.repositoryId,
                  pull,
                  0,
                  transport,
                  target.nodeId,
                ),
              ).then(
                (page) => {
                  pages += 1;
                  return page;
                },
                (error) => drop(index, error),
              )
            : null,
        );
        warmed.set(
          firstPageKey(index, target.repositoryId, pull, target.nodeId),
          { joint, single },
        );
        await single;
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(feedConcurrency, outcomes.length) },
        worker,
      ),
    );
    console.warn(
      JSON.stringify({
        event: "value_history_first_pages_warmed",
        concurrency: feedConcurrency,
        window: readAheadWindow,
        outcomes: outcomes.length,
        // Outcomes whose repository or URL the read-ahead could not resolve;
        // the loop reads and reports those itself.
        unresolved: targets.filter((target) => !target).length,
        pages,
        ...(dropped ? { dropped } : {}),
      }),
    );
  }
  const readAhead =
    feedConcurrency > 1 && outcomes.length > 0
      ? warmFirstHistoryPages(await readAheadTargets())
      : null;
  try {
    for (const [index, outcome] of outcomes.entries()) {
      onProgress({
        phase: "value-histories",
        completed: index,
        total: outcomes.length,
      });
      moveLoop(index);
      const [owner, repo] = new URL(outcome.url).pathname
        .split("/")
        .filter(Boolean);
      const { repository, identity } = await repositoryIdentity(
        `${owner}/${repo}`,
      );
      const ahead = takeWarmed(
        firstPageKey(index, repository.id, outcome.number, identity.node_id),
      );
      let aheadJoint = ahead?.joint;
      const graph = await readWorkUnitHistory(
        async (after, through) => {
          // Only an empty page read ahead is used. A history with records is
          // read again in this turn, so a record replaced since the read-ahead
          // is decided as the one-at-a-time reader decides it.
          const read =
            after === 0 && through === null ? await aheadJoint : null;
          aheadJoint = undefined;
          const warmedJoint = read && emptyJointPage(read) ? read : null;
          return (
            warmedJoint ??
            feedRead(() =>
              fetchWorkUnitHistoryPage(
                repository.id,
                outcome.number,
                after,
                through,
                transport,
                identity.node_id,
              ),
            )
          );
        },
        { repositoryNodeId: identity.node_id, pullRequestNodeId: outcome.id },
      );
      const groupDigest = graph.current?.row.record_digest ?? null;
      if (
        observedGroups.has(outcome.id) &&
        observedGroups.get(outcome.id) !== groupDigest
      )
        throw new Error(
          "Joint value history changed during snapshot collection",
        );
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
          decision = await consumeWorkUnitHistory(
            graph,
            members,
            legacyDigests,
          );
          const closure = historicalClosedContexts?.get(outcome.id);
          if (
            decision.status === "stale" &&
            closure?.standaloneReview &&
            closure.digest === groupDigest &&
            members.length === 1
          ) {
            const rebound = await rebindHistoricalStandaloneReview(
              members[0],
              graph.current.record,
              github,
            );
            if (rebound !== members[0])
              decision = await consumeWorkUnitHistory(
                graph,
                [rebound],
                legacyDigests,
              );
          }
          groups.set(graph.current.row.record_digest, decision);
          if (decision.status === "assessed") {
            const actors = new Set(
              decision.evidence.claims.flatMap(
                (claim) => claim.implementationActorNodeIds,
              ),
            );
            // Current allocation uses primary commit authors on every branch.
            // Preserve the original evidence/claims for valuation digest checks.
            for (const claim of decision.evidence.claims)
              for (const id of workUnitCreditActorIds(
                decision.evidence,
                claim,
              ) ?? [])
                actors.add(id);
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
      const warmedSingle = await ahead?.single;
      const first =
        (warmedSingle &&
        warmedSingle.records.length === 0 &&
        warmedSingle.nextAfter === null
          ? warmedSingle
          : null) ??
        (await feedRead(() =>
          fetchValueHistoryPage(
            repository.id,
            outcome.number,
            0,
            transport,
            identity.node_id,
          ),
        ));
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
            : feedRead(() =>
                fetchValueHistoryPage(
                  repository.id,
                  outcome.number,
                  after,
                  transport,
                  identity.node_id,
                ),
              ),
        collected.evidence,
        collected.policy,
        (evidence, paths) => collectValueContext(github, evidence, paths),
      );
      valueDecisions.set(outcome.id, decision);
      if (decision.status === "assessed")
        await hydrateActors(new Set(decision.implementationActorNodeIds));
    }
  } finally {
    readAheadOpen = false;
    moveLoop(outcomes.length);
    await readAhead;
  }
  onProgress({
    phase: "value-histories",
    completed: outcomes.length,
    total: outcomes.length,
  });
  return {
    valueDecisions,
    jointValueDecisions,
    valueActors,
    retainedCommitAuthors,
    implementationAttributionHolds,
    heldWorkUnits,
  };
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
  retainedActorNodeIds: Iterable<string> = [],
): Promise<Map<string, string>> {
  // 404 covers the release window before the route is deployed.
  const body = await fetchAuthoritativeFeed<{
    schemaVersion?: unknown;
    bans?: unknown;
  }>(ACCOUNT_BAN_FEED, transport, "The account ban feed is unavailable");
  if (
    body?.schemaVersion !== "slop-account-bans:v1" ||
    !Array.isArray(body.bans) ||
    body.bans.length > 10_000
  )
    throw new Error("The account ban feed has an invalid shape");
  const bans = new Map<string, string>();
  const retained = new Map<string, Set<string>>();
  for (const nodeId of retainedActorNodeIds) {
    const id =
      typeof nodeId === "string" ? githubUserIdFromNodeId(nodeId) : null;
    if (id === null)
      throw new Error(
        "Retained ban identity is not a canonical GitHub user ID",
      );
    const aliases = retained.get(id) ?? new Set<string>();
    aliases.add(nodeId);
    retained.set(id, aliases);
  }
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
    const bannedAt = new Date(ban.bannedAt).toISOString();
    // Historical proofs can still contain a deleted account's immutable ID,
    // including an older node-ID spelling. Its ban must not disappear merely
    // because GitHub can no longer return a live user object.
    for (const nodeId of retained.get(ban.githubId) ?? [])
      bans.set(nodeId, bannedAt);
    const account = await github.get<{ id: number; node_id: string }>(
      `/user/${ban.githubId}`,
    );
    // No new live event can carry a deleted account. Retained identities were
    // matched above without relying on the availability of that live object.
    if (account === null) continue;
    if (
      String(account.id) !== ban.githubId ||
      typeof account.node_id !== "string"
    )
      throw new Error("GitHub returned a different account for a ban");
    bans.set(account.node_id, bannedAt);
  }
  return bans;
}
