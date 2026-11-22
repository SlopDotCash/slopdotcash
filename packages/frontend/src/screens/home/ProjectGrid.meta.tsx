import type { ComponentMeta } from "vibestack/stories";
import { community, listed, promised, unverified } from "./fixtures.ts";
import { homeProjectOrder, homeProjects } from "./listing.ts";
import type { ProjectGridProps } from "./ProjectCards.tsx";

export const meta: ComponentMeta<ProjectGridProps> = {
  args: { projects: homeProjectOrder(homeProjects(listed)) },
  examples: { Community: { projects: community.slice(0, 3) }, Promised: { projects: [promised, unverified] } },
};
