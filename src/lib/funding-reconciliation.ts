/** Reconciles a published funding preparation against observed settled
 * transfers. Preparations record what each contributor is owed and the chain
 * records what moved; nothing connected the two, so a payout made outside the
 * settlement pipeline could silently omit a recipient. Reads settled history
 * only and confers no approval or payment authority. */

import {
  assertFundingPreparation,
  createFundingReview,
  type FundingPreparation,
} from "./funding-review-data";

/** Per-recipient outcome of comparing entitlement against observed transfers. */
export type FundingPayoutStatus =
  /** Observed exactly the entitled amount. */
  | "exact"
  /** Observed a non-zero amount that is not the entitled amount. */
  | "mismatch"
  /** A wallet is on record and nothing was observed for it. */
  | "unpaid"
  /** No wallet on record, so the preparation itself cannot direct a payment. */
  | "unpayable";

export interface FundingPayoutRow {
  actor: { id: string; login: string };
  address: string | null;
  entitledMinor: string;
  observedMinor: string;
  /** observed minus entitled; negative means short-paid. */
  deltaMinor: string;
  status: FundingPayoutStatus;
}

export interface FundingPayoutReconciliation {
  projectId: string;
  cycleId: string;
  capMinor: string | null;
  rows: FundingPayoutRow[];
  totals: {
    entitledMinor: string;
    observedMinor: string;
    /** Entitlement of rows that carry a wallet, so the payable subtotal. */
    payableEntitledMinor: string;
    /** Entitlement of payable rows that observed nothing. */
    unpaidMinor: string;
  };
  /** Observed addresses that no contributor in the preparation claims. */
  unexpectedAddresses: string[];
  /** True only when every payable row is exact and nothing is unexpected. */
  reconciles: boolean;
}

function assertMinor(value: string, field: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,29})$/u.test(value)) {
    throw new TypeError(`${field} must be a non-negative minor-unit integer`);
  }
  return BigInt(value);
}

/**
 * Compares each contributor's entitlement, as the project's own allocator
 * computes it, against the total observed for that contributor's registered
 * address.
 *
 * Entitlement comes from `createFundingReview`, so this never re-derives the
 * weight math: a reconciliation failure means the payout disagrees with the
 * preparation, not that two implementations disagree with each other.
 *
 * `observedByAddress` maps a recipient address to the total minor units it
 * received in the settlement window. Addresses are compared exactly, because
 * Solana base58 is case-sensitive.
 */
export function reconcileFundingPayout(
  preparation: FundingPreparation,
  observedByAddress: ReadonlyMap<string, string>,
): FundingPayoutReconciliation {
  const review = createFundingReview(assertFundingPreparation(preparation));
  const claimed = new Set<string>();
  let entitled = 0n;
  let observed = 0n;
  let payableEntitled = 0n;
  let unpaid = 0n;

  const rows = review.contributors.map((row) => {
    const entitledMinor = assertMinor(
      row.simulatedMinor ?? "0",
      `${row.actor.login}.simulatedMinor`,
    );
    entitled += entitledMinor;
    const address = row.wallet?.address ?? null;
    if (address === null) {
      return {
        actor: { id: row.actor.id, login: row.actor.login },
        address: null,
        entitledMinor: entitledMinor.toString(),
        observedMinor: "0",
        deltaMinor: (-entitledMinor).toString(),
        status: "unpayable" as const,
      };
    }
    claimed.add(address);
    payableEntitled += entitledMinor;
    const observedMinor = assertMinor(
      observedByAddress.get(address) ?? "0",
      `${row.actor.login}.observed`,
    );
    observed += observedMinor;
    if (observedMinor === 0n) unpaid += entitledMinor;
    return {
      actor: { id: row.actor.id, login: row.actor.login },
      address,
      entitledMinor: entitledMinor.toString(),
      observedMinor: observedMinor.toString(),
      deltaMinor: (observedMinor - entitledMinor).toString(),
      status:
        observedMinor === entitledMinor
          ? ("exact" as const)
          : observedMinor === 0n
            ? ("unpaid" as const)
            : ("mismatch" as const),
    };
  });

  const unexpectedAddresses = [...observedByAddress.keys()]
    .filter((address) => !claimed.has(address))
    .sort();

  return {
    projectId: review.projectId,
    cycleId: review.cycleId,
    capMinor: review.capMinor,
    rows,
    totals: {
      entitledMinor: entitled.toString(),
      observedMinor: observed.toString(),
      payableEntitledMinor: payableEntitled.toString(),
      unpaidMinor: unpaid.toString(),
    },
    unexpectedAddresses,
    reconciles:
      unexpectedAddresses.length === 0 &&
      rows.every((row) => row.status === "exact" || row.status === "unpayable"),
  };
}
