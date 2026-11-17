import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { projects } from "./fixtures.ts";
import type { ProjectListProps } from "./ProjectList.tsx";
import { shownProjects } from "./projects.ts";

export const meta: ComponentMeta<ProjectListProps> = {
  args: { projects: shownProjects(projects, null, "") },
  play: {
    // spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"
    Default: async () => {
      const [first] = screen.getAllByRole("link");
      await expect(first?.getAttribute("aria-label")).toBe("Open Forge");
      await expect(first?.getAttribute("href")).toBe("/admin?project=forge");
      await expect(screen.getByText("Decision needed")).toBeTruthy();
      await expect(screen.getByText("paused")).toBeTruthy();
    },
  },
};
