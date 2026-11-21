// The shared constants and money rules of the security report deposit
// (PRD section 8, "Report deposit"; section 6, FEE-07).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  REPORT_DEPOSIT_KEEPING_CLOSES,
  REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS,
  REPORT_DEPOSIT_NETWORK,
  REPORT_DEPOSIT_REFUND_SILENT_DAYS,
  REPORT_DEPOSIT_SWITCHED_ON,
  REPORT_DEPOSIT_USD_MINOR,
  reportDepositAmount,
  reportDepositItem,
  reportDepositOn,
} from "../src/lib/security-report-deposit.mjs";
import {
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_TOKENS,
  submissionFeeItem,
} from "../src/lib/submission-fee.mjs";

test("the constants are the published rule", () => {
  expect(REPORT_DEPOSIT_NETWORK).toBe("robinhood-mainnet");
  expect(REPORT_DEPOSIT_USD_MINOR).toBe("5000000");
  expect(REPORT_DEPOSIT_REFUND_SILENT_DAYS).toBe(14);
  expect(REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS).toBe(7);
  expect(REPORT_DEPOSIT_KEEPING_CLOSES).toEqual([
    "spam",
    "duplicate",
    "out-of-scope",
  ]);
  // The deposit's network has SLOP and a contract in the fee tables.
  expect(SUBMISSION_FEE_TOKENS[REPORT_DEPOSIT_NETWORK].slop).toMatch(
    /^0x[0-9a-fA-F]{40}$/u,
  );
  expect(SUBMISSION_FEE_CONTRACTS[REPORT_DEPOSIT_NETWORK]).toMatch(
    /^0x[0-9a-fA-F]{40}$/u,
  );
});

test("the item is keccak256(abi.encodePacked('slop-report-v1', caseId))", () => {
  // Both vectors were computed outside this code, with Foundry:
  //   cast keccak "0x$(printf 'slop-report-v1<caseId>' | xxd -p | tr -d '\n')"
  // and, for the second, also
  //   cast keccak "$(cast abi-encode --packed 'f(string,string)' slop-report-v1 <caseId>)"
  expect(reportDepositItem("sc_0123456789abcdef0123456789abcdef")).toBe(
    "0x758d1ecb67e152773fe50eb67a9196eb49d390212345a082b6bdf59ae20c90b8",
  );
  expect(reportDepositItem("sc_a1B2c3D4e5F6g7H8")).toBe(
    "0xd7ae32628dda5038987d455629c88c960693530c77eea3149ce0351115436868",
  );
});

test("an item needs a real case id and never equals a pull request's item", () => {
  for (const bad of [
    "",
    "sc_",
    "sc_short",
    "ss_0123456789abcdef",
    "sc_0123456789abcdef\n",
    "sc_01234567 9abcdef",
    42,
    null,
    undefined,
  ])
    expect(() => reportDepositItem(bad as string)).toThrow(TypeError);
  // The tag differs, so no case id can produce a pull request's item.
  expect(reportDepositItem("sc_0123456789abcdef")).not.toBe(
    submissionFeeItem(1, 1),
  );
  expect(reportDepositItem("sc_0123456789abcdef")).not.toBe(
    reportDepositItem("sc_0123456789abcdeg"),
  );
});

test("the amount is 5 dollars of SLOP at the rate, rounded up to a whole SLOP", () => {
  const whole = (slop: bigint) => (slop * 10n ** 18n).toString();
  // 5 x 78.908929 = 394.544645, so 395 whole SLOP.
  expect(reportDepositAmount("78.908929")).toBe(whole(395n));
  // An exact product is not rounded further.
  expect(reportDepositAmount("79")).toBe(whole(395n));
  expect(reportDepositAmount("80")).toBe(whole(400n));
  // The smallest fraction above a whole SLOP still rounds up.
  expect(reportDepositAmount("80.000000000000000001")).toBe(whole(401n));
  // A very strong SLOP still costs one whole SLOP, never zero.
  expect(reportDepositAmount("0.000001")).toBe(whole(1n));
  expect(reportDepositAmount("0.2")).toBe(whole(1n));
  expect(reportDepositAmount("0.200001")).toBe(whole(2n));
});

test("without a rate there is no amount, and a malformed rate is refused", () => {
  expect(reportDepositAmount(null)).toBeNull();
  expect(reportDepositAmount(undefined)).toBeNull();
  for (const bad of ["", "0", "0.0", "-1", "1e3", "abc", " 5", 5])
    expect(() => reportDepositAmount(bad as string)).toThrow(TypeError);
});

test("the deposit is on unless the project turned it off", () => {
  expect(reportDepositOn({})).toBe(true);
  expect(reportDepositOn({ security: {} })).toBe(true);
  expect(reportDepositOn({ security: { reportDeposit: true } })).toBe(true);
  expect(reportDepositOn({ security: { reportDeposit: false } })).toBe(false);
  expect(reportDepositOn(null)).toBe(true);
  expect(reportDepositOn(undefined)).toBe(true);
});

test("the browser switch says on only while the server asks for the deposit", () => {
  // `SECURITY_REPORT_DEPOSIT` in wrangler.toml is the production mode. The
  // pay page and the report form offer the deposit only when this constant
  // is true, so the two change in the same reviewed change.
  const production = Bun.TOML.parse(readFileSync("wrangler.toml", "utf8")) as {
    vars: { SECURITY_REPORT_DEPOSIT?: string };
  };
  expect(["off", "dry_run", "live"]).toContain(
    production.vars.SECURITY_REPORT_DEPOSIT as string,
  );
  expect(REPORT_DEPOSIT_SWITCHED_ON).toBe(
    production.vars.SECURITY_REPORT_DEPOSIT === "live",
  );
  // Staging never asks: it has no SLOP and no deposit contract.
  const staging = Bun.TOML.parse(
    readFileSync("wrangler.staging.toml", "utf8"),
  ) as { vars: { SECURITY_REPORT_DEPOSIT?: string } };
  expect(staging.vars.SECURITY_REPORT_DEPOSIT).toBe("off");
});
