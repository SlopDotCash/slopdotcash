/**
 * The two pure rules for a standing deposit (operator decision, 23 November
 * 2026; PRD section 5, "Standing deposit", and section 6, FEE-08): whether a
 * deposit pays its account's standing row, and what the resolver may send
 * for it. They read no chain, database or clock.
 *
 * The standing deposit is held in a second `SubmissionDeposits` contract on
 * Robinhood Chain. The Worker keeps it as a ledger of its own,
 * `robinhood-standing`, while every token, burn address and confirmation
 * comes from the Robinhood Chain tables. The website writes the row in
 * `standing_deposits`, and Slopbot decides what is due on it. This Worker
 * only marks the row paid and sends what the row says.
 */

import {
  STANDING_DEPOSIT_LEDGER,
  STANDING_DEPOSIT_NETWORK,
} from "../../src/lib/standing-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  type SubmissionFeeTerms,
  submissionFeeTokenKind,
} from "../../src/lib/submission-fee.mjs";

/** An account's row in `standing_deposits`. */
export interface StandingRow {
  id: string;
  item: string;
  /** SLOP base units due, fixed when the row was asked. */
  slopAmount: string;
  /** Set when the contributor withdrew the row before paying it. */
  cancelledAt: string | null;
  paidNetwork: string | null;
  paidDepositId: number | null;
  outcome: string | null;
}

export type StandingDepositRefusal =
  | "unknown_item"
  | "token_not_accepted"
  | "standing_wrong_ledger"
  | "standing_token_not_slop"
  | "wrong_kept_to"
  | "standing_cancelled"
  | "standing_amount_invalid"
  | "amount_below_due"
  | "item_already_paid"
  | "item_already_decided";

const AMOUNT = /^(0|[1-9][0-9]{0,38})$/u;
const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/** The chain whose token table applies to a ledger. */
const chainOf = (network: string) =>
  network === STANDING_DEPOSIT_LEDGER ? STANDING_DEPOSIT_NETWORK : network;

/**
 * Whether a deposit pays for its account's standing row.
 *
 * It counts only when all of these hold: the deposit is on the standing
 * ledger; the token is SLOP from the Robinhood Chain table; a kept deposit
 * would go to the burn address; the row exists and was not withdrawn before
 * payment; the amount is at least the amount the row asked for; and the row
 * is not already paid by another deposit or decided. Everything else is
 * refused with a reason and never kept. A refused deposit of an accepted
 * token is sent back. One of a token outside the table keeps the reason
 * `token_not_accepted`, which leaves it unresolved for its payer to reclaim.
 */
export function standingDepositCounts(
  network: string,
  deposit: {
    readonly depositId: number | string;
    readonly token: string;
    readonly amount: string;
    readonly keptTo: string;
  },
  row: StandingRow | null,
  terms: SubmissionFeeTerms = {},
):
  | { accepted: true; due: string }
  | { accepted: false; reason: StandingDepositRefusal } {
  const refuse = (reason: StandingDepositRefusal) =>
    ({ accepted: false, reason }) as const;
  // The token first: the resolver never calls into a token nobody reviewed,
  // whatever else the deposit says.
  const kind = submissionFeeTokenKind(chainOf(network), deposit.token, terms);
  if (kind === null) return refuse("token_not_accepted");
  if (network !== STANDING_DEPOSIT_LEDGER)
    return refuse("standing_wrong_ledger");
  if (kind !== "slop") return refuse("standing_token_not_slop");
  if (!same(deposit.keptTo, terms.burn ?? SUBMISSION_FEE_BURN))
    return refuse("wrong_kept_to");
  if (!row) return refuse("unknown_item");
  if (row.cancelledAt !== null) return refuse("standing_cancelled");
  if (!AMOUNT.test(row.slopAmount) || BigInt(row.slopAmount) <= 0n)
    return refuse("standing_amount_invalid");
  if (!AMOUNT.test(deposit.amount))
    throw new TypeError("deposit.amount must be a base-unit decimal string");
  const due = BigInt(row.slopAmount);
  if (BigInt(deposit.amount) < due) return refuse("amount_below_due");
  const paidBy = row.paidDepositId;
  const own =
    paidBy !== null &&
    row.paidNetwork === network &&
    String(paidBy) === String(deposit.depositId);
  // A second deposit for a row that is already paid or decided pays for
  // nothing; the deposit that paid stays accepted.
  if (!own && paidBy !== null) return refuse("item_already_paid");
  if (!own && row.outcome !== null) return refuse("item_already_decided");
  return { accepted: true, due: due.toString() };
}

/**
 * What the resolver may send for a deposit on the standing ledger:
 * "refund", "keep" or null.
 *
 * Nothing before the deposit is finalized and judged, or once it has left
 * the open states, and never for a token outside the table. A refused
 * deposit is sent back whatever the row says. An accepted one is sent back
 * when the row it paid says `refund_due`. It is kept only when that row says
 * `kept_due`, names this very deposit as the one that paid, and the deposit
 * itself is SLOP on the standing ledger whose kept destination is the burn
 * address. No other input can produce "keep".
 */
export function standingResolveAction(
  network: string,
  deposit: {
    readonly depositId: number | string;
    readonly token: string;
    readonly keptTo: string;
    readonly finalizedAt: string | null;
    readonly state: string;
    readonly accepted: number | boolean | null;
  },
  row: StandingRow | null,
  terms: SubmissionFeeTerms = {},
): "refund" | "keep" | null {
  if (!deposit.finalizedAt) return null;
  if (!["open", "refund_due", "kept_due"].includes(deposit.state)) return null;
  const kind = submissionFeeTokenKind(chainOf(network), deposit.token, terms);
  if (kind === null) return null;
  if (deposit.accepted === 0 || deposit.accepted === false) return "refund";
  if (deposit.accepted !== 1 && deposit.accepted !== true) return null;
  if (
    !row ||
    row.paidNetwork !== network ||
    String(row.paidDepositId) !== String(deposit.depositId)
  )
    return null;
  if (row.outcome === "refund_due") return "refund";
  if (
    row.outcome === "kept_due" &&
    network === STANDING_DEPOSIT_LEDGER &&
    kind === "slop" &&
    same(deposit.keptTo, terms.burn ?? SUBMISSION_FEE_BURN)
  )
    return "keep";
  return null;
}
