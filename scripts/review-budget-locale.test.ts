/**
 * The additive review budget is real money: a project with a committed review
 * line splits that budget by review weight with largest remainder. Its extra
 * base units follow the actor-ID tie order. GitHub node IDs are mixed-case
 * base64, so a host locale that case-folds "I" to "Ä±" (Turkish) reverses an
 * i/I pair and pays the leftover unit to a different reviewer. The monthly
 * shared pool is already pinned by `compareActors`; the review line was not.
 */
import { expect, spyOn, test } from "bun:test";
import { allocateReviewBudgetMinor } from "../src/lib/reward-cycle";

// Two reviewers of equal weight and one base unit to award. GitHub node IDs
// are mixed-case base64; these differ only in the case of a final letter.
const reviewers = [
  { actorId: "U_kgDOAAAI", scoreThirds: 1 },
  { actorId: "U_kgDOAAAi", scoreThirds: 1 },
];

function shares(): Record<string, string> {
  return Object.fromEntries(
    [...allocateReviewBudgetMinor(1n, reviewers)].map(([id, amount]) => [
      id,
      amount.toString(),
    ]),
  );
}

test("a tied review-budget remainder keeps its reviewer when the host locale is Turkish", () => {
  const english = shares();
  // English order puts "i" before "I", so the leftover unit goes to it.
  expect(english).toEqual({
    U_kgDOAAAi: "1",
    U_kgDOAAAI: "0",
  });
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
    expect(shares()).toEqual(english);
  } finally {
    compare.mockRestore();
  }
});
