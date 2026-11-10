/**
 * Frontend wallet-request utilities keep one saved request per tab.
 *
 * F4: clearing a saved request must use the same attempt identity as
 * updating it, so a record rewritten with its keys in a different order
 * can still be cleared (PRD section 6: "Keep uncertain attempts until
 * reconciliation; a missing receipt is not failure proof.").
 * Model: formal/models/ui/ui_owner_vault_setup_storage.qnt.
 */
import { beforeEach, expect, test } from "bun:test";
import {
  clearPendingAttempt,
  updatePendingAttempt,
} from "../src/lib/pending-attempt";

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
