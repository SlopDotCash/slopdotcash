import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ContributorAllocationRowProps } from "./ContributorAllocationRow.tsx";
import { awaitingAllocation, sentAllocation } from "./fixtures.ts";

export const meta: ComponentMeta<ContributorAllocationRowProps> = {
  args: { shown: awaitingAllocation, onRetry: () => undefined },
  examples: { Sent: { shown: sentAllocation }, Failed: { failed: true } },
  play: {
    // spec/settlement/contributorAllocation.md, "A timely first wallet confirmation survives replacement"
    Default: async () => {
      await expect(screen.getByRole("link", { name: "Add or confirm your Base wallet" }).getAttribute("href")).toBe("/account#wallets");
    },
  },
};
