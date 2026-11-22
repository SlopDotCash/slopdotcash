import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ContributorAllocationRowProps } from "./ContributorAllocationRow.tsx";
import { awaitingAllocation, sentAllocation } from "./fixtures.ts";

export const meta: ComponentMeta<ContributorAllocationRowProps> = {
  args: { view: awaitingAllocation, onRetry: () => undefined },
  examples: {
    Sent: { view: sentAllocation },
    Scheduled: { view: { ...awaitingAllocation, display: "AllocationScheduled", walletPrompt: false } },
    Unclaimed: { view: { ...awaitingAllocation, display: "AllocationUnclaimed", walletPrompt: false } },
    Unavailable: { view: { tag: "AllocationUnavailable" } },
  },
  play: {
    // spec/frontend/projections.md, "Payouts shows only the signed-in account's allocation row, and a failed read is unavailable, never absent"
    Default: async () => {
      await expect(screen.getByRole("link", { name: "Add Base wallet" }).getAttribute("href")).toBe("/account#wallets");
    },
  },
};
