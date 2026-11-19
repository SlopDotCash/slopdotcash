import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { notListedInstallText } from "../../../gen/frontend__poolListing.ts";
import { copied, listing, origin, project, unlisted } from "./fixtures.ts";
import type { InstallPanelProps } from "./InstallPanel.tsx";

export const meta: ComponentMeta<InstallPanelProps> = {
  args: { project, clearance: "ready", listing, origin, onCopy: copied },
  examples: { Checking: { clearance: "loading" }, Blocked: { clearance: "blocked" }, Unchecked: { clearance: "error" }, NotListed: { clearance: "blocked", listing: unlisted } },
  play: {
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    Default: async () => {
      await expect(screen.getByText("Read https://slop.cash/SKILL.md and follow it to contribute to github.com/slopdotcash/slop.")).toBeTruthy();
    },
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    Blocked: async () => {
      await expect([screen.getByText("Read https://slop.cash/SKILL.md and follow it."), screen.getByRole("link", { name: "Project owner: review setup" }).getAttribute("href")]).toEqual([expect.anything(), "/projects/slop/manage"]);
    },
    // spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"
    NotListed: async () => {
      await expect([screen.getByText(notListedInstallText).textContent, screen.queryByRole("link", { name: "Project owner: review setup" })]).toEqual([notListedInstallText, null]);
    },
  },
};
