// Kept submission fees as fee income: only a stablecoin deposit the contract
// sent to this fee wallet, recorded as kept from finalized evidence, counts.
import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { D1BuybackStore } from "./buyback-store";
import { NETWORK_DEFINITIONS } from "./config";

const WALLET = "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86";
const BURN = "0x000000000000000000000000000000000000dEaD";
const USDC = NETWORK_DEFINITIONS.base.usdc as string;
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const SLOP = "0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae";
const SINCE = "2026-11-12T00:00:00.000Z";

function harness() {
  const { db, sqlite } = sqliteD1();
  let id = 0;
  const deposit = (fields: Record<string, string | number | null> = {}) => {
    id += 1;
    const row = {
      network: "base-mainnet",
      deposit_id: id,
      item: `0x${"1".repeat(64)}`,
      payer: `0x${"a".repeat(40)}`,
      token: USDC,
      amount: "2000000",
      kept_to: WALLET.toLowerCase(),
      tx_hash: `0x${id.toString(16).padStart(64, "0")}`,
      block_number: 100 + id,
      block_time: "2026-12-01T00:00:00.000Z",
      finalized_at: "2026-12-01T00:20:00.000Z",
      accepted: 1,
      state: "kept",
      resolve_tx: `0x${(1000 + id).toString(16).padStart(64, "0")}`,
      resolved_at: "2026-12-09T00:00:00.000Z",
      ...fields,
    };
    const keys = Object.keys(row);
    sqlite
      .query(
        `INSERT INTO submission_fee_deposits (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      )
      .run(...Object.values(row));
  };
  const store = new D1BuybackStore(db as never);
  return { deposit, store };
}

test("kept stablecoin fees sent to the fee wallet are fee income of that network and asset", async () => {
  const { deposit, store } = harness();
  expect(await store.feeIncome("base", USDC, WALLET, SINCE)).toBe(0n);
  deposit();
  deposit({ amount: "5000000" });
  deposit({ network: "robinhood-mainnet", token: USDG, amount: "3000000" });
  expect(await store.feeIncome("base", USDC, WALLET, SINCE)).toBe(7_000_000n);
  expect(await store.feeIncome("robinhood", USDG, WALLET, SINCE)).toBe(
    3_000_000n,
  );
  // Another asset, or another wallet, sees none of it.
  expect(await store.feeIncome("base", USDG, WALLET, SINCE)).toBe(0n);
  expect(await store.feeIncome("robinhood", USDC, WALLET, SINCE)).toBe(0n);
  expect(
    await store.feeIncome("base", USDC, `0x${"7".repeat(40)}`, SINCE),
  ).toBe(0n);
  expect(await store.feeIncome("ethereum", USDC, WALLET, SINCE)).toBe(0n);
});

test("a refund, a reclaim and a deposit not yet resolved are not income", async () => {
  const { deposit, store } = harness();
  deposit({ state: "refunded" });
  deposit({ state: "reclaimed" });
  deposit({ state: "kept_due", resolve_tx: null, resolved_at: null });
  deposit({ state: "open", resolve_tx: null, resolved_at: null });
  // A row that claims kept without its finalized evidence.
  deposit({ finalized_at: null });
  deposit({ resolve_tx: null });
  deposit({ accepted: 0 });
  expect(await store.feeIncome("base", USDC, WALLET, SINCE)).toBe(0n);
});

test("kept SLOP goes to the burn address and is never income", async () => {
  const { deposit, store } = harness();
  deposit({
    network: "robinhood-mainnet",
    token: SLOP,
    amount: "75000000000000000000",
    kept_to: BURN.toLowerCase(),
  });
  expect(await store.feeIncome("robinhood", SLOP, WALLET, SINCE)).toBe(0n);
  expect(await store.feeIncome("robinhood", USDG, WALLET, SINCE)).toBe(0n);
});

test("only fees kept at or after the start instant count", async () => {
  const { deposit, store } = harness();
  deposit({ resolved_at: "2026-11-11T23:59:59.000Z" });
  deposit({ resolved_at: SINCE, amount: "1000000" });
  expect(await store.feeIncome("base", USDC, WALLET, SINCE)).toBe(1_000_000n);
});

test("a stored amount that is not a whole number refuses the total", async () => {
  const { deposit, store } = harness();
  deposit({ amount: "2.5" });
  await expect(store.feeIncome("base", USDC, WALLET, SINCE)).rejects.toThrow(
    "Kept submission fee has an invalid amount",
  );
});

test("a kept Solana USDC fee is income of the Solana fee wallet, by exact address", async () => {
  const { deposit, store } = harness();
  const mint = NETWORK_DEFINITIONS.solana.usdc as string;
  const wallet = "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY";
  const row = {
    network: "solana-mainnet",
    token: mint,
    kept_to: wallet,
    payer: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    tx_hash: "5".repeat(88),
    resolve_tx: "6".repeat(88),
  };
  deposit(row);
  deposit({ ...row, state: "refunded" });
  // Base58 is case-sensitive: another spelling is another address.
  deposit({ ...row, kept_to: wallet.toLowerCase() });
  deposit({ ...row, token: mint.toLowerCase() });
  expect(await store.feeIncome("solana", mint, wallet, SINCE)).toBe(2_000_000n);
  expect(
    await store.feeIncome("solana", mint.toLowerCase(), wallet, SINCE),
  ).toBe(2_000_000n);
  expect(await store.feeIncome("base", USDC, WALLET, SINCE)).toBe(0n);
});
