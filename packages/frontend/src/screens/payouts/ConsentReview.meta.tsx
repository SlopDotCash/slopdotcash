import { Dialog, DialogContent } from "@repo/ui";
import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ConsentReviewProps } from "./ConsentReview.tsx";
import { payee, reservedPayment } from "./fixtures.ts";

export const meta: ComponentMeta<ConsentReviewProps> = {
  args: {
    payout: reservedPayment,
    family: "evm",
    claimAddress: payee,
    wallets: [{ id: "1", name: "Rabby" }],
    phase: "Choosing",
    walletAccount: "",
    problem: "",
    notice: "",
    busy: false,
    onSign: () => undefined,
    onReplace: () => undefined,
    onContinue: () => undefined,
    onCancel: () => undefined,
  },
  decorator: (story) => (
    <Dialog open>
      <DialogContent>{story()}</DialogContent>
    </Dialog>
  ),
  examples: {
    Replacing: { phase: "Replacing", walletAccount: "0x9f000000000000000000000000000000000000d4" },
    Registered: { phase: "Connected", walletAccount: "0x9f000000000000000000000000000000000000d4" },
    Signing: { phase: "Signing", busy: true },
    Unavailable: { phase: "Closed", problem: "Payout consent is unavailable. Your award stays reserved. Retry later." },
    NoWallet: { wallets: [] },
  },
  play: {
    // spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"
    Default: async () => {
      await expect([screen.getByRole("group", { name: "Vault" }).textContent, screen.getByRole("group", { name: "Your wallet" }).textContent, screen.getByText("Fee (2%)").textContent]).toEqual([reservedPayment.vault, payee, "Fee (2%)"]);
    },
    // spec/frontend/walletConsent.md, "Replacing a saved wallet needs an explicit choice"
    Replacing: async () => {
      await expect([screen.getByRole("button", { name: "Register wallet account" }), screen.getByRole("button", { name: "Keep saved address" }), screen.queryByRole("button", { name: "Connect Rabby" })].map(Boolean)).toEqual([true, true, false]);
    },
    // spec/frontend/walletConsent.md, "Replacing a saved wallet needs an explicit choice"
    Registered: async () => {
      await expect([screen.getByRole("group", { name: "Your wallet" }).textContent, Boolean(screen.getByRole("button", { name: "Sign consent" }))]).toEqual(["0x9f000000000000000000000000000000000000d4", true]);
    },
  },
};
