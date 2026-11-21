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

/** Keep a merged-only packet only when the complete canonical collection proves
 * omitting ordinary closed outcomes has no award or linked-provenance effect. */
export function createMergedHistoricalReplaySnapshot(
  input: LeaderboardInput,
  scope: HistoricalLeaderboardScope,
  baseline: PointsJournal,
): LeaderboardSnapshot {
  const closed = input.closedUnmergedPullRequests ?? [];
  if (!closed.length) return createHistoricalLeaderboardSnapshot(input, scope);
  const closedIds = new Set(closed.map(({ id }) => id));
  const closedNumbers = new Set(closed.map(({ number }) => number));
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
    closedCoverage.some(
      (row) =>
        !closedNumbers.has(row.pullRequestNumber) ||
        row.status !== "missing" ||
        row.recordDigest !== null,
    ) ||
    closed.some((pull) => input.jointValueDecisions?.has(pull.id)) ||
    (complete.source.unavailableSources ?? []).some((source) =>
      closedIds.has(source.nodeId),
    ) ||
    (complete.source.heldWorkUnits ?? []).some((unit) =>
      unit.sourceNodeIds.some((id) => closedIds.has(id)),
    ) ||
    (complete.reviewedImplementationUnits ?? []).some((unit) =>
      closedIds.has(unit.pullRequestId),
    )
  )
    throw new HistoricalClosedOutcomeError("assessment");

  function closedSource(url: string) {
    const source = new URL(url);
    const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)$/u.exec(
      source.pathname,
    );
    return (
      source.origin === "https://github.com" &&
      match !== null &&
      findRegisteredRepository(match[1], match[2])?.id === scope.repository &&
      closedNumbers.has(Number(match[3]))
    );
  }
  const completePayment = paymentLedger(complete);
  if (
    completePayment.some((event) => closedSource(event.source.url)) ||
    complete.ledger.some((event) => closedSource(event.source.url)) ||
    complete.penalties?.some((row) => closedIds.has(row.source.id))
  )
    throw new HistoricalClosedOutcomeError("scored-work");

  const projected = createHistoricalLeaderboardSnapshot(
    { ...input, closedUnmergedPullRequests: [] },
    scope,
  );
  function retainedProvenance(snapshot: LeaderboardSnapshot) {
    return {
      coverage: (snapshot.valueAssessmentCoverage ?? []).filter(
        (row) => !closedIds.has(row.pullRequestId),
      ),
      units: snapshot.reviewedImplementationUnits ?? [],
      reviews: (snapshot.reviewExclusions ?? []).filter(
        (row) => !closedIds.has(row.pullRequestId),
      ),
      attributions: snapshot.attributions.filter(
        (row) => !closedIds.has(row.artifactId) && !closedSource(row.sourceUrl),
      ),
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
