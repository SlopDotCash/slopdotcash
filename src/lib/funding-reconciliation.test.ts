/** Reconciliation against the published asi 2026-08 preparation. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reconcileFundingPayout } from "./funding-reconciliation";
import {
  assertFundingPreparation,
  type FundingPreparation,
} from "./funding-review-data";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function preparation(): FundingPreparation {
  return assertFundingPreparation(
    JSON.parse(
      readFileSync(
        resolve(root, "funding/preparations/asi-2026-08.json"),
        "utf8",
      ),
    ),
  );
}

/**
 * The three registered wallets that held no USDC token account when the
 * 2026-08 asi transfers were made. A bare TransferChecked cannot land on an
 * absent associated token account, so each was skipped.
 */
const WITHOUT_TOKEN_ACCOUNT = new Set([
  "2eFE3feeepWZ43zPtPMuKSc7ZCRzndeogjwkU7nW7H1p",
  "EU8ZXW65rMfw8o7py5kzahJiGqh8Dh9uaGcMAysu3hXi",
  "73SUereGr4EAuQxftTAUn4EBdQggdyjXQhv8rYeB6GCH",
]);

/** Pays each registered wallet its entitlement, minus any excluded address. */
function observe(
  excluded: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const observed = new Map<string, string>();
  for (const row of reconcileFundingPayout(preparation(), new Map()).rows) {
    if (row.address && !excluded.has(row.address)) {
      observed.set(row.address, row.entitledMinor);
    }
  }
  return observed;
}

describe("reconcileFundingPayout", () => {
  it("names every registered wallet that received nothing", () => {
    const result = reconcileFundingPayout(
      preparation(),
      observe(WITHOUT_TOKEN_ACCOUNT),
    );

    expect(result.projectId).toBe("asi");
    expect(result.cycleId).toBe("2026-08");
    expect(
      result.rows
        .filter((row) => row.status === "unpaid")
        .map((row) => row.actor.login)
        .sort(),
    ).toEqual(["FreeSolDev", "deepanshu-yd", "hermesagent270-commits"]);
    expect(result.totals.unpaidMinor).toBe("203076752");
    // A payout that omits a registered wallet must never reconcile.
    expect(result.reconciles).toBe(false);
  });

  it("reconciles once every registered wallet is paid its entitlement", () => {
    const result = reconcileFundingPayout(preparation(), observe());
    expect(result.rows.some((row) => row.status === "unpaid")).toBe(false);
    expect(result.totals.unpaidMinor).toBe("0");
    expect(result.totals.observedMinor).toBe("1543244221");
    expect(result.totals.observedMinor).toBe(
      result.totals.payableEntitledMinor,
    );
    expect(result.unexpectedAddresses).toEqual([]);
    expect(result.reconciles).toBe(true);
  });

  it("separates an underpayment from an omission", () => {
    const short = observe();
    short.set("4V9YdVwMEgit4QLmYae4tAX1H1bnBmxM4XbZkL2ucNWZ", "386680390");
    const row = reconcileFundingPayout(preparation(), short).rows.find(
      (candidate) => candidate.actor.login === "Prabhat1308",
    );
    expect(row).toMatchObject({ status: "mismatch", deltaMinor: "-1" });
    expect(reconcileFundingPayout(preparation(), short).reconciles).toBe(false);
  });

  it("flags a transfer to an address no contributor claims", () => {
    const stray = observe();
    stray.set("11111111111111111111111111111111", "1000000");
    const result = reconcileFundingPayout(preparation(), stray);
    expect(result.unexpectedAddresses).toEqual([
      "11111111111111111111111111111111",
    ]);
    expect(result.reconciles).toBe(false);
  });

  it("treats a contributor with no wallet as unpayable, never as unpaid", () => {
    const result = reconcileFundingPayout(preparation(), observe());
    const unpayable = result.rows.filter((row) => row.status === "unpayable");
    expect(unpayable).toHaveLength(8);
    expect(unpayable.every((row) => row.address === null)).toBe(true);
    // The cap is allocated in full, so most of this cycle's entitlement
    // belongs to contributors the preparation cannot direct a payment to.
    expect(result.totals.entitledMinor).toBe("5000000000");
    expect(BigInt(result.totals.payableEntitledMinor)).toBeLessThan(
      BigInt(result.totals.entitledMinor),
    );
    expect(result.reconciles).toBe(true);
  });

  it("rejects a malformed observed amount instead of coercing it", () => {
    expect(() =>
      reconcileFundingPayout(
        preparation(),
        new Map([["4V9YdVwMEgit4QLmYae4tAX1H1bnBmxM4XbZkL2ucNWZ", "3.5"]]),
      ),
    ).toThrow(/minor-unit integer/u);
  });
});
