/** Reconciliation against the two settlements this repository has published:
 * the frozen preparations in `funding/preparations/` and the transfers
 * recorded in `disclosures/`. Observations are read from the disclosures
 * rather than synthesized from entitlements, so a passing test describes the
 * August 2026 payout as it happened rather than as it was planned. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Disclosure } from "../../scripts/check-direct-payment-disclosures";
import {
  type FundingPayoutReconciliation,
  type FundingPayoutStatus,
  reconcileFundingPayout,
} from "./funding-reconciliation";
import {
  assertFundingPreparation,
  type FundingPreparation,
} from "./funding-review-data";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as T;
}

function preparation(projectId: string): FundingPreparation {
  return assertFundingPreparation(
    readJson(`funding/preparations/${projectId}-2026-08.json`),
  );
}

function disclosure(projectId: string): Disclosure {
  return readJson<Disclosure>(
    `disclosures/${projectId}-2026-08-direct-payments.json`,
  );
}

/**
 * What settled, keyed by the address that received it. Recipients come from
 * the disclosure and not from the preparation, because two of them are not the
 * address the preparation registered for that contributor.
 */
function settled(projectId: string): Map<string, string> {
  const observed = new Map<string, string>();
  for (const row of disclosure(projectId).rows) {
    if (!row.observed) continue;
    const prior = BigInt(observed.get(row.observed.recipient) ?? "0");
    observed.set(
      row.observed.recipient,
      (prior + BigInt(row.observed.amountMinor)).toString(),
    );
  }
  return observed;
}

function tally(
  result: FundingPayoutReconciliation,
): Record<FundingPayoutStatus, number> {
  const counts: Record<FundingPayoutStatus, number> = {
    exact: 0,
    mismatch: 0,
    unpaid: 0,
    withheld: 0,
    unpayable: 0,
  };
  for (const row of result.rows) counts[row.status] += 1;
  return counts;
}

function row(result: FundingPayoutReconciliation, login: string) {
  const found = result.rows.find(
    (candidate) => candidate.actor.login === login,
  );
  if (!found) throw new Error(`${login} is not in the preparation`);
  return found;
}

describe("reconcileFundingPayout against the asi 2026-08 settlement", () => {
  const result = reconcileFundingPayout(preparation("asi"), settled("asi"));

  it("accounts for every one of the 19 transfers that settled", () => {
    const observed = settled("asi");
    expect(observed.size).toBe(19);
    expect(
      [...observed.values()].reduce((sum, minor) => sum + BigInt(minor), 0n),
    ).toBe(1785267199n);

    expect(result.projectId).toBe("asi");
    expect(result.cycleId).toBe("2026-08");
    expect(tally(result)).toEqual({
      exact: 15,
      mismatch: 2,
      unpaid: 1,
      withheld: 0,
      unpayable: 8,
    });
    // Seventeen transfers matched a registered wallet; the other two did not,
    // so the observed total here is short of the 1,785.267199 that moved.
    expect(result.totals.observedMinor).toBe("1526552981");
    expect(result.totals.payableEntitledMinor).toBe("1543244221");
    expect(result.reconciles).toBe(false);
  });

  it("separates a contributor skipped from one paid at another address", () => {
    // FreeSolDev is the discriminator: the asi wallet received nothing, and a
    // transfer for the same entitlement landed at the address registered under
    // eliza. Reporting only "unpaid" would have described a loss that did not
    // happen; reporting only the stray address would have hidden the gap.
    expect(row(result, "FreeSolDev")).toMatchObject({
      status: "unpaid",
      address: "EU8ZXW65rMfw8o7py5kzahJiGqh8Dh9uaGcMAysu3hXi",
      entitledMinor: "25036860",
      observedMinor: "0",
    });
    expect(result.totals.unpaidMinor).toBe("25036860");

    // Svector-anu froze no asi wallet at all, so the preparation could not have
    // directed this payment, yet 233.677358 was sent anyway.
    expect(row(result, "Svector-anu")).toMatchObject({
      status: "unpayable",
      address: null,
    });

    expect(result.unexpectedAddresses).toEqual([
      "Ex6ePz4UvsdCnYKptbm7tuPg4YBExiqHNxU6ARibg1Wy",
      "soAVqvYm8vceoycnVjnwYj74YRaWHMBYYSiz6hUFBCc",
    ]);
    // The disclosure reached the same two rows independently, by annotating
    // the recipient rather than by comparing against the preparation.
    expect(result.unexpectedAddresses).toEqual(
      disclosure("asi")
        .rows.filter((entry) => entry.walletAnomaly && entry.observed)
        .map((entry) => entry.observed?.recipient)
        .sort(),
    );
  });

  it("reports the raised numerators as mismatches, not as correct payments", () => {
    // Both were paid more than the frozen preparation entitles them to. The
    // disclosure reconstructs the difference as added weight and says plainly
    // that no published artifact records the adjustment, so the primitive must
    // not smooth it over.
    expect(row(result, "ss251")).toMatchObject({
      status: "mismatch",
      deltaMinor: "5563747",
    });
    expect(row(result, "rama0x1")).toMatchObject({
      status: "mismatch",
      deltaMinor: "2781873",
    });

    for (const login of ["ss251", "rama0x1"]) {
      const disclosed = disclosure("asi").rows.find(
        (entry) => entry.login === login,
      );
      expect(disclosed?.weightAdjustment).toBeDefined();
      expect(disclosed?.publishedWeight).not.toBe(disclosed?.effectiveWeight);
      // Paid to the minor unit under the disclosure's reconstructed basis, and
      // wrong under the preparation's. That is the whole finding.
      expect(row(result, login).observedMinor).toBe(
        disclosed?.entitlementMinor,
      );
    }
  });
});

