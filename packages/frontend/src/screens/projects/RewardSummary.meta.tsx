import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { notListedText } from "../../../gen/frontend__poolListing.ts";
import { promiseNoticeText } from "../../../gen/frontend__projections.ts";
import { bountyProject, funded, honorProject, prizeProject, project, promised, unfunded, unpromised, unread, unreadFunding, unverified, withdrawn } from "./fixtures.ts";
import type { RewardSummaryProps } from "./RewardSummary.tsx";

export const meta: ComponentMeta<RewardSummaryProps> = {
  args: { project, funding: funded, promise: unpromised(funded) },
  examples: {
    Withdrawn: { funding: withdrawn, promise: unpromised(withdrawn) },
    Unread: { funding: unread, promise: unpromised(unread) },
    Bounty: { project: bountyProject },
    Prize: { project: prizeProject, funding: unread, promise: unpromised(unread) },
    NotListed: { funding: unfunded, promise: unpromised(unfunded) },
    Promised: { project: honorProject, funding: unfunded, promise: promised },
    Unverified: { project: honorProject, funding: unreadFunding, promise: unverified },
  },
  play: {
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Default: async () => {
      await expect([screen.queryByText(notListedText), screen.queryByText(promiseNoticeText)]).toEqual([null, null]);
    },
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Unread: async () => {
      await expect([screen.queryByText(/\$500/u), screen.queryByText(notListedText)]).toEqual([null, null]);
    },
    // spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"
    NotListed: async () => {
      await expect([screen.getByText(notListedText), screen.queryByText(promiseNoticeText)]).toEqual([expect.anything(), null]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    Promised: async () => {
      await expect([screen.getByText(promiseNoticeText), screen.queryByText(notListedText), screen.getByText(/^\$500/u)]).toEqual([expect.anything(), null, expect.anything()]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    Unverified: async () => {
      await expect([screen.getByText(promiseNoticeText), screen.queryByText(notListedText)]).toEqual([expect.anything(), null]);
    },
  },
};
