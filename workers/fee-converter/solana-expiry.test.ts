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
    const value =
      method === "getBlock" && !("getBlock" in override)
        ? {
            blockhash:
              params[0] === 100 ? "signed-blockhash" : `block-${params[0]}`,
            previousBlockhash:
              params[0] === 200
                ? "signed-blockhash"
                : params[0] === 100
                  ? "genesis-hash"
                  : "block-200",
            parentSlot: params[0] === 100 ? 0 : (params[0] as number) - 100,
            signatures: [],
          }
        : values[method];
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

test("masked history-index failure cannot release a send present in a landing-window block", async () => {
  const make = (operator: string) => {
    const ordinary = provider(operator);
    const rpc: RecoveryRpc = async <T>(method: string, params: unknown[]) => {
      if (method === "getBlock") {
        const at = params[0] as number;
        return {
          blockhash: at === 100 ? "signed-blockhash" : `block-${at}`,
          previousBlockhash:
            at === 200 ? "signed-blockhash" : `block-${at - 100}`,
          parentSlot: at - 100,
          signatures: at === 200 ? ["signed-transaction"] : [],
        } as T;
      }
      return ordinary.rpc<T>(method, params);
    };
    return { operator, rpc };
  };
  expect(
    await proveSolanaExpiry("signed-transaction", "signed-blockhash", 100, [
      make("alchemy"),
      make("allnodes-publicnode"),
    ]),
  ).toBeNull();
});

test("long finalized windows resume after restart without trusting null indexes", async () => {
  const records = new Map<string, import("./solana-expiry").ExpiryCoverage>();
  const pages: import("./solana-expiry").CoverageBlock[][] = [];
  const store: import("./solana-expiry").ExpiryCoverageStore = {
    read: async (tx, op) => structuredClone(records.get(`${tx}:${op}`) ?? null),
    save: async (previous, next, page) => {
      expect(previous?.revision ?? 0).toBe(
        records.get(`${next.txId}:${next.operator}`)?.revision ?? 0,
      );
      records.set(`${next.txId}:${next.operator}`, structuredClone(next));
      pages.push(page);
    },
  };
  let context = 180;
  const hash = (at: number) =>
    at === 100 ? "signed-blockhash" : `block-${at}`;
  function chain(operator: string): { operator: string; rpc: RecoveryRpc } {
    return {
      operator,
      rpc: async <T>(method: string, params: unknown[]) => {
        if (method === "getBlock") {
          const at = params[0] as number;
          return {
            blockhash: hash(at),
            previousBlockhash: hash(at - 1),
            parentSlot: at - 1,
            signatures: [],
          } as T;
        }
        if (method === "isBlockhashValid")
          return { context: { slot: context }, value: false } as T;
        if (method === "getSignatureStatuses")
          return { context: { slot: context + 1 }, value: [null] } as T;
        if (method === "getGenesisHash") return genesis as T;
        if (method === "getFirstAvailableBlock") return 0 as T;
        return null as T;
      },
    };
  }
  const services = [chain("alchemy"), chain("allnodes-publicnode")];
  expect(
    await proveSolanaExpiry("tx", "signed-blockhash", 100, services, store),
  ).toBeNull();
  expect(pages.map((p) => p.length)).toEqual([32, 32]);
  // The next cron sees a newer tip, but resumes the original expired horizon.
  context = 200;
  expect(
    await proveSolanaExpiry("tx", "signed-blockhash", 100, services, {
      ...store,
    }),
  ).toBeNull();
  const proof = await proveSolanaExpiry(
    "tx",
    "signed-blockhash",
    100,
    services,
    { ...store },
  );
  expect(proof?.providers.map((p) => p.coverage?.tipSlot)).toEqual([180, 180]);
  expect(proof?.providers.map((p) => p.coverage?.blocks)).toEqual([81, 81]);
  expect(proof?.providers.every((p) => p.coverage?.complete)).toBe(true);
  expect(pages.reduce((sum, p) => sum + p.length, 0)).toBe(162);
  const written = pages.length;
  expect(
    await proveSolanaExpiry("tx", "signed-blockhash", 100, services, store),
  ).not.toBeNull();
  expect(pages).toHaveLength(written);
});

for (const fault of [
  "missing-block",
  "missing-signatures",
  "broken-parent",
  "signature-found",
  "partial-error",
])
  test(`positive landing-window coverage refuses ${fault}`, async () => {
    const make = (operator: string) => {
      const base = provider(operator);
      const rpc: RecoveryRpc = async <T>(method: string, params: unknown[]) => {
        if (method !== "getBlock") return base.rpc<T>(method, params);
        const at = params[0] as number;
        if (at === 200 && fault === "partial-error")
          throw new Error("block archive unavailable");
        if (at === 200 && fault === "missing-block") return null as T;
        const block: {
          blockhash: string;
          previousBlockhash: string;
          parentSlot: number;
          signatures?: string[];
        } = {
          blockhash: at === 100 ? "signed-blockhash" : `block-${at}`,
          previousBlockhash: at === 200 ? "signed-blockhash" : "block-200",
          parentSlot: at - 100,
          signatures: [],
        };
        if (at === 200 && fault === "missing-signatures")
          delete block.signatures;
        if (at === 200 && fault === "broken-parent") block.parentSlot = 250;
        if (at === 200 && fault === "signature-found")
          block.signatures = ["tx"];
        return block as T;
      };
      return { operator, rpc };
    };
    const work = proveSolanaExpiry("tx", "signed-blockhash", 100, [
      make("alchemy"),
      make("allnodes-publicnode"),
    ]);
    if (fault === "partial-error")
      await expect(work).rejects.toThrow("archive unavailable");
    else expect(await work).toBeNull();
  });
