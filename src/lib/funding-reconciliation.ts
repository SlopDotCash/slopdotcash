/** Reconciles a published funding preparation against observed settled
 * transfers. Preparations record what each contributor is projected to
 * receive and the chain records what moved; nothing connected the two, so a
 * payout made outside the settlement pipeline could silently omit a recipient.
 * Reads settled history only and confers no approval or payment authority. */

import {
  assertFundingPreparation,
  createFundingReview,
  type FundingPreparation,
} from "./funding-review-data";
import { MINIMUM_TRANSFER_MINOR } from "./rewards";

/** Per-recipient outcome of comparing entitlement against observed transfers. */
export type FundingPayoutStatus =
  /** Observed exactly the entitled amount. */
  | "exact"
  /** Observed a non-zero amount that is not the entitled amount. */
  | "mismatch"
  /** A wallet is on record, the entitlement clears the transfer minimum, and
   * nothing was observed for it. */
  | "unpaid"
  /** A wallet is on record and the entitlement is below the transfer minimum,
   * so a settlement that sends nothing is complying with the floor rather than
   * skipping the row. */
  | "withheld"
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
    /** Entitlement of payable rows above the floor that observed nothing. */
    unpaidMinor: string;
    /** Entitlement of payable rows correctly withheld under the floor. */
    withheldMinor: string;
  };
  /** Observed addresses that no contributor in the preparation claims. */
  unexpectedAddresses: string[];
  /** True only when every payable row is exact or withheld under the floor,
   * and nothing is unexpected. */
  reconciles: boolean;
}

/** The floor the platform will not send below, taken from the rewards module
 * so the two cannot drift apart. */
const MINIMUM_TRANSFER = BigInt(MINIMUM_TRANSFER_MINOR);

/** A zero observation is only an omission above the floor. Below it, sending
 * nothing is what the settlement is supposed to do. */
function resolveStatus(
  entitled: bigint,
  observed: bigint,
): FundingPayoutStatus {
  if (observed === entitled) return "exact";
  if (observed !== 0n) return "mismatch";
  return entitled < MINIMUM_TRANSFER ? "withheld" : "unpaid";
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
  for (const [address, amount] of observedByAddress) {
    assertMinor(amount, `${address}.observed`);
  }
  const claimed = new Set<string>();
  let entitled = 0n;
  let observed = 0n;
  let payableEntitled = 0n;
  let unpaid = 0n;
  let withheld = 0n;

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
    if (claimed.has(address)) {
      throw new TypeError(
        "Cannot reconcile duplicate preparation wallet address",
      );
    }
    claimed.add(address);
    payableEntitled += entitledMinor;
    const observedMinor = assertMinor(
      observedByAddress.get(address) ?? "0",
      `${row.actor.login}.observed`,
    );
    observed += observedMinor;
    const status = resolveStatus(entitledMinor, observedMinor);
    if (status === "unpaid") unpaid += entitledMinor;
    if (status === "withheld") withheld += entitledMinor;
    return {
      actor: { id: row.actor.id, login: row.actor.login },
      address,
      entitledMinor: entitledMinor.toString(),
      observedMinor: observedMinor.toString(),
      deltaMinor: (observedMinor - entitledMinor).toString(),
      status,
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
      withheldMinor: withheld.toString(),
    },
    unexpectedAddresses,
    reconciles:
      unexpectedAddresses.length === 0 &&
      rows.every(
        (row) =>
          row.status === "exact" ||
          row.status === "unpayable" ||
          row.status === "withheld",
      ),
  };
}
