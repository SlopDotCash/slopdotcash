import { expect, fn } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ContributionSettingsProps } from "./ContributionSettings.tsx";

const checked = (name: string) => document.getElementById(`field-${name}`)?.getAttribute("aria-checked") ?? null;

export const meta: ComponentMeta<ContributionSettingsProps> = {
  args: { bountyOnly: false, value: { submissionFee: "true", wantedIssues: "true", reportDeposit: "true" }, onChange: fn() },
  examples: {
    BountyOnly: { bountyOnly: true },
    TurnedOff: { value: { submissionFee: "false", wantedIssues: "false", reportDeposit: "false" } },
    SettingsAmount: { amount: { value: "2", error: undefined, onChange: fn() } },
    InvalidAmount: { amount: { value: "0.5", error: "Enter an amount from 1 to 10, with at most two decimal places.", onChange: fn() } },
  },
  play: {
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Default: async () => {
      await expect([checked("submissionFee"), checked("wantedIssues"), checked("reportDeposit"), document.getElementById("field-submissionFeeAmount")]).toEqual(["true", "true", "true", null]);
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    BountyOnly: async () => {
      await expect([checked("submissionFee"), checked("wantedIssues"), checked("reportDeposit")]).toEqual([null, null, "true"]);
    },
    // spec/backend/submissionFeeSettings.md, "Submission fee settings are exact, bounded and off unless enabled with a valid amount"
    SettingsAmount: async () => {
      await expect(document.getElementById("field-submissionFeeAmount")).not.toBeNull();
    },
  },
};
