/**
 * Aggregates self-reported model identity against accepted outcomes.
 *
 * Every figure here is a view over data the snapshot already publishes: the
 * ledger of merged pull requests and accepted reviews, and the model
 * attributions the pipeline found on those sources. Nothing is fetched and
 * nothing changes score. Identity stays self-reported provenance exactly as the
 * methodology states; this module only counts it next to the outcomes it was
 * declared on, by the same actor.
 */

import type {
  LeaderboardSnapshot,
  ModelAttribution,
  ScoreEvent,
} from "./leaderboard-types";

/** Provider spellings that name the same organization. */
const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  "openai-codex": "openai",
  "z.ai": "zai",
  "z-ai": "zai",
  "moonshot-ai": "moonshotai",
};

const PROVIDER_PREFIXES = [
  "openai/",
  "anthropic/",
  "xai/",
  "google/",
  "zai/",
  "z-ai/",
  "z.ai/",
];

export interface ModelIdentityKey {
  provider: string;
  model: string;
  key: string;
}

/**
 * Folds case and known provider aliases so that `OpenAI/GPT-5.6` and
 * `openai/gpt-5.6` count as one model. A provider repeated inside the model
 * field is stripped. Anything else stays exactly as declared.
 */
export function modelIdentityKey(
  provider: string,
  model: string,
): ModelIdentityKey {
  const rawProvider = provider.trim().toLowerCase();
  const normalizedProvider = PROVIDER_ALIASES[rawProvider] ?? rawProvider;
  let normalizedModel = model.trim().toLowerCase();
  for (const prefix of [`${normalizedProvider}/`, ...PROVIDER_PREFIXES]) {
    if (normalizedModel.startsWith(prefix)) {
      normalizedModel = normalizedModel.slice(prefix.length);
    }
  }
  return {
    provider: normalizedProvider,
    model: normalizedModel,
    key: `${normalizedProvider}/${normalizedModel}`,
  };
}

export interface ModelOutcomeRow {
  key: string;
  provider: string;
  model: string;
  declarations: number;
  signedDeclarations: number;
  contributors: number;
  mergedPullRequests: number;
  signedPullRequests: number;
  pullRequestPoints: number;
  acceptedReviews: number;
  reviewPoints: number;
  /** Share of this model's accepted outcomes from its busiest contributor. */
  topContributorShare: number | null;
  declaredAs: Array<{ identifier: string; count: number }>;
}

export interface ClientOutcomeRow {
  client: string;
  signedRuns: number;
  contributors: number;
  mergedPullRequests: number;
  pullRequestPoints: number;
  models: Array<{ key: string; count: number }>;
  medianOutputTokens: number | null;
  runsWithExactUsage: number;
}

export interface ModelOutcomeTotals {
  declarations: number;
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
  totals: ModelOutcomeTotals;
  models: ModelOutcomeRow[];
  clients: ClientOutcomeRow[];
}

interface ModelBucket {
  declarations: number;
  signedDeclarations: number;
  contributors: Set<string>;
  mergedPullRequests: Set<string>;
  signedPullRequests: Set<string>;
  pullRequestPoints: number;
  acceptedReviews: number;
  reviewPoints: number;
  outcomesByActor: Map<string, number>;
  declaredAs: Map<string, number>;
}

interface ClientBucket {
  signedRuns: number;
  contributors: Set<string>;
  mergedPullRequests: Set<string>;
  pullRequestPoints: number;
  models: Map<string, number>;
  outputTokens: number[];
}

function newModelBucket(): ModelBucket {
  return {
    declarations: 0,
    signedDeclarations: 0,
    contributors: new Set(),
    mergedPullRequests: new Set(),
    signedPullRequests: new Set(),
    pullRequestPoints: 0,
    acceptedReviews: 0,
    reviewPoints: 0,
    outcomesByActor: new Map(),
    declaredAs: new Map(),
  };
}

