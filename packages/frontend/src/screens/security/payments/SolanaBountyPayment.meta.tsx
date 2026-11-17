import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { emptyAttempt, savedSolana, solanaWallets, uncertainSolana } from "./fixtures.ts";
import type { SolanaBountyPaymentProps } from "./SolanaBountyPayment.tsx";

const onSend = fn();
const onCheck = fn();

export const meta: ComponentMeta<SolanaBountyPaymentProps> = {
  args: {
    network: "solana-mainnet",
    phase: "Planned",
    saved: emptyAttempt,
    confirmed: [],
    wallets: solanaWallets,
    address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    busy: false,
    error: null,
    stale: false,
    notice: null,
    onConnect: fn(),
    onSend,
    onType: fn(),
    onCheck,
    onRefresh: fn(),
  },
  examples: {
    Submitted: { phase: "Submitted", saved: savedSolana },
    Uncertain: { phase: "Uncertain", saved: uncertainSolana },
    Expired: { phase: "Expired" },
  },
  play: {
    // spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"
    Default: async () => {
      await userEvent.click(screen.getByRole("button", { name: "Pay approved award" }));
      await expect(onSend).toHaveBeenCalled();
    },
    // spec/frontend/solanaBountyPrompt.md, "Verification and history recovery rechecks the account and never sends"
    Submitted: async () => {
      await expect(screen.queryByRole("button", { name: "Pay approved award" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Verify submitted payment" }));
      await expect(onCheck).toHaveBeenCalled();
    },
    // spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"
    Uncertain: async () => {
      await expect(screen.getByText("Wallet result uncertain. Enter its signature to continue.")).toBeVisible();
      await expect(screen.queryByRole("button", { name: "Pay approved award" })).toBeNull();
    },
    // spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"
    Expired: async () => {
      await expect(screen.getByRole("button", { name: "Pay approved award" })).toBeDisabled();
    },
  },
};
