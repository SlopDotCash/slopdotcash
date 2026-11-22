import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { copied, listing, origin, project, unlisted } from "./fixtures.ts";
import type { InstallPanelProps } from "./InstallPanel.tsx";

export const meta: ComponentMeta<InstallPanelProps> = {
  args: { project, clearance: "ready", listing, origin, onCopy: copied },
  examples: { Checking: { clearance: "loading" }, Blocked: { clearance: "blocked" }, Unchecked: { clearance: "error" }, NotListed: { clearance: "blocked", listing: unlisted } },
  play: {
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    Blocked: async () => {
      await expect(screen.getByRole("link", { name: "Owner setup" }).getAttribute("href")).toBe("/projects/slop/manage");
    },
    // spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"
    NotListed: async () => {
      await expect(screen.queryByRole("link", { name: "Owner setup" })).toBeNull();
    },
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    Checking: async () => {
      await expect(screen.getByRole("status", { name: "Checking project clearance" })).toBeTruthy();
    },
  },
};
