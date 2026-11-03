/**
 * Regression: allocateQualityWeights and allocateFundingReview must pin
 * largest-remainder actor tie-breaks to English so leftover micros do not
 * flip under Turkish vs English host locales. Distinct from #2151
 * (reward-cycle.ts only).
 */
import { expect, spyOn, test } from "bun:test";
import { allocateQualityWeights } from "../src/lib/contribution-quality";

function withTurkishLocale<T>(run: () => T): T {
  const original = String.prototype.localeCompare;
  const locale = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return original.call(this, other, locales ?? "tr", options);
    },
  );
  try {
    return run();
  } finally {
    locale.mockRestore();
  }
}

const weights = new Map([
  ["MDQ6VXNlcjEwMA==", 1n],
  ["MDQ6VXNlcjEwMQ==", 1n],
]);
const logins = new Map([
  ["MDQ6VXNlcjEwMA==", "Ivan"],
  ["MDQ6VXNlcjEwMQ==", "ivan"],
]);

test("quality and funding-review remainder sorts pin collation to English", async () => {
  const q = await Bun.file("src/lib/contribution-quality.ts").text();
  const f = await Bun.file("src/lib/funding-review-data.ts").text();
  expect(q).toContain('localeCompare(right.toLowerCase(), "en")');
  expect(q).toContain('left.localeCompare(right, "en")');
  expect(f).toContain('localeCompare(b.r.actor.login.toLowerCase(), "en")');
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
