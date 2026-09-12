import { describe, expect, it } from "vitest";
import { prepareSourceCorrection, sha256 } from "../scripts/source-correction";
import { qualityEvidenceBinding } from "../src/lib/contribution-quality";
import {
  createLeaderboardSnapshot,
  type ScoreEvent,
} from "../src/lib/leaderboard";
import { snapshotFixture } from "./fixtures";

async function fixture() {
  const from = "2026-07-28T00:00:00.000Z",
    to = "2026-09-01T00:00:00.000Z";
  const actor = {
    id: "U_fixture",
    login: "reviewer",
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    url: "https://github.com/reviewer",
    kind: "User" as const,
  };
  const event = (n: number): ScoreEvent => ({
    id: `PR_${n}:reviewer:U_fixture`,
    actor,
    category: "substantive-review",
    points: 1,
    scoreThirds: 3,
    workUnitId: `wu_eliza_review_${n}`,
    continuity: {
      sourceSnapshotSha256: "c".repeat(64),
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/313",
    },
    occurredAt: "2026-08-20T00:00:00.000Z",
    repository: "elizaOS/eliza",
    source: {
      id: `PRR_${n}`,
      kind: "review",
      number: n,
      title: `Review ${n}`,
      url: `https://github.com/elizaOS/eliza/pull/${n}#pullrequestreview-${n}`,
    },
    reason: "Previously accepted substantive review.",
  });
  const make = (events: ScoreEvent[]) =>
    createLeaderboardSnapshot({
      generatedAt: to,
      windowFrom: from,
      windowTo: to,
      sourceUpdatedAt: to,
      source: {
        ...snapshotFixture().source,
        fetchedAt: to,
        cutoffAt: to,
        verificationWindow: { days: 35, from, to },
        counts: {
          mergedPullRequests: 0,
          detailedMergedPullRequests: 0,
          closedIssues: 0,
          detailedClosedIssues: 0,
          resolvedIssues: 0,
          openIssues: 0,
          openPullRequests: 0,
        },
      },
      mergedPullRequestOutcomes: [],
      mergedPullRequests: [],
      detailEligibleMergedPullRequestIds: [],
      closedIssueCount: 0,
      resolvedIssues: [],
      openIssues: [],
      openPullRequests: [],
      verificationWindowFrom: from,
      verifiedEvidence: [],
      retainedReviewEvents: events,
    });
  const original = make([event(1)]),
    archive = make([event(1), event(2)]);
  const snapshotBytes = JSON.stringify(original),
    archiveBytes = JSON.stringify(archive),
    auditBytes = "{}";
  const source = archive.ledger.find((row) => row.source.number === 2);
  if (!source) throw new Error("Missing fixture source");
  const recovered = {
    ...source,
    evidenceBonusBasisPoints: 0,
    continuity: {
      sourceSnapshotSha256: sha256(archiveBytes),
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/313",
    },
  };
  const historyBytes = JSON.stringify({ events: [recovered] });
  const e = original.ledger[0];
  const preparation = {
    projectId: "eliza",
    cycleId: "2026-08",
    sourceSnapshotSha256: sha256(snapshotBytes),
    sourceAuditSha256: sha256(auditBytes),
    observedAt: to,
    provenance: {
      ruleVersion: "slop-score-v2",
      walletObservationsSha256: "a".repeat(64),
      snapshotFrom: from,
      snapshotTo: to,
      periodFrom: "2026-08-01T00:00:00.000Z",
      periodTo: to,
      snapshotLedgerCount: 1,
      sourceMergedPullRequests: 0,
      mergedCensus: 0,
      scoredMerges: 0,
    },
    counts: { contributors: 1, events: 1, scoreThirds: "3", weight: "30000" },
    contributors: [
      {
        actor: { id: actor.id, login: actor.login },
        scoreThirds: "3",
        weight: "30000",
        eventCount: 1,
        eventIdsSha256: sha256(JSON.stringify([e.id])),
        wallet: null,
        lookupUnavailable: false,
      },
    ],
  };
  const evidence = {
    schemaVersion: "1" as const,
    projectId: "eliza",
    cycleId: "2026-08",
    sourceSnapshotSha256: sha256(snapshotBytes),
    closureCensus: {
      method: "repository-created-order-v1" as const,
      sourceSha256: "b".repeat(64),
      observedAt: to,
      discussionSourceSha256: null,
    },
    events: [
      {
        id: e.id,
        actorId: actor.id,
        url: e.source.url,
        title: e.source.title,
        kind: "review" as const,
        scoreThirds: 3,
        weight: "30000",
        flags: [],
      },
    ],
    closures: [],
  };
  const preparationBytes = JSON.stringify(preparation),
    qualityBytes = JSON.stringify(evidence);
  const request = {
    schemaVersion: "1",
    kind: "historical-review-correction-request",
    projectId: "eliza",
    cycleId: "2026-08",
    predecessorPreparationSha256: sha256(preparationBytes),
    archiveSha256: sha256(archiveBytes),
    historySha256: sha256(historyBytes),
    eventIds: [recovered.id],
    reason:
      "Recover this exact historical accepted review without changing previous records.",
  };
  const proposals = [
    {
      schemaVersion: "1",
      kind: "contribution-quality-proposal",
      projectId: "eliza",
      cycleId: "2026-08",
      sourceSnapshotSha256: sha256(snapshotBytes),
      sourceQualityBinding: await qualityEvidenceBinding(evidence),
      capMinor: "10000000000",
      decisions: [],
      burdens: [],
      paymentAuthorized: false,
    },
  ];
  return {
    preparationBytes,
    snapshotBytes,
    auditBytes,
    archiveBytes,
    historyBytes,
    qualityBytes,
    request,
    proposals,
  };
}
describe("historical source correction previews", () => {
  it("preserves original rows, includes recovered reviews in uncertainty, and conserves the cap", async () => {
    const input = await fixture();
    const before = JSON.stringify(input);
    const result = await prepareSourceCorrection(input);
    expect(result.proposedEvents).toBe(2);
    expect(result.rows[0].proposedScoreThirds).toBe("6");
    expect(result.rows[0].proposedMinor).toBe("10000000000");
    expect(result.rows[0].deltaMinor).toBe("0");
    expect(result.qualityPreviews[0].unresolvedEvents).toBe(2);
    expect(result.paymentAuthorized).toBe(false);
    expect(result.activePreparationChanged).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("rejects modified predecessor bytes", async () => {
    const x = await fixture();
    x.preparationBytes += " ";
    await expect(prepareSourceCorrection(x)).rejects.toThrow("digest mismatch");
  });
  it("rejects duplicate requested IDs", async () => {
    const x = await fixture();
    x.request.eventIds.push(x.request.eventIds[0]);
    await expect(prepareSourceCorrection(x)).rejects.toThrow("distinct");
  });
  it("rejects changed historical review and inferred bonus even when history hash is updated", async () => {
    for (const mutation of [
      { reason: "Invented reason" },
      { evidenceBonusBasisPoints: 1000 },
    ]) {
      const x = await fixture();
      const h = JSON.parse(x.historyBytes);
      Object.assign(h.events[0], mutation);
      x.historyBytes = JSON.stringify(h);
      x.request.historySha256 = sha256(x.historyBytes);
      await expect(prepareSourceCorrection(x)).rejects.toThrow();
    }
  });
  it("rejects stale quality proposal and refuses approval claims", async () => {
    for (const mutation of [
      { sourceQualityBinding: "stale" },
      { paymentAuthorized: true },
    ]) {
      const x = await fixture();
      Object.assign(x.proposals[0], mutation);
      await expect(prepareSourceCorrection(x)).rejects.toThrow("wrong source");
    }
  });
  it("rejects altered quality metadata despite matching actor totals and IDs", async () => {
    const x = await fixture();
    const q = JSON.parse(x.qualityBytes);
    q.events[0].url =
      "https://github.com/elizaOS/eliza/pull/999#pullrequestreview-999";
    x.qualityBytes = JSON.stringify(q);
    await expect(prepareSourceCorrection(x)).rejects.toThrow(
      "metadata differs",
    );
  });
  it("rejects replay of an already credited source", async () => {
    const x = await fixture();
    const archive = JSON.parse(x.archiveBytes);
    const existing = archive.ledger.find(
      (event: ScoreEvent) => event.source.number === 1,
    );
    existing.continuity = {
      sourceSnapshotSha256: sha256(x.archiveBytes),
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/313",
    };
    x.historyBytes = JSON.stringify({ events: [existing] });
    x.request.historySha256 = sha256(x.historyBytes);
    x.request.eventIds = [existing.id];
    await expect(prepareSourceCorrection(x)).rejects.toThrow(
      "already credited",
    );
  });
  it("rejects a request for another cycle and missing recovered IDs", async () => {
    const x = await fixture();
    x.request.cycleId = "2026-07";
    await expect(prepareSourceCorrection(x)).rejects.toThrow(
      "Wrong correction cycle",
    );
    x.request.cycleId = "2026-08";
    x.request.eventIds = ["missing"];
    await expect(prepareSourceCorrection(x)).rejects.toThrow(
      "Missing or repeated",
    );
  });
});
