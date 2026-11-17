import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { solanaWallets } from "./fixtures.ts";
import type { SolanaBountyRecoveryProps } from "./SolanaBountyRecovery.tsx";

const onCheck = fn();

export const meta: ComponentMeta<SolanaBountyRecoveryProps> = {
  args: {
    wallets: solanaWallets,
    address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    busy: false,
    error: null,
    stale: false,
    notice: null,
    onConnect: fn(),
    onCheck,
    onRefresh: fn(),
  },
  examples: {
    Disconnected: { address: undefined },
    Changed: { error: "The recovery request changed. Refresh before signing.", stale: true },
  },
  play: {
    // spec/frontend/solanaBountyPrompt.md, "Verification and history recovery rechecks the account and never sends"
    Default: async () => {
      await userEvent.click(screen.getByRole("button", { name: "Check expired payment" }));
      await expect(onCheck).toHaveBeenCalled();
    },
    // spec/frontend/solanaBountyPrompt.md, "Verification and history recovery rechecks the account and never sends"
    Disconnected: async () => {
      await expect(screen.getByRole("button", { name: "Check expired payment" })).toBeDisabled();
    },
    // spec/settlement/directBounty.md, "A recovered request changes only an unpaid leg after exact retirement"
    Changed: async () => {
      await expect(screen.getByRole("button", { name: "Review current case" })).toBeVisible();
    },
  },
};
