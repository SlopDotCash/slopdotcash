import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { notListedText } from "../../../gen/frontend__poolListing.ts";
import { promiseNoticeText } from "../../../gen/frontend__projections.ts";
import { projectFunding } from "./summary.ts";
import { bountyProject, funded, prizeProject, project, unfunded, unread, withdrawn } from "./fixtures.ts";
import type { RewardSummaryProps } from "./RewardSummary.tsx";

const promisedProject = { ...project, reward: { ...project.reward, honorSystem: true } };
const promisedVault = { network: "base-mainnet", vault: "0x5e1f0000000000000000000000000000000000aa" };
const unverified = projectFunding({ project: { ...promisedProject, deployments: [promisedVault] }, read: { status: "Loading", vaults: undefined }, networkPays: () => true, nowMs: Date.parse("2026-11-17T12:00:00.000Z") });

export const meta: ComponentMeta<RewardSummaryProps> = {
  args: { project, funding: funded },
  examples: {
    Withdrawn: { funding: withdrawn },
    Unread: { funding: unread },
    Bounty: { project: bountyProject },
    Prize: { project: prizeProject, funding: unread },
    NotListed: { funding: unfunded },
    Promised: { project: promisedProject, funding: unfunded },
    PromisedUnverified: { project: { ...promisedProject, deployments: [promisedVault] }, funding: unverified },
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
      await expect([screen.getByText("Points only · no cash rewards").textContent, screen.queryByText(/\$500/u), screen.queryByText(notListedText)]).toEqual(["Points only · no cash rewards", null, null]);
    },
    // spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"
    NotListed: async () => {
      await expect([screen.getByText(notListedText).textContent, screen.getByText("Points only · no cash rewards").textContent]).toEqual([notListedText, "Points only · no cash rewards"]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    Promised: async () => {
      await expect([screen.getByText(promiseNoticeText).textContent, screen.queryByText(notListedText), screen.getByText(/monthly, split between contributors/u).textContent]).toEqual([
        promiseNoticeText,
        null,
        "$500 monthly, split between contributors · Promised · Not vaulted",
      ]);
    },
    // spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
    PromisedUnverified: async () => {
      await expect([screen.getByText(promiseNoticeText).textContent, screen.getByText(/monthly, split between contributors/u).textContent]).toEqual([
        promiseNoticeText,
        "$500 monthly, split between contributors · Promised · Vault funding unverified",
      ]);
    },
  },
};
