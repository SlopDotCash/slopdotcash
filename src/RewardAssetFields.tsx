import type { FundingChoice } from "./lib/project-proposal";
import {
  NETWORK_NAMES,
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
} from "./lib/reward-asset.mjs";
import { ChoiceField, SelectField, TextField } from "./ProjectFormFields";

export type RewardAssetSelection = Pick<
  FundingChoice,
  "network" | "assetKind" | "tokenAddress" | "tokenSymbol"
>;

/** The same asset choices for monthly rewards and private bounties. */
export function RewardAssetFields({
  choice,
  set,
  error,
  networkFixed,
  compact = false,
  networkError,
  namePrefix = "",
}: {
  choice: RewardAssetSelection;
  set: (field: keyof RewardAssetSelection, value: string) => void;
  error: (field: "tokenAddress" | "tokenSymbol") => string | undefined;
  networkFixed: boolean;
  compact?: boolean;
  networkError?: string;
  namePrefix?: string;
}) {
  const fieldName = (name: string) =>
    namePrefix ? `${namePrefix}-${name}` : name;
  const Selection = compact ? ChoiceField : SelectField;
  const network =
    REWARD_ASSET_NETWORKS[choice.network as RewardAssetNetwork] ??
    REWARD_ASSET_NETWORKS.base;
  const symbol =
    choice.assetKind === "token"
      ? choice.tokenSymbol.trim() || "token"
      : choice.assetKind === "native"
        ? network.native.symbol
        : network.stablecoin.symbol;
  if (networkFixed)
    return (
      <p className="field-hint">
        {compact
          ? `${symbol} · ${network.name}`
          : `Paid in ${symbol} on ${network.name} (fixed by the vault).`}
      </p>
    );
  return (
    <>
      <Selection
        label="Network"
        error={networkError}
        name={fieldName("settlementChain")}
        onChange={(value) => set("network", value)}
        options={Object.entries(NETWORK_NAMES)}
        value={choice.network}
      />
      <Selection
        label="Asset"
        name={fieldName("rewardKind")}
        onChange={(value) => set("assetKind", value)}
        options={[
          [
            "stablecoin",
            compact
              ? network.stablecoin.symbol
              : `${network.stablecoin.symbol} (network stablecoin)`,
          ],
          ["native", network.native.symbol],
          ["token", "Another token"],
        ]}
        value={choice.assetKind}
      />
      {choice.assetKind === "token" ? (
        <>
          <TextField
            error={error("tokenAddress")}
            hint={
              compact
                ? undefined
                : network.family === "evm"
                  ? `The ERC-20 contract address on ${network.name}.`
                  : "The classic SPL mint address on Solana."
            }
            label="Token address"
            name={fieldName("rewardAssetAddress")}
            onChange={(value) => set("tokenAddress", value)}
            placeholder={network.family === "evm" ? "0x…" : "Mint address"}
            value={choice.tokenAddress}
          />
          <TextField
            error={error("tokenSymbol")}
            label="Token symbol"
            name={fieldName("rewardAssetSymbol")}
            onChange={(value) => set("tokenSymbol", value)}
            value={choice.tokenSymbol}
          />
        </>
      ) : compact ? null : (
        <details className="proposal-advanced">
          <summary>{symbol} asset details</summary>
          <p className="field-hint">
            {network.name}: <code>{network[choice.assetKind].address}</code>
          </p>
        </details>
      )}
    </>
  );
}
