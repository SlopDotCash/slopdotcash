import { canonicalJson } from "../src/lib/canonical-json";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import {
  assertHistoricalLeaderboardSnapshot,
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
  repositoryIdFromUrl,
} from "../src/lib/leaderboard";
import type { ScoreEvent } from "../src/lib/leaderboard-types";
import {
  applyPointsSnapshot,
  assertPointsJournal,
  awardForScore,
  latestPoints,
  type PointAward,
  type PointRevision,
  type PointsJournal,
} from "../src/lib/points";
import { VALUE_SCORING_APPROVED_HISTORY_FROM } from "../src/lib/scoring-policy";
import { sha256Hex } from "../src/lib/sha256";
import type { WorkUnitRecord } from "../workers/slopbot/value-work-unit-journal";
import type { HistoricalAssessmentCatalog } from "./historical-assessment-catalog";
import {
  type HistoricalAssessmentReceipt,
  type HistoricalContextGitHub,
  historicalClosedContextBindings,
  isHistoricalClosedFinding,
} from "./historical-assessment-reconciliation";
import { isStandaloneHistoricalReview } from "./historical-closed-review-source";
import type { HistoricalPointsPacket } from "./reviewed-historical-points";

type ValueScope = Pick<HistoricalPointsPacket, "projectId" | "sourceAudit">;
type ValuePacket = ValueScope &
  Pick<
    HistoricalPointsPacket,
    | "revision"
    | "manifestSha256"
    | "baselineDigest"
    | "baselineRevisionCount"
    | "valueSnapshot"
    | "valueKeys"
  >;
type Coverage = NonNullable<
  LeaderboardSnapshot["valueAssessmentCoverage"]
>[number];

function ensure(value: unknown, reason: string): asserts value {
  if (!value) throw Error(reason);
}

function hasValueDecision(row: PointRevision): boolean {
  return row.decision?.sourceId.startsWith("value:") ?? false;
}

function inWindow(
  occurredAt: string,
  audit: Pick<ValueScope["sourceAudit"], "from" | "through">,
) {
  return occurredAt >= audit.from && occurredAt < audit.through;
}

function wire(value: unknown) {
  // The reviewed value is JSON on disk; `undefined` fields in a live object
  // do not survive that boundary.
  return canonicalJson(JSON.parse(JSON.stringify(value)));
}

function sameJson(left: unknown, right: unknown) {
  return wire(left) === wire(right);
}

type VerifiedClosedReview = {
  parentId: string;
  parentNumber: number;
  actorNodeId: string;
  sourceUrl: string;
  occurredAt: string;
  recordDigest: string;
};

export type VerifiedClosedReviews = ReadonlyMap<string, VerifiedClosedReview>;

function parentPullNumber(url: string) {
  const match = /^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)$/u.exec(
    new URL(url).pathname,
  );
  return match ? Number(match[1]) : null;
}

function boundClosedReview(event: ScoreEvent, reviews: VerifiedClosedReviews) {
  const proof = reviews.get(event.source.id);
  return (
    !!proof &&
    event.category === "substantive-review" &&
    event.source.kind === "review" &&
    event.id === `${proof.parentId}:value-review:${event.source.id}` &&
    event.actor.kind === "User" &&
    event.actor.id === proof.actorNodeId &&
    event.source.number === proof.parentNumber &&
    event.source.url === proof.sourceUrl &&
    new Date(event.occurredAt).toISOString() === proof.occurredAt &&
    event.scoreDecisionSourceId === `value:${proof.recordDigest}`
  );
}

type RestReview = {
  id: number;
  node_id: string;
  html_url: string;
  submitted_at: string | null;
  state?: string;
  user: { id: number; node_id: string; type: string } | null;
};

/** Bind each ordinary canonical closure review to current GitHub and the
 * immutable reviewed journal before it can enter either local projection. */
