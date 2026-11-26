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
    problem: "",
    busy: false,
    onSign: () => undefined,
    onCancel: () => undefined,
  },
  decorator: (story) => (
    <Dialog open>
      <DialogContent>{story()}</DialogContent>
    </Dialog>
  ),
  examples: {
    TestNetwork: { payout: { ...reservedPayment, network: "base-sepolia" } },
    Solana: { payout: { chain: "solana", network: "solana-devnet", vault: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" }, family: "solana", claimAddress: "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2" },
    Signing: { busy: true },
    WrongAddress: { problem: "Wrong address. Connect 0x2b7c…00c3." },
  },
  play: {
    // spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"
    Default: async () => {
      await expect([screen.getByRole("group", { name: "Vault" }).textContent, screen.getByRole("group", { name: "Your wallet" }).textContent]).toEqual([reservedPayment.vault, payee]);
    },
  },
};
