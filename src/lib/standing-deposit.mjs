/**
 * The standing deposit (operator decision, 23 November 2026; PRD section 5,
 * "Standing deposit", and section 6, FEE-08).
 *
 * A contributor posts one SLOP deposit on Robinhood Chain, worth 10 US
 * dollars at Slop's published SLOP rate when it is requested, rounded up to
 * a whole SLOP. While it stands, Slopbot does not ask them the per pull
 * request submission fee on a project that accepts standing deposits, once
 * they have had a pull request merged on that project. It is held in a
 * second deployment of the `SubmissionDeposits` contract whose payer can
 * take a deposit back after 365 days instead of 30.
 *
 * It is lost only when a maintainer adds `slop-keep-fee` to a covered pull
 * request that was closed without a merge within 21 days of opening, and
 * the close and the label still stand 48 hours later. The whole deposit is
 * then burned and coverage ends. An ordinary close costs nothing. The
 * contributor can withdraw at any time: coverage of new pull requests stops
 * at once and the deposit is sent back 21 days later, unless a strike on a
 * pull request opened before then is pending.
 *
 * This file holds the constants every part shares and the pure rules. It
 * reads no chain, database or clock.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  SUBMISSION_FEE_SLOP_DECIMALS,
  SUBMISSION_FEE_STABLE_DECIMALS,
  slopRateScaled,
} from "./submission-fee.mjs";

/** The chain whose token, burn address and confirmations apply. */
export const STANDING_DEPOSIT_NETWORK = "robinhood-mainnet";
/**
 * The Worker's ledger key for this contract. Deposit, cursor, send and
 * parked rows are keyed by it, so ids never collide with the per pull
 * request contract on the same chain.
 */
export const STANDING_DEPOSIT_LEDGER = "robinhood-standing";
/**
 * The second `SubmissionDeposits` deployment, with a 365-day reclaim delay
 * (`contracts/evm/script/DeployStandingDeposits.sol`), deployed on
 * Robinhood Chain on 24 November 2026 (`contracts/DEPLOY-MAINNET.md`,
 * "Standing deposit contract"). While null, nobody could post a standing
 * deposit and nothing changed for anyone.
 */
export const STANDING_DEPOSIT_CONTRACT =
  "0x446604d5c3Cc99c60CCE3d5C4357BC60f5b45993";
/** The block of that deployment, where the event scan starts. */
export const STANDING_DEPOSIT_START_BLOCK = 122128533;
export const STANDING_DEPOSIT_RECLAIM_DAYS = 365;
export const STANDING_DEPOSIT_USD_MINOR = "10000000"; // 10.00 USD, six decimals
/** A covered pull request can cost the deposit only if closed within this many days of opening. */
export const STANDING_DEPOSIT_STRIKE_WINDOW_DAYS = 21;
/** A close and `slop-keep-fee` label must both still stand this long before the deposit is kept. */
export const STANDING_DEPOSIT_STRIKE_GRACE_HOURS = 48;
/** After a withdrawal request, the deposit is sent back this many days later. */
export const STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS = 21;
/** At most this many covered pull requests of one contributor may be open at once. */
export const STANDING_DEPOSIT_OPEN_CAP = 10;
/**
 * A deposit covers new pull requests for this many days after it is paid,
 * then counts as withdrawn, so its last strike window and the withdrawal
 * wait both end before the contract's 365-day reclaim.
 */
export const STANDING_DEPOSIT_COVER_DAYS = 340;
/** The comment Slopbot posts on a covered pull request says so; this label marks it. */
export const STANDING_DEPOSIT_COVERED_LABEL = "slopbot:deposit-covered";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const UINT64_MAX = (1n << 64n) - 1n;
const ONE_SLOP = 10n ** BigInt(SUBMISSION_FEE_SLOP_DECIMALS);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function uint64(value, name) {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (
    (typeof value !== "bigint" &&
      typeof value !== "string" &&
      !Number.isSafeInteger(value)) ||
    !/^[1-9][0-9]{0,19}$/u.test(text) ||
    BigInt(text) > UINT64_MAX
  )
    throw new TypeError(`${name} must be a positive 64-bit integer`);
  return BigInt(text);
}

/**
 * The contract's `item` for one standing deposit of a GitHub account:
 * `keccak256(abi.encodePacked("slop-standing-v1", uint64(githubId), uint64(round)))`,
 * lowercase 0x hex. `round` counts an account's standing deposits from 1, so
 * a deposit posted after a withdrawal or a strike names a new item.
 */
