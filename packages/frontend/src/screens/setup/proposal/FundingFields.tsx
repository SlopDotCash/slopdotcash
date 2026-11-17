// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { PAYOUT_FEE_BASIS_POINTS, WITHDRAWAL_FEE_BASIS_POINTS } from "@repo/settlement/kernels/networks";
import { ListChecks, type LucideIcon, Shield, Wallet } from "lucide-react";
import type { FundingChoice } from "../../../flows/projects/proposal.ts";
import { ChoiceField, TextField } from "../fields/ProjectFields.tsx";
import { RewardAssetFields } from "../fields/RewardAssetFields.tsx";
import { rewardSymbol } from "../fields/rewardAsset.ts";

export type FundingField = "mode" | "network" | "assetKind" | "tokenAddress" | "tokenSymbol" | "monthlyAmount";

export type FundingFieldsProps = {
  choice: FundingChoice;
  onChange: (field: FundingField, value: string) => void;
  error: (field: "monthlyAmount" | "tokenAddress" | "tokenSymbol") => string | undefined;
  /** A project with a vault keeps its network and asset. */
  networkFixed: boolean;
  compact?: boolean;
  /** The private bounty is chosen in place of a monthly pool. */
  bounty?: boolean;
  /** Offers the private bounty choice. */
  onBounty?: () => void;
  networkError?: string;
};

const percent = (basisPoints: number) => `${basisPoints / 100}%`;

/** The one optional reward choice: points only, a monthly amount in one asset on one network, or a private bounty. */
export function FundingFields({ choice, onChange, error, networkFixed, compact = false, bounty = false, onBounty, networkError }: FundingFieldsProps) {
  const symbol = rewardSymbol(choice);
  const mode = bounty ? "bounty" : choice.mode;
  const label = (Glyph: LucideIcon, text: string, shown = compact) => (
    <span className="inline-flex items-center gap-2">
      {shown ? <Glyph aria-hidden className="size-5" /> : null}
      {text}
    </span>
  );
  const modes = [
    ["none", label(ListChecks, "Points only")],
    ["monthly", label(Wallet, "Monthly rewards")],
    ...(onBounty ? [["bounty", label(Shield, "Private bounty", true)] as const] : []),
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <ChoiceField
        label={compact ? "Reward type" : "Monthly funding (optional)"}
        name="fundingMode"
        value={mode}
        options={modes}
        onChange={(value) => (value === "bounty" ? onBounty?.() : onChange("mode", value))}
      />
      {mode === "none" ? (
        compact ? null : <p className="text-sm text-muted-foreground">Add funding later.</p>
      ) : (
        <>
          <RewardAssetFields choice={choice} onChange={onChange} error={error} networkFixed={networkFixed} networkError={networkError} compact={compact} />
          <TextField
            label={bounty ? `Award per accepted finding (${symbol})` : `Monthly amount (${symbol})`}
            name="monthlyPool"
            inputMode="decimal"
            value={choice.monthlyAmount}
            error={error("monthlyAmount")}
            hint={compact ? undefined : "A pledge until deposited in the vault. Changes apply from the next UTC month."}
            onChange={(value) => onChange("monthlyAmount", value)}
          />
          {compact ? null : (
            <p className="text-sm text-muted-foreground">
              Payout fee: {percent(PAYOUT_FEE_BASIS_POINTS)}. Unused-fund withdrawal fee: {percent(WITHDRAWAL_FEE_BASIS_POINTS)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
