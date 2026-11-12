import { expect, test } from "bun:test";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { scanReferralLogs } from "./chain-logs";

const registeredPage = ESCROW_NETWORKS["robinhood-mainnet"].scanPageBlocks;
if (!registeredPage) throw new Error("robinhood-mainnet has no scan page");
const REGISTERED = BigInt(registeredPage);

/** Records each requested page and returns one marker per page. */
async function pages(first: bigint, last: bigint, pageBlocks?: bigint) {
  const seen: [bigint, bigint][] = [];
  const results = await scanReferralLogs(
    "robinhood-mainnet",
    first,
    last,
    async (from, to) => {
      seen.push([from, to]);
      return [`${from}-${to}`];
    },
    pageBlocks,
  );
  return { seen, results };
}

/** Every block from first to last appears in exactly one page, in order. */
function expectExactCover(
  seen: [bigint, bigint][],
  first: bigint,
  last: bigint,
) {
  expect(seen[0][0]).toBe(first);
  expect(seen[seen.length - 1][1]).toBe(last);
  for (let index = 0; index < seen.length; index += 1) {
    expect(seen[index][0] <= seen[index][1]).toBe(true);
    if (index > 0) expect(seen[index][0]).toBe(seen[index - 1][1] + 1n);
  }
}

test("a wider page covers the same blocks in fewer requests", async () => {
  const first = 111_162_445n;
  const last = first + 2_500_000n;
  const registered = await pages(first, last);
  const wide = await pages(first, last, 1_000_000n);

  expectExactCover(registered.seen, first, last);
  expectExactCover(wide.seen, first, last);
  expect(registered.seen.length).toBe(Number(2_500_001n / REGISTERED) + 1);
  expect(wide.seen).toEqual([
    [first, first + 999_999n],
    [first + 1_000_000n, first + 1_999_999n],
    [first + 2_000_000n, last],
  ]);
  expect(wide.results).toHaveLength(3);
});

test("a range that ends on a page boundary reads no block twice", async () => {
  const { seen } = await pages(10n, 29n, 10n);
  expect(seen).toEqual([
    [10n, 19n],
    [20n, 29n],
  ]);
});

test("a failed page rejects the scan instead of returning a partial range", async () => {
  let calls = 0;
  const scan = scanReferralLogs(
    "robinhood-mainnet",
    0n,
    2_999_999n,
    async () => {
      calls += 1;
      if (calls === 2) throw new Error("range refused");
      return ["log"];
    },
    1_000_000n,
  );
  await expect(scan).rejects.toThrow("range refused");
  expect(calls).toBe(2);
});

test("a page below one block is refused before any read", async () => {
  let calls = 0;
  const scan = scanReferralLogs(
    "robinhood-mainnet",
    0n,
    10n,
    async () => {
      calls += 1;
      return [];
    },
    0n,
  );
  await expect(scan).rejects.toThrow("at least one block");
  expect(calls).toBe(0);
});