function newClientBucket(): ClientBucket {
  return {
    signedRuns: 0,
    contributors: new Set(),
    mergedPullRequests: new Set(),
    pullRequestPoints: 0,
    models: new Map(),
    outputTokens: [],
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function increment(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedEntries(map: Map<string, number>) {
  return [...map.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function getOrCreate<T>(map: Map<string, T>, key: string, create: () => T): T {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

function attributionClient(attribution: ModelAttribution): string | null {
  const client = attribution.run?.client;
  return client ? client.trim().toLowerCase() : null;
}

/**
 * Joins each accepted outcome in the ledger to the model declarations made on
 * that same source by the same actor, then counts per model and per client.
 *
 * Merged pull requests join on the PR node ID (the attribution artifact);
 * accepted reviews join on the review node ID (the attribution source). A
 * declaration by anyone other than the outcome's actor never counts, which is
 * the same rule the methodology applies to provenance. When one outcome names
 * several models it counts once for each and its points split evenly.
 */
export function summarizeModelOutcomes(
  snapshot: Pick<LeaderboardSnapshot, "attributions" | "ledger">,
): ModelOutcomeSummary {
  const identities = new Map<ModelAttribution, ModelIdentityKey>();
  const bySource = new Map<string, ModelAttribution[]>();
  const byArtifact = new Map<string, ModelAttribution[]>();
  const models = new Map<string, ModelBucket>();
  const clients = new Map<string, ClientBucket>();
  const declaringContributors = new Set<string>();
  const signedContributors = new Set<string>();
  const declaredIdentifiers = new Set<string>();

  for (const attribution of snapshot.attributions) {
    const identity = modelIdentityKey(attribution.provider, attribution.model);
    identities.set(attribution, identity);
    getOrCreate(bySource, attribution.sourceId, () => []).push(attribution);
    getOrCreate(byArtifact, attribution.artifactId, () => []).push(attribution);
    declaredIdentifiers.add(`${attribution.provider}/${attribution.model}`);

    const bucket = getOrCreate(models, identity.key, newModelBucket);
    bucket.declarations += 1;
    increment(
      bucket.declaredAs,
      `${attribution.provider}/${attribution.model}`,
    );
    const actorId = attribution.actor?.id ?? null;
    if (actorId) {
      bucket.contributors.add(actorId);
      declaringContributors.add(actorId);
    }
    if (attribution.run) {
      bucket.signedDeclarations += 1;
      if (actorId) signedContributors.add(actorId);
      const client = attributionClient(attribution);
      if (client) {
        const clientBucket = getOrCreate(clients, client, newClientBucket);
        clientBucket.signedRuns += 1;
        if (actorId) clientBucket.contributors.add(actorId);
        increment(clientBucket.models, identity.key);
        const usage = attribution.run.usage;
        if (usage.confidence === "exact" && usage.outputTokens > 0) {
          clientBucket.outputTokens.push(usage.outputTokens);
        }
      }
    }
  }

  const totals: ModelOutcomeTotals = {
    declarations: snapshot.attributions.length,
    signedDeclarations: snapshot.attributions.filter((entry) => entry.run)
      .length,
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

  const countOutcome = (event: ScoreEvent, isPullRequest: boolean): void => {
    const candidates =
      (isPullRequest
        ? byArtifact.get(event.source.id)
        : bySource.get(event.source.id)) ?? [];
    const own = candidates.filter(
      (attribution) => attribution.actor?.id === event.actor.id,
    );
    if (own.length === 0) return;
    const keys = [
      ...new Set(own.map((attribution) => identities.get(attribution)?.key)),
    ].filter((key): key is string => typeof key === "string");
    if (keys.length === 0) return;
    const share = event.points / keys.length;

    if (isPullRequest) {
      totals.mergedPullRequestsWithModel += 1;
      totals.pullRequestPointsWithModel += event.points;
      if (own.some((attribution) => attribution.run)) {
        totals.mergedPullRequestsWithSignedRun += 1;
      }
    } else {
      totals.acceptedReviewsWithModel += 1;
    }

    for (const key of keys) {
      const bucket = models.get(key);
      if (!bucket) continue;
      if (isPullRequest) {
        bucket.mergedPullRequests.add(event.source.id);
        bucket.pullRequestPoints += share;
        if (
          own.some(
            (attribution) =>
              attribution.run && identities.get(attribution)?.key === key,
          )
        ) {
          bucket.signedPullRequests.add(event.source.id);
        }
      } else {
        bucket.acceptedReviews += 1;
        bucket.reviewPoints += share;
      }
      increment(bucket.outcomesByActor, event.actor.id);
    }

    if (isPullRequest) {
      const clientKeys = [
        ...new Set(
          own
            .map(attributionClient)
            .filter((client): client is string => client !== null),
        ),
      ];
      for (const client of clientKeys) {
        const bucket = clients.get(client);
        if (!bucket) continue;
        bucket.mergedPullRequests.add(event.source.id);
        bucket.pullRequestPoints += event.points / clientKeys.length;
      }
    }
  };

  for (const event of snapshot.ledger) {
    if (event.category === "merged-pull-request") {
      totals.mergedPullRequests += 1;
      totals.pullRequestPoints += event.points;
      countOutcome(event, true);
    } else if (event.category === "substantive-review") {
      totals.acceptedReviews += 1;
      countOutcome(event, false);
    }
  }

  const modelRows: ModelOutcomeRow[] = [...models.entries()]
    .map(([key, bucket]) => {
      const outcomes = [...bucket.outcomesByActor.values()].reduce(
        (sum, count) => sum + count,
        0,
      );
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
        declaredAs: sortedEntries(bucket.declaredAs).map(
          ([identifier, count]) => ({ identifier, count }),
        ),
      };
    })
    .sort(
      (left, right) =>
        right.mergedPullRequests - left.mergedPullRequests ||
        right.acceptedReviews - left.acceptedReviews ||
        right.declarations - left.declarations ||
        left.key.localeCompare(right.key),
    );

  const clientRows: ClientOutcomeRow[] = [...clients.entries()]
    .map(([client, bucket]) => ({
      client,
      signedRuns: bucket.signedRuns,
      contributors: bucket.contributors.size,
      mergedPullRequests: bucket.mergedPullRequests.size,
      pullRequestPoints: bucket.pullRequestPoints,
      models: sortedEntries(bucket.models).map(([key, count]) => ({
        key,
        count,
      })),
      medianOutputTokens: median(bucket.outputTokens),
      runsWithExactUsage: bucket.outputTokens.length,
    }))
    .sort(
      (left, right) =>
        right.signedRuns - left.signedRuns ||
        left.client.localeCompare(right.client),
    );

  totals.distinctModels = modelRows.length;
  totals.distinctClients = clientRows.length;

  return { totals, models: modelRows, clients: clientRows };
}
