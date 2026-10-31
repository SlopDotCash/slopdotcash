/**
 * Quality weights are source-bound minor amounts (scripts/source-correction.ts
 * prepares hash-provenanced correction previews from them). Equal remainders
 * follow the contributor tie order. A host locale that case-folds "I" to
 * "ı" must award the same leftover unit to the same contributor.
 */
import { expect, spyOn, test } from "bun:test";
import { allocateQualityWeights } from "../src/lib/contribution-quality";

function allocate() {
  const weights = new Map<string, bigint>([
    ["node-upper", 1n],
    ["node-lower", 1n],
  ]);
  const logins = new Map<string, string>([
    ["node-upper", "Idea"],
    ["node-lower", "idea"],
  ]);
  // Cap of 1 minor unit, two equal weights: exactly one tied contributor
  // receives the single remainder unit, chosen by the login tie break.
  return Object.fromEntries(allocateQualityWeights(weights, "1", logins));
}

test("a tied quality remainder keeps its recipient when the host locale is Turkish", () => {
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
    // One minor unit, two equal weights. English order gives it to "idea".
    expect(english).toEqual({ "node-upper": "0", "node-lower": "1" });
    expect(allocate()).toEqual(english);
    expect(
      Object.values(allocate()).reduce((sum, v) => sum + BigInt(v), 0n),
    ).toBe(1n);
  } finally {
    lower.mockRestore();
    compare.mockRestore();
  }
});
