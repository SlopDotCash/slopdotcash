// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Disclosure } from "@repo/ui";
import { CHAIN_NAMES } from "../../../kernels/assetText.ts";
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

/** The same asset choices for monthly rewards and private bounties. */
export function RewardAssetFields({ choice, onChange, error, networkFixed, compact = false, networkError, namePrefix = "" }: RewardAssetFieldsProps) {
  const fieldName = (name: string) => (namePrefix ? `${namePrefix}-${name}` : name);
  const network = rewardNetwork(choice.network);
  const symbol = rewardSymbol(choice);
  const name = CHAIN_NAMES[choice.network];
  if (networkFixed) return <p className="text-sm text-muted-foreground">{compact ? `${symbol} · ${name}` : `Paid in ${symbol} on ${name} (fixed by the vault).`}</p>;
  const Selection = compact ? ChoiceField : SelectField;
  const networkField = <Selection label="Network" name={fieldName("settlementChain")} error={networkError} options={rewardChains} value={choice.network} onChange={(value) => onChange("network", value)} />;
  if (network === undefined) return networkField;
  const assets = [
    ["stablecoin", compact ? network.stablecoin.symbol : `${network.stablecoin.symbol} (network stablecoin)`],
    ["native", network.native.symbol],
    ["token", "Another token"],
  ] as const;
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
            hint={compact ? undefined : network.family === "evm" ? `The ERC-20 contract address on ${network.name}.` : "The classic SPL mint address on Solana."}
            placeholder={network.family === "evm" ? "0x…" : "Mint address"}
            value={choice.tokenAddress}
            onChange={(value) => onChange("tokenAddress", value)}
          />
          <TextField label="Token symbol" name={fieldName("rewardAssetSymbol")} error={error("tokenSymbol")} value={choice.tokenSymbol} onChange={(value) => onChange("tokenSymbol", value)} />
        </>
      ) : compact ? null : (
        <Disclosure summary={`${symbol} asset details`}>
          <p className="text-sm text-muted-foreground">
            {network.name}: <code className="font-mono break-all">{network[choice.assetKind].address}</code>
          </p>
        </Disclosure>
      )}
    </>
  );
}
