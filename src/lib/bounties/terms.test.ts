import { describe, expect, it } from "vitest";
import { scenario } from "../../../tests/fixtures/bounties/scenario";
import {
  assertBountyTerms,
  bountyObligation,
  bountyTermsDigest,
} from "./terms";

function changed(fields: Record<string, unknown>) {
  const terms = { ...scenario().terms, ...fields };
  return { ...terms, termsDigest: bountyTermsDigest(terms) };
}

describe("published fixed-price bounty terms", () => {
  it("keeps beneficiary principal exact while adding the explicit fee", () => {
    expect(bountyObligation(scenario().terms)).toEqual({
      principalMinor: "10000000",
      feeMinor: "100000",
      totalUsdcMinor: "10100000",
    });
  });

  it("does not admit incomplete draft terms to a funded obligation", () => {
    expect(() =>
      assertBountyTerms({
        schemaVersion: "1",
        status: "draft",
        bountyId: "draft",
      }),
    ).toThrow();
    expect(() =>
      bountyObligation(changed({ status: "draft" }) as never),
    ).toThrow();
  });

  it("requires commercial fee payer and basis-point rounding without defaults", () => {
    expect(() =>
      assertBountyTerms(
        changed({ feeRule: { kind: "fixed", amountMinor: "100000" } }),
      ),
    ).toThrow();
    expect(() =>
      assertBountyTerms(
        changed({
          feeRule: {
            kind: "basis-points",
            basisPoints: "100",
            payer: "funder",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertBountyTerms(
        changed({
          feeRule: {
            kind: "basis-points",
            basisPoints: "100",
            rounding: "nearest",
            payer: "funder",
          },
        }),
      ),
    ).toThrow();
  });

  it.each([
    ["floor", "0"],
    ["ceil", "1"],
  ] as const)(
    "rounds a fractional micro-unit by explicit %s policy",
    (rounding, feeMinor) => {
      const terms = assertBountyTerms(
        changed({
          principalMinor: "1",
          feeRule: {
            kind: "basis-points",
            basisPoints: "1",
            rounding,
            payer: "funder",
          },
        }),
      );
      expect(bountyObligation(terms)).toEqual({
        principalMinor: "1",
        feeMinor,
        totalUsdcMinor: rounding === "floor" ? "1" : "2",
      });
    },
  );

  it("changes the fee obligation without deducting or rewriting beneficiary principal", () => {
    const terms = assertBountyTerms(
      changed({
        feeRule: { kind: "fixed", amountMinor: "7", payer: "beneficiary" },
      }),
    );
    expect(bountyObligation(terms)).toEqual({
      principalMinor: "10000000",
      feeMinor: "7",
      totalUsdcMinor: "10000007",
    });
    expect(scenario().terms.principalMinor).toBe("10000000");
  });

  it("preserves micro-USDC above floating-point precision", () => {
    const terms = assertBountyTerms(
      changed({
        principalMinor: "9007199254740993",
        feeRule: { kind: "fixed", amountMinor: "7", payer: "funder" },
      }),
    );
    expect(bountyObligation(terms)).toEqual({
      principalMinor: "9007199254740993",
      feeMinor: "7",
      totalUsdcMinor: "9007199254741000",
    });
  });

  it("fails closed on changed digest, authority, currency, or refund binding", () => {
    expect(() =>
      assertBountyTerms({ ...scenario().terms, principalMinor: "9" }),
    ).toThrow();
    for (const fields of [
      { mint: "wrong" },
      { network: "devnet" },
      { principalMinor: "01" },
      { authority: { ...scenario().terms.authority, reviewerActorIds: [] } },
      { funders: [] },
      { submissionDeadline: "2026-10-02" },
      { unexpected: true },
    ])
      expect(() => assertBountyTerms(changed(fields))).toThrow();
  });
});
