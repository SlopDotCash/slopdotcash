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
    // spec/ui/status.md, "Payment states keep award, funding and settlement apart"
    Default: async () => {
      await expect(screen.getAllByText("Paid").length).toBe(1);
      await expect(["Submitted", "Queued", "Held", "Needs wallet", "Underfunded", "Unavailable", "Received"].map((word) => screen.getAllByText(word).length > 0)).toEqual([true, true, true, true, true, true, true]);
    },
    // spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
    Empty: async () => {
      await expect(screen.getByText("No approved awards yet.")).toBeTruthy();
    },
    // spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
    FailedKeepsRows: async () => {
      await expect([screen.getByText("Showing the last verified data.").textContent, screen.getAllByText("Paid").length]).toEqual(["Showing the last verified data.", 1]);
    },
  },
};
