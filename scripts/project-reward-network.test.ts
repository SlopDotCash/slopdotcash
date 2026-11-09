import { expect, test } from "bun:test";
import { rewardFields } from "../src/lib/project-proposal";
import {
  NETWORK_NAMES,
  REWARD_ASSET_NETWORKS,
  REWARD_ASSET_NETWORK_IDS,
  rewardAssetChoice,
} from "../src/lib/reward-asset.mjs";

test.each(["constructor", "__proto__", "toString"])(
  "an inherited object name %s is not a reward network",
  (network) => {
    expect(Object.hasOwn(REWARD_ASSET_NETWORKS, network)).toBe(false);
    expect((REWARD_ASSET_NETWORKS as unknown as Record<string, unknown>)[network]).toBeUndefined();
    for (const kind of ["stablecoin", "native", "token"] as const) {
      expect(() => rewardAssetChoice(network, kind, "", ""))
        .toThrow("Choose a supported reward network");
    }
    const unfunded = rewardFields({
      mode: "none", network, assetKind: "native", tokenAddress: "",
      tokenSymbol: "", monthlyAmount: "1",
    }, new Date("2026-11-09T00:00:00.000Z"));
    expect(unfunded).not.toHaveProperty("rewardAsset");
    expect(unfunded).not.toHaveProperty("escrow");
  },
);

test("the frozen reward network dictionary preserves its canonical picker order", () => {
  expect(Object.isFrozen(REWARD_ASSET_NETWORKS)).toBe(true);
  expect(Object.keys(REWARD_ASSET_NETWORKS)).toEqual(Object.keys(NETWORK_NAMES));
  expect(REWARD_ASSET_NETWORK_IDS).toEqual(Object.keys(NETWORK_NAMES));
  for (const network of REWARD_ASSET_NETWORK_IDS) {
    expect(rewardAssetChoice(network, "native", "", "").symbol)
      .toBe(REWARD_ASSET_NETWORKS[network].native.symbol);
    expect(rewardAssetChoice(network, "stablecoin", "", "").address)
      .toBe(REWARD_ASSET_NETWORKS[network].stablecoin.address);
  }
});
