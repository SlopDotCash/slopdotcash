// Mainnet payout execution is on only for networks a reviewed change enabled.
import { describe, expect, test } from "bun:test";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import {
  MAINNET_EXECUTION,
  mainnetExecutionEnabled,
} from "./mainnet-execution.mjs";

describe("MAINNET_EXECUTION", () => {
  test("lists every registry mainnet, and only Base is on", () => {
    const mainnets = Object.entries(ESCROW_NETWORKS)
      .filter(([, network]) => !network.testnet)
      .map(([name]) => name)
      .sort();
    expect(Object.keys(MAINNET_EXECUTION).sort()).toEqual(mainnets);
    expect(
      Object.entries(MAINNET_EXECUTION)
        .filter(([, on]) => on === true)
        .map(([name]) => name),
    ).toEqual(["base-mainnet"]);
    expect(mainnetExecutionEnabled("base-mainnet")).toBe(true);
    for (const name of [
      ...mainnets.filter((name) => name !== "base-mainnet"),
      "base-sepolia",
      "anvil",
      "toString",
      "__proto__",
    ])
      expect(mainnetExecutionEnabled(name)).toBe(false);
  });
});
