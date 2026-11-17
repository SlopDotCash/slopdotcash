import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { bountyProject, funded, prizeProject, project, unread, withdrawn } from "./fixtures.ts";
import type { RewardSummaryProps } from "./RewardSummary.tsx";

export const meta: ComponentMeta<RewardSummaryProps> = {
  args: { project, funding: funded },
  examples: {
    Withdrawn: { funding: withdrawn },
    Unread: { funding: unread },
    Bounty: { project: bountyProject },
    Prize: { project: prizeProject, funding: unread },
  },
  play: {
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Default: async () => {
      await expect(screen.getByText(/monthly, split between contributors$/u).textContent).toBe("$500 monthly, split between contributors");
    },
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Withdrawn: async () => {
      await expect([screen.getByText(/^Funds were withdrawn from the vault during December 2026/u), screen.getByText("Points only · no cash rewards")].length).toBe(2);
    },
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Unread: async () => {
      await expect([screen.getByText("Points only · no cash rewards").textContent, screen.queryByText(/\$500/u)]).toEqual(["Points only · no cash rewards", null]);
    },
  },
};
