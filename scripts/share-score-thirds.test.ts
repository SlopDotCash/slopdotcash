import { describe, expect, test } from "bun:test";
import { shareScoreThirds } from "../src/lib/leaderboard";

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

describe("shareScoreThirds", () => {
  test("never awards more thirds than the work unit holds", () => {
    // One-third unit credited to three actors: the floor keeps a share
    // positive but must not mint two extra thirds.
    expect(sum(shareScoreThirds(1, 3, 1))).toBe(1);
    expect(shareScoreThirds(1, 3, 1)).toEqual([1, 0, 0]);
    expect(sum(shareScoreThirds(2, 5, 1))).toBe(2);
  });

  test("earlier actors receive the remainder", () => {
    expect(shareScoreThirds(3, 2, 1)).toEqual([2, 1]);
    expect(shareScoreThirds(24, 5, 1)).toEqual([5, 5, 5, 5, 4]);
  });

  test("a verified assessment split conserves with no floor", () => {
    expect(shareScoreThirds(1, 2, 0)).toEqual([1, 0]);
    expect(sum(shareScoreThirds(1, 20, 0))).toBe(1);
  });
});
