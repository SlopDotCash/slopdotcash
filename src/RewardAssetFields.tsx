import { ExternalLink, Lock } from "lucide-react";
import { evmExplorerOrigin } from "./lib/payments/contracts";
import type { FundingChoice } from "./lib/project-proposal";
import {
  NETWORK_NAMES,
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
} from "./lib/reward-asset.mjs";
import { ExternalLinkAnchor, NetworkName } from "./Presentation";
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
        {symbol}{" "}
        <NetworkName chain={choice.network}>{network.name}</NetworkName>{" "}
        <span
          aria-label="Fixed by the vault"
          role="img"
          title="Fixed by the vault"
        >
          <Lock size={14} aria-hidden="true" />
        </span>
      </p>
    );
  return (
    <>
      {compact ? (
        // ChoiceField's markup, with each network's mark beside its name.
        <fieldset
          className="setup-choice"
          aria-describedby={
            networkError
              ? `field-${fieldName("settlementChain")}-error`
              : undefined
          }
        >
          <legend>Network</legend>
          <div className="setup-choice-options">
            {Object.entries(NETWORK_NAMES).map(([value, name], index) => (
              <label key={value}>
                <input
                  id={
                    index === 0
                      ? `field-${fieldName("settlementChain")}`
                      : undefined
                  }
                  type="radio"
                  name={fieldName("settlementChain")}
                  value={value}
                  checked={choice.network === value}
                  onChange={() => set("network", value)}
                />
                <span>
                  <NetworkName chain={value}>{name}</NetworkName>
                </span>
              </label>
            ))}
          </div>
          {networkError ? (
            <small
              className="field-error"
              id={`field-${fieldName("settlementChain")}-error`}
            >
              {networkError}
            </small>
          ) : null}
        </fieldset>
      ) : (
        <SelectField
          label="Network"
          error={networkError}
          name={fieldName("settlementChain")}
          onChange={(value) => set("network", value)}
          options={Object.entries(NETWORK_NAMES)}
          value={choice.network}
        />
      )}
      <Selection
        label="Asset"
        name={fieldName("rewardKind")}
        onChange={(value) => set("assetKind", value)}
        options={[
          ["stablecoin", network.stablecoin.symbol],
          ["native", network.native.symbol],
          ["token", "Another token"],
        ]}
        value={choice.assetKind}
      />
      {choice.assetKind === "token" ? (
        <>
          <TextField
            error={error("tokenAddress")}
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
      ) : compact || choice.assetKind !== "stablecoin" ? null : (
        <ExternalLinkAnchor
          className="field-hint"
          href={
            network.family === "evm"
              ? `${evmExplorerOrigin(choice.network)}/token/${network.stablecoin.address}`
              : `https://explorer.solana.com/address/${network.stablecoin.address}`
          }
          label={`${symbol} on the ${network.name} explorer`}
        >
          {symbol} <ExternalLink size={14} aria-hidden="true" />
        </ExternalLinkAnchor>
      )}
    </>
  );
}
