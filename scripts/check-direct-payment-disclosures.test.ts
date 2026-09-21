import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDirectPaymentDisclosures,
  type Disclosure,
  roundHalfUp,
  verifyDisclosure,
} from "./check-direct-payment-disclosures";

const ROOT = resolve(import.meta.dirname, "..");

function load(projectId: string): {
  disclosure: Disclosure;
  preparation: Uint8Array;
} {
  const disclosure = JSON.parse(
    readFileSync(
      resolve(ROOT, `disclosures/${projectId}-2026-08-direct-payments.json`),
      "utf8",
    ),
  ) as Disclosure;
  return {
    disclosure,
    preparation: readFileSync(resolve(ROOT, disclosure.preparation.path)),
  };
}

function mutate(
  projectId: string,
  change: (disclosure: Disclosure) => void,
): string[] {
  const { disclosure, preparation } = load(projectId);
  const copy = structuredClone(disclosure);
  change(copy);
  return verifyDisclosure(copy, preparation);
}

describe("roundHalfUp", () => {
  it("rounds a half up rather than to even", () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n);
    expect(roundHalfUp(7n, 2n)).toBe(4n);
    expect(roundHalfUp(4n, 2n)).toBe(2n);
  });

  it("refuses a non-positive denominator", () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe("the checked-in August disclosures", () => {
  it("reproduce from the preparations they name", () => {
    expect(checkDirectPaymentDisclosures(ROOT)).toEqual([]);
  });

  it("account for every contributor in each preparation", () => {
    for (const projectId of ["eliza", "asi"]) {
      const { disclosure, preparation } = load(projectId);
      const contributors = JSON.parse(new TextDecoder().decode(preparation))
        .contributors as unknown[];
      expect(disclosure.rows).toHaveLength(contributors.length);
      expect(disclosure.totals.rows).toBe(contributors.length);
    }
  });

  it("record the asi allocation as exceeding the published cap", () => {
    const { disclosure } = load("asi");
    expect(disclosure.reconstructedBasis.overCapMinor).toBe("11127493");
  });

  it("keep the eliza allocation inside the published cap", () => {
    const { disclosure } = load("eliza");
    expect(BigInt(disclosure.reconstructedBasis.overCapMinor)).toBeLessThan(0n);
  });
});

describe("verifyDisclosure refuses a drifted record", () => {
  it("catches a preparation digest that no longer matches", () => {
    const failures = mutate("asi", (d) => {
      d.preparation.sha256 = "0".repeat(64);
    });
    expect(failures.some((f) => f.includes("disclosure claims"))).toBe(true);
  });

  it("catches a contributor weight silently raised without an adjustment", () => {
    const failures = mutate("asi", (d) => {
      const row = d.rows.find((entry) => entry.login === "kenjohnscreates");
      if (!row) throw new Error("fixture row missing");
      row.effectiveWeight = String(BigInt(row.effectiveWeight) + 10_000n);
    });
    expect(
      failures.some((f) =>
        f.includes("not published weight plus the declared adjustment"),
      ),
    ).toBe(true);
  });

  it("catches a weight adjustment carrying no public reason", () => {
    const failures = mutate("asi", (d) => {
      const row = d.rows.find((entry) => entry.login === "ss251");
      if (!row?.weightAdjustment) throw new Error("fixture row missing");
      row.weightAdjustment.reason = "   ";
    });
    expect(failures.some((f) => f.includes("without a public reason"))).toBe(
      true,
    );
  });

  it("catches an entitlement that the declared basis does not produce", () => {
    const failures = mutate("eliza", (d) => {
      const row = d.rows[0];
      row.entitlementMinor = String(BigInt(row.entitlementMinor) + 1n);
    });
    expect(
      failures.some((f) => f.includes("does not equal the declared basis")),
    ).toBe(true);
  });

  it("catches a payment to an address the preparation never froze", () => {
    const failures = mutate("asi", (d) => {
      const row = d.rows.find((entry) => entry.login === "FreeSolDev");
      if (!row) throw new Error("fixture row missing");
      row.walletAnomaly = undefined;
    });
    expect(
      failures.some((f) => f.includes("the preparation did not freeze")),
    ).toBe(true);
  });

  it("catches a duplicated transaction signature", () => {
    const failures = mutate("asi", (d) => {
      const paid = d.rows.filter((entry) => entry.observed);
      const [first, second] = paid;
      if (!first?.observed || !second?.observed)
        throw new Error("fixture rows missing");
      second.observed.signature = first.observed.signature;
    });
    expect(failures.some((f) => f.includes("is used twice"))).toBe(true);
  });

  it("catches an unpaid row above the minimum reported as held", () => {
    const failures = mutate("eliza", (d) => {
      const row = d.rows.find(
        (entry) => entry.state === "unclaimed" && !entry.observed,
      );
      if (!row) throw new Error("fixture row missing");
      row.state = "held-below-minimum";
      d.totals.byState["held-below-minimum"] = {
        rows: d.totals.byState["held-below-minimum"].rows + 1,
        amountMinor: String(
          BigInt(d.totals.byState["held-below-minimum"].amountMinor) +
            BigInt(row.entitlementMinor),
        ),
      };
      d.totals.byState.unclaimed = {
        rows: d.totals.byState.unclaimed.rows - 1,
        amountMinor: String(
          BigInt(d.totals.byState.unclaimed.amountMinor) -
            BigInt(row.entitlementMinor),
        ),
      };
    });
    expect(
      failures.some((f) => f.includes("above the minimum but state")),
    ).toBe(true);
  });

  it("catches an observed total that does not sum the transfers", () => {
    const failures = mutate("asi", (d) => {
      d.totals.observedAmountMinor = String(
        BigInt(d.totals.observedAmountMinor) - 1n,
      );
    });
    expect(failures.some((f) => f.includes("totals.observedAmountMinor"))).toBe(
      true,
    );
  });

  it("catches an over-cap figure that hides the excess", () => {
    const failures = mutate("asi", (d) => {
      d.reconstructedBasis.overCapMinor = "0";
    });
    expect(failures.some((f) => f.includes("overCapMinor"))).toBe(true);
  });
});