export async function verifyHistoricalClosedReviews(
  snapshot: LeaderboardSnapshot | null,
  receipt: HistoricalAssessmentReceipt,
  catalog: Pick<HistoricalAssessmentCatalog, "joint">,
  github?: Pick<HistoricalContextGitHub, "get">,
): Promise<VerifiedClosedReviews> {
  const proofs = new Map<string, VerifiedClosedReview>();
  if (!snapshot) return proofs;
  const contexts = new Map(
    [...historicalClosedContextBindings(receipt)].map(
      ([id, binding]) => [binding.number, { id, ...binding }] as const,
    ),
  );
  if (!contexts.size) return proofs;
  ensure(
    receipt.status === "requires-value-replay",
    "Closed historical review is outside a reconciled assessment scope",
  );
  const records = new Map(
    catalog.joint.map((row) => [row.record_digest, row.record_json]),
  );
  const primary = new Map(snapshot.ledger.map((event) => [event.id, event]));
  for (const event of [
    ...snapshot.ledger,
    ...(snapshot.paymentReviewBasis?.ledger ?? []),
  ]) {
    const context = contexts.get(parentPullNumber(event.source.url) ?? 0);
    if (
      !context ||
      event.repository.toLowerCase() !== receipt.scope.repository.toLowerCase()
    )
      continue;
    if (proofs.has(event.source.id)) {
      const canonical = primary.get(event.id);
      ensure(
        canonical &&
          boundClosedReview(event, proofs) &&
          sameJson(event, canonical),
        "Closed historical review is duplicated or differs from the canonical ledger",
      );
      continue;
    }
    const recordJson = records.get(context.digest);
    const reviewId = /^#pullrequestreview-([1-9]\d*)$/u.exec(
      new URL(event.source.url).hash,
    )?.[1];
    ensure(
      github &&
        reviewId &&
        recordJson &&
        sha256Hex(recordJson) === context.digest &&
        event.category === "substantive-review" &&
        event.source.kind === "review" &&
        event.source.number === context.number &&
        event.id === `${context.id}:value-review:${event.source.id}` &&
        event.scoreDecisionSourceId === `value:${context.digest}` &&
        inWindow(new Date(event.occurredAt).toISOString(), receipt.scope) &&
        Date.parse(event.occurredAt) < Date.parse(context.occurredAt) &&
        primary.has(event.id),
      "Closed historical review has no authenticated source or recorded value",
    );
    const record = JSON.parse(recordJson) as WorkUnitRecord;
    ensure(
      receipt.records.some(
        (row) =>
          row.journal === "joint" &&
          row.digest === context.digest &&
          (context.standaloneReview
            ? row.sources.length === 1 && isStandaloneHistoricalReview(record)
            : row.sources.some(
                (source) =>
                  source.finding === "audited-head" ||
                  source.finding === "stale-head",
              )),
      ) &&
        record.sources.some(
          (source) =>
            source.pullRequestNodeId === context.id &&
            source.pullRequestNumber === context.number &&
            source.headSha === context.headSha &&
            Date.parse(source.occurredAt) === Date.parse(context.occurredAt) &&
            source.repositoryNodeId === receipt.scope.repositoryNodeId &&
            source.indirectAcceptance === undefined,
        ) &&
        record.units.some(
          ({ assessment }) =>
            assessment.status === "assessed" &&
            assessment.reviews.some(
              (review) =>
                review.sourceId === event.source.id && review.tier !== "none",
            ),
        ),
      "Closed historical review is absent from the assessed work unit",
    );
    const current = await github.get<RestReview>(
      `/repos/${receipt.scope.repository}/pulls/${context.number}/reviews/${reviewId}`,
    );
    ensure(
      current?.node_id === event.source.id &&
        String(current.id) === reviewId &&
        current.html_url === event.source.url &&
        (!context.standaloneReview ||
          current.state === "APPROVED" ||
          current.state === "CHANGES_REQUESTED") &&
        current.submitted_at &&
        Date.parse(current.submitted_at) === Date.parse(event.occurredAt) &&
        current.user?.type === "User" &&
        current.user.node_id === event.actor.id &&
        String(current.user.id) === githubUserIdFromNodeId(event.actor.id),
      "Closed historical review identity or timing changed",
    );
    proofs.set(event.source.id, {
      parentId: context.id,
      parentNumber: context.number,
      actorNodeId: event.actor.id,
      sourceUrl: event.source.url,
      occurredAt: new Date(event.occurredAt).toISOString(),
      recordDigest: context.digest,
    });
    ensure(
      boundClosedReview(event, proofs),
      "Closed historical review differs from the canonical evidence",
    );
  }
  return proofs;
}

