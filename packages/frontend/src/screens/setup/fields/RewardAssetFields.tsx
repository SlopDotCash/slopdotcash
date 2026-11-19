// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import type { Chain } from "@repo/settlement/kernels/networks";
import { ExternalLink, NetworkMark } from "@repo/ui";
import { ExternalLink as ExternalLinkIcon, Lock } from "lucide-react";
import { CHAIN_NAMES } from "../../../kernels/assetText.ts";
import { evmExplorerOrigin } from "../../../kernels/explorers.ts";
import { ChoiceField, SelectField, TextField } from "./ProjectFields.tsx";
import { type RewardAssetSelection, rewardChains, rewardNetwork, rewardSymbol } from "./rewardAsset.ts";

export type RewardAssetFieldsProps = {
  choice: RewardAssetSelection;
  onChange: (field: keyof RewardAssetSelection, value: string) => void;
  error: (field: "tokenAddress" | "tokenSymbol") => string | undefined;
  networkFixed: boolean;
  compact?: boolean;
  networkError?: string;
  namePrefix?: string;
};

const networkMark = (chain: Chain) => <NetworkMark network={CHAIN_NAMES[chain]} size="sm" />;

/** The same asset choices for monthly rewards and private bounties. */
export function RewardAssetFields({ choice, onChange, error, networkFixed, compact = false, networkError, namePrefix = "" }: RewardAssetFieldsProps) {
  const fieldName = (name: string) => (namePrefix ? `${namePrefix}-${name}` : name);
  const network = rewardNetwork(choice.network);
  const symbol = rewardSymbol(choice);
  if (networkFixed)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {symbol} {networkMark(choice.network)}
        <span role="img" aria-label="Fixed by the vault" title="Fixed by the vault">
          <Lock aria-hidden className="size-3.5" />
        </span>
      </p>
    );
  const networkField = compact ? (
    <ChoiceField label="Network" name={fieldName("settlementChain")} error={networkError} options={rewardChains.map(([chain]) => [chain, networkMark(chain)] as const)} value={choice.network} onChange={(value) => onChange("network", value)} />
  ) : (
    <SelectField label="Network" name={fieldName("settlementChain")} error={networkError} options={rewardChains} value={choice.network} onChange={(value) => onChange("network", value)} />
  );
  if (network === undefined) return networkField;
  const Selection = compact ? ChoiceField : SelectField;
  const assets = [
    ["stablecoin", network.stablecoin.symbol],
    ["native", network.native.symbol],
    ["token", "Another token"],
  ] as const;
  const stablecoinUrl = network.family === "evm" ? `${evmExplorerOrigin(choice.network)}/token/${network.stablecoin.address}` : `https://explorer.solana.com/address/${network.stablecoin.address}`;
  return (
    <>
      {networkField}
      <Selection label="Asset" name={fieldName("rewardKind")} options={assets} value={choice.assetKind} onChange={(value) => onChange("assetKind", value)} />
      {choice.assetKind === "token" ? (
        <>
          <TextField
            label="Token address"
            name={fieldName("rewardAssetAddress")}
            error={error("tokenAddress")}
            placeholder={network.family === "evm" ? "0x…" : "Mint address"}
            value={choice.tokenAddress}
            onChange={(value) => onChange("tokenAddress", value)}
          />
          <TextField label="Token symbol" name={fieldName("rewardAssetSymbol")} error={error("tokenSymbol")} value={choice.tokenSymbol} onChange={(value) => onChange("tokenSymbol", value)} />
        </>
      ) : compact || choice.assetKind !== "stablecoin" ? null : (
        <ExternalLink href={stablecoinUrl} label={`${symbol} on the ${network.name} explorer`} className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground underline">
          {symbol} <ExternalLinkIcon aria-hidden className="size-3.5" />
        </ExternalLink>
      )}
    </>
  );
}
