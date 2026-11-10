/**
 * Frontend wallet-request utilities keep one saved request per tab.
 *
 * F4: clearing a saved request must use the same attempt identity as
 * updating it, so a record rewritten with its keys in a different order
 * can still be cleared (PRD section 6: "Keep uncertain attempts until
 * reconciliation; a missing receipt is not failure proof.").
 * F5: checking whether a vault-setup attempt is still current must not
 * rewrite the saved record, so a submitted hash survives the check
 * (PRD section 3: "Preserve the first-registration proof, pending
 * attempts, uncertain attempts, and replay protection.").
 * F6: the 75/25 security bounty split must be exact (PRD section 8:
 * "The standard split is 75% to the researcher and 25% to Slop. Its
 * gross amount must divide by four in asset base units. An authorized
 * full-award exception pays 100% to the researcher and needs no such
 * divisibility rule.").
 * Model: formal/models/ui/ui_owner_vault_setup_storage.qnt.
 */
import { beforeEach, expect, test } from "bun:test";
import {
  clearPendingAttempt,
  updatePendingAttempt,
} from "../src/lib/pending-attempt";
import { vaultSetupAttempt } from "../src/lib/vault-setup-attempt";
import { securityBountyShares } from "../src/lib/verified-security-split";

const key = "slop:frontend-utils:v1:example";
const store = new Map<string, string>();
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});
beforeEach(() => store.clear());

const attemptId = "6f1c2b1e-1d2a-4c3b-8a4d-5e6f7a8b9c0d";
const otherAttemptId = "7a2d3c2f-2e3b-4d4c-9b5e-6f7a8b9c0d1e";
const record = {
  version: 1 as const,
  attemptId,
  input: { network: "base-sepolia" },
  hash: null as string | null,
};
const hash = `0x${"ab".repeat(32)}`;

test("F4: clear removes a record rewritten with its keys in another order", () => {
  store.set(key, JSON.stringify({ attemptId, hash: null }));
  // The same content written back with its keys in a different order.
  store.set(key, JSON.stringify({ hash: null, attemptId }));
  expect(updatePendingAttempt(key, { attemptId }, { attemptId })).toBe(true);
  // Restore the reordered record: update rewrote it in canonical order.
  store.set(key, JSON.stringify({ hash: null, attemptId }));
  expect(clearPendingAttempt(key, { ...record })).toBe(true);
  expect(store.has(key)).toBe(false);
});

test("F4: clear still refuses a different attempt", () => {
  store.set(key, JSON.stringify({ attemptId, hash: null }));
  expect(
    clearPendingAttempt(key, { ...record, attemptId: otherAttemptId }),
  ).toBe(false);
  expect(store.has(key)).toBe(true);
});

test("F5: stillCurrent does not erase a submitted hash", () => {
  const attempt = vaultSetupAttempt(key, record);
  expect(attempt.begin()).toBe(true);
  expect(attempt.submitted(hash)).toBe(true);
  expect(JSON.parse(store.get(key) ?? "null")).toEqual({ ...record, hash });
  expect(attempt.stillCurrent()).toBe(true);
  expect(JSON.parse(store.get(key) ?? "null")).toEqual({ ...record, hash });
});

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