/** The exact projection consumed by historical packet reconstruction. */
export function projectHistoricalValueChanges(
  { projectId, sourceAudit }: ValueScope,
  baseline: PointsJournal,
  snapshot: LeaderboardSnapshot,
  closedReviews: VerifiedClosedReviews = new Map(),
) {
  assertLeaderboardSnapshot(snapshot);
  ensure(
    snapshot.valuePolicyEffectiveAt === VALUE_SCORING_APPROVED_HISTORY_FROM &&
      snapshot.window.from === sourceAudit.from &&
      snapshot.window.to === sourceAudit.through,
    "Historical value snapshot has another window",
  );
  const sources = new Map(
    sourceAudit.sources.map((source) => [source.id, source]),
  );
  const reviewParents = new Map(
    [...closedReviews.values()].map((proof) => [proof.parentId, proof]),
  );
  const coverage = snapshot.valueAssessmentCoverage ?? [];
  ensure(
    sources.size === sourceAudit.sources.length &&
      coverage.length === sources.size + reviewParents.size &&
      (snapshot.source.counts.closedUnmergedPullRequests ?? 0) ===
        reviewParents.size &&
      coverage.every((row) => {
        const closed = reviewParents.get(row.pullRequestId);
        return (
          row.repository.toLowerCase() ===
            sourceAudit.repository.toLowerCase() &&
          (closed
            ? !sources.has(row.pullRequestId) &&
              closed.parentNumber === row.pullRequestNumber &&
              row.status === "assessed" &&
              row.recordDigest === closed.recordDigest
            : sources.get(row.pullRequestId)?.number === row.pullRequestNumber)
        );
      }),
    "Snapshot omits audited sources",
  );
  const reviewNumbers = new Set(
    [...reviewParents.values()].map((proof) => proof.parentNumber),
  );
  for (const event of [
    ...snapshot.ledger,
    ...(snapshot.paymentReviewBasis?.ledger ?? []),
  ]) {
    if (
      event.repository.toLowerCase() === sourceAudit.repository.toLowerCase() &&
      reviewNumbers.has(parentPullNumber(event.source.url) ?? 0)
    )
      ensure(
        boundClosedReview(event, closedReviews),
        "Closed historical context has an unverified or non-review award",
      );
  }
  const snapshotDigest = sha256Hex(JSON.stringify(snapshot));
  const previous = latestPoints(baseline);
  const updated = latestPoints(
    applyPointsSnapshot(
      baseline,
      snapshot,
      snapshotDigest,
      snapshot.generatedAt,
      { preserveHeldImplementation: true },
    ),
  );
  const changed = [...updated.values()].filter(
    (row) => previous.get(row.award.key)?.id !== row.id,
  );
  const rows = changed.filter(
    (row) =>
      hasValueDecision(row) &&
      row.award.projectId === projectId &&
      inWindow(row.award.occurredAt, sourceAudit),
  );
  return { snapshotDigest, previous, changed, rows };
}

function bySource(left: Coverage, right: Coverage) {
  return left.pullRequestNumber - right.pullRequestNumber;
}

