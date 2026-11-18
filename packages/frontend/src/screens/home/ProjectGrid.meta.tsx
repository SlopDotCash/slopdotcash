import type { ComponentMeta } from "vibestack/stories";
import { community, listed, mergeLine } from "./fixtures.ts";
import { homeProjectOrder, homeProjects } from "./listing.ts";
import type { ProjectGridProps } from "./ProjectCards.tsx";

export const meta: ComponentMeta<ProjectGridProps> = {
  args: { projects: homeProjectOrder(homeProjects(listed)), mergeLine },
  examples: { Community: { projects: community.slice(0, 3) } },
};
