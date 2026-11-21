/**
 * TEMPORARY COPY for the deposit Worker's branch. Session A (deposit-backend)
 * owns this file; drop this copy in favour of A's when A's change is merged.
 * The names and meanings are the shared interface's section 1
 * (drafts/security-deposit/2026-11-21-interface.md).
 *
 * The refundable SLOP deposit on a private security report (operator
 * decision, 21 November 2026). Token, contract, chain id, confirmations and
 * the burn address come from the tables in `submission-fee.mjs`.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { slopRateScaled } from "./submission-fee.mjs";

export const REPORT_DEPOSIT_NETWORK = "robinhood-mainnet";
export const REPORT_DEPOSIT_USD_MINOR = "5000000"; // 5.00 USD, six decimals
export const REPORT_DEPOSIT_REFUND_SILENT_DAYS = 14; // no response after payment
export const REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS = 7; // a keeping close must stand this long
export const REPORT_DEPOSIT_KEEPING_CLOSES = [
  "spam",
  "duplicate",
  "out-of-scope",
];

/** `keccak256(abi.encodePacked("slop-report-v1", utf8(caseId)))`, lowercase 0x hex. */
export function reportDepositItem(caseId) {
  if (typeof caseId !== "string" || caseId.length === 0)
    throw new TypeError("caseId must be a non-empty string");
  const encoder = new TextEncoder();
  const tag = encoder.encode("slop-report-v1");
  const id = encoder.encode(caseId);
  const packed = new Uint8Array(tag.length + id.length);
  packed.set(tag, 0);
  packed.set(id, tag.length);
  return `0x${[...keccak_256(packed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** SLOP base units (18 decimals) for the deposit at a rate, rounded up to a whole SLOP; null without a rate. */
export function reportDepositAmount(slopPerUsd) {
  if (slopPerUsd === null || slopPerUsd === undefined) return null;
  const one = 10n ** 18n;
  // Dollars (six decimals) times SLOP base units per dollar.
  const exact =
    (BigInt(REPORT_DEPOSIT_USD_MINOR) * slopRateScaled(slopPerUsd)) /
    1_000_000n;
  const whole = (exact + one - 1n) / one;
  return (whole * one).toString();
}

/** True unless the project turned it off: `project.security?.reportDeposit !== false`. */
export function reportDepositOn(project) {
  return project?.security?.reportDeposit !== false;
}