function verifyCoverage(
  snapshot: LeaderboardSnapshot,
  receipt: HistoricalAssessmentReceipt,
  closedReviews: VerifiedClosedReviews,
) {
  const reviewedParents = new Set(
    [...closedReviews.values()].map((proof) => proof.parentId),
  );
  const active = new Map<string, { digest: string; stale: boolean }>();
  for (const { digest, sources } of receipt.records)
    for (const source of sources) {
      if (
        source.finding === "outside-audit" ||
        (isHistoricalClosedFinding(source.finding) &&
          !reviewedParents.has(source.id))
      )
        continue;
      ensure(
        (source.finding === "audited-head" ||
          source.finding === "stale-head" ||
          isHistoricalClosedFinding(source.finding)) &&
          !active.has(source.id),
        "Historical assessment has a conflicting active source",
      );
      active.set(source.id, { digest, stale: source.finding === "stale-head" });
    }
  const coverage = [...(snapshot.valueAssessmentCoverage ?? [])].sort(bySource);
  const staleIds = new Set<string>();
  for (const row of coverage) {
    const record = active.get(row.pullRequestId);
    if (!record) {
      ensure(
        row.recordDigest === null &&
          ["missing", "incomplete", "human-ratified"].includes(row.status),
        "Historical value coverage cites an unaudited active assessment",
      );
      continue;
    }
    // A verified attribution hold keeps earlier awards while the frozen
    // receipt retains the original active digest. Missing is never a hold.
    ensure(
      !["missing", "legacy-policy"].includes(row.status) &&
        (row.recordDigest === record.digest ||
          (row.status === "incomplete" && row.recordDigest === null)) &&
        !(record.stale && row.status === "assessed"),
      "Historical value coverage omits or misstates an active assessment",
    );
    active.delete(row.pullRequestId);
    if (record.stale) staleIds.add(row.pullRequestId);
  }
  ensure(
    active.size === 0,
    "Historical value coverage omits an active assessment",
  );
  return { coverage, staleIds };
}

function compareSnapshotScope(
  { projectId, sourceAudit }: ValueScope,
  closedReviews: VerifiedClosedReviews,
) {
  const byNumber = new Map(
    sourceAudit.sources.map((source) => [source.number, source]),
  );
  ensure(
    byNumber.size === sourceAudit.sources.length,
    "Historical audit repeats a source number",
  );
  function parent(award: PointAward) {
    const url = new URL(award.sourceUrl);
    const match = /^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)$/u.exec(url.pathname);
    return match &&
      repositoryIdFromUrl(award.sourceUrl) === sourceAudit.repository
      ? byNumber.get(Number(match[1]))
      : undefined;
  }
  function contains(award: PointAward) {
    if (
      award.projectId !== projectId ||
      !inWindow(award.occurredAt, sourceAudit)
    )
      return false;
    const source = parent(award);
    if (!source) {
      const review = closedReviews.get(award.sourceId);
      return (
        award.category === "substantive-review" &&
        review?.actorNodeId === award.actor.id &&
        review.sourceUrl === award.sourceUrl &&
        review.occurredAt === award.occurredAt
      );
    }
    return (
      award.category === "substantive-review" ||
      (award.category === "merged-pull-request" &&
        award.sourceId === source.id &&
        award.occurredAt === source.mergedAt)
    );
  }
  return { parent, contains };
}

