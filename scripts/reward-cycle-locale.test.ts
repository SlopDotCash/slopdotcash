import { expect, spyOn, test } from "bun:test";
import { allocateReviewBudgetMinor } from "../src/lib/reward-cycle";

function withTurkishLocale(run: () => void) {
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
    run();
  } finally {
    locale.mockRestore();
  }
}

// The production i/I pair from the published 2026-10-30 snapshot, already
// used by scripts/leaderboard-locale.test.ts for this collation class.
// Equal weights leave equal remainders, so the actor-ID tie-break decides
// which contributor receives the one unallocated minor unit.
const ids = ["PR_kwDOMT5cIs8AAAABG3i2Yg", "PR_kwDOMT5cIs8AAAABG3IwgQ"];

function tiedAllocation() {
  return allocateReviewBudgetMinor(3n, [
    { actorId: ids[0], scoreThirds: 1 },
    { actorId: ids[1], scoreThirds: 1 },
  ]);
}

test("the remainder tie-break gives the extra unit to the same contributor under a Turkish default locale", () => {
  withTurkishLocale(() => {
    const allocations = tiedAllocation();
    expect(allocations.get(ids[0])).toBe(2n);
    expect(allocations.get(ids[1])).toBe(1n);
  });
});

test("the remainder tie-break matches the English order by default", () => {
  const allocations = tiedAllocation();
  expect(allocations.get(ids[0])).toBe(2n);
  expect(allocations.get(ids[1])).toBe(1n);
});

test("distinct remainders keep their allocation under a Turkish default locale", () => {
  withTurkishLocale(() => {
    const allocations = allocateReviewBudgetMinor(5n, [
      { actorId: ids[0], scoreThirds: 1 },
      { actorId: ids[1], scoreThirds: 2 },
    ]);
    expect(allocations.get(ids[0])).toBe(2n);
    expect(allocations.get(ids[1])).toBe(3n);
  });
});
