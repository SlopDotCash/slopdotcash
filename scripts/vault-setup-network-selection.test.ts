import { expect, test } from "bun:test";
import type { PagesEnv } from "../backend/pages";
import { vaultSetupNetworks } from "../functions/api/v1/[[path]]";
import { mainnetExecutionEnabled } from "../workers/payment-executor/mainnet-execution.mjs";

test("reviewed owner setup does not require or activate a payment signer", () => {
  const env = {
    PAYMENT_NETWORKS: '["base-mainnet"]',
    PAYMENT_RPC_URLS: JSON.stringify({
      "robinhood-mainnet": "https://rpc.example.invalid/robinhood",
      "solana-mainnet": "https://rpc.example.invalid/solana",
      ethereum: "http://insecure.example.invalid",
      unknown: "https://rpc.example.invalid/unknown",
    }),
  } as PagesEnv;
  expect(vaultSetupNetworks(env)).toEqual([
    "base-mainnet",
    "robinhood-mainnet",
    "solana-mainnet",
  ]);
  expect(mainnetExecutionEnabled("robinhood-mainnet")).toBe(false);
  expect(mainnetExecutionEnabled("solana-mainnet")).toBe(false);
  expect(vaultSetupNetworks({ PAYMENT_NETWORKS: "[]" } as PagesEnv)).toEqual(
    [],
  );
});
