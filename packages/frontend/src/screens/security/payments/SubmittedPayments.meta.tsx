import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { submittedHashes } from "./fixtures.ts";
import type { SubmittedPaymentsProps } from "./SubmittedPayments.tsx";

const onCheck = fn();

export const meta: ComponentMeta<SubmittedPaymentsProps> = {
  args: { solana: false, values: submittedHashes, busy: false, error: null, stale: false, onValue: fn(), onCheck, onRefresh: fn() },
  examples: { Unchecked: { values: [""] } },
  play: {
    // spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
    Default: async () => {
      await userEvent.click(screen.getByRole("button", { name: "Verify submitted payments" }));
      await expect(onCheck).toHaveBeenCalled();
    },
    // spec/settlement/payment.md, "Direct reconciliation requires a retained exact attempt"
    Unchecked: async () => {
      await expect(screen.getByRole("button", { name: "Verify submitted payments" })).toBeDisabled();
    },
  },
};
