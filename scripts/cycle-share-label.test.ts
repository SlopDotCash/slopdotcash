import { expect, test } from "bun:test";
import { cycleShareLabel } from "../src/lib/cycle-index";

test("an unrecorded cycle share is not shown as a zero share", () => {
  // The cycle index schema records sharePartsPerMillion as number | null,
  // and the profile payment history already reads the null state as
  // "Share not recorded" for the same field. The cycle pages printed "0%".
  expect(cycleShareLabel(null)).toBe("Share not recorded");
});

test("recorded cycle shares use the canonical percent format", () => {
  // ProjectLeaderboard and Profiles render this same field through
  // formatPercent, `(share / 10_000).toFixed(2)`; the cycle pages printed
  // the raw unrounded quotient (333333 became "33.3333%").
  const cases: Array<[number, string]> = [
    [0, "0.00%"],
    [1, "0.00%"],
    [166667, "16.67%"],
    [333333, "33.33%"],
    [999999, "100.00%"],
    [1000000, "100.00%"],
  ];
  for (const [share, label] of cases)
    expect(cycleShareLabel(share)).toBe(label);
});
