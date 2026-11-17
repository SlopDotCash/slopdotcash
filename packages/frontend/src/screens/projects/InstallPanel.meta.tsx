import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { copied, origin, project } from "./fixtures.ts";
import type { InstallPanelProps } from "./InstallPanel.tsx";

export const meta: ComponentMeta<InstallPanelProps> = {
  args: { project, clearance: "ready", origin, onCopy: copied },
  examples: { Checking: { clearance: "loading" }, Blocked: { clearance: "blocked" }, Unchecked: { clearance: "error" } },
  play: {
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    Default: async () => {
      await expect(screen.getByText("Read https://slop.cash/SKILL.md and follow it to contribute to github.com/slopdotcash/slop.")).toBeTruthy();
    },
    // spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
    Blocked: async () => {
      await expect([screen.getByText("Read https://slop.cash/SKILL.md and follow it."), screen.getByRole("link", { name: "Project owner: review setup" }).getAttribute("href")]).toEqual([expect.anything(), "/projects/slop/manage"]);
    },
  },
};
