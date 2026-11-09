import { expect, test } from "bun:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { EVM_NATIVE_ASSET, readVaultTotals } from "./adapter";

// Actual reader with deterministic RPC facts. These tests establish neither a
// live provider nor deployment verification; the wrapper owns that latter step.
const vault = `0x${"A".repeat(40)}`;
const token = `0x${"2".repeat(40)}`;
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const selector = (signature: string) => `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).toString("hex").slice(0, 8)}`;
function fixture(options: {
  counters?: bigint[]; asset?: string; decimals?: bigint; pending?: bigint;
  nativeBalance?: string; chain?: string; block?: string; timestamp?: string;
  malformed?: string; pendingFailure?: boolean;
} = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const counters = options.counters ?? [6n, 1n, 0n, 1n, 0n, 2n, 1n, 0n, 1n, 5n];
  const config = {
    vault, network: "base-mainnet", chainId: 8453n,
    request: async (method: string, params: unknown[]) => {
      calls.push({ method, params });
      if (method === "eth_chainId") return options.chain ?? "0x2105";
      if (method === "eth_getBlockByNumber") return { number: options.block ?? "0x20", timestamp: options.timestamp ?? "0x6553f100" };
      if (method === "eth_getBalance") return options.nativeBalance ?? "0x5";
      if (method !== "eth_call") throw new Error(`Unexpected RPC ${method}`);
      const data = (params[0] as { data: string }).data;
      if (data === selector("totals()")) return options.malformed ?? `0x${counters.map(word).join("")}`;
      if (data === selector("token()")) return `0x${"0".repeat(24)}${(options.asset ?? token).slice(2)}`;
      if (data === selector("decimals()")) return `0x${word(options.decimals ?? 6n)}`;
      if (data === selector("pendingMonthlyGross()")) {
        if (options.pendingFailure) throw new Error("pending getter unavailable");
        return `0x${word(options.pending ?? 1n)}`;
      }
      throw new Error("Unexpected getter");
    },
  };
  return { config, calls };
}

test("all counter and asset reads use the captured numeric finalized block", async () => {
  const { config, calls } = fixture();
  const totals = await readVaultTotals(config);
  expect(calls.filter((call) => call.method === "eth_getBlockByNumber")).toEqual([
    { method: "eth_getBlockByNumber", params: ["finalized", false] },
  ]);
  expect(calls.filter((call) => call.method === "eth_call").map((call) => call.params[1]))
    .toEqual(["0x20", "0x20", "0x20", "0x20"]);
  expect(totals).toMatchObject({ vault: vault.toLowerCase(), asset: token, blockNumber: "32",
    totalDeposited: "6", freeBalance: "2", reservedPrincipal: "1", reservedFees: "0", accruedFees: "1", reserved: "2" });
});

test("balanced legacy totals never require a pending getter", async () => {
  const { config, calls } = fixture({ counters: [5n, 1n, 0n, 1n, 0n, 2n, 1n, 0n, 1n, 4n], pendingFailure: true });
  const totals = await readVaultTotals(config);
  expect(totals.reserved).toBeNull();
  expect(calls.some((call) => call.method === "eth_call" && (call.params[0] as { data: string }).data === selector("pendingMonthlyGross()"))).toBe(false);
});

test("a pending reserve must explain the exact accounting gap", async () => {
  await expect(readVaultTotals(fixture({ pending: 2n }).config)).rejects.toThrow("do not conserve");
  await expect(readVaultTotals(fixture({ pendingFailure: true }).config)).rejects.toThrow("pending getter unavailable");
});

test("spent counters above deposits cannot be repaired with a pending reserve", async () => {
  const { config, calls } = fixture({ counters: [4n, 1n, 0n, 1n, 0n, 2n, 1n, 0n, 1n, 5n] });
  await expect(readVaultTotals(config)).rejects.toThrow("do not conserve");
  expect(calls).toHaveLength(5);
});

test("vault backing includes pending reserve and accrued fees", async () => {
  await expect(readVaultTotals(fixture({ counters: [6n, 1n, 0n, 1n, 0n, 2n, 1n, 0n, 1n, 4n] }).config))
    .rejects.toThrow("do not conserve");
  const result = await readVaultTotals(fixture({ counters: [6n, 1n, 0n, 1n, 0n, 2n, 1n, 0n, 1n, 7n] }).config);
  expect(result.freeBalance).toBe("2");
  expect(result.totalDeposited).toBe("6");
});

test("native totals require eighteen decimals and the same observed ETH balance", async () => {
  const good = fixture({ asset: EVM_NATIVE_ASSET, decimals: 18n });
  expect((await readVaultTotals(good.config)).asset).toBe(EVM_NATIVE_ASSET);
  expect(good.calls.find((call) => call.method === "eth_getBalance")?.params).toEqual([vault, "0x20"]);
  await expect(readVaultTotals(fixture({ asset: EVM_NATIVE_ASSET, decimals: 6n }).config))
    .rejects.toThrow("ETH balance");
  await expect(readVaultTotals(fixture({ asset: EVM_NATIVE_ASSET, decimals: 18n, nativeBalance: "0x6" }).config))
    .rejects.toThrow("ETH balance");
});

test("a wrong chain fails before any finalized block read", async () => {
  const { config, calls } = fixture({ chain: "0x1" });
  await expect(readVaultTotals(config)).rejects.toThrow("Wrong chain");
  expect(calls.map((call) => call.method)).toEqual(["eth_chainId"]);
});

test("malformed block quantities fail before counter getters", async () => {
  const { config, calls } = fixture({ block: "0x00" });
  await expect(readVaultTotals(config)).rejects.toThrow("Invalid RPC quantity");
  expect(calls).toHaveLength(2);
});

test("truncated ABI and oversized uint128 counters cannot return partial totals", async () => {
  const short = fixture({ malformed: "0x00" });
  await expect(readVaultTotals(short.config)).rejects.toThrow("Malformed vault totals");
  expect(short.calls).toHaveLength(3);
  await expect(readVaultTotals(fixture({ counters: [1n << 128n, 1n, 0n, 1n, 0n, 2n, 1n, 0n, 1n, 5n] }).config))
    .rejects.toThrow("Invalid uint128");
});

test("invalid asset decimals and timestamps refuse an otherwise balanced result", async () => {
  await expect(readVaultTotals(fixture({ decimals: 256n }).config)).rejects.toThrow("Malformed vault asset");
  await expect(readVaultTotals(fixture({ timestamp: "not-hex" }).config)).rejects.toThrow("Invalid RPC quantity");
});
