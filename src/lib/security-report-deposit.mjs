/**
 * The refundable deposit on a private security report (operator decision,
 * 21 November 2026; PRD section 8, "Report deposit"; section 6, FEE-07).
 *
 * A report filed through Slop needs a deposit of SLOP on Robinhood Chain
 * worth 5 US dollars at Slop's published SLOP rate, rounded up to a whole
 * SLOP. It sits in the `SubmissionDeposits` contract. It is sent back unless
 * the report is closed as spam, a duplicate or out of scope and that close
 * stands for seven days; a kept deposit goes to the burn address.
 *
 * This file holds the constants every part shares and the pure rules: the
 * report's item hash, the SLOP amount at a rate, and whether a project has
 * the deposit on. The token, contract, chain id, confirmations and burn
 * address come from the tables in `submission-fee.mjs`. It reads no chain,
 * database or clock.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  SUBMISSION_FEE_SLOP_DECIMALS,
  SUBMISSION_FEE_STABLE_DECIMALS,
  slopRateScaled,
} from "./submission-fee.mjs";

export const REPORT_DEPOSIT_NETWORK = "robinhood-mainnet";
export const REPORT_DEPOSIT_USD_MINOR = "5000000"; // 5.00 USD, six decimals
export const REPORT_DEPOSIT_REFUND_SILENT_DAYS = 14; // no response after payment
export const REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS = 7; // a keeping close must stand this long
export const REPORT_DEPOSIT_KEEPING_CLOSES = [
  "spam",
  "duplicate",
  "out-of-scope",
];
/**
 * True only while the server asks reporters for the deposit, which is while
 * `SECURITY_REPORT_DEPOSIT` in `wrangler.toml` is `live`. The pay page and
 * the report form offer nothing while this is false. A test holds the two
 * together; change them in the same reviewed change.
 */
export const REPORT_DEPOSIT_SWITCHED_ON = true;

/** The Slop case id of a private report (`CASE_ID` in the case store). */
const CASE_ID = /^sc_[A-Za-z0-9_-]{8,72}$/u;
const ONE_SLOP = 10n ** BigInt(SUBMISSION_FEE_SLOP_DECIMALS);

/** `keccak256(abi.encodePacked("slop-report-v1", utf8(caseId)))`, lowercase 0x hex. */
export function reportDepositItem(caseId) {
  if (typeof caseId !== "string" || !CASE_ID.test(caseId))
    throw new TypeError("caseId must be a Slop case id");
  const packed = new TextEncoder().encode(`slop-report-v1${caseId}`);
  return `0x${[...keccak_256(packed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** SLOP base units (18 decimals) for the deposit at a rate, rounded up to a whole SLOP; null without a rate. */
export function reportDepositAmount(slopPerUsd) {
  if (slopPerUsd === null || slopPerUsd === undefined) return null;
  // usd / 10^6 dollars, times whole SLOP per dollar (scaled by 10^18),
  // divided back to whole SLOP and rounded up.
  const numerator =
    BigInt(REPORT_DEPOSIT_USD_MINOR) * slopRateScaled(slopPerUsd);
  const denominator = 10n ** BigInt(SUBMISSION_FEE_STABLE_DECIMALS) * ONE_SLOP;
  const whole = (numerator + denominator - 1n) / denominator;
  return (whole * ONE_SLOP).toString();
}

/** True unless the project turned it off: `project.security?.reportDeposit !== false`. */
export function reportDepositOn(project) {
  return project?.security?.reportDeposit !== false;
}
