/** Historical review recovery preview. Never emits an active preparation or approval. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  assertQualityEvidence,
  calculateQualityReview,
  type QualityEvidence,
  qualityEvidenceBinding,
  verifyQualityEventIds,
} from "../src/lib/contribution-quality";
import {
  assertFundingPreparation,
  createFundingReview,
  exactRecord,
} from "../src/lib/funding-review-data";
import {
  assertLeaderboardSnapshot,
  type ScoreEvent,
} from "../src/lib/leaderboard";
import { findProject } from "../src/lib/projects.mjs";

export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function prepareSourceCorrection(input: {
  preparationBytes: string;
  snapshotBytes: string;
  auditBytes: string;
  archiveBytes: string;
  historyBytes: string;
  qualityBytes: string;
  request: unknown;
  proposals: unknown[];
}) {
  const request = exactRecord(
    input.request,
    "schemaVersion,kind,projectId,cycleId,predecessorPreparationSha256,archiveSha256,historySha256,eventIds,reason",
  );
  check(
    request.schemaVersion === "1" &&
      request.kind === "historical-review-correction-request",
    "Invalid correction request",
  );
  check(
    request.predecessorPreparationSha256 === sha256(input.preparationBytes) &&
      request.archiveSha256 === sha256(input.archiveBytes) &&
      request.historySha256 === sha256(input.historyBytes),
    "Correction input digest mismatch",
  );
  check(
    typeof request.reason === "string" &&
      request.reason.trim().length >= 20 &&
      request.reason.length <= 2000,
    "Explain the source correction",
  );
  check(
    Array.isArray(request.eventIds) &&
      request.eventIds.length > 0 &&
      request.eventIds.every((id) => typeof id === "string") &&
      new Set(request.eventIds).size === request.eventIds.length,
    "Select distinct recovered event IDs",
  );
  const preparation = assertFundingPreparation(
    JSON.parse(input.preparationBytes),
  );
  check(
    request.projectId === preparation.projectId &&
      request.cycleId === preparation.cycleId,
    "Wrong correction cycle",
  );
  check(
    preparation.sourceSnapshotSha256 === sha256(input.snapshotBytes) &&
      preparation.sourceAuditSha256 === sha256(input.auditBytes),
    "Original snapshot/audit digest mismatch",
  );
  const original: unknown = JSON.parse(input.snapshotBytes),
    archive: unknown = JSON.parse(input.archiveBytes);
  assertLeaderboardSnapshot(original);
  assertLeaderboardSnapshot(archive);
  check(
    original.ruleVersion === preparation.provenance.ruleVersion &&
      original.window.from === preparation.provenance.snapshotFrom &&
      original.window.to === preparation.provenance.snapshotTo &&
      original.ledger.length === preparation.provenance.snapshotLedgerCount &&
      original.source.counts.mergedPullRequests ===
        preparation.provenance.sourceMergedPullRequests,
    "Original collection provenance differs from preparation",
  );
  const evidence = assertQualityEvidence(
    JSON.parse(input.qualityBytes),
    preparation,
  );
  await verifyQualityEventIds(evidence, preparation);
  const project = findProject(preparation.projectId);
  check(project, "Unknown project");
  const repositories = new Set(project.repositories.map((repo) => repo.id));
  const inCycle = (event: ScoreEvent) =>
    repositories.has(event.repository) &&
    Date.parse(event.occurredAt) >=
      Date.parse(preparation.provenance.periodFrom) &&
    Date.parse(event.occurredAt) < Date.parse(preparation.provenance.periodTo);
  const baseline = original.ledger.filter(inCycle);
  check(
    baseline.length === evidence.events.length &&
      baseline.every((event) => {
        const row = evidence.events.find((row) => row.id === event.id);
        const thirds = event.scoreThirds ?? Math.round(event.points * 3);
        return (
          row &&
          row.actorId === event.actor.id &&
          row.kind ===
            (event.category === "merged-pull-request"
              ? "implementation"
              : event.category === "substantive-review"
                ? "review"
                : "evaluation") &&
          row.url === event.source.url &&
          row.title === event.source.title &&
          row.scoreThirds === thirds &&
          row.weight ===
            (
              BigInt(thirds) *
              BigInt(10000 + (event.evidenceBonusBasisPoints ?? 0))
            ).toString()
        );
      }),
    "Quality metadata differs from original ledger",
  );
  const history: { events: ScoreEvent[] } = JSON.parse(input.historyBytes);
  check(Array.isArray(history.events), "Missing accepted history");
  const existingIds = new Set(original.ledger.map((event) => event.id));
  const existingSources = new Set(
    original.ledger.map((event) => event.source.id),
  );
  const existingUrls = new Set(
    original.ledger.map((event) => event.source.url),
  );
  const recovered = request.eventIds
    .map((id) => {
      const matches = history.events.filter((event) => event.id === id),
        sources = archive.ledger.filter((event) => event.id === id);
      check(
        matches.length === 1 && sources.length === 1,
        "Missing or repeated historical event",
      );
      const event = matches[0],
        source = sources[0];
      check(
        event.continuity !== undefined &&
          event.continuity.sourceSnapshotSha256 === request.archiveSha256 &&
          /^https:\/\/github\.com\/SlopDotCash\/slopdotcash\/(?:issues|pull)\/[1-9][0-9]*$/.test(
            event.continuity.decisionUrl,
          ),
        "Missing reviewed archive provenance",
      );
      const normalized = (row: ScoreEvent) => {
        const {
          continuity: _continuity,
          evidenceBonusBasisPoints: _bonus,
          ...rest
        } = row;
        return rest;
      };
      check(
        isDeepStrictEqual(normalized(event), normalized(source)),
        "Recovered event changed from archive",
      );
      check(
        event.category === "substantive-review" &&
          event.source.kind === "review" &&
          event.scoreThirds === 3 &&
          event.points === 1 &&
          (event.evidenceBonusBasisPoints ?? 0) === 0 &&
          inCycle(event),
        "Recovery must be in-cycle base-only review credit",
      );
      check(
        preparation.contributors.some(
          (row) =>
            row.actor.id === event.actor.id &&
            row.actor.login === event.actor.login,
        ),
        "Recovery adds or changes a contributor identity; separate census review required",
      );
      check(
        !existingIds.has(event.id) &&
          !existingSources.has(event.source.id) &&
          !existingUrls.has(event.source.url),
        "Source already credited or correction replayed",
      );
      existingIds.add(event.id);
      existingSources.add(event.source.id);
      existingUrls.add(event.source.url);
      return event;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const corrected: QualityEvidence = {
    ...evidence,
    events: [
      ...evidence.events,
      ...recovered.map((event) => ({
        id: event.id,
        actorId: event.actor.id,
        url: event.source.url,
        title: event.source.title,
        kind: "review" as const,
        scoreThirds: 3,
        weight: "30000",
        flags: ["recovered review: value unratified"],
      })),
    ],
  };
  const review = createFundingReview(preparation);
  check(review.capMinor, "Correction requires a monthly pool");
  const capMinor = review.capMinor;
  const amount = (values: Map<string, string>, id: string) => {
    const value = values.get(id);
    check(value !== undefined, "Missing allocation actor");
    return value;
  };
  const actors = new Map(
    preparation.contributors.map((row) => [row.actor.id, row.actor.login]),
  );
  const before = calculateQualityReview(
    evidence,
    [],
    review.capMinor,
    [],
    actors,
  );
  const after = calculateQualityReview(
    corrected,
    [],
    review.capMinor,
    [],
    actors,
  );
  const provenance = {
    predecessorPreparationSha256: sha256(input.preparationBytes),
    sourceSnapshotSha256: sha256(input.snapshotBytes),
    sourceAuditSha256: sha256(input.auditBytes),
    archiveSha256: sha256(input.archiveBytes),
    historySha256: sha256(input.historyBytes),
    qualitySha256: sha256(input.qualityBytes),
  };
  const correctionSha256 = sha256(
    JSON.stringify({
      provenance,
      eventIds: recovered.map((event) => event.id),
      reason: request.reason,
    }),
  );
  const rows = preparation.contributors.map((row) => {
    const events = corrected.events.filter(
      (event) => event.actorId === row.actor.id,
    );
    return {
      actor: row.actor,
      wallet: row.wallet,
      lookupUnavailable: row.lookupUnavailable,
      beforeScoreThirds: row.scoreThirds,
      proposedScoreThirds: events
        .reduce((sum, event) => sum + BigInt(event.scoreThirds), 0n)
        .toString(),
      beforeWeight: row.weight,
      proposedWeight: events
        .reduce((sum, event) => sum + BigInt(event.weight), 0n)
        .toString(),
      proposedEventCount: events.length,
      proposedEventIdsSha256: sha256(
        JSON.stringify(events.map((event) => event.id).sort()),
      ),
      beforeMinor: amount(before.after, row.actor.id),
      proposedMinor: amount(after.after, row.actor.id),
      deltaMinor: (
        BigInt(amount(after.after, row.actor.id)) -
        BigInt(amount(before.after, row.actor.id))
      ).toString(),
    };
  });
  const sourceQualityBinding = await qualityEvidenceBinding(evidence);
  const previews = input.proposals.map((value) => {
    check(
      value && typeof value === "object" && !Array.isArray(value),
      "Invalid quality proposal",
    );
    const proposal = value as Record<string, unknown>;
    check(
      proposal.schemaVersion === "1" &&
        proposal.kind === "contribution-quality-proposal" &&
        proposal.projectId === preparation.projectId &&
        proposal.cycleId === preparation.cycleId &&
        proposal.sourceSnapshotSha256 === preparation.sourceSnapshotSha256 &&
        proposal.sourceQualityBinding === sourceQualityBinding &&
        proposal.capMinor === review.capMinor &&
        proposal.paymentAuthorized === false &&
        Array.isArray(proposal.burdens),
      "Quality proposal has wrong source or budget",
    );
    calculateQualityReview(
      evidence,
      proposal.decisions,
      capMinor,
      proposal.burdens,
      actors,
    );
    const result = calculateQualityReview(
      corrected,
      proposal.decisions,
      capMinor,
      proposal.burdens,
      actors,
    );
    return {
      kind: "correction-bound-quality-preview",
      correctionSha256,
      paymentAuthorized: false,
      decisions: proposal.decisions,
      burdens: proposal.burdens,
      reviewedEvents: result.reviewedEvents,
      unresolvedEvents: result.unresolvedEvents,
      retainedMinor: result.retainedMinor,
      amounts: rows.map((row) => ({
        actor: row.actor,
        amountMinor: amount(result.after, row.actor.id),
      })),
    };
  });
  check(
    rows.reduce((sum, row) => sum + BigInt(row.proposedMinor), 0n) ===
      BigInt(review.capMinor) &&
      rows.reduce((sum, row) => sum + BigInt(row.deltaMinor), 0n) === 0n,
    "Correction money does not reconcile",
  );
  return {
    schemaVersion: "1",
    kind: "historical-review-correction-preview",
    projectId: preparation.projectId,
    cycleId: preparation.cycleId,
    correctionSha256,
    provenance,
    reason: request.reason,
    paymentAuthorized: false,
    approval: "pending",
    activePreparationChanged: false,
    capMinor: review.capMinor,
    beforeEvents: evidence.events.length,
    proposedEvents: corrected.events.length,
    addedScoreThirds: recovered.length * 3,
    recoveredEvents: recovered.map((event) => ({
      id: event.id,
      actor: event.actor,
      source: event.source,
      occurredAt: event.occurredAt,
      scoreThirds: 3,
      weight: "30000",
      continuity: event.continuity,
    })),
    rows,
    qualityPreviews: previews,
  };
}
