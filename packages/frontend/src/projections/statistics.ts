// spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"; spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"; spec/frontend/views.md, "Model outcome statistics aggregate self-reported identities against accepted outcomes and never change a score"
import { isUnavailableModelIdentifier } from "@repo/contributor/client";
import { type LeaderboardSnapshot, type ModelAttribution, pointsOf, type ScoreEvent } from "@repo/points/client";
import { Schema } from "effect";
import whoBuildsText from "../../../../data/who-builds/2026-09-17/snapshot.json?raw";
import { type MergeRow, mergeLine } from "../../gen/frontend__projections.ts";
import { declarationCounts } from "../../gen/frontend__views.ts";

export { whoBuildsText };

export interface MergeActivityRow {
  readonly repository: string;
  readonly observedAt: string;
  readonly lastAttemptFailed: boolean;
  readonly lastMergedAt: string | null;
  readonly waitingOutside: number;
  readonly waitingCapped: boolean;
  readonly mergedOutsideLast30Days: number;
  readonly medianHoursToMerge: number | null;
}

const dayMs = 86_400_000;

const unavailableModel = (value: string): boolean => isUnavailableModelIdentifier(value);

/** @throws {never} */
function instant(iso: string): number {
  const millis = Date.parse(iso);
  return Number.isSafeInteger(millis) && millis > 0 ? millis : -1;
}

