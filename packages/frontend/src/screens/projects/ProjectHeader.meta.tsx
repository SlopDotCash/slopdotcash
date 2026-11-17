import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { project } from "./fixtures.ts";
import type { ProjectHeaderProps } from "./ProjectHeader.tsx";

export const meta: ComponentMeta<ProjectHeaderProps> = {
  args: { project },
  examples: { CustomImage: { project: { ...project, image: "/slop-mark.png" } } },
  play: {
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Default: async () => {
      await expect([screen.getByRole("heading", { level: 1 }).textContent, screen.getByRole("link", { name: "View Slop on GitHub" }).getAttribute("href")]).toEqual(["Slop", "https://github.com/slopdotcash/slop"]);
    },
  },
};
