/**
 * F6: the 75/25 security bounty split must be exact (PRD section 8:
 * "The standard split is 75% to the researcher and 25% to Slop. Its
 * gross amount must divide by four in asset base units. An authorized
 * full-award exception pays 100% to the researcher and needs no such
 * divisibility rule.").
 * Model: formal/models/ui/ui_owner_vault_setup_storage.qnt.
 */
import { expect, test } from "bun:test";
import { securityBountyShares } from "../src/lib/verified-security-split";

test("F6: a non-divisible gross is rejected instead of dropping the remainder", () => {
  expect(() => securityBountyShares(10001n, false)).toThrow(RangeError);
  expect(securityBountyShares(10000n, false)).toEqual({
    researcher: 7500n,
    slop: 2500n,
  });
});

test("F6: a full award still pays the whole gross without a divisibility rule", () => {
  expect(securityBountyShares(10001n, true)).toEqual({
    researcher: 10001n,
    slop: 0n,
  });
});
