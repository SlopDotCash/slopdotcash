import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { promiseNoticeText } from "../../../gen/frontend__projections.ts";
import { bountyProject, funded, honorProject, prizeProject, project, promised, shareNotice, unfunded, unpromised, unread, unreadFunding, unverified, withdrawn } from "./fixtures.ts";
import type { RewardSummaryProps } from "./RewardSummary.tsx";

export const meta: ComponentMeta<RewardSummaryProps> = {
  args: { project, funding: funded, promise: unpromised(funded), shareNotice: null },
  examples: {
    Withdrawn: { funding: withdrawn, promise: unpromised(withdrawn) },
    Unread: { funding: unread, promise: unpromised(unread) },
    Bounty: { project: bountyProject },
    Prize: { project: prizeProject, funding: unread, promise: unpromised(unread) },
    Unfunded: { funding: unfunded, promise: unpromised(unfunded) },
    Promised: { project: honorProject, funding: unfunded, promise: promised },
    Unverified: { project: honorProject, funding: unreadFunding, promise: unverified },
    Shared: { shareNotice },
  },
  play: {
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Default: async () => {
      await expect([screen.getByText(/\/mo$/u).textContent, screen.queryByText(promiseNoticeText)]).toEqual(["$500 /mo", null]);
    },
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Withdrawn: async () => {
      await expect([screen.getByText(/^Funds were withdrawn from the vault during December 2026/u), screen.getByText("Points only")].length).toBe(2);
    },
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Unread: async () => {
      await expect([screen.getByText("Points only").textContent, screen.queryByText(/\$500/u)]).toEqual(["Points only", null]);
    },
    // spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"
    Unfunded: async () => {
      await expect([screen.getAllByRole("paragraph").length, screen.queryByText(promiseNoticeText)]).toEqual([1, null]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    Promised: async () => {
      await expect([screen.getByText(promiseNoticeText).textContent, screen.getByText(/\/mo · /u).textContent]).toEqual([promiseNoticeText, "$500 /mo · Promised · Not vaulted"]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    Unverified: async () => {
      await expect([screen.getByText(promiseNoticeText).textContent, screen.getByText(/\/mo · /u).textContent]).toEqual([promiseNoticeText, "$500 /mo · Promised · Vault funding unverified"]);
    },
    // spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"
    Shared: async () => {
      await expect(screen.getAllByRole("paragraph")).toHaveLength(2);
    },
  },
};
