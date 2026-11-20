import { expect, test } from "bun:test";
import { formatPercent } from "../src/lib/reward-amount";

/**
 * A share is parts per million. Two displayed decimal places are half up of
 * that exact ratio. 150 ppm is 0.015%, which is 0.02% at two places.
 */
test("share percents round half up on an exact half hundredth", () => {
  expect(formatPercent(150)).toBe("0.02%");
  expect(formatPercent(10_050)).toBe("1.01%");
  expect(formatPercent(149)).toBe("0.01%");
  expect(formatPercent(50)).toBe("0.01%");
  expect(formatPercent(0)).toBe("0.00%");
  expect(formatPercent(333_333)).toBe("33.33%");
  expect(formatPercent(1_000_000)).toBe("100.00%");
});