function verifyLinkedScope(
  snapshot: LeaderboardSnapshot,
  receipt: HistoricalAssessmentReceipt,
  projection: ReturnType<typeof projectHistoricalValueChanges>,
  contains: (award: PointAward) => boolean,
) {
  for (const row of projection.changed) {
    if (!hasValueDecision(row)) continue;
    const previous = projection.previous.get(row.award.key);
    ensure(
      contains(row.award) &&
        (!previous ||
          (contains(previous.award) &&
            previous.award.occurredAt === row.award.occurredAt)),
      "Historical value change crosses the audited source or occurrence scope",
    );
  }

  const unitKey = (row: PointRevision) =>
    `${row.decision?.sourceId}\0${row.award.workUnitId}`;
  const groupsByUnit = new Map<string, string>(
    (snapshot.reviewedImplementationUnits ?? []).flatMap(({ units }) =>
      units.map(
        ({ groupId, recordDigest, workUnitId }) =>
          [`value:${recordDigest}\0${workUnitId}`, groupId] as const,
      ),
    ),
  );
  const implementation = projection.rows.filter(
    ({ award }) => award.category === "merged-pull-request",
  );
  const changedUnitIds = new Set<string>();
  const changedGroups = new Set<string>();
  const changedDecisions = new Set<string>();
  for (const row of implementation) {
    changedUnitIds.add(row.award.workUnitId);
    if (row.decision) changedDecisions.add(row.decision.sourceId);
    const group = groupsByUnit.get(unitKey(row));
    if (group) changedGroups.add(group);
  }
  const outsideMembers = new Set(
    receipt.records
      .filter(
        (record) =>
          record.journal === "joint" &&
          changedDecisions.has(`value:${record.digest}`),
      )
      .flatMap((record) =>
        record.sources
          .filter(
            (source) =>
              source.finding === "outside-audit" ||
              isHistoricalClosedFinding(source.finding),
          )
          .map((source) => source.id),
      ),
  );
  function linked(row: PointRevision) {
    const group = groupsByUnit.get(unitKey(row));
    return (
      changedUnitIds.has(row.award.workUnitId) ||
      (group !== undefined && changedGroups.has(group)) ||
      (row.decision !== undefined &&
        changedDecisions.has(row.decision.sourceId)) ||
      outsideMembers.has(row.award.sourceId)
    );
  }
  for (const row of projection.changed) {
    if (
      row.award.projectId !== receipt.scope.projectId ||
      row.award.category !== "merged-pull-request" ||
      contains(row.award)
    )
      continue;
    ensure(
      !linked(row),
      "Historical value replay would split a linked implementation change across the audited scope",
    );
  }
  // The rolling importer can omit a predecessor outside its window entirely.
  // Do not admit its in-window replacement while that earlier pool still stands.
  for (const row of projection.previous.values()) {
    const { award } = row;
    if (
      award.projectId !== receipt.scope.projectId ||
      award.category !== "merged-pull-request" ||
      award.amount <= 0 ||
      contains(award)
    )
      continue;
    ensure(
      !linked(row),
      "Historical value replay would split a linked implementation change across the audited scope",
    );
  }
}

function pointProjection(rows: readonly PointRevision[]) {
  return rows
    .map(({ award, previous, decision, sourceRule }) => ({
      award,
      previous,
      decision,
      sourceRule,
    }))
    .sort((left, right) => left.award.key.localeCompare(right.award.key));
}

