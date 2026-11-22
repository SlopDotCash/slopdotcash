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
      await expect([screen.getByText(/\/mo$/u).textContent, screen.queryByText(notListedText), screen.queryByText(promiseNoticeText)]).toEqual(["$500 /mo", null, null]);
    },
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Withdrawn: async () => {
      await expect([screen.getByText(/^Funds were withdrawn from the vault during December 2026/u), screen.getByText("Points only")].length).toBe(2);
    },
    // spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
    Unread: async () => {
      await expect([screen.getByText("Points only").textContent, screen.queryByText(/\$500/u), screen.queryByText(notListedText)]).toEqual(["Points only", null, null]);
    },
    // spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"
    NotListed: async () => {
      await expect([screen.getByText(notListedText).textContent, screen.getByText("Points only").textContent, screen.queryByText(promiseNoticeText)]).toEqual([notListedText, "Points only", null]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    Promised: async () => {
      await expect([screen.getByText(promiseNoticeText).textContent, screen.queryByText(notListedText), screen.getByText(/\/mo · /u).textContent]).toEqual([promiseNoticeText, null, "$500 /mo · Promised · Not vaulted"]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    Unverified: async () => {
      await expect([screen.getByText(promiseNoticeText).textContent, screen.queryByText(notListedText), screen.getByText(/\/mo · /u).textContent]).toEqual([promiseNoticeText, null, "$500 /mo · Promised · Vault funding unverified"]);
    },
  },
};
