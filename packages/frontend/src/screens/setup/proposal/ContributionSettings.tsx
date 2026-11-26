// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/submissionFeeSettings.md, "Submission fee settings are exact, bounded and off unless enabled with a valid amount"; spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"
import { switchedOn as feeSwitchedOn, keepFeeLabel, refundUndecidedDays } from "@repo/backend/client";
import { REPORT_DEPOSIT_SWITCHED_ON } from "@repo/security/client";
import { Checkbox, Label } from "@repo/ui";
import type { ReactNode } from "react";
import { wantedLabelName } from "../../../../gen/backend__mergeActivity.ts";
import { REPORT_DEPOSIT_SETTING_HINT } from "../../../projections/reportDeposit.ts";
import { fieldId, TextField } from "../fields/ProjectFields.tsx";

export type ContributionSetting = "submissionFee" | "wantedIssues" | "reportDeposit";

export const SUBMISSION_FEE_HINT = `Slopbot reviews an outside contributor's pull request once a refundable fee is deposited. A merge sends the fee back, and so does ${refundUndecidedDays} days without a maintainer decision. A pull request closed without a merge keeps it, unless it answers a ${wantedLabelName} issue and you do not add ${keepFeeLabel}. Contributors can pay in SLOP at half the price instead.`;

export type ContributionSettingsProps = {
  /** A listing that is only a security program takes no contributions, so it asks for neither fee nor wanted issues. */
  bountyOnly: boolean;
  value: Readonly<Record<ContributionSetting, string>>;
  onChange: (field: ContributionSetting, value: string) => void;
  /** The fee amount, where the owner can set it: the settings page. */
  amount?: { readonly value: string; readonly error: string | undefined; readonly onChange: (value: string) => void };
};

function Setting({ name, value, label, hint, onChange }: { name: ContributionSetting; value: string; label: string; hint: ReactNode; onChange: (value: string) => void }) {
  const id = fieldId(name);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Checkbox id={id} name={name} checked={value === "true"} aria-describedby={`${id}-hint`} onCheckedChange={(checked) => onChange(String(checked === true))} />
        <Label htmlFor={id}>{label}</Label>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/** The refundable submission fee, the wanted issues label and the refundable report deposit, each on unless the owner turns it off. */
export function ContributionSettings({ bountyOnly, value, onChange, amount }: ContributionSettingsProps) {
  return (
    <div className="flex flex-col gap-4">
      {bountyOnly ? null : (
        <>
          <Setting
            name="submissionFee"
            value={value.submissionFee}
            label="Ask outside contributors for a refundable submission fee"
            hint={`${SUBMISSION_FEE_HINT}${feeSwitchedOn ? "" : " Slop has not switched the fee on yet; this choice applies once it does."}`}
            onChange={(entry) => onChange("submissionFee", entry)}
          />
          {amount && value.submissionFee === "true" ? <TextField label="Submission fee in USDC or USDG" name="submissionFeeAmount" inputMode="decimal" value={amount.value} error={amount.error} onChange={amount.onChange} /> : null}
          <Setting
            name="wantedIssues"
            value={value.wantedIssues}
            label="List the issues you most want done"
            hint={
              <>
                Slopbot creates the <code>{wantedLabelName}</code> label. Put it on 3 to 5 issues; they are listed first on your project page and contributor agents start with them.
              </>
            }
            onChange={(entry) => onChange("wantedIssues", entry)}
          />
        </>
      )}
      <Setting
        name="reportDeposit"
        value={value.reportDeposit}
        label="Ask reporters for a refundable SLOP deposit"
        hint={`${REPORT_DEPOSIT_SETTING_HINT}${REPORT_DEPOSIT_SWITCHED_ON ? "" : " Slop has not switched the deposit on yet; this choice applies once it does."}`}
        onChange={(entry) => onChange("reportDeposit", entry)}
      />
    </div>
  );
}
