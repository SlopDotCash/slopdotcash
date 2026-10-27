import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LeaderboardSnapshot,
  PAYMENT_REVIEW_POLICY,
  PAYMENT_REVIEW_POLICY_AT,
  paymentReviewSnapshot,
  type ScoreEvent,
} from "../src/lib/leaderboard";
import { createPaymentProjectView } from "../src/lib/project-view";
import { prepareSourceCorrection, sha256 } from "./source-correction";

const archived = JSON.parse(
  readFileSync(
    "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json",
    "utf8",
  ),
) as LeaderboardSnapshot;
const dir = mkdtempSync(join(tmpdir(), "quality-payment-ledger-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const SHIFT_MS = 31 * 86_400_000;
function shift(iso: string): string {
  const moved = new Date(Date.parse(iso) + SHIFT_MS).toISOString();
  return iso.includes(".") ? moved : moved.replace(/\.\d{3}Z$/u, "Z");
}

/**
 * The archived September snapshot moved 31 days forward, so its September
 * events fall inside the October period, with a payment review basis that
 * either removes one in-period base review of a contributor who keeps other
 * events, or adds that review back to a raw ledger that lacks it.
 */
function octoberSnapshot(basis: "removes" | "adds"): {
  snapshot: LeaderboardSnapshot;
  review: ScoreEvent;
} {
  const snapshot = structuredClone(archived);
  snapshot.window = {
    ...snapshot.window,
    from: shift(snapshot.window.from),
    to: shift(snapshot.window.to),
  };
  snapshot.source.verificationWindow = { ...snapshot.window };
  snapshot.source.cutoffAt = snapshot.window.to;
  snapshot.generatedAt = "2026-11-01T05:00:00.000Z";
  snapshot.source.fetchedAt = snapshot.generatedAt;
  for (const event of snapshot.ledger)
    event.occurredAt = shift(event.occurredAt);
  const inPeriod = (event: ScoreEvent) =>
    event.repository === "elizaOS/eliza" &&
    event.occurredAt >= "2026-10-01T00:00:00Z" &&
    event.occurredAt < "2026-11-01T00:00:00Z";
  const counts = new Map<string, number>();
  for (const event of snapshot.ledger.filter(inPeriod))
    counts.set(event.actor.id, (counts.get(event.actor.id) ?? 0) + 1);
  const review = snapshot.ledger.find(
    (event) =>
      inPeriod(event) &&
      event.category === "substantive-review" &&
      event.scoreThirds === 3 &&
      event.points === 1 &&
      event.evidenceBonusBasisPoints === undefined &&
      (counts.get(event.actor.id) ?? 0) > 3,
  ) as ScoreEvent;
  const key = "substantiveReviews";
  const withoutReview = snapshot.leaders.map((leader) =>
    leader.actor.id !== review.actor.id
      ? leader
      : {
          ...leader,
          score: Math.floor((leader.scoreThirds - 3) / 3),
          scoreThirds: leader.scoreThirds - 3,
          points: { ...leader.points, [key]: leader.points[key] - 1 },
          pointThirds: {
            ...leader.pointThirds,
            [key]: leader.pointThirds[key] - 3,
          },
          acceptedOutcomes: {
            ...leader.acceptedOutcomes,
            [key]: leader.acceptedOutcomes[key] - 1,
          },
        },
  );
  const withReview = snapshot.leaders;
  if (basis === "adds") {
    snapshot.ledger = snapshot.ledger.filter((event) => event.id !== review.id);
    snapshot.leaders = withoutReview;
  }
  snapshot.paymentReviewBasis = {
    policy: PAYMENT_REVIEW_POLICY,
    effectiveAt: PAYMENT_REVIEW_POLICY_AT,
    leaders: basis === "adds" ? withReview : withoutReview,
    ledger: basis === "adds" ? [review] : [],
    removedEventIds: basis === "adds" ? [] : [review.id],
    removedAttributionIds: [],
    attributionOrder: snapshot.attributions.map((a) => a.id),
    attributions: [],
    invalidAttributionMarkers: snapshot.invalidAttributionMarkers,
    attributionCoverage: snapshot.attributionCoverage,
    opportunities: snapshot.opportunities,
    reviewExclusions: snapshot.reviewExclusions ?? [],
  };
  return { snapshot, review };
}

/** A funding preparation derived the way `prepare-funding-review --import` does. */
function preparationFor(snapshot: LeaderboardSnapshot, cycleId: string) {
  const view = createPaymentProjectView(snapshot, "eliza", cycleId);
  const contributors = view.leaders.map((leader) => {
    const events = view.ledger
      .filter((event) => event.actor.id === leader.actor.id)
      .map((event) => event.id)
      .sort();
    return {
      actor: { id: leader.actor.id, login: leader.actor.login },
      scoreThirds: String(leader.scoreThirds),
      weight: String(leader.adjustedWeight),
      eventCount: events.length,
      eventIdsSha256: sha256(JSON.stringify(events)),
      wallet: null,
      lookupUnavailable: false,
    };
  });
  const merges = new Map<string, ScoreEvent>();
  for (const event of view.ledger)
    if (event.category === "merged-pull-request")
      merges.set(event.source.id, event);
  const snapshotBytes = JSON.stringify(snapshot);
  const auditBytes = "audit-bytes";
  const preparation = {
    projectId: "eliza",
    cycleId,
    sourceSnapshotSha256: sha256(snapshotBytes),
    sourceAuditSha256: sha256(auditBytes),
    observedAt: view.cycle.to,
    provenance: {
      ruleVersion: snapshot.ruleVersion,
      walletObservationsSha256: sha256("wallets"),
      snapshotFrom: snapshot.window.from,
      snapshotTo: snapshot.window.to,
      periodFrom: view.cycle.from,
      periodTo: view.cycle.to,
      snapshotLedgerCount:
        cycleId >= "2026-10"
          ? paymentReviewSnapshot(snapshot).ledger.length
          : snapshot.ledger.length,
      sourceMergedPullRequests: snapshot.source.counts.mergedPullRequests,
      mergedCensus: merges.size,
      scoredMerges: merges.size,
    },
    counts: {
      contributors: contributors.length,
      events: contributors.reduce((sum, row) => sum + row.eventCount, 0),
      scoreThirds: contributors
        .reduce((sum, row) => sum + BigInt(row.scoreThirds), 0n)
        .toString(),
      weight: contributors
        .reduce((sum, row) => sum + BigInt(row.weight), 0n)
        .toString(),
    },
    contributors,
  };
  return {
    view,
    snapshotBytes,
    auditBytes,
    preparationBytes: JSON.stringify(preparation),
    merges: [...merges.values()],
  };
}

/** Runs the production script on the preparation's complete merge census. */
function prepareQuality(
  name: string,
  cycleId: string,
  input: ReturnType<typeof preparationFor>,
) {
  const path = (file: string) => join(dir, `${name}-${file}`);
  const nodes = input.merges.map((event) => ({
    id: event.source.id,
    url: event.source.url,
    title: event.source.title,
    createdAt: input.view.cycle.from,
    closedAt: event.occurredAt,
    mergedAt: event.occurredAt,
    additions: 20,
    deletions: 5,
    author: { id: event.actor.id, login: event.actor.login },
  }));
  writeFileSync(path("preparation.json"), input.preparationBytes);
  writeFileSync(path("snapshot.json"), input.snapshotBytes);
  writeFileSync(
    path("closed.json"),
    JSON.stringify({
      method: "repository-created-order-v1",
      projectId: "eliza",
      cycleId,
      observedAt: input.view.cycle.to,
      coverage: [
        {
          repository: "elizaOS/eliza",
          pages: 1,
          scanned: nodes.length,
          complete: true,
        },
      ],
      nodes,
    }),
  );
  writeFileSync(
    path("bases.json"),
    JSON.stringify(
      nodes.map((row) => ({ id: row.id, baseRefName: "develop" })),
    ),
  );
  const run = spawnSync(
    process.execPath,
    [
      "--preload",
      "./tests/registry-preload.ts",
      "scripts/prepare-contribution-quality.ts",
      path("preparation.json"),
      path("snapshot.json"),
      path("closed.json"),
      path("bases.json"),
      path("quality.json"),
    ],
    { encoding: "utf8" },
  );
  return {
    status: run.status,
    output: `${run.stdout}${run.stderr}`,
    qualityPath: path("quality.json"),
  };
}

/** Recovers `review` from `archiveBytes` with reviewed archive provenance. */
function recoveredFrom(review: ScoreEvent, archiveBytes: string): ScoreEvent {
  return {
    ...review,
    continuity: {
      sourceSnapshotSha256: sha256(archiveBytes),
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/1",
    },
  };
}

async function correctionError(
  input: ReturnType<typeof preparationFor>,
  qualityBytes: string,
  archiveBytes: string,
  history: ScoreEvent[],
  eventIds: string[],
): Promise<string> {
  const historyBytes = JSON.stringify({ events: history });
  try {
    await prepareSourceCorrection({
      preparationBytes: input.preparationBytes,
      snapshotBytes: input.snapshotBytes,
      auditBytes: input.auditBytes,
      archiveBytes,
      historyBytes,
      qualityBytes,
      request: {
        schemaVersion: "1",
        kind: "historical-review-correction-request",
        projectId: "eliza",
        cycleId: "2026-10",
        predecessorPreparationSha256: sha256(input.preparationBytes),
        archiveSha256: sha256(archiveBytes),
        historySha256: sha256(historyBytes),
        eventIds,
        reason: "Recover review events excluded by a collection defect.",
      },
      proposals: [],
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("prepareSourceCorrection did not reject the fixture");
}

describe("2026-10 quality evidence follows the payment review ledger", () => {
  const removes = octoberSnapshot("removes");
  const october = preparationFor(removes.snapshot, "2026-10");
  const removed = removes.review;
  const paymentEvents = october.view.ledger.length;

  test("prepare-contribution-quality builds evidence from the payment review ledger", () => {
    const run = prepareQuality("october", "2026-10", october);
    expect(run.output).toContain(`Prepared ${paymentEvents} scored events`);
    expect(run.status).toBe(0);
    const evidence = JSON.parse(readFileSync(run.qualityPath, "utf8"));
    expect(evidence.events).toHaveLength(paymentEvents);
    expect(
      evidence.events.some((event: { id: string }) => event.id === removed.id),
    ).toBe(false);
  }, 60_000);

  test("source correction accepts that evidence and refuses to recover the removed review", async () => {
    const run = prepareQuality("correction", "2026-10", october);
    expect(run.status).toBe(0);
    const qualityBytes = readFileSync(run.qualityPath, "utf8");
    const archiveBytes = october.snapshotBytes;
    // Reaching the history stage proves the baseline matched the evidence.
    expect(
      await correctionError(
        october,
        qualityBytes,
        archiveBytes,
        [],
        ["missing-event"],
      ),
    ).toBe("Missing or repeated historical event");
    expect(
      await correctionError(
        october,
        qualityBytes,
        archiveBytes,
        [recoveredFrom(removed, archiveBytes)],
        [removed.id],
      ),
    ).toBe("Source already credited or correction replayed");
  }, 60_000);

  test("source correction refuses to recover a review only the payment review ledger credits", async () => {
    const adds = octoberSnapshot("adds");
    const added = preparationFor(adds.snapshot, "2026-10");
    expect(adds.snapshot.ledger.some((e) => e.id === adds.review.id)).toBe(
      false,
    );
    expect(added.view.ledger.some((e) => e.id === adds.review.id)).toBe(true);
    const run = prepareQuality("added", "2026-10", added);
    expect(run.status).toBe(0);
    const qualityBytes = readFileSync(run.qualityPath, "utf8");
    // The archive is a snapshot whose raw ledger still holds the review.
    const archiveBytes = october.snapshotBytes;
    expect(
      await correctionError(
        added,
        qualityBytes,
        archiveBytes,
        [recoveredFrom(adds.review, archiveBytes)],
        [adds.review.id],
      ),
    ).toBe("Source already credited or correction replayed");
  }, 60_000);
});

describe("pre-2026-10 quality evidence keeps the score ledger", () => {
  test("prepare-contribution-quality accepts the archived September cycle", () => {
    const september = preparationFor(archived, "2026-09");
    const run = prepareQuality("september", "2026-09", september);
    expect(run.output).toContain(
      `Prepared ${september.view.ledger.length} scored events`,
    );
    expect(run.status).toBe(0);
  }, 60_000);
});
