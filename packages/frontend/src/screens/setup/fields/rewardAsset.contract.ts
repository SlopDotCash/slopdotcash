// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { vectors } from "../../../kernels/vectors.ts";
import { type RewardAssetSelection, rewardSymbol, type TokenProblem, tokenProblem } from "./rewardAsset.ts";

const token = (network: RewardAssetSelection["network"], tokenAddress: string, tokenSymbol = "SLOP"): RewardAssetSelection => ({ network, assetKind: "token", tokenAddress, tokenSymbol });

export const aTokenIsAStandardAddressOtherThanTheNetworkCoins = vectors<RewardAssetSelection, TokenProblem | undefined>(
  [
    [token("base", "0x00000000000000000000000000000000000000ab"), undefined],
    [token("base", " 0x00000000000000000000000000000000000000AB "), undefined],
    [token("base", "0x1234"), { field: "tokenAddress", message: "Enter a 0x address with 40 hex characters." }],
    [token("base", "0x0000000000000000000000000000000000000000"), { field: "tokenAddress", message: "Enter a 0x address with 40 hex characters." }],
    [token("robinhood", "0x5fc5360d0400a0fd4f2af552add042d716f1d168"), { field: "tokenAddress", message: "That address is the network stablecoin; choose USDG." }],
    [token("solana", "So11111111111111111111111111111111111111112"), undefined],
    [token("solana", "11111111111111111111111111111111"), { field: "tokenAddress", message: "Choose SOL as the native coin." }],
    [token("solana", "0x00000000000000000000000000000000000000ab"), { field: "tokenAddress", message: "Enter a base58 SPL mint address." }],
    [token("ethereum", "0x00000000000000000000000000000000000000ab", "not a symbol"), { field: "tokenSymbol", message: "Enter a symbol of 1-16 letters or digits." }],
  ],
  tokenProblem,
);

export const theAmountIsNamedInItsOwnAsset = vectors<Omit<RewardAssetSelection, "tokenAddress">, string>(
  [
    [{ network: "base", assetKind: "stablecoin", tokenSymbol: "" }, "USDC"],
    [{ network: "robinhood", assetKind: "stablecoin", tokenSymbol: "" }, "USDG"],
    [{ network: "solana", assetKind: "native", tokenSymbol: "" }, "SOL"],
    [{ network: "ethereum", assetKind: "native", tokenSymbol: "" }, "ETH"],
    [{ network: "base", assetKind: "token", tokenSymbol: "  " }, "token"],
    [{ network: "base", assetKind: "token", tokenSymbol: " SLOP " }, "SLOP"],
  ],
  rewardSymbol,
);
