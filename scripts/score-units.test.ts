import { expect, test } from "bun:test";
import {
  addScoreThirds,
  isScoreThirds,
  pointsToScoreThirdsString,
  scoreThirdsStringToPoints,
  scoreThirdsToPoints,
} from "../src/lib/score-units";

test("numeric compatibility units round-trip exact whole Points", () => {
  for (let points = 0; points <= 1_000; points += 1) {
    expect(isScoreThirds(points / 10)).toBe(true);
    expect(scoreThirdsToPoints(points / 10)).toBe(points);
  }
  expect(scoreThirdsToPoints(21.6)).toBe(216);
  expect(scoreThirdsToPoints(Number.MAX_SAFE_INTEGER / 10)).toBe(
    Number.MAX_SAFE_INTEGER,
  );
});

test("numeric compatibility units reject noncanonical precision and unsafe totals", () => {
  for (const value of [
    -0.1,
    0.01,
    0.1 + 0.2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ]) {
    expect(isScoreThirds(value)).toBe(false);
    expect(() => scoreThirdsToPoints(value)).toThrow(TypeError);
  }
  expect(isScoreThirds("0.1")).toBe(false);
  expect(isScoreThirds(null)).toBe(false);
});

test("adding score thirds uses integer Points without floating-point drift", () => {
  expect(addScoreThirds(0.1, 0.2)).toBe(0.3);
  let total = 0;
  for (let index = 0; index < 100; index += 1) {
    total = addScoreThirds(total, 0.1);
  }
  expect(total).toBe(10);
  expect(() => addScoreThirds(Number.MAX_SAFE_INTEGER / 10, 0.1)).toThrow(
    TypeError,
  );
  expect(() => addScoreThirds(900_719_925_474_098.6, 0.1)).toThrow(TypeError);
});

test("string compatibility units preserve arbitrary integer Points exactly", () => {
  for (const value of ["0", "1", "0.1", "24.7", "99999999999999999999.9"]) {
    expect(pointsToScoreThirdsString(scoreThirdsStringToPoints(value))).toBe(
      value,
    );
  }
  expect(scoreThirdsStringToPoints("99999999999999999999.9")).toBe(
    999999999999999999999n,
  );
  expect(pointsToScoreThirdsString(0n)).toBe("0");
  expect(pointsToScoreThirdsString(240n)).toBe("24");
});

test("string compatibility units reject ambiguous or sub-Point values", () => {
  for (const value of ["", "01", ".1", "1.0", "1.01", "-1", "1e2", " 1"]) {
    expect(() => scoreThirdsStringToPoints(value)).toThrow(TypeError);
  }
  expect(() => pointsToScoreThirdsString(-1n)).toThrow(TypeError);
});
