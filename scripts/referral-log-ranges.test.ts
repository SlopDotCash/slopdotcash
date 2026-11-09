import { expect, test } from "bun:test";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { scanReferralLogs } from "../workers/referral-accrual/chain-logs";

const network = "robinhood-testnet";
const size = BigInt(ESCROW_NETWORKS[network].scanPageBlocks!);

test("referral range reads use inclusive nonoverlapping pages and retain reply order and duplicates", async () => {
  const ranges: [bigint, bigint][] = [];
  const result = await scanReferralLogs(network, 5n, 5n + size * 2n, async (from, to) => {
    ranges.push([from, to]);
    return ranges.length === 1 ? [2, 1] : ranges.length === 2 ? [1, 1] : [3];
  });
  expect(ranges).toEqual([
    [5n, 5n + size - 1n],
    [5n + size, 5n + size * 2n - 1n],
    [5n + size * 2n, 5n + size * 2n],
  ]);
  expect(result).toEqual([2, 1, 1, 1, 3]);
});

test("range reads are sequential and do not start the next page before the previous reply", async () => {
  const ranges: [bigint, bigint][] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = scanReferralLogs(network, 1n, size + 1n, async (from, to) => {
    ranges.push([from, to]);
    if (ranges.length === 1) await gate;
    return [from];
  });
  expect(ranges).toEqual([[1n, size]]);
  release();
  expect(await pending).toEqual([1n, size + 1n]);
  expect(ranges).toEqual([[1n, size], [size + 1n, size + 1n]]);
});

test("a failed later page exposes no partial result and a new invocation restarts its first block", async () => {
  const ranges: [bigint, bigint][] = [];
  let fail = true;
  const read = async (from: bigint, to: bigint) => {
    ranges.push([from, to]);
    if (fail && from > 7n) throw new Error("page unavailable");
    return [from];
  };
  await expect(scanReferralLogs(network, 7n, 7n + size, read)).rejects.toThrow("page unavailable");
  fail = false;
  expect(await scanReferralLogs(network, 7n, 7n + size, read)).toEqual([7n, 7n + size]);
  expect(ranges).toEqual([[7n, 7n + size - 1n], [7n + size, 7n + size], [7n, 7n + size - 1n], [7n + size, 7n + size]]);
});

test("an empty range makes no calls and a single block is still queried", async () => {
  const ranges: [bigint, bigint][] = [];
  const read = async (from: bigint, to: bigint) => { ranges.push([from, to]); return []; };
  expect(await scanReferralLogs(network, 4n, 3n, read)).toEqual([]);
  expect(ranges).toEqual([]);
  expect(await scanReferralLogs(network, 4n, 4n, read)).toEqual([]);
  expect(ranges).toEqual([[4n, 4n]]);
});

test("a network without a configured log range refuses even an empty interval", async () => {
  let called = false;
  await expect(scanReferralLogs("solana-mainnet" as Parameters<typeof scanReferralLogs>[0], 4n, 3n, async () => {
    called = true;
    return [];
  })).rejects.toThrow("Referral event scan range is not configured");
  expect(called).toBe(false);
});