export function standingDepositItem(githubId, round) {
  const account = uint64(githubId, "githubId");
  const sequence = uint64(round, "round");
  const tag = new TextEncoder().encode("slop-standing-v1");
  const packed = new Uint8Array(tag.length + 16);
  packed.set(tag, 0);
  const view = new DataView(packed.buffer);
  view.setBigUint64(tag.length, account, false);
  view.setBigUint64(tag.length + 8, sequence, false);
  return `0x${[...keccak_256(packed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** SLOP base units (18 decimals) for the deposit at a rate, rounded up to a whole SLOP; null without a rate. */
export function standingDepositAmount(slopPerUsd) {
  if (slopPerUsd === null || slopPerUsd === undefined) return null;
  const numerator =
    BigInt(STANDING_DEPOSIT_USD_MINOR) * slopRateScaled(slopPerUsd);
  const denominator = 10n ** BigInt(SUBMISSION_FEE_STABLE_DECIMALS) * ONE_SLOP;
  const whole = (numerator + denominator - 1n) / denominator;
  return (whole * ONE_SLOP).toString();
}

/** True once the contract address and start block are recorded. */
export function standingDepositDeployed(
  contract = STANDING_DEPOSIT_CONTRACT,
  startBlock = STANDING_DEPOSIT_START_BLOCK,
) {
  return (
    typeof contract === "string" &&
    ADDRESS.test(contract) &&
    Number.isSafeInteger(startBlock) &&
    startBlock >= 0
  );
}

/**
 * True unless the project's owner refused standing deposits:
 * `project.slopbot.submissionFee.standingDeposits !== false`. Absent is on.
 */
export function standingDepositsAccepted(project) {
  return project?.slopbot?.submissionFee?.standingDeposits !== false;
}

/**
 * When the deposit stops covering new pull requests: the withdrawal request,
 * or `STANDING_DEPOSIT_COVER_DAYS` after payment, whichever is first. Null
 * for an unpaid deposit.
 */
export function standingCoverEndsAt(deposit) {
  const paid = Date.parse(deposit?.paidAt ?? "");
  if (!Number.isFinite(paid)) return null;
  const limit = paid + STANDING_DEPOSIT_COVER_DAYS * DAY_MS;
  const asked = Date.parse(deposit?.withdrawRequestedAt ?? "");
  return new Date(Number.isFinite(asked) ? Math.min(asked, limit) : limit);
}

/**
 * Whether a standing deposit covers a pull request opened at `openedAt`.
 * Every fact is read by the caller: the deposit (paid, no outcome, not
 * cancelled), the project's acceptance, whether the author has a merged
 * pull request on the project's repositories, and how many of the author's
 * covered pull requests are open now.
 */
export function standingDepositCovers(facts) {
  const { deposit, accepted, mergedOnProject, openCovered, openedAt } = facts;
  if (!accepted || mergedOnProject !== true) return false;
  if (!deposit || deposit.outcome !== null || deposit.cancelledAt) return false;
  const ends = standingCoverEndsAt(deposit);
  const opened = Date.parse(openedAt ?? "");
  if (ends === null || !Number.isFinite(opened)) return false;
  // A pull request opened before payment is covered once the deposit is
  // paid; its strike window starts at the later of opening and payment.
  if (opened >= ends.getTime()) return false;
  return (
    Number.isSafeInteger(openCovered) && openCovered < STANDING_DEPOSIT_OPEN_CAP
  );
}

/**
 * What a covered pull request means for its deposit now:
 * - `strike`: closed without a merge within the window, with `slop-keep-fee`,
 *   and both seen for the grace period: the deposit is kept.
 * - `pending`: closed and labelled, but not yet for the grace period.
 * - `clear`: merged, or past its window without a strike: it can never cost.
 * - `watch`: still open and inside its window.
 * `windowStart` is the later of the pull request's opening and the deposit's
 * payment. `strikeSeenAt` is when Slopbot first saw it closed and labelled.
 */
export function standingCoverState(facts, now) {
  const time = now.getTime();
  const start = Date.parse(facts.windowStart ?? "");
  if (facts.merged) return "clear";
  if (!Number.isFinite(start)) return "watch";
  const windowEnds = start + STANDING_DEPOSIT_STRIKE_WINDOW_DAYS * DAY_MS;
  const closedAt = Date.parse(facts.closedAt ?? "");
  const closedInWindow =
    facts.closed === true &&
    Number.isFinite(closedAt) &&
    closedAt <= windowEnds;
  if (closedInWindow && facts.keepMarked === true) {
    const seen = Date.parse(facts.strikeSeenAt ?? "");
    if (
      Number.isFinite(seen) &&
      time >= seen + STANDING_DEPOSIT_STRIKE_GRACE_HOURS * HOUR_MS
    )
      return "strike";
    return "pending";
  }
  // Closed inside the window without the label: a maintainer may still add
  // it until the window ends.
  return time > windowEnds ? "clear" : "watch";
}

/**
 * What is due on a paid standing deposit with no outcome yet:
 * `kept_due` when any of its covers is a strike, `refund_due` when the
 * withdrawal wait has passed after coverage ended and every cover is clear,
 * otherwise null. A cover still `watch` or `pending` holds the refund until
 * Slopbot checks it again, so a stale reading never sends a deposit back
 * ahead of a strike.
 */
export function standingDepositDue(deposit, coverStates, now) {
  if (!deposit || deposit.outcome !== null || !deposit.paidAt) return null;
  if (coverStates.includes("strike")) return "kept_due";
  const ends = standingCoverEndsAt(deposit);
  if (ends === null) return null;
  if (
    now.getTime() <
    ends.getTime() + STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS * DAY_MS
  )
    return null;
  if (coverStates.some((state) => state !== "clear")) return null;
  return "refund_due";
}
