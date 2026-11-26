import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { reservedPayment } from "./fixtures.ts";
import { netAmountProps } from "./PayoutAmount.tsx";
import type { PayoutRowProps } from "./PayoutRow.tsx";
import { awardStatus, paymentStatus } from "./status.ts";

export const meta: ComponentMeta<PayoutRowProps> = {
  args: { chain: reservedPayment.chain, network: reservedPayment.network, projectId: reservedPayment.projectId, amount: netAmountProps(reservedPayment), status: paymentStatus(reservedPayment) },
  decorator: (story) => <ul>{story()}</ul>,
  examples: {
    Paid: { status: paymentStatus({ deliveryState: "paid", state: "paid", transactionId: "0x7a1d" }), explorerUrl: "https://basescan.org/tx/0x7a1d" },
    PaidWithoutFinality: { status: paymentStatus({ deliveryState: "paid", state: "reserved", transactionId: null }) },
    Underfunded: { status: awardStatus({ state: "underfunded" }).presentation, statusTitle: awardStatus({ state: "underfunded" }).title, note: "October 2026" },
    NeedsWallet: { status: paymentStatus({ deliveryState: "needs_wallet", state: "reserved", transactionId: null }), statusTitle: "Awaiting wallet: add or confirm your Base wallet", statusHref: "/account#wallets" },
    TestNetworkToken: { network: "base-sepolia", amount: { amount: "1500000000000000000", decimals: 18, token: "0x1111111111111111111111111111111111111111" }, note: "October 2026" },
  },
  play: {
    // spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"
    NeedsWallet: async () => {
      const link = screen.getByRole("link", { name: "Needs wallet" });
      await expect(link.getAttribute("href")).toBe("/account#wallets");
      await expect(link).toHaveAccessibleDescription("Awaiting wallet: add or confirm your Base wallet");
    },
  },
};
