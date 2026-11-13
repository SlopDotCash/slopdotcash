import { expect, test } from "bun:test";
import { paymentWeightDisplayParts } from "../src/lib/project-view";

/** The same two-decimal rule formatPercent uses for a parts-per-million share. */
function shownPercent(partsPerMillion: number): string {
  return (partsPerMillion / 10_000).toFixed(2);
}

function weights(entries: readonly (readonly [string, number])[]) {
  return entries.map(([login, adjustedWeight]) => ({
    actor: { id: `id-${login}`, login },
    adjustedWeight,
  }));
}

function shown(entries: readonly (readonly [string, number])[]) {
  const parts = paymentWeightDisplayParts(weights(entries));
  return entries.map(([login]) => shownPercent(parts.get(`id-${login}`) ?? -1));
}

/** The previous column rounded each weight on its own, in parts per million. */
function independentlyRounded(entries: readonly (readonly [string, number])[]) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return entries.map(([, weight]) =>
    shownPercent(Math.round((weight * 1_000_000) / total)),
  );
}

/** Hundredths of a percent, so 33.33 and 33.34 sum as integers. */
function hundredths(labels: readonly string[]) {
  return labels.reduce(
    (total, label) => total + Number(label.replace(".", "")),
    0,
  );
}

test("equal unfunded weights print percentages that sum to 100.00", () => {
  const threeEntries = [
    ["ada", 1],
    ["bea", 1],
    ["cam", 1],
  ] as const;
  expect(hundredths(independentlyRounded(threeEntries))).toBe(9999);
  const three = shown(threeEntries);
  expect(three).toEqual(["33.34", "33.33", "33.33"]);
  expect(hundredths(three)).toBe(10000);

  const sevenEntries = [
    ["a", 1],
    ["b", 1],
    ["c", 1],
    ["d", 1],
    ["e", 1],
    ["f", 1],
    ["g", 1],
  ] as const;
  expect(hundredths(independentlyRounded(sevenEntries))).toBe(10003);
  const seven = shown(sevenEntries);
  expect(seven).toEqual([
    "14.29",
    "14.29",
    "14.29",
    "14.29",
    "14.28",
    "14.28",
    "14.28",
  ]);
  expect(hundredths(seven)).toBe(10000);
});

test("unfunded payment weight keeps exact quarters and a single full share", () => {
  expect(
    shown([
      ["ada", 1],
      ["bea", 3],
    ]),
  ).toEqual(["25.00", "75.00"]);
  expect(shown([["ada", 40]])).toEqual(["100.00"]);
  expect(
    shown([
      ["ada", 0],
      ["bea", 0],
    ]),
  ).toEqual(["0.00", "0.00"]);
  expect(paymentWeightDisplayParts([])).toEqual(new Map());
});
