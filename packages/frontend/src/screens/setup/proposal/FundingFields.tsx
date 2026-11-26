// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { PAYOUT_FEE_BASIS_POINTS } from "@repo/settlement/kernels/networks";
import { Checkbox, Label, Status } from "@repo/ui";
import { ListChecks, type LucideIcon, Shield, Wallet } from "lucide-react";
import { honorSystemEditable } from "../../../../gen/frontend__presentation.ts";
import { type FundingChoice, monthlyPoolValue } from "../../../flows/projects/proposal.ts";
import { ChoiceField, TextField } from "../fields/ProjectFields.tsx";
import { RewardAssetFields } from "../fields/RewardAssetFields.tsx";
import { rewardNetwork, rewardSymbol } from "../fields/rewardAsset.ts";

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
  /** The owner's honor-system promise of a monthly pool. */
  promise?: { checked: boolean; onChange: (checked: boolean) => void };
};

function positiveAmount(choice: FundingChoice, symbol: string): boolean {
  const token = choice.assetKind === "token" ? { symbol } : choice.assetKind === "native" ? rewardNetwork(choice.network)?.native : undefined;
  return monthlyPoolValue(choice.monthlyAmount, token).valid;
}

/** The one optional reward choice: points only, a monthly amount in one asset on one network, or a private bounty. */
export function FundingFields({ choice, onChange, error, networkFixed, compact = false, bounty = false, onBounty, networkError, promise }: FundingFieldsProps) {
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
        label={compact ? "Reward type" : "Type"}
        name="fundingMode"
        value={mode}
        options={modes}
        onChange={(value) => (value === "bounty" ? onBounty?.() : onChange("mode", value))}
      />
      {mode === "none" ? null : (
        <>
          <RewardAssetFields choice={choice} onChange={onChange} error={error} networkFixed={networkFixed} networkError={networkError} compact={compact} />
          <TextField
            label={bounty ? `Award (${symbol})` : `Amount / month (${symbol})`}
            name="monthlyPool"
            inputMode="decimal"
            value={choice.monthlyAmount}
            error={error("monthlyAmount")}
            hint={compact ? undefined : <Status presentation={{ tone: "Caution", icon: "Wallet", label: "Pledge until deposited" }} />}
            onChange={(value) => onChange("monthlyAmount", value)}
          />
          {promise && !bounty ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="field-honorSystem"
                  name="honorSystem"
                  checked={promise.checked}
                  disabled={!honorSystemEditable(positiveAmount(choice, symbol), promise.checked)}
                  aria-describedby="field-honorSystem-hint"
                  onCheckedChange={(checked) => promise.onChange(checked === true)}
                />
                <Label htmlFor="field-honorSystem">Promise this amount on the honor system</Label>
              </div>
              <p id="field-honorSystem-hint" className="text-sm text-muted-foreground">
                Contributors will see that this amount is not vaulted or guaranteed.
              </p>
            </div>
          ) : null}
          {compact ? null : <p className="text-sm text-muted-foreground">{PAYOUT_FEE_BASIS_POINTS / 100}% fee</p>}
        </>
      )}
    </div>
  );
}
