/**
 * The historical-review correction preview binds the recovered events
 * into `correctionSha256`, a SHA-256 over the sorted recovered event
 * IDs. Event IDs embed GitHub pull-request node IDs, which are opaque
 * and mixed-case; a host-default localeCompare can reverse i/I pairs
 * (Turkish), so the same correction produced a different digest — and
 * a different recovered-event order — on different hosts. The sort is
 * pinned to English collation, like the leaderboard pins.
 */
import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  assignLeaderboardRanks,
  compareRankedEntries,
  type LeaderboardSnapshot,
  type ScoreEvent,
} from "../src/lib/leaderboard";
import { createPaymentProjectView } from "../src/lib/project-view";
import { prepareSourceCorrection, sha256 } from "./source-correction";

const archived = JSON.parse(
  gunzipSync(
    readFileSync(
      "tests/fixtures/history/cycles/eliza/2026-09/source-snapshot.json.gz",
    ),
  ).toString("utf8"),
) as LeaderboardSnapshot;

// Adjacent PR IDs in the production snapshot published 2026-10-30.
// Turkish default collation reverses this order because it treats I
// and i differently.
const ids = ["PR_kwDOMT5cIs8AAAABG3i2Yg", "PR_kwDOMT5cIs8AAAABG3IwgQ"];

function recoveredEvents(): ScoreEvent[] {
  const templates = [
    archived.ledger.find(
      (event) =>
        event.repository === "elizaOS/eliza" &&
        event.category === "substantive-review" &&
        event.actor.id === "U_kgDODBAqOQ",
    ),
    archived.ledger.find(
      (event) =>
        event.repository === "elizaOS/eliza" &&
        event.category === "substantive-review" &&
        event.actor.id === "U_kgDOEOd4mA",
    ),
  ];
  return templates.map((template, index) => {
    const source = template as ScoreEvent;
    const sourceId = `PRR_kwDOMT5cIs8AAAABRepro${index + 1}AA`;
    return {
      ...source,
      id: `${ids[index]}:reviewer:${source.actor.id}`,
      source: {
        ...source.source,
        id: sourceId,
        url: `https://github.com/elizaOS/eliza/pull/${source.source.number}#pullrequestreview-600000000${index + 1}`,
      },
      workUnitId: `wu_eliza_${sourceId.toLowerCase().replace(/[^a-z0-9_-]+/gu, "_")}`,
    } as ScoreEvent;
  });
}

function archiveSnapshot(events: ScoreEvent[]): LeaderboardSnapshot {
  const archive = structuredClone(archived);
  archive.ledger.push(...structuredClone(events));
  for (const event of events) {
    const leader = archive.leaders.find(
      (entry) => entry.actor.id === event.actor.id,
    );
    if (!leader) throw new Error("recovered actor is not a leader");
    leader.pointThirds.substantiveReviews += 3;
    leader.points.substantiveReviews += 1;
    leader.acceptedOutcomes.substantiveReviews += 1;
    leader.scoreThirds += 3;
    leader.score = Math.floor(leader.scoreThirds / 3);
  }
  archive.leaders.sort(compareRankedEntries);
  assignLeaderboardRanks(
    archive.leaders as { rank: number; scoreThirds: number }[],
  );
  return archive;
}

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
  const preparation = {
    projectId: "eliza",
    cycleId,
    sourceSnapshotSha256: sha256(snapshotBytes),
    sourceAuditSha256: sha256("audit-bytes"),
    observedAt: view.cycle.to,
    provenance: {
      ruleVersion: snapshot.ruleVersion,
      walletObservationsSha256: sha256("wallets"),
      snapshotFrom: snapshot.window.from,
      snapshotTo: snapshot.window.to,
      periodFrom: view.cycle.from,
      periodTo: view.cycle.to,
      snapshotLedgerCount: snapshot.ledger.length,
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
  return { view, snapshotBytes, preparationBytes: JSON.stringify(preparation) };
}

async function runCorrection() {
  const events = recoveredEvents();
  const archiveBytes = JSON.stringify(archiveSnapshot(events));
  const archiveSha256 = sha256(archiveBytes);
  const { view, snapshotBytes, preparationBytes } = preparationFor(
    archived,
    "2026-09",
  );
  const historyBytes = JSON.stringify({
    events: events.map((event) => ({
      ...event,
      continuity: {
        decisionUrl: "https://github.com/SlopDotCash/slopdotcash/issues/123",
        sourceSnapshotSha256: archiveSha256,
      },
    })),
  });
  const quality = {
    schemaVersion: "1",
    projectId: "eliza",
    cycleId: "2026-09",
    sourceSnapshotSha256: sha256(snapshotBytes),
    closureCensus: {
      method: "repository-created-order-v1",
      sourceSha256: sha256("census"),
      observedAt: view.cycle.to,
      discussionSourceSha256: null,
    },
    events: view.ledger.map((event) => {
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
  return prepareSourceCorrection({
    preparationBytes,
    snapshotBytes,
    auditBytes: "audit-bytes",
    archiveBytes,
    historyBytes,
    qualityBytes: JSON.stringify(quality),
    request: {
      schemaVersion: "1",
      kind: "historical-review-correction-request",
      projectId: "eliza",
      cycleId: "2026-09",
      predecessorPreparationSha256: sha256(preparationBytes),
      archiveSha256,
      historySha256: sha256(historyBytes),
      eventIds: events.map((event) => event.id),
      reason: "Recover two retained reviews omitted from the September ledger.",
    },
    proposals: [],
  });
}

test("Turkish generation keeps the same correction digest and recovered order", async () => {
  const english = await runCorrection();
  expect(english.recoveredEvents.map((event) => event.id)).toEqual([
    `${ids[0]}:reviewer:U_kgDODBAqOQ`,
    `${ids[1]}:reviewer:U_kgDOEOd4mA`,
  ]);
  const originalCompare = String.prototype.localeCompare;
  const compare = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return originalCompare.call(this, other, locales ?? "tr", options);
    },
  );
  try {
    const turkish = await runCorrection();
    expect(turkish.correctionSha256).toBe(english.correctionSha256);
    expect(turkish.recoveredEvents.map((event) => event.id)).toEqual(
      english.recoveredEvents.map((event) => event.id),
    );
  } finally {
    compare.mockRestore();
  }
});
