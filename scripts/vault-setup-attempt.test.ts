/**
 * Vault creation keeps one saved wallet request per project tab (PRD section
 * 6). A wallet result that arrives after its view was replaced must not
 * recreate a slot the owner cleared, nor erase a newer request.
 * Model: formal/models/ui/ui_owner_vault_setup_storage.qnt.
 */
import { beforeEach, expect, test } from "bun:test";
import { clearPendingAttempt } from "../src/lib/pending-attempt";
import { vaultSetupAttempt } from "../src/lib/vault-setup-attempt";

const key = "slop:vault-setup:v1:example";
const store = new Map<string, string>();
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});
beforeEach(() => store.clear());

const record = (attemptId: string) => ({
  version: 1 as const,
  attemptId,
  input: { network: "base-sepolia" },
  hash: null as string | null,
});
const first = record("6f1c2b1e-1d2a-4c3b-8a4d-5e6f7a8b9c0d");
const second = record("7a2d3c2f-2e3b-4d4c-9b5e-6f7a8b9c0d1e");
const hash = `0x${"ab".repeat(32)}`;

test("a late wallet hash cannot recreate a request the owner cleared", () => {
  const late = vaultSetupAttempt(key, first);
  expect(late.begin()).toBe(true);
  // A remounted view restores the record and the owner clears it.
  expect(clearPendingAttempt(key, first)).toBe(true);
  expect(late.submitted(hash)).toBe(false);
  expect(store.has(key)).toBe(false);
});

test("a late decline cannot erase a newer request", () => {
  const late = vaultSetupAttempt(key, first);
  expect(late.begin()).toBe(true);
  expect(clearPendingAttempt(key, first)).toBe(true);
  const retry = vaultSetupAttempt(key, second);
  expect(retry.begin()).toBe(true);
  expect(late.declined()).toBe(false);
  expect(late.stillCurrent()).toBe(false);
  expect(JSON.parse(store.get(key) ?? "null")).toEqual(second);
  expect(retry.submitted(hash)).toBe(true);
  expect(JSON.parse(store.get(key) ?? "null")).toEqual({ ...second, hash });
});

test("a new request cannot overwrite a saved one, and its own results apply", () => {
  expect(vaultSetupAttempt(key, first).begin()).toBe(true);
  expect(vaultSetupAttempt(key, second).begin()).toBe(false);
  expect(JSON.parse(store.get(key) ?? "null")).toEqual(first);
  const own = vaultSetupAttempt(key, first);
  expect(own.stillCurrent()).toBe(true);
  expect(own.declined()).toBe(true);
  expect(store.has(key)).toBe(false);
});
