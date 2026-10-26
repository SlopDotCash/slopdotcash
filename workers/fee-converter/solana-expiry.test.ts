import { expect, test } from "bun:test";
import {
  proveSolanaExpiry,
  type RecoveryRpc,
  recoveryOperator,
} from "./solana-expiry";

const genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
function provider(operator: string, override: Record<string, unknown> = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const values: Record<string, unknown> = {
    getGenesisHash: genesis,
    getFirstAvailableBlock: 90,
    getBlock: { blockhash: "signed-blockhash" },
    isBlockhashValid: { context: { slot: 300 }, value: false },
    getSignatureStatuses: { context: { slot: 301 }, value: [null] },
    getTransaction: null,
    ...override,
  };
  const rpc: RecoveryRpc = async <T>(method: string, params: unknown[]) => {
    calls.push({ method, params });
    const value = values[method];
    if (value instanceof Error) throw value;
    return value as T;
  };
  return { operator, rpc, calls };
}
test("expired Solana bytes need two independent providers with complete landing-window history", async () => {
  const a = provider("alchemy"),
    b = provider("allnodes-publicnode");
  const proof = await proveSolanaExpiry(
    "signed-transaction",
    "signed-blockhash",
    100,
    [a, b],
  );
  expect(proof?.providers).toHaveLength(2);
  for (const p of [a, b]) {
    expect(
      p.calls.find((c) => c.method === "getSignatureStatuses")?.params,
    ).toEqual([["signed-transaction"], { searchTransactionHistory: true }]);
    expect(
      p.calls.find((c) => c.method === "isBlockhashValid")?.params,
    ).toEqual([
      "signed-blockhash",
      { commitment: "finalized", minContextSlot: 100 },
    ]);
    expect(p.calls.find((c) => c.method === "getTransaction")?.params).toEqual([
      "signed-transaction",
      {
        commitment: "finalized",
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
      },
    ]);
  }
});
for (const [name, override] of Object.entries({
  "pruned-history": { getFirstAvailableBlock: 101 },
  "missing-history": { getFirstAvailableBlock: null },
  "wrong-cluster": { getGenesisHash: "other-chain" },
  "wrong-fork-anchor": { getBlock: { blockhash: "other-blockhash" } },
  "missing-anchor": { getBlock: null },
  "still-valid": { isBlockhashValid: { context: { slot: 300 }, value: true } },
  "missing-expiry": { isBlockhashValid: { context: { slot: 300 } } },
  "stale-expiry": { isBlockhashValid: { context: { slot: 99 }, value: false } },
  "landed-signature": {
    getSignatureStatuses: {
      context: { slot: 301 },
      value: [{ confirmationStatus: "finalized" }],
    },
  },
  "stale-status": {
    getSignatureStatuses: { context: { slot: 299 }, value: [null] },
  },
  "missing-status": {
    getSignatureStatuses: { context: { slot: 301 }, value: [] },
  },
  "landed-receipt": { getTransaction: { meta: { err: null } } },
  "failed-landed-receipt": {
    getTransaction: { meta: { err: { InstructionError: [0, "error"] } } },
  },
}))
  test(`expiry disagreement preserves the liability: ${name}`, async () => {
    expect(
      await proveSolanaExpiry("tx", "signed-blockhash", 100, [
        provider("alchemy"),
        provider("allnodes-publicnode", override),
      ]),
    ).toBeNull();
  });
test("provider faults and aliases cannot release native gas", async () => {
  await expect(
    proveSolanaExpiry("tx", "signed-blockhash", 100, [
      provider("alchemy"),
      provider("allnodes-publicnode", {
        getTransaction: new Error("provider unavailable"),
      }),
    ]),
  ).rejects.toThrow("unavailable");
  expect(
    await proveSolanaExpiry("tx", "signed-blockhash", 100, [
      provider("alchemy"),
      provider("alchemy"),
    ]),
  ).toBeNull();
  expect(
    recoveryOperator("https://solana-mainnet.g.alchemy.com/v2/private"),
  ).toBe("alchemy");
  expect(recoveryOperator("https://another.g.alchemy.com/v2/private")).toBe(
    "alchemy",
  );
  expect(recoveryOperator("https://unreviewed.invalid")).toBeNull();
  expect(recoveryOperator("http://solana-rpc.publicnode.com")).toBeNull();
});