/** @throws {never} */
function counted(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

/** @throws {never} */
export function mergeRowOf(row: MergeActivityRow): MergeRow {
  const median = row.medianHoursToMerge;
  return {
    present: true,
    observedAt: instant(row.observedAt),
    lastAttemptFailed: row.lastAttemptFailed,
    lastMergedAt: row.lastMergedAt === null ? 0 : instant(row.lastMergedAt),
    waitingOutside: counted(row.waitingOutside),
    mergedOutside30d: counted(row.mergedOutsideLast30Days),
    medianDoubled: median === null ? -1 : Number.isFinite(median) && median >= 0 ? Math.round(median * 2) : -2,
  };
}

interface ReadRow {
  readonly row: MergeActivityRow;
  readonly stale: boolean;
}

/** @throws {never} */
function readRows(rows: ReadonlyArray<MergeActivityRow> | undefined): ReadonlyArray<ReadRow> {
  return (rows ?? []).flatMap((row): ReadRow[] => {
    const line = mergeLine(mergeRowOf(row));
    return line.tag === "MergeCurrent" ? [{ row, stale: false }] : line.tag === "MergeStale" ? [{ row, stale: true }] : [];
  });
}

/** @throws {never} */
function ago(iso: string, nowMs: number): string {
  const days = Math.floor((nowMs - Date.parse(iso)) / dayMs);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** @throws {never} */
function duration(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) {
    const rounded = Math.round(hours);
    return rounded === 1 ? "1 hour" : `${rounded} hours`;
  }
  return `${Math.round(hours / 24)} days`;
}

/** @throws {RangeError} */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

interface MergeSummary {
  readonly last: string | null;
  readonly waiting: number;
  readonly capped: boolean;
  readonly observed: string;
  readonly busiest: MergeActivityRow;
  readonly stale: boolean;
}

/** @throws {never} */
function summary(rows: ReadonlyArray<ReadRow>): MergeSummary | undefined {
  const [first, ...rest] = rows;
  if (first === undefined) return undefined;
  return rest.reduce<MergeSummary>((found, { row, stale }) => ({
    last: row.lastMergedAt !== null && (found.last === null || row.lastMergedAt > found.last) ? row.lastMergedAt : found.last,
    waiting: found.waiting + row.waitingOutside,
    capped: found.capped || row.waitingCapped,
    observed: row.observedAt < found.observed ? row.observedAt : found.observed,
    busiest: row.mergedOutsideLast30Days > found.busiest.mergedOutsideLast30Days ? row : found.busiest,
    stale: found.stale || stale,
  }), { last: first.row.lastMergedAt, waiting: first.row.waitingOutside, capped: first.row.waitingCapped, observed: first.row.observedAt, busiest: first.row, stale: first.stale });
}

/** @throws {never} */
function median(found: MergeSummary): number | undefined {
  const hours = found.busiest.medianHoursToMerge;
  return hours === null || found.busiest.mergedOutsideLast30Days === 0 ? undefined : hours;
}

/** @throws {RangeError} */
export function mergeActivityLine(rows: ReadonlyArray<MergeActivityRow> | undefined, nowMs: number): string | null {
  const found = summary(readRows(rows));
  if (found === undefined) return null;
  const hours = median(found);
  const parts = [
    found.last !== null ? `last merge ${ago(found.last, nowMs)}` : "no merge found",
    found.waiting === 0
      ? "no outside pull request waiting 7+ days"
      : `${found.waiting}${found.capped ? "+" : ""} outside pull ${found.waiting === 1 && !found.capped ? "request" : "requests"} waiting 7+ days for a maintainer`,
    hours === undefined ? "no outside pull request merged in 30 days" : `outside pull requests merged in a median ${duration(hours)} (30 days)`,
    `checked ${shortDate(found.observed)}`,
  ];
  return `Merging: ${parts.join(" · ")}`;
}

/** @throws {RangeError} */
export function mergeActivityCardLine(rows: ReadonlyArray<MergeActivityRow> | undefined, nowMs: number): string | null {
  const found = summary(readRows(rows));
  if (found === undefined) return null;
  const hours = median(found);
  const parts = [
    found.last !== null ? `Last merge ${ago(found.last, nowMs)}` : "No merge found",
    `${found.waiting}${found.capped ? "+" : ""} outside ${found.waiting === 1 && !found.capped ? "PR" : "PRs"} waiting 7+ days`,
    ...hours === undefined ? [] : [`median merge ${duration(hours)}`],
    ...found.stale ? [`checked ${shortDate(found.observed)}`] : [],
  ];
  return parts.join(" · ");
}

const Cohort = Schema.Struct({ name: Schema.String, size: Schema.Number, classifiable: Schema.Number, aiPrimary: Schema.Number, aiExternalPr: Schema.Number });
const Focus = Schema.Struct({ area: Schema.String, repos: Schema.Number, prs: Schema.Number, contributors: Schema.Number, primaryContributors: Schema.Number });
const Repository = Schema.Struct({ repo: Schema.String, prs: Schema.Number, contributors: Schema.Number, stars: Schema.Number });
const WhoBuilds = Schema.Struct({
  generatedAt: Schema.String,
  leaderboardGeneratedAt: Schema.String,
  window: Schema.Struct({ days: Schema.Number, from: Schema.String, to: Schema.String }),
  ruleVersion: Schema.String,
  contributors: Schema.Number,
  noFootprint: Schema.Number,
  unclassifiable: Schema.Number,
  externalRepos: Schema.Number,
  externalReposExMass: Schema.Number,
  externalPrsExMass: Schema.Number,
  contributorsWithExternal: Schema.Number,
  aiRepoMedianStars: Schema.Number,
  aiRepoShareUnder10: Schema.Number,
  cohorts: Schema.Array(Cohort),
  focus: Schema.Array(Focus),
  topAi: Schema.Array(Schema.Struct({ ...Repository.fields, desc: Schema.String })),
  recognizable: Schema.Array(Repository),
  topOther: Schema.Array(Schema.Struct({ repo: Schema.String, prs: Schema.Number, area: Schema.String, stars: Schema.Number, desc: Schema.String })),
  massAccounts: Schema.Array(Schema.Struct({ login: Schema.String, prs: Schema.Number, repos: Schema.Number })),
});

type WhoBuildsRecord = typeof WhoBuilds.Type;
type WhoBuildsCohort = typeof Cohort.Type;

export type WhoBuildsSnapshot = Omit<WhoBuildsRecord, "cohorts"> & { readonly cohorts: readonly [WhoBuildsCohort, ...WhoBuildsCohort[]] };

const isWhoBuilds = Schema.is(WhoBuilds);

/** @throws {never} */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function whoBuildsSnapshotOf(text: string): WhoBuildsSnapshot | undefined {
  const value = parsed(text);
  if (!isWhoBuilds(value)) return undefined;
  const [first, ...rest] = value.cohorts;
  return first === undefined ? undefined : { ...value, cohorts: [first, ...rest] };
}

export interface RepositoryLabel {
  readonly displayName: string;
  readonly description: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
}

export interface RepositoryFootprint extends RepositoryLabel {
  readonly repositoryId: string;
  readonly events: number;
  readonly share: number;
}

export interface WhoBuildsSummary {
  readonly windowDays: number;
  readonly contributors: number;
  readonly scoredEvents: number;
  readonly repositories: ReadonlyArray<RepositoryFootprint>;
}

/** @throws {never} */
export function summarizeWhoBuilds(snapshot: Pick<LeaderboardSnapshot, "ledger" | "leaders" | "window">, describe: (repositoryId: string) => RepositoryLabel | undefined): WhoBuildsSummary {
  const counts = new Map<string, number>();
  for (const event of snapshot.ledger) counts.set(event.repository, (counts.get(event.repository) ?? 0) + 1);
  const scoredEvents = snapshot.ledger.length;
  const repositories = [...counts.entries()]
    .map(([repositoryId, events]) => ({
      repositoryId,
      ...describe(repositoryId) ?? { displayName: repositoryId, description: null, projectId: null, projectName: null },
      events,
      share: scoredEvents > 0 ? events / scoredEvents : 0,
    }))
    .sort((left, right) => right.events - left.events || left.repositoryId.localeCompare(right.repositoryId));
  return { windowDays: snapshot.window.days, contributors: snapshot.leaders.length, scoredEvents, repositories };
}

const providerAliases: Readonly<Record<string, string>> = {
  "openai-codex": "openai",
  "z.ai": "zai",
  "z-ai": "zai",
  "moonshot-ai": "moonshotai",
  spacexai: "xai",
  "x-ai": "xai",
};

interface ModelIdentityKey {
  readonly provider: string;
  readonly model: string;
  readonly key: string;
}

/** @throws {never} */
export function modelIdentityKey(provider: string, model: string): ModelIdentityKey {
  const rawProvider = provider.trim().toLowerCase();
  const normalizedProvider = providerAliases[rawProvider] ?? rawProvider;
  const prefixes = [normalizedProvider, ...Object.keys(providerAliases).filter((alias) => providerAliases[alias] === normalizedProvider)];
  const lowered = model.trim().toLowerCase();
  const prefix = prefixes.find((candidate) => lowered.startsWith(`${candidate}/`));
  const unprefixed = prefix === undefined ? lowered : lowered.slice(prefix.length + 1);
  const normalizedModel = unprefixed.replaceAll(/(^|[a-z]-)(\d)-(\d)(?!\d)/gu, "$1$2.$3");
  return { provider: normalizedProvider, model: normalizedModel, key: `${normalizedProvider}/${normalizedModel}` };
}

export interface ModelOutcomeRow {
  readonly key: string;
  readonly provider: string;
  readonly model: string;
  readonly declarations: number;
  readonly signedDeclarations: number;
  readonly contributors: number;
  readonly mergedPullRequests: number;
  readonly signedPullRequests: number;
  readonly pullRequestPoints: number;
  readonly acceptedReviews: number;
  readonly reviewPoints: number;
  readonly topContributorShare: number | null;
  readonly topContributorOutcomes: number;
  readonly declaredAs: ReadonlyArray<{ readonly identifier: string; readonly count: number }>;
}

export interface ClientOutcomeRow {
  readonly client: string;
  readonly signedRuns: number;
  readonly contributors: number;
  readonly mergedPullRequests: number;
  readonly pullRequestPoints: number;
  readonly models: ReadonlyArray<{ readonly key: string; readonly count: number }>;
  readonly medianOutputTokens: number | null;
  readonly runsWithExactUsage: number;
}

export interface ModelOutcomeTotals {
  declarations: number;
  declarationsWithoutExactModel: number;
  signedDeclarations: number;
  declaringContributors: number;
  signedContributors: number;
  distinctModels: number;
  distinctDeclaredIdentifiers: number;
  distinctClients: number;
  mergedPullRequests: number;
  mergedPullRequestsWithModel: number;
  mergedPullRequestsWithSignedRun: number;
  pullRequestPoints: number;
  pullRequestPointsWithModel: number;
  acceptedReviews: number;
  acceptedReviewsWithModel: number;
}

export interface ModelOutcomeSummary {
  readonly totals: ModelOutcomeTotals;
  readonly models: ReadonlyArray<ModelOutcomeRow>;
  readonly clients: ReadonlyArray<ClientOutcomeRow>;
}

interface ModelBucket {
  declarations: number;
  signedDeclarations: number;
  readonly contributors: Set<string>;
  readonly mergedPullRequests: Set<string>;
  readonly signedPullRequests: Set<string>;
  pullRequestPoints: number;
  acceptedReviews: number;
  reviewPoints: number;
  readonly outcomesByActor: Map<string, number>;
  readonly declaredAs: Map<string, number>;
}

interface ClientBucket {
  signedRuns: number;
  readonly contributors: Set<string>;
  readonly mergedPullRequests: Set<string>;
  pullRequestPoints: number;
  readonly models: Map<string, number>;
  readonly outputTokens: number[];
}

/** @throws {never} */
function newModelBucket(): ModelBucket {
  return { declarations: 0, signedDeclarations: 0, contributors: new Set(), mergedPullRequests: new Set(), signedPullRequests: new Set(), pullRequestPoints: 0, acceptedReviews: 0, reviewPoints: 0, outcomesByActor: new Map(), declaredAs: new Map() };
}

/** @throws {never} */
function newClientBucket(): ClientBucket {
  return { signedRuns: 0, contributors: new Set(), mergedPullRequests: new Set(), pullRequestPoints: 0, models: new Map(), outputTokens: [] };
}

/** @throws {never} */
function middle(values: ReadonlyArray<number>): number | null {
  const sorted = [...values].sort((left, right) => left - right);
  const half = Math.floor(sorted.length / 2);
  const upper = sorted[half];
  const lower = sorted[half - 1];
  if (upper === undefined) return null;
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}

/** @throws {never} */
function increment(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** @throws {never} */
function sortedEntries(map: ReadonlyMap<string, number>): ReadonlyArray<readonly [string, number]> {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

/** @throws {never} */
function bucketOf<T>(map: Map<string, T>, key: string, create: () => T): T {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

/** @throws {never} */
function clientOf(attribution: ModelAttribution): string | null {
  const client = attribution.run?.client;
  return client ? client.trim().toLowerCase() : null;
}

/** @throws {never} */
function eventPoints(event: Pick<ScoreEvent, "points" | "scoreThirds">): number {
  return pointsOf(event.scoreThirds ?? event.points * 3);
}

/** @throws {never} */
export function summarizeModelOutcomes(snapshot: Pick<LeaderboardSnapshot, "attributions" | "ledger">): ModelOutcomeSummary {
  const actorNumbers = new Map<string, number>();
  const actorNumber = (id: string | null | undefined) => {
    if (!id) return 0;
    const known = actorNumbers.get(id) ?? actorNumbers.size + 1;
    actorNumbers.set(id, known);
    return known;
  };
  const identities = new Map<ModelAttribution, ModelIdentityKey>();
  const bySource = new Map<string, ModelAttribution[]>();
  const byArtifact = new Map<string, ModelAttribution[]>();
  const models = new Map<string, ModelBucket>();
  const clients = new Map<string, ClientBucket>();
  const countedRuns = new Set<string>();
  const declaringContributors = new Set<string>();
  const signedContributors = new Set<string>();
  const declaredIdentifiers = new Set<string>();
  let declarationsWithoutExactModel = 0;

  for (const attribution of snapshot.attributions) {
    if (unavailableModel(attribution.model)) {
      declarationsWithoutExactModel += 1;
      continue;
    }
    const identity = modelIdentityKey(attribution.provider, attribution.model);
    const declared = `${attribution.provider}/${attribution.model}`;
    identities.set(attribution, identity);
    bucketOf(bySource, attribution.sourceId, () => []).push(attribution);
    bucketOf(byArtifact, attribution.artifactId, () => []).push(attribution);
    declaredIdentifiers.add(declared);
    const bucket = bucketOf(models, identity.key, newModelBucket);
    bucket.declarations += 1;
    increment(bucket.declaredAs, declared);
    const actorId = attribution.actor?.id ?? null;
    if (actorId) {
      bucket.contributors.add(actorId);
      declaringContributors.add(actorId);
    }
    const run = attribution.run;
    if (run === null) continue;
    bucket.signedDeclarations += 1;
    if (actorId) signedContributors.add(actorId);
    const client = clientOf(attribution);
    const runKey = `${run.devicePublicKey}:${run.runId}`;
    if (client === null || countedRuns.has(runKey)) continue;
    countedRuns.add(runKey);
    const clientBucket = bucketOf(clients, client, newClientBucket);
    clientBucket.signedRuns += 1;
    if (actorId) clientBucket.contributors.add(actorId);
    increment(clientBucket.models, identity.key);
    if (run.usage.confidence === "exact") clientBucket.outputTokens.push(run.usage.outputTokens);
  }

  const totals: ModelOutcomeTotals = {
    declarations: snapshot.attributions.length - declarationsWithoutExactModel,
    declarationsWithoutExactModel,
    signedDeclarations: snapshot.attributions.filter((entry) => entry.run !== null).length,
    declaringContributors: declaringContributors.size,
    signedContributors: signedContributors.size,
    distinctModels: 0,
    distinctDeclaredIdentifiers: declaredIdentifiers.size,
    distinctClients: 0,
    mergedPullRequests: 0,
    mergedPullRequestsWithModel: 0,
    mergedPullRequestsWithSignedRun: 0,
    pullRequestPoints: 0,
    pullRequestPointsWithModel: 0,
    acceptedReviews: 0,
    acceptedReviewsWithModel: 0,
  };
  const mergedWithModel = new Set<string>();
  const mergedWithSignedRun = new Set<string>();
  const mergedSources = new Set<string>();

  const countOutcome = (event: ScoreEvent, pullRequest: boolean): void => {
    const candidates = (pullRequest ? byArtifact.get(event.source.id) : bySource.get(event.source.id)) ?? [];
    const outcomeActor = actorNumber(event.actor.id);
    const own = candidates.filter((attribution) => declarationCounts({ declarer: actorNumber(attribution.actor?.id), outcomeActor, exactModel: true }));
    const keys = [...new Set(own.flatMap((attribution) => {
      const key = identities.get(attribution)?.key;
      return key === undefined ? [] : [key];
    }))];
    if (keys.length === 0) return;
    const points = eventPoints(event);
    const share = points / keys.length;
    if (pullRequest) {
      mergedWithModel.add(event.source.id);
      totals.mergedPullRequestsWithModel = mergedWithModel.size;
      totals.pullRequestPointsWithModel += points;
      if (own.some((attribution) => attribution.run !== null)) {
        mergedWithSignedRun.add(event.source.id);
        totals.mergedPullRequestsWithSignedRun = mergedWithSignedRun.size;
      }
    } else {
      totals.acceptedReviewsWithModel += 1;
    }
    for (const key of keys) {
      const bucket = models.get(key);
      if (bucket === undefined) continue;
      if (pullRequest) {
        bucket.mergedPullRequests.add(event.source.id);
        bucket.pullRequestPoints += share;
        if (own.some((attribution) => attribution.run !== null && identities.get(attribution)?.key === key)) bucket.signedPullRequests.add(event.source.id);
      } else {
        bucket.acceptedReviews += 1;
        bucket.reviewPoints += share;
      }
      increment(bucket.outcomesByActor, event.actor.id);
    }
    if (!pullRequest) return;
    const clientKeys = [...new Set(own.flatMap((attribution) => {
      const client = clientOf(attribution);
      return client === null ? [] : [client];
    }))];
    for (const client of clientKeys) {
      const bucket = clients.get(client);
      if (bucket === undefined) continue;
      bucket.mergedPullRequests.add(event.source.id);
      bucket.pullRequestPoints += points / clientKeys.length;
    }
  };

  for (const event of snapshot.ledger) {
    if (event.category === "merged-pull-request") {
      mergedSources.add(event.source.id);
      totals.mergedPullRequests = mergedSources.size;
      totals.pullRequestPoints += eventPoints(event);
      countOutcome(event, true);
    } else if (event.category === "substantive-review") {
      totals.acceptedReviews += 1;
      countOutcome(event, false);
    }
  }

  const modelRows: ModelOutcomeRow[] = [...models.entries()]
    .map(([key, bucket]) => {
      const outcomes = [...bucket.outcomesByActor.values()].reduce((sum, value) => sum + value, 0);
      const top = Math.max(0, ...bucket.outcomesByActor.values());
      const separator = key.indexOf("/");
      return {
        key,
        provider: key.slice(0, separator),
        model: key.slice(separator + 1),
        declarations: bucket.declarations,
        signedDeclarations: bucket.signedDeclarations,
        contributors: bucket.contributors.size,
        mergedPullRequests: bucket.mergedPullRequests.size,
        signedPullRequests: bucket.signedPullRequests.size,
        pullRequestPoints: bucket.pullRequestPoints,
        acceptedReviews: bucket.acceptedReviews,
        reviewPoints: bucket.reviewPoints,
        topContributorShare: outcomes > 0 ? top / outcomes : null,
        topContributorOutcomes: top,
        declaredAs: sortedEntries(bucket.declaredAs).map(([identifier, count]) => ({ identifier, count })),
      };
    })
    .sort((left, right) => right.mergedPullRequests - left.mergedPullRequests || right.acceptedReviews - left.acceptedReviews || right.declarations - left.declarations || left.key.localeCompare(right.key));

  const clientRows: ClientOutcomeRow[] = [...clients.entries()]
    .map(([client, bucket]) => ({
      client,
      signedRuns: bucket.signedRuns,
      contributors: bucket.contributors.size,
      mergedPullRequests: bucket.mergedPullRequests.size,
      pullRequestPoints: bucket.pullRequestPoints,
      models: sortedEntries(bucket.models).map(([key, count]) => ({ key, count })),
      medianOutputTokens: middle(bucket.outputTokens),
      runsWithExactUsage: bucket.outputTokens.length,
    }))
    .sort((left, right) => right.signedRuns - left.signedRuns || left.client.localeCompare(right.client));

  totals.distinctModels = modelRows.length;
  totals.distinctClients = clientRows.length;
  return { totals, models: modelRows, clients: clientRows };
}
