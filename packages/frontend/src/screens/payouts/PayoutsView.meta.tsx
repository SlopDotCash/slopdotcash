import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { noPayouts, payouts } from "./fixtures.ts";
import type { PayoutsViewProps } from "./PayoutsPage.tsx";

export const meta: ComponentMeta<PayoutsViewProps> = {
  args: { loading: false, signedOut: false, loginHref: "/login?next=%2Fearnings", account: payouts, onRetry: () => undefined },
  examples: {
    Loading: { loading: true, account: undefined },
    Empty: { account: noPayouts },
    FailedKeepsRows: { problem: "Payments could not load. Retry." },
    SignedOut: { signedOut: true, account: undefined },
  },
  play: {
    // spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"
    Default: async () => {
      await expect(screen.getAllByText("Paid").length).toBe(1);
      await expect(["Submitted", "Queued", "Held", "Needs wallet", "Underfunded", "Unavailable", "Received"].map((word) => screen.getAllByText(word).length > 0)).toEqual([true, true, true, true, true, true, true]);
      await expect(screen.getByRole("link", { name: "Awaiting wallet: add or confirm your Base wallet" }).getAttribute("href")).toBe("/account#wallets");
    },
    // spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
    Empty: async () => {
      await expect(screen.queryByRole("list", { name: "Awards and payments" })).toBeNull();
    },
    // spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
    FailedKeepsRows: async () => {
      await expect([Boolean(screen.getByRole("button", { name: "Retry" })), screen.getAllByText("Paid").length]).toEqual([true, 1]);
    },
  },
};
