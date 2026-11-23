import { canonicalJson } from "../src/lib/canonical-json";
import {
  createHistoricalLeaderboardSnapshot,
  type HistoricalLeaderboardScope,
  type LeaderboardInput,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { applyPointsSnapshot, type PointsJournal } from "../src/lib/points";
import { findRegisteredRepository } from "../src/lib/repositories.mjs";
import { sha256Hex } from "../src/lib/sha256";

export type HistoricalClosedContextBindings = ReadonlyMap<
  string,
  {
    digest: string;
    number: number;
    headSha: string;
    occurredAt: string;
    standaloneReview?: true;
    retainedMergeHold?: true;
  }
>;

export type HistoricalEmptyLegacyClosureBindings = ReadonlyMap<
  string,
  { digest: string; number: number; headSha: string; occurredAt: string }
>;

export class HistoricalClosedOutcomeError extends Error {
  constructor(
    readonly reason: "lifecycle" | "assessment" | "scored-work" | "projection",
  ) {
    super(
      `Historical closed-unmerged ${reason} requires a reviewed expanded lifecycle source contract`,
    );
    this.name = "HistoricalClosedOutcomeError";
  }
}

function same(left: unknown, right: unknown) {
  const wire = (value: unknown) =>
    canonicalJson(JSON.parse(JSON.stringify(value)));
  return wire(left) === wire(right);
}

function pointChanges(snapshot: LeaderboardSnapshot, baseline: PointsJournal) {
  const journal = applyPointsSnapshot(
    baseline,
    snapshot,
    sha256Hex(JSON.stringify(snapshot)),
    snapshot.generatedAt,
    { preserveHeldImplementation: true },
  );
  // Snapshot digests and derived revision IDs differ even when the economic
  // and provenance transitions are identical. The input predecessor IDs stay pinned.
  return journal.revisions
    .slice(baseline.revisions.length)
    .map(({ id: _id, sourceDigest: _sourceDigest, ...revision }) => revision);
}

function paymentLedger(snapshot: LeaderboardSnapshot) {
  const basis = snapshot.paymentReviewBasis;
  const ledger = new Map(snapshot.ledger.map((event) => [event.id, event]));
  for (const id of basis?.removedEventIds ?? []) ledger.delete(id);
  for (const event of basis?.ledger ?? []) ledger.set(event.id, event);
  return [...ledger.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Keep only audited merges and approved closed review sources. Prove that
 * omitting context-only outcomes preserves awards and linked provenance. */
export function createMergedHistoricalReplaySnapshot(
  input: LeaderboardInput,
  scope: HistoricalLeaderboardScope,
  baseline: PointsJournal,
  approvedContexts: HistoricalClosedContextBindings = new Map(),
  emptyLegacyClosures: HistoricalEmptyLegacyClosureBindings = new Map(),
): LeaderboardSnapshot {
  const closed = input.closedUnmergedPullRequests ?? [];
  const closedById = new Map(closed.map((pull) => [pull.id, pull]));
  for (const [id, binding] of approvedContexts) {
    const pull = closedById.get(id);
    const decision = input.jointValueDecisions?.get(id);
    if (
      !pull ||
      pull.number !== binding.number ||
      pull.headRefOid !== binding.headSha ||
      Date.parse(pull.closedAt ?? "") !== Date.parse(binding.occurredAt) ||
      !decision ||
      decision.latestDigest !== binding.digest
    )
      throw new HistoricalClosedOutcomeError("lifecycle");
    if (binding.standaloneReview && decision.status !== "assessed")
      throw new HistoricalClosedOutcomeError("assessment");
  }
  for (const [id, binding] of emptyLegacyClosures) {
    const pull = closedById.get(id);
    if (
      !pull ||
      pull.number !== binding.number ||
      pull.headRefOid !== binding.headSha ||
      Date.parse(pull.closedAt ?? "") !== Date.parse(binding.occurredAt)
    )
      throw new HistoricalClosedOutcomeError("lifecycle");
    const decision = input.valueDecisions?.get(id);
    if (
      approvedContexts.has(id) ||
      input.jointValueDecisions?.has(id) ||
      pull.reviews.length !== 0 ||
      decision?.latestDigest !== binding.digest ||
      (decision.status !== "assessed" && decision.status !== "unresolved") ||
      decision.assessment.tier !== null ||
      decision.assessment.reviews.length !== 0
    )
      throw new HistoricalClosedOutcomeError("assessment");
  }
  if (!closed.length) return createHistoricalLeaderboardSnapshot(input, scope);
  const closedIds = new Set(closedById.keys());
  const closedByNumber = new Map(closed.map((pull) => [pull.number, pull]));
  const closedNumbers = new Set(closedByNumber.keys());
  if (
    closedIds.size !== closed.length ||
    closedNumbers.size !== closed.length ||
    closed.some((pull) => {
      const instant = Date.parse(pull.closedAt ?? "");
      return (
        pull.mergedAt !== null ||
        !Number.isFinite(instant) ||
        instant < Date.parse(input.windowFrom) ||
        instant >= Date.parse(input.windowTo)
      );
    }) ||
    input.mergedPullRequestOutcomes.some(
      (pull) => closedIds.has(pull.id) || closedNumbers.has(pull.number),
    )
  )
    throw new HistoricalClosedOutcomeError("lifecycle");

  const complete = createHistoricalLeaderboardSnapshot(input, scope);
  const coverage = complete.valueAssessmentCoverage ?? [];
  const closedCoverage = coverage.filter((row) =>
    closedIds.has(row.pullRequestId),
  );
  if (
    closedCoverage.length !== closed.length ||
    closedCoverage.some((row) => {
      if (closedById.get(row.pullRequestId)?.number !== row.pullRequestNumber)
        return true;
      const empty = emptyLegacyClosures.get(row.pullRequestId);
      if (empty)
        return (
          (row.status !== "assessed" && row.status !== "unresolved") ||
          row.recordDigest !== empty.digest ||
          row.reviewAssessmentDigest !== undefined
        );
      const approved = approvedContexts.get(row.pullRequestId);
      return approved
        ? row.status === "missing" ||
            row.status === "legacy-policy" ||
            (row.recordDigest !== approved.digest &&
              !(row.status === "incomplete" && row.recordDigest === null))
        : row.status !== "missing" || row.recordDigest !== null;
    }) ||
    closed.some(
      (pull) =>
        input.jointValueDecisions?.has(pull.id) &&
        !approvedContexts.has(pull.id),
    ) ||
    (complete.source.unavailableSources ?? []).some((source) =>
      closedIds.has(source.nodeId),
    ) ||
    (complete.source.heldWorkUnits ?? []).some((unit) =>
      unit.sourceNodeIds.some(
        (id) =>
          closedIds.has(id) &&
          (!approvedContexts.get(id)?.retainedMergeHold ||
            approvedContexts.get(id)?.digest !== unit.recordDigest),
      ),
    ) ||
    (complete.reviewedImplementationUnits ?? []).some((unit) => {
      const binding = approvedContexts.get(unit.pullRequestId);
      return (
        closedIds.has(unit.pullRequestId) &&
        (!binding || (binding.standaloneReview && unit.units.length > 0))
      );
    })
  )
    throw new HistoricalClosedOutcomeError("assessment");

  function closedSource(url: string) {
    const source = new URL(url);
    const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)$/u.exec(
      source.pathname,
    );
    return source.origin === "https://github.com" &&
      match !== null &&
      findRegisteredRepository(match[1], match[2])?.id === scope.repository
      ? closedByNumber.get(Number(match[3]))
      : undefined;
  }
  const completePayment = paymentLedger(complete);
  const reviewSources = new Set<string>();
  const emptyLegacyDecisions = new Set(
    [...emptyLegacyClosures.values()].map(({ digest }) => `value:${digest}`),
  );
  for (const event of [...complete.ledger, ...completePayment]) {
    if (
      emptyLegacyClosures.has(event.source.id) ||
      emptyLegacyDecisions.has(event.scoreDecisionSourceId ?? "")
    )
      throw new HistoricalClosedOutcomeError("scored-work");
    const pull = closedSource(event.source.url);
    if (!pull) continue;
    const binding = approvedContexts.get(pull.id);
    if (
      !binding ||
      event.category !== "substantive-review" ||
      event.source.kind !== "review" ||
      event.source.number !== binding.number ||
      event.actor.kind !== "User" ||
      event.scoreDecisionSourceId !== `value:${binding.digest}` ||
      Date.parse(event.occurredAt) >= Date.parse(binding.occurredAt) ||
      !pull.reviews.some(
        (review) =>
          review.id === event.source.id &&
          review.url === event.source.url &&
          review.submittedAt === event.occurredAt &&
          review.author?.id === event.actor.id,
      )
    )
      throw new HistoricalClosedOutcomeError("scored-work");
    reviewSources.add(pull.id);
  }
  if (complete.penalties?.some((row) => closedIds.has(row.source.id)))
    throw new HistoricalClosedOutcomeError("scored-work");

  const projected = createHistoricalLeaderboardSnapshot(
    {
      ...input,
      closedUnmergedPullRequests: closed.filter((pull) =>
        reviewSources.has(pull.id),
      ),
      valueContextPullRequests: [
        ...(input.valueContextPullRequests ?? []),
        ...closed.filter(
          (pull) =>
            approvedContexts.has(pull.id) &&
            !reviewSources.has(pull.id) &&
            input.jointValueDecisions?.get(pull.id)?.status === "assessed",
        ),
      ],
    },
    scope,
  );
  function retainedProvenance(snapshot: LeaderboardSnapshot) {
    return {
      coverage: (snapshot.valueAssessmentCoverage ?? []).filter(
        (row) =>
          !closedIds.has(row.pullRequestId) ||
          reviewSources.has(row.pullRequestId),
      ),
      // A verified origin can have work-unit membership, but the wire
      // format only emits membership rows for covered (merged) sources.
      // Every retained merged member must keep its exact connected group.
      units: (snapshot.reviewedImplementationUnits ?? []).filter(
        (row) =>
          !approvedContexts.has(row.pullRequestId) ||
          reviewSources.has(row.pullRequestId),
      ),
      reviews: (snapshot.reviewExclusions ?? []).filter(
        (row) =>
          !closedIds.has(row.pullRequestId) ||
          reviewSources.has(row.pullRequestId),
      ),
      attributions: snapshot.attributions.filter((row) => {
        const closed = closedSource(row.sourceUrl);
        return closed
          ? reviewSources.has(closed.id)
          : !closedIds.has(row.artifactId);
      }),
      penalties: snapshot.penalties ?? [],
    };
  }
  if (
    !same(complete.ledger, projected.ledger) ||
    !same(completePayment, paymentLedger(projected)) ||
    !same(retainedProvenance(complete), retainedProvenance(projected)) ||
    !same(pointChanges(complete, baseline), pointChanges(projected, baseline))
  )
    throw new HistoricalClosedOutcomeError("projection");
  return projected;
}
