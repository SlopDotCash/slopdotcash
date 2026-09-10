import { describe, expect, it } from "vitest";
import {
  displayUsdc,
  parseUsdc,
  prepareReviewAdjustments,
} from "./funding-review";

describe("maintainer funding review", () => {
  const recipients = [
    { actor: { id: "A", login: "alice" }, simulatedMinor: "6666667" },
    { actor: { id: "B", login: "bob" }, simulatedMinor: "3333333" },
  ];
  it("retains excluded people and exact original awards without redistributing", () => {
    const result = prepareReviewAdjustments(
      recipients,
      [
        {
          actorId: "A",
          decision: "exclude",
          amountMinor: "6666667",
          reason: "Duplicate accepted outcome",
        },
      ],
      "10000000",
    );
    expect(result.rows).toEqual([
      {
        actor: recipients[0].actor,
        suggestedMinor: "6666667",
        proposedMinor: "0",
        decision: "exclude",
        reason: "Duplicate accepted outcome",
      },
      {
        actor: recipients[1].actor,
        suggestedMinor: "3333333",
        proposedMinor: "3333333",
        decision: "include",
        reason: "",
      },
    ]);
    expect(result.totalMinor).toBe("3333333");
    expect(result.unallocatedMinor).toBe("6666667");
  });
  it("refuses unreasoned changes, unknown actors and over-cap awards", () => {
    expect(() =>
      prepareReviewAdjustments(
        recipients,
        [{ actorId: "A", decision: "exclude", amountMinor: "0", reason: " " }],
        "10000000",
      ),
    ).toThrow(/public reason/);
    expect(() =>
      prepareReviewAdjustments(
        recipients,
        [
          {
            actorId: "C",
            decision: "include",
            amountMinor: "0",
            reason: "none",
          },
        ],
        "10000000",
      ),
    ).toThrow(/unknown/);
    expect(() =>
      prepareReviewAdjustments(
        recipients,
        [
          {
            actorId: "A",
            decision: "include",
            amountMinor: "10000000",
            reason: "Extra work",
          },
        ],
        "10000000",
      ),
    ).toThrow(/exceed/);
  });
  it("parses exact micro-USDC without rounding or exponent coercion", () => {
    expect(parseUsdc("10000.000001")).toBe("10000000001");
    expect(displayUsdc("10000000001")).toBe("10000.000001");
    for (const invalid of ["1e4", "-1", "1.0000001", "NaN", "", "01"])
      expect(() => parseUsdc(invalid)).toThrow();
  });
});
