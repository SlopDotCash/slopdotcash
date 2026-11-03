/**
 * Regression: allocateQualityWeights and allocateFundingReview must pin
 * largest-remainder actor tie-breaks to English so leftover micros do not
 * flip under Turkish vs English host locales. Distinct from #2151
 * (reward-cycle.ts only).
 *
 * Pinning localeCompare alone is not enough: operands built with unpinned
 * toLowerCase() flip on a Turkish host ("I" -> "ı"), so case-folding must
 * also use toLocaleLowerCase("en").
 */
import { expect, spyOn, test } from "bun:test";
import { allocateQualityWeights } from "../src/lib/contribution-quality";
import {
  createFundingReview,
  type FundingPreparation,
} from "../src/lib/funding-review-data";

function withTurkishLocale<T>(run: () => T): T {
  const originalCompare = String.prototype.localeCompare;
  const originalLocaleLower = String.prototype.toLocaleLowerCase;
  const locale = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return originalCompare.call(this, other, locales ?? "tr", options);
    },
  );
  const lower = spyOn(String.prototype, "toLowerCase").mockImplementation(
    function (this: string) {
      return originalLocaleLower.call(this, "tr");
    },
  );
  const localeLower = spyOn(
    String.prototype,
    "toLocaleLowerCase",
  ).mockImplementation(function (this: string, locales?: Intl.LocalesArgument) {
    // Keep an explicit "en" pin; default / other locales fold as Turkish.
    if (locales === "en" || locales === "en-US") {
      return originalLocaleLower.call(this, "en");
    }
    return originalLocaleLower.call(this, locales ?? "tr");
  });
  try {
    return run();
  } finally {
    locale.mockRestore();
    lower.mockRestore();
    localeLower.mockRestore();
  }
}

/** Ignore Biome wrapping so a pinned comparator still matches as source. */
function compactSource(source: string): string {
  return source.replace(/\s+/g, "");
}

// "I" vs "ii": English host folds "I"->"i" and sorts before "ii";
// Turkish host folds "I"->"ı" which sorts after "i", flipping the remainder.
const weights = new Map([
  ["MDQ6VXNlcjEwMA==", 1n],
  ["MDQ6VXNlcjEwMQ==", 1n],
]);
const logins = new Map([
  ["MDQ6VXNlcjEwMA==", "I"],
  ["MDQ6VXNlcjEwMQ==", "ii"],
]);

const HASH = "a".repeat(64);

/**
 * Three equal weights against slopdotcash's 1000000000 cap (1 mod 3) leave
 * one micro. "z" sorts after both logins, so the micro is the I-vs-ii tie.
 */
function tieBreakPreparation(): FundingPreparation {
  const contributor = (id: string, login: string) => ({
    actor: { id, login },
    scoreThirds: "1",
    weight: "1",
    eventCount: 1,
    eventIdsSha256: HASH,
    wallet: null,
    lookupUnavailable: false,
  });
  return {
    projectId: "slopdotcash",
    cycleId: "2026-11",
    sourceSnapshotSha256: HASH,
    sourceAuditSha256: null,
    observedAt: "2026-12-02T00:00:00.000Z",
    provenance: {
      ruleVersion: "slop-score-v1",
      walletObservationsSha256: HASH,
      snapshotFrom: "2026-10-11T00:00:00.000Z",
      snapshotTo: "2026-12-02T00:00:00.000Z",
      periodFrom: "2026-11-01T00:00:00.000Z",
      periodTo: "2026-12-01T00:00:00.000Z",
      snapshotLedgerCount: 3,
      sourceMergedPullRequests: 3,
      mergedCensus: null,
      derivation: "snapshot-derived",
      evidenceUrl: "https://github.com/SlopDotCash/slopdotcash/actions/runs/1",
      evidenceArtifact: "funding-preparation-locale-tie",
      scoredMerges: 3,
    },
    counts: {
      contributors: 3,
      events: 3,
      scoreThirds: "3",
      weight: "3",
    },
    contributors: [
      contributor("MDQ6VXNlcjEwMA==", "I"),
      contributor("MDQ6VXNlcjEwMQ==", "ii"),
      contributor("MDQ6VXNlcjEwMg==", "z"),
    ],
  };
}

function simulatedByLogin(
  preparation: FundingPreparation,
): Map<string, string> {
  const review = createFundingReview(preparation);
  return new Map(
    review.contributors.map((row) => [
      row.actor.login,
      row.simulatedMinor ?? "",
    ]),
  );
}

test("quality and funding-review remainder sorts pin case-fold and collation to English", async () => {
  const q = compactSource(
    await Bun.file("src/lib/contribution-quality.ts").text(),
  );
  const f = compactSource(
    await Bun.file("src/lib/funding-review-data.ts").text(),
  );
  expect(q).toContain(
    'left.toLocaleLowerCase("en").localeCompare(right.toLocaleLowerCase("en"),"en")',
  );
  expect(q).toContain('left.localeCompare(right,"en")');
  expect(f).toContain('.toLocaleLowerCase("en")');
  expect(f).toContain(
    'localeCompare(b.r.actor.login.toLocaleLowerCase("en"),"en")',
  );
  expect(f).toContain('localeCompare(b.r.actor.login,"en")');
});

test("allocateQualityWeights leftover micro is stable under Turkish default locale", () => {
  const en = allocateQualityWeights(weights, "3", logins);
  expect([...en.values()].map(BigInt).reduce((a, b) => a + b, 0n)).toBe(3n);
  const tr = withTurkishLocale(() =>
    allocateQualityWeights(weights, "3", logins),
  );
  expect(tr.get("MDQ6VXNlcjEwMA==")).toBe(en.get("MDQ6VXNlcjEwMA=="));
  expect(tr.get("MDQ6VXNlcjEwMQ==")).toBe(en.get("MDQ6VXNlcjEwMQ=="));
});

test("createFundingReview leftover micro is stable under Turkish default locale", () => {
  const en = simulatedByLogin(tieBreakPreparation());
  const paid = [...en.values()].reduce(
    (sum, amount) => sum + BigInt(amount),
    0n,
  );
  expect(paid).toBe(1000000000n);
  // English order awards the single leftover micro to "I", before "ii".
  expect(BigInt(en.get("I") ?? "0")).toBe(BigInt(en.get("ii") ?? "0") + 1n);
  const tr = withTurkishLocale(() => simulatedByLogin(tieBreakPreparation()));
  expect(tr.get("I")).toBe(en.get("I"));
  expect(tr.get("ii")).toBe(en.get("ii"));
  expect(tr.get("z")).toBe(en.get("z"));
});

test("I vs ii fixture flips under Turkish case-fold without the en pin", () => {
  // Sanity: the fixture itself is locale-sensitive when case-fold is unpinned.
  const enLeft = "I".toLocaleLowerCase("en");
  const enRight = "ii".toLocaleLowerCase("en");
  const trLeft = "I".toLocaleLowerCase("tr");
  const trRight = "ii".toLocaleLowerCase("tr");
  expect(enLeft.localeCompare(enRight, "en")).not.toBe(
    trLeft.localeCompare(trRight, "en"),
  );
});
