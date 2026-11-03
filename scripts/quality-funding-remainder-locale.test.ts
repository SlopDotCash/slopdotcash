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

function withTurkishLocale<T>(run: () => T): T {
  const originalCompare = String.prototype.localeCompare;
  const originalLower = String.prototype.toLowerCase;
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
  ).mockImplementation(function (
    this: string,
    locales?: Intl.LocalesArgument,
  ) {
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

test("quality and funding-review remainder sorts pin case-fold and collation to English", async () => {
  const q = await Bun.file("src/lib/contribution-quality.ts").text();
  const f = await Bun.file("src/lib/funding-review-data.ts").text();
  expect(q).toContain(
    'left.toLocaleLowerCase("en").localeCompare(right.toLocaleLowerCase("en"), "en")',
  );
  expect(q).toContain('left.localeCompare(right, "en")');
  expect(f).toContain('.toLocaleLowerCase("en")');
  expect(f).toContain(
    'localeCompare(b.r.actor.login.toLocaleLowerCase("en"), "en")',
  );
  expect(f).toContain('localeCompare(b.r.actor.login, "en")');
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