/** Compare the approved Points projection with independently collected trusted inputs. */
export function verifyHistoricalValueReplay(
  packet: ValuePacket,
  baseline: PointsJournal,
  receipt: HistoricalAssessmentReceipt,
  trustedSnapshot: LeaderboardSnapshot | null,
  closedReviews: VerifiedClosedReviews = new Map(),
): string {
  assertPointsJournal(baseline);
  const { projectId, sourceAudit: audit } = packet;
  const sourceAuditSha256 = sha256Hex(
    JSON.stringify({
      repository: audit.repository,
      repositoryNodeId: audit.repositoryNodeId,
      from: audit.from,
      through: audit.through,
      sources: [...audit.sources]
        .sort((a, b) => a.number - b.number)
        .map(({ id, number, headSha, mergedAt }) => ({
          id,
          number,
          headSha,
          mergedAt,
        })),
    }),
  );
  ensure(
    sameJson(receipt.scope, {
      projectId,
      repository: audit.repository,
      repositoryNodeId: audit.repositoryNodeId,
      from: audit.from,
      through: audit.through,
      sourceAuditSha256,
    }) &&
      receipt.counts.auditedSources === audit.sources.length &&
      receipt.heads.registryRevision === packet.revision &&
      receipt.heads.registryManifestSha256 === packet.manifestSha256 &&
      receipt.heads.d1PointsDigest === packet.baselineDigest &&
      receipt.heads.d1PointsCount === packet.baselineRevisionCount &&
      baseline.revisions.length === packet.baselineRevisionCount &&
      sha256Hex(JSON.stringify(baseline)) === packet.baselineDigest,
    "Historical value replay differs from the reconciled audit or Points baseline",
  );
  const { receiptSha256, ...receiptBody } = receipt;
  ensure(
    receipt.blockers.length === 0 &&
      receipt.counts.relevantRecords === receipt.records.length &&
      receiptSha256 === sha256Hex(canonicalJson(receiptBody)),
    "Historical assessment reconciliation is incomplete",
  );
  if (receipt.status === "no-scoped-active-assessments") {
    ensure(
      receipt.records.length === 0 &&
        packet.valueSnapshot === null &&
        trustedSnapshot === null &&
        packet.valueKeys.length === 0 &&
        closedReviews.size === 0,
      "Empty assessment scope cannot carry historical value decisions",
    );
    return sha256Hex(wire({ receiptSha256, value: null }));
  }
  ensure(
    receipt.status === "requires-value-replay" &&
      receipt.records.length > 0 &&
      trustedSnapshot &&
      packet.valueSnapshot,
    "Complete historical value replay is required",
  );

  const scope = {
    projectId,
    repository: audit.repository,
    repositoryNodeId: audit.repositoryNodeId,
    manifestSha256: packet.manifestSha256,
  };
  const { contains, parent } = compareSnapshotScope(packet, closedReviews);
  const contexts = historicalClosedContextBindings(receipt);
  for (const proof of closedReviews.values()) {
    const context = contexts.get(proof.parentId);
    ensure(
      context?.digest === proof.recordDigest &&
        context.number === proof.parentNumber,
      "Closed historical review is outside the reconciled assessment scope",
    );
  }
  const closedNumbers = new Set(
    [...contexts.values()].map(({ number }) => number),
  );
  function replay(snapshot: LeaderboardSnapshot) {
    assertHistoricalLeaderboardSnapshot(snapshot, scope);
    for (const event of [
      ...snapshot.ledger,
      ...(snapshot.paymentReviewBasis?.ledger ?? []),
    ]) {
      if (closedNumbers.has(parentPullNumber(event.source.url) ?? 0))
        ensure(
          boundClosedReview(event, closedReviews),
          "Closed historical context has an unverified or non-review award",
        );
    }
    const projection = projectHistoricalValueChanges(
      packet,
      baseline,
      snapshot,
      closedReviews,
    );
    const { coverage, staleIds } = verifyCoverage(
      snapshot,
      receipt,
      closedReviews,
    );
    const events = snapshot.ledger.filter((event) =>
      event.scoreDecisionSourceId?.startsWith("value:"),
    );
    for (const event of events) {
      const award = awardForScore(event);
      const source = parent(award);
      ensure(
        (source
          ? !staleIds.has(source.id)
          : boundClosedReview(event, closedReviews)) && contains(award),
        "Historical value decision crosses the audited source or uses stale evidence",
      );
    }
    verifyLinkedScope(snapshot, receipt, projection, contains);
    return {
      coverage,
      events: events.sort((a, b) => a.id.localeCompare(b.id)),
      units: [...(snapshot.reviewedImplementationUnits ?? [])].sort((a, b) =>
        a.pullRequestId.localeCompare(b.pullRequestId),
      ),
      held: [...(snapshot.source.heldWorkUnits ?? [])].sort((a, b) =>
        a.recordDigest.localeCompare(b.recordDigest),
      ),
      unavailable: [...(snapshot.source.unavailableSources ?? [])].sort(
        (a, b) => a.nodeId.localeCompare(b.nodeId),
      ),
      points: pointProjection(projection.rows),
    };
  }
  const trusted = replay(trustedSnapshot);
  const reviewed =
    packet.valueSnapshot === trustedSnapshot
      ? trusted
      : replay(packet.valueSnapshot);
  ensure(
    sameJson(trusted, reviewed),
    "Reviewed historical value decisions differ from the trusted replay",
  );
  ensure(
    sameJson(
      trusted.points.map(({ award }) => award.key).sort(),
      [...packet.valueKeys].sort(),
    ),
    "Reviewed value keys omit or add a trusted assessed change",
  );
  return sha256Hex(wire({ receiptSha256, value: trusted }));
}
