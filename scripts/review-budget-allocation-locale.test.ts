/**
 * The review-line allocator (allocateReviewBudgetMinor, PRD section 6 and
 * review-budget-v1) splits a committed review budget into integer base units by
 * largest remainder. Equal remainders must follow the canonical actor-ID tie
 * break, which compareActors and the funding-review allocator already pin to
 * English collation so "a tied remainder lands on the same contributor" on
 * every host.
 *
 * Two contributors whose immutable IDs differ only by an "i"/"I" collate in the
 * opposite order under a Turkish host locale than under English. With equal
 * weights and a single leftover base unit, a locale-dependent tie break would
 * pay that unit to a different contributor depending on the host, which this
 * test forbids.
 */
import { expect, spyOn, test } from "bun:test";
import { allocateReviewBudgetMinor } from "../src/lib/reward-cycle";

const contributors = [
  { actorId: "U_kgDOreviewi", scoreThirds: 1 },
  { actorId: "U_kgDOreviewI", scoreThirds: 1 },
];

function allocate(): Record<string, string> {
  return Object.fromEntries(
    [...allocateReviewBudgetMinor(1n, contributors)].map(([id, amount]) => [
      id,
      amount.toString(),
    ]),
  );
}

test("a tied review-budget remainder keeps its recipient when the host locale is Turkish", () => {
  const english = allocate();
  // English collation sorts "i" before "I", so the leftover unit goes to "...i".
  expect(english).toEqual({ U_kgDOreviewi: "1", U_kgDOreviewI: "0" });
  const originalCompare = String.prototype.localeCompare;
  const compare = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      // An unpinned comparison follows the host locale, here Turkish.
      return originalCompare.call(this, other, locales ?? "tr", options);
    },
  );
  let turkish: Record<string, string>;
  try {
    turkish = allocate();
  } finally {
    compare.mockRestore();
  }
  expect(turkish).toEqual(english);
  // Exactly one leftover base unit is distributed, to a single contributor.
  expect(Object.values(english).sort()).toEqual(["0", "1"]);
});
