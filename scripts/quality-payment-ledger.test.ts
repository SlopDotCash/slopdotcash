import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  assignLeaderboardRanks,
  compareRankedEntries,
  type LeaderboardSnapshot,
  PAYMENT_REVIEW_POLICY,
  PAYMENT_REVIEW_POLICY_AT,
  paymentReviewSnapshot,
  type ScoreEvent,
} from "../src/lib/leaderboard";
import {
  qualityEvidenceBinding,
  type QualityEvidence,
} from "../src/lib/contribution-quality";
import {
  assertFundingPreparation,
  createFundingReview,
} from "../src/lib/funding-review-data";
import { createPaymentProjectView } from "../src/lib/project-view";
import { childEnvironment } from "./child-environment.mjs";
import { prepareSourceCorrection, sha256 } from "./source-correction";

const archived = JSON.parse(
  gunzipSync(
    readFileSync(
      "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json.gz",
    ),
  ).toString("utf8"),
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
 * removes one in-period base review of a contributor who keeps other events.
 */
function octoberSnapshot(): {
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
  snapshot.paymentReviewBasis = {
    policy: PAYMENT_REVIEW_POLICY,
    effectiveAt: PAYMENT_REVIEW_POLICY_AT,
    leaders: withoutReview,
    ledger: [],
    removedEventIds: [review.id],
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
    qualityPath: path("quality.json"),
  };
}

describe("2026-10 quality evidence follows the payment review ledger", () => {
  const removes = octoberSnapshot();
  const october = preparationFor(removes.snapshot, "2026-10");
  const removed = removes.review;
  const paymentEvents = october.view.ledger.length;

  test("prepare-contribution-quality builds evidence from the payment review ledger", () => {
    const run = prepareQuality("october", "2026-10", october);
    expect(run.status).toBe(0);
    const evidence = JSON.parse(readFileSync(run.qualityPath, "utf8"));
    expect(evidence.events).toHaveLength(paymentEvents);
    expect(
      evidence.events.some((event: { id: string }) => event.id === removed.id),
    ).toBe(false);
  }, 60_000);
});

describe("pre-2026-10 quality evidence keeps the score ledger", () => {
  test("prepare-contribution-quality accepts the archived September cycle", () => {
    const september = preparationFor(archived, "2026-09");
    const run = prepareQuality("september", "2026-09", september);
    expect(run.status).toBe(0);
  }, 60_000);
});

/**
 * Real historical preview inputs derived from the same complete October
 * snapshot/preparation fixture above. Added archive reviews are disposable
 * test facts, not approved historical corrections or a replacement registry.
 */
function correctionFixture(count = 1, duplicate: "source" | "url" | null = null) {
  const { snapshot, review } = octoberSnapshot();
  const prepared = preparationFor(snapshot, "2026-10");
  const evidence: QualityEvidence = {
    schemaVersion: "1",
    projectId: "eliza",
    cycleId: "2026-10",
    sourceSnapshotSha256: sha256(prepared.snapshotBytes),
    closureCensus: {
      method: "repository-created-order-v1",
      sourceSha256: sha256("disposable complete census"),
      observedAt: prepared.view.cycle.to,
      discussionSourceSha256: null,
    },
    events: prepared.view.ledger.map((event) => {
      const thirds = event.scoreThirds ?? Math.round(event.points * 3);
      return {
        id: event.id,
        actorId: event.actor.id,
        url: event.source.url,
        title: event.source.title,
        kind:
          event.category === "merged-pull-request"
            ? "implementation"
            : event.category === "substantive-review"
              ? "review"
              : "evaluation",
        scoreThirds: thirds,
        weight: (
          BigInt(thirds) * BigInt(10000 + (event.evidenceBonusBasisPoints ?? 0))
        ).toString(),
        flags: [],
      };
    }),
    closures: [],
  };
  const archive = structuredClone(snapshot);
  delete archive.paymentReviewBasis;
  const additions: ScoreEvent[] = [];
  for (let index = 0; index < count; index++) {
    const event = structuredClone(review);
    event.id = `${review.id}:correction-fixture-${index}`;
    event.source = {
      ...event.source,
      id: `PRR_correction_fixture_${duplicate === "source" ? 0 : index}`,
      url: `${review.source.url.split("#")[0]}#pullrequestreview-${900000 + (duplicate === "url" ? 0 : index)}`,
    };
    delete event.continuity;
    delete event.reviewHistory;
    archive.ledger.push(event);
    additions.push(event);
    const leader = archive.leaders.find(
      (row) => row.actor.id === event.actor.id,
    );
    if (!leader) throw new Error("Correction fixture actor disappeared");
    leader.scoreThirds += 3;
    leader.score = Math.floor(leader.scoreThirds / 3);
    leader.points.substantiveReviews += 1;
    leader.pointThirds.substantiveReviews += 3;
    leader.acceptedOutcomes.substantiveReviews += 1;
  }
  archive.leaders.sort(compareRankedEntries);
  assignLeaderboardRanks(archive.leaders);
  const archiveBytes = JSON.stringify(archive);
  const recovered = additions.map((event) => ({
    ...event,
    continuity: {
      sourceSnapshotSha256: sha256(archiveBytes),
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/123",
    },
  }));
  const historyBytes = JSON.stringify({ events: recovered });
  const input = {
    preparationBytes: prepared.preparationBytes,
    snapshotBytes: prepared.snapshotBytes,
    auditBytes: "audit-bytes",
    archiveBytes,
    historyBytes,
    qualityBytes: JSON.stringify(evidence),
    request: {
      schemaVersion: "1",
      kind: "historical-review-correction-request",
      projectId: "eliza",
      cycleId: "2026-10",
      predecessorPreparationSha256: sha256(prepared.preparationBytes),
      archiveSha256: sha256(archiveBytes),
      historySha256: sha256(historyBytes),
      eventIds: recovered.map((event) => event.id),
      reason: "Restore the independently reviewed archived source in a preview only.",
    },
    proposals: [] as unknown[],
  };
  return { input, evidence, recovered, removed: review };
}

async function correctionProposal(fixture: ReturnType<typeof correctionFixture>) {
  const review = createFundingReview(
    assertFundingPreparation(JSON.parse(fixture.input.preparationBytes)),
  );
  return {
    schemaVersion: "1",
    kind: "contribution-quality-proposal",
    projectId: "eliza",
    cycleId: "2026-10",
    sourceSnapshotSha256: sha256(fixture.input.snapshotBytes),
    sourceQualityBinding: await qualityEvidenceBinding(fixture.evidence),
    capMinor: review.capMinor,
    paymentAuthorized: false,
    decisions: [],
    burdens: [],
  };
}

describe("historical source correction remains a source-bound preview", () => {
  test("two recovered reviews preserve frozen inputs, the pool and unratified quality", async () => {
    const fixture = correctionFixture(2);
    fixture.input.proposals = [await correctionProposal(fixture)];
    const before = structuredClone(fixture.input);
    const result = await prepareSourceCorrection(fixture.input);
    expect(fixture.input).toEqual(before);
    expect(result.kind).toBe("historical-review-correction-preview");
    expect(result.paymentAuthorized).toBe(false);
    expect(result.activePreparationChanged).toBe(false);
    expect(result.approval).toBe("pending");
    expect(result.addedScoreThirds).toBe(6);
    expect(result.recoveredEvents.map((event) => event.id)).toEqual(
      fixture.recovered.map((event) => event.id).sort(),
    );
    expect(
      result.rows.reduce((sum, row) => sum + BigInt(row.proposedMinor), 0n),
    ).toBe(BigInt(result.capMinor));
    expect(
      result.rows.reduce((sum, row) => sum + BigInt(row.deltaMinor), 0n),
    ).toBe(0n);
    expect(result.qualityPreviews[0].unresolvedEvents).toBe(
      fixture.evidence.events.length + 2,
    );
    expect(result.qualityPreviews[0].correctionSha256).toBe(
      result.correctionSha256,
    );
    expect(result.qualityPreviews[0].paymentAuthorized).toBe(false);
  });

  test("an event excluded from the payment basis is still credited in the raw ledger", async () => {
    const fixture = correctionFixture();
    const event = {
      ...fixture.removed,
      continuity: {
        sourceSnapshotSha256: sha256(fixture.input.archiveBytes),
        decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/123",
      },
    };
    fixture.input.historyBytes = JSON.stringify({ events: [event] });
    fixture.input.request.historySha256 = sha256(fixture.input.historyBytes);
    fixture.input.request.eventIds = [event.id];
    await expect(prepareSourceCorrection(fixture.input)).rejects.toThrow(
      "Source already credited or correction replayed",
    );
  });

  test.each(["source", "url"] as const)(
    "a second recovered %s collision refuses the entire preview",
    async (kind) => {
      const fixture = correctionFixture(2, kind);
      const before = structuredClone(fixture.input);
      await expect(prepareSourceCorrection(fixture.input)).rejects.toThrow(
        "Source already credited or correction replayed",
      );
      expect(fixture.input).toEqual(before);
    },
  );

  test("changed archived bytes and incorrect input digests cannot produce a preview", async () => {
    const fixture = correctionFixture();
    const events = structuredClone(fixture.recovered);
    events[0].source.title += " changed after archival";
    fixture.input.historyBytes = JSON.stringify({ events });
    fixture.input.request.historySha256 = sha256(fixture.input.historyBytes);
    await expect(prepareSourceCorrection(fixture.input)).rejects.toThrow(
      "Recovered event changed from archive",
    );
    fixture.input.request.archiveSha256 = "0".repeat(64);
    await expect(prepareSourceCorrection(fixture.input)).rejects.toThrow(
      "Correction input digest mismatch",
    );
  });

  test("quality proposals must bind the original source and cannot pre-review recovered events", async () => {
    const fixture = correctionFixture();
    const proposal = await correctionProposal(fixture);
    fixture.input.proposals = [
      { ...proposal, sourceQualityBinding: "quality-evidence-v2:stale" },
    ];
    await expect(prepareSourceCorrection(fixture.input)).rejects.toThrow(
      "Quality proposal has wrong source or budget",
    );
    fixture.input.proposals = [
      {
        ...proposal,
        decisions: [
          {
            eventIds: [fixture.recovered[0].id],
            tier: "small",
            reason: "This decision was not part of the original evidence.",
            evidenceUrls: [fixture.recovered[0].source.url],
          },
        ],
      },
    ];
    await expect(prepareSourceCorrection(fixture.input)).rejects.toThrow(
      "Unknown event or an outcome counted twice",
    );
  });

  test("the CLI refuses a published cycle and never overwrites an existing preview", () => {
    const fixture = correctionFixture();
    const cwd = mkdtempSync(join(dir, "correction-cli-"));
    const entries = [
      fixture.input.preparationBytes,
      fixture.input.snapshotBytes,
      fixture.input.auditBytes,
      fixture.input.archiveBytes,
      fixture.input.historyBytes,
      fixture.input.qualityBytes,
      JSON.stringify(fixture.input.request),
    ];
    const paths = entries.map((bytes, index) => {
      const path = join(cwd, `input-${index}.json`);
      writeFileSync(path, bytes);
      return path;
    });
    const output = join(cwd, "preview.json");
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "--no-env-file",
          "--preload",
          resolve("tests/registry-preload.ts"),
          resolve("scripts/prepare-source-correction.ts"),
          ...paths,
          output,
        ],
        {
          cwd,
          encoding: "utf8",
          timeout: 60_000,
          env: childEnvironment(process.env, { TMPDIR: cwd }),
        },
      );
    writeFileSync(output, "retained earlier output\n");
    const exists = run();
    expect(exists.status).not.toBe(0);
    expect(exists.stderr).toContain("EEXIST");
    expect(readFileSync(output, "utf8")).toBe("retained earlier output\n");
    mkdirSync(join(cwd, "cycles/eliza/2026-10"), { recursive: true });
    const published = run();
    expect(published.status).not.toBe(0);
    expect(published.stderr).toContain(
      "A published cycle requires a separately reviewed revision contract",
    );
    expect(readFileSync(output, "utf8")).toBe("retained earlier output\n");
  }, 60_000);
});
