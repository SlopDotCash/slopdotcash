import { expect, test } from "bun:test";
import { handleSolanaMonthLock } from "./solana-month-lock";

const OWNER = "So11111111111111111111111111111111111111112";
const BLOCKHASH = "SysvarC1ock11111111111111111111111111111111";

const request = (body: unknown) =>
  new Request(
    "https://slop.cash/api/v1/payments/projects/demo/solana-month-lock",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

test("a malformed lock or release request is refused before any chain read", async () => {
  let resolved = 0;
  const resolve = async () => {
    resolved++;
    throw new Error("not reached");
  };
  for (const body of [
    {
      step: "review",
      action: "lock",
      network: "solana-mainnet",
      vault: "v",
      wallet: OWNER,
      count: 2,
      amount: "1",
    },
    {
      step: "review",
      action: "release",
      network: "solana-mainnet",
      vault: "v",
      wallet: OWNER,
      period: "2026-13",
    },
    {
      step: "check",
      action: "release",
      network: "solana-mainnet",
      vault: "v",
      wallet: OWNER,
      periods: [202612, 202701],
      blockhash: BLOCKHASH,
      transactionId: "x",
    },
    {
      step: "review",
      action: "withdraw",
      network: "solana-mainnet",
      vault: "v",
      wallet: OWNER,
    },
  ]) {
    const response = await handleSolanaMonthLock(request(body), resolve);
    expect(response.status).toBe(400);
  }
  expect(resolved).toBe(0);
});
