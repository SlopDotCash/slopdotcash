import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { archivedProject, pausedProject, permissionProject, project } from "./fixtures.ts";
import type { ParticipationProps } from "./Participation.tsx";

export const meta: ComponentMeta<ParticipationProps> = {
  args: { project, install: <p>Agent setup</p> },
  examples: {
    Archived: { project: archivedProject, successorName: "Slop Next" },
    PermissionRequired: { project: permissionProject },
    Paused: { project: pausedProject },
  },
  play: {
    // spec/backend/listing.md, "A restricted project is closed on every public route and a paused one stays listed"
    Paused: async () => {
      await expect([screen.getByRole("link", { name: "Owner setup" }).getAttribute("href"), screen.queryByText("Agent setup")]).toEqual(["/projects/slop/manage", null]);
    },
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    PermissionRequired: async () => {
      await expect([screen.getByRole("img", { name: "Permission required" }), screen.getByRole("link", { name: "Ask Slop Labs" }).getAttribute("href")]).toEqual([expect.anything(), "https://github.com/slopdotcash"]);
    },
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    Archived: async () => {
      await expect(screen.getByRole("link", { name: "Slop Next" }).getAttribute("href")).toBe("/projects/slop-next");
    },
  },
};
