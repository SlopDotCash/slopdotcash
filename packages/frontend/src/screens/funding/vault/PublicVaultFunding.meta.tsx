import { expect, fn, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { lockDeployment, lockProject } from "./fixtures.ts";
import type { PublicVaultFundingProps } from "./PublicVaultFunding.tsx";

export const meta: ComponentMeta<PublicVaultFundingProps> = {
  args: { project: lockProject, deployment: lockDeployment, period: "2026-11", account: 0, showNetwork: false, onFinalized: fn() },
  examples: { TwoVaults: { showNetwork: true } },
  play: {
    // spec/frontend/projections.md, "The public page offers only a deposit, after the no-refund disclosure"
    Default: async () => {
      await expect([screen.getAllByRole("button").length, screen.queryByRole("radiogroup")]).toEqual([1, null]);
    },
  },
};