describe("reconcileFundingPayout against the eliza 2026-08 settlement", () => {
  const result = reconcileFundingPayout(preparation("eliza"), settled("eliza"));

  it("reports every paid row as a mismatch because the basis differed", () => {
    expect(tally(result)).toEqual({
      exact: 0,
      mismatch: 53,
      unpaid: 0,
      withheld: 3,
      unpayable: 52,
    });
    expect(result.unexpectedAddresses).toEqual([]);
    expect(result.reconciles).toBe(false);

    // Not 53 separate errors. Every paid row matches its entitlement under the
    // denominator the disclosure declares, which is the published total plus
    // the 210,000 of weight restored by #434 after this preparation froze. The
    // frozen bytes cannot reproduce the payout, and the disclosure can.
    const disclosed = new Map(
      disclosure("eliza").rows.map((entry) => [entry.login, entry]),
    );
    const residual: string[] = [];
    for (const mismatch of result.rows.filter((r) => r.status === "mismatch")) {
      const entry = disclosed.get(mismatch.actor.login);
      const drift =
        BigInt(mismatch.observedMinor) - BigInt(entry?.entitlementMinor ?? "0");
      // The disclosure states each row's own residual, so agreeing with it is
      // a check against a CI-verified record and not a restatement of the
      // number this test just read.
      expect(drift).toBe(BigInt(entry?.deltaMinor ?? "0"));
      expect(drift === 0n || drift === 1n).toBe(true);
      if (drift === 1n) residual.push(mismatch.actor.login);
      expect(mismatch.observedMinor).not.toBe(mismatch.entitledMinor);
    }
    // Fifty rows land on the restored basis to the minor unit. Three sit one
    // unit above it, which is where half-up rounding and the remainder pass
    // disagree, and the disclosure names exactly these three.
    expect(residual.sort()).toEqual([
      "Finberg-Laurelin-CEO",
      "Uuriko",
      "sailorpepe",
    ]);
  });

  it("calls a row under the transfer minimum withheld, not unpaid", () => {
    const withheld = result.rows.filter((r) => r.status === "withheld");
    expect(withheld.map((r) => r.actor.login).sort()).toEqual([
      "FLAVIEN66",
      "OxBenji",
      "fishwishes",
    ]);
    // All three registered a wallet and all three are below the 2.00 USDC
    // floor, so sending nothing was the rule working. A caller that stops on
    // any unpaid row must not stop on these.
    expect(withheld.every((r) => r.address !== null)).toBe(true);
    expect(withheld.every((r) => BigInt(r.entitledMinor) < 2000000n)).toBe(
      true,
    );
    expect(result.totals.withheldMinor).toBe("3318400");
    expect(result.totals.unpaidMinor).toBe("0");
  });
});

describe("reconcileFundingPayout controls", () => {
  const observed = settled("asi");
  const prabhat = "4V9YdVwMEgit4QLmYae4tAX1H1bnBmxM4XbZkL2ucNWZ";

  it("reconciles only when nothing is short and nothing is stray", () => {
    // The settlement asi should have made: every registered wallet paid the
    // frozen entitlement and nothing sent anywhere else. The real map never
    // reaches this state, so without it nothing proves `reconciles` can be
    // true at all.
    const corrected = new Map<string, string>();
    for (const entry of reconcileFundingPayout(preparation("asi"), new Map())
      .rows) {
      if (entry.address) corrected.set(entry.address, entry.entitledMinor);
    }
    const clean = reconcileFundingPayout(preparation("asi"), corrected);
    expect(tally(clean)).toMatchObject({ exact: 18, mismatch: 0, unpaid: 0 });
    expect(clean.totals.observedMinor).toBe(clean.totals.payableEntitledMinor);
    expect(clean.reconciles).toBe(true);

    // One stray transfer is enough on its own, with every row still exact.
    const stray = new Map(corrected);
    stray.set("11111111111111111111111111111111", "1000000");
    const result = reconcileFundingPayout(preparation("asi"), stray);
    expect(tally(result)).toMatchObject({ exact: 18, mismatch: 0, unpaid: 0 });
    expect(result.unexpectedAddresses).toEqual([
      "11111111111111111111111111111111",
    ]);
    expect(result.reconciles).toBe(false);
  });

  it("turns a dropped transfer above the floor into an unpaid row", () => {
    const dropped = new Map(observed);
    dropped.delete(prabhat);
    const result = reconcileFundingPayout(preparation("asi"), dropped);
    expect(row(result, "Prabhat1308")).toMatchObject({
      status: "unpaid",
      observedMinor: "0",
    });
    expect(result.totals.unpaidMinor).toBe("411717251");
  });

  it("separates an underpayment from an omission", () => {
    const short = new Map(observed);
    short.set(prabhat, "386680390");
    const result = reconcileFundingPayout(preparation("asi"), short);
    expect(row(result, "Prabhat1308")).toMatchObject({
      status: "mismatch",
      deltaMinor: "-1",
    });
    expect(result.reconciles).toBe(false);
  });

  it("rejects a malformed observed amount instead of coercing it", () => {
    expect(() =>
      reconcileFundingPayout(preparation("asi"), new Map([[prabhat, "3.5"]])),
    ).toThrow(/minor-unit integer/u);
  });
});
