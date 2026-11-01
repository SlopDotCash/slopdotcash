/**
 * Funding-review amounts are preparation data for monthly-pool simulated
 * minor units and external prize shares (createFundingReview). Equal
 * remainders follow the canonical actor tie break, as the allocator's own
 * doc comment states. A host locale that case-folds "I" to "ı" must award
 * the same leftover unit to the same contributor.
 *
 * Fixture: project "delta-star" (external-prize-share, feeBasisPoints 1000)
 * from the frozen fixture registry loaded by tests/registry-preload.ts
 * (bunfig.toml preload), so the allocation total is exactly
 * 1_000_000 - 1000*100 = 900_000 parts per million. Weights 15 and 49
 * (sum 64) give both contributors remainder 32 and exactly one leftover
 * unit: 900000*15/64 = 210937 r32; 900000*49/64 = 689062 r32. The single
 * leftover unit therefore goes entirely to whichever tied contributor the
 * login tie break ranks first.
 */
import { expect, spyOn, test } from "bun:test";
import { createFundingReview } from "../src/lib/funding-review-data";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function preparation() {
  return {
    projectId: "delta-star",
    cycleId: "2026-08",
    sourceSnapshotSha256: HASH_A,
    sourceAuditSha256: HASH_B,
    observedAt: "2026-09-02T00:00:00.000Z",
    provenance: {
      ruleVersion: "probe-1",
      walletObservationsSha256: HASH_C,
      snapshotFrom: "2026-07-01T00:00:00.000Z",
      snapshotTo: "2026-09-02T00:00:00.000Z",
      periodFrom: "2026-08-01T00:00:00.000Z",
      periodTo: "2026-09-01T00:00:00.000Z",
      snapshotLedgerCount: 2,
      sourceMergedPullRequests: 2,
      mergedCensus: 2,
      scoredMerges: 2,
    },
    counts: { contributors: 2, events: 2, scoreThirds: "2", weight: "64" },
    contributors: [
      {
        actor: { id: "node-upper", login: "Idea" },
        scoreThirds: "1",
        weight: "15",
        eventCount: 1,
        eventIdsSha256: HASH_A,
        wallet: null,
        lookupUnavailable: false,
      },
      {
        actor: { id: "node-lower", login: "idea" },
        scoreThirds: "1",
        weight: "49",
        eventCount: 1,
        eventIdsSha256: HASH_B,
        wallet: null,
        lookupUnavailable: false,
      },
    ],
  };
}

function allocate() {
  const review = createFundingReview(preparation() as never);
  return Object.fromEntries(
    review.contributors.map((row) => [
      row.actor.id,
      row.externalSharePartsPerMillion,
    ]),
  );
}

test("a tied funding-review remainder keeps its recipient when the host locale is Turkish", () => {
  const english = allocate();
  const originalCompare = String.prototype.localeCompare;
  const lower = spyOn(String.prototype, "toLowerCase").mockImplementation(
    function (this: string) {
      return this.toLocaleLowerCase("tr");
    },
  );
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
    // English ordering gives the tied unit to "idea" (node-lower).
    expect(english).toEqual({ "node-upper": "210937", "node-lower": "689063" });
    expect(allocate()).toEqual(english);
    expect(
      Object.values(allocate()).reduce((s, v) => s + BigInt(v ?? "0"), 0n),
    ).toBe(900000n);
  } finally {
    lower.mockRestore();
    compare.mockRestore();
  }
});
