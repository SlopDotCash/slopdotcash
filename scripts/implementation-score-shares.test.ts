import { expect, test } from "bun:test";
import {
  shareImplementationPoints,
  shareImplementationScoreThirds,
} from "../src/lib/implementation-allocation";
import { scoreThirdsToPoints } from "../src/lib/score-units";

test("compatibility thirds allocate at whole-Point precision", () => {
  const shares = shareImplementationScoreThirds(
    24,
    ["original", "maintainer"],
    new Map([
      ["original", 90n],
      ["maintainer", 10n],
    ]),
  );
  expect(shares).toEqual([21.6, 2.4]);
  expect(shares.map(scoreThirdsToPoints)).toEqual([216, 24]);
  expect(
    shareImplementationScoreThirds(
      1,
      ["c", "b", "a"],
      new Map([
        ["a", 1n],
        ["b", 1n],
        ["c", 1n],
      ]),
    ),
  ).toEqual([0.3, 0.3, 0.4]);
  expect(() =>
    shareImplementationScoreThirds(0.01, ["a"], new Map([["a", 1n]])),
  ).toThrow(TypeError);
  expect(() =>
    shareImplementationScoreThirds(
      Number.MAX_SAFE_INTEGER / 10,
      ["a", "b"],
      new Map([
        ["a", BigInt(Number.MAX_SAFE_INTEGER) - 4n],
        ["b", 4n],
      ]),
    ),
  ).toThrow(TypeError);
});

test("implementation shares preserve the assessed total and changed-line proportions", () => {
  expect(
    shareImplementationPoints(
      24,
      ["original", "maintainer"],
      new Map([
        ["original", 90n],
        ["maintainer", 10n],
      ]),
    ),
  ).toEqual([22, 2]);
  for (let total = 0; total <= 30; total += 1) {
    for (let first = 0; first <= 7; first += 1) {
      for (let second = 0; second <= 7; second += 1) {
        if (first + second === 0) continue;
        const weights = [first, second, 0];
        const shares = shareImplementationPoints(
          total,
          ["a", "b", "zero"],
          new Map(
            weights.map((weight, index) => [
              ["a", "b", "zero"][index],
              BigInt(weight),
            ]),
          ),
        );
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
        for (const [index, share] of shares.entries()) {
          const floor = Math.floor((total * weights[index]) / (first + second));
          expect(share === floor || share === floor + 1).toBe(true);
        }
        expect(shares[2]).toBe(0);
      }
    }
  }
});

test("small scores have no per-actor minimum that inflates the outcome", () => {
  expect(
    shareImplementationPoints(
      1,
      ["c", "b", "a"],
      new Map([
        ["a", 1n],
        ["b", 1n],
        ["c", 1n],
      ]),
    ),
  ).toEqual([0, 0, 1]);
});

test("actor ID breaks equal remainder ties independently of actor and map order", () => {
  const weights = new Map([
    ["c", 1n],
    ["a", 1n],
    ["b", 1n],
  ]);
  for (const actors of [
    ["a", "b", "c"],
    ["c", "a", "b"],
    ["b", "c", "a"],
  ]) {
    const shares = shareImplementationPoints(2, actors, weights);
    expect(new Map(actors.map((id, index) => [id, shares[index]]))).toEqual(
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 0],
      ]),
    );
  }
});

test("integer arithmetic stays exact when products and combined weights exceed safe numbers", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  expect(
    shareImplementationPoints(
      maximum,
      ["b", "a"],
      new Map([
        ["a", BigInt(maximum) ** 2n],
        ["b", BigInt(maximum) ** 2n],
      ]),
    ),
  ).toEqual([4_503_599_627_370_495, 4_503_599_627_370_496]);
});

test("complete zero-line evidence keeps equal sharing without inflating the total", () => {
  expect(
    shareImplementationPoints(
      2,
      ["c", "b", "a"],
      new Map([
        ["a", 0n],
        ["b", 0n],
        ["c", 0n],
      ]),
    ),
  ).toEqual([0, 1, 1]);
});

test("missing, negative and noninteger weights cannot fabricate a proportional share", () => {
  for (const weight of [-1n, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      shareImplementationPoints(
        1,
        ["a"],
        new Map([["a", weight]]) as Map<string, bigint>,
      ),
    ).toThrow(TypeError);
  }
  expect(() => shareImplementationPoints(1, ["a"], new Map())).toThrow(
    TypeError,
  );
  expect(() =>
    shareImplementationPoints(1, ["a", "a"], new Map([["a", 1n]])),
  ).toThrow(TypeError);
  expect(() => shareImplementationPoints(1, [], new Map())).toThrow(TypeError);
  expect(() =>
    shareImplementationPoints(0.5, ["a"], new Map([["a", 1n]])),
  ).toThrow(TypeError);
});
