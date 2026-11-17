import type { ComponentMeta } from "vibestack/stories";
import { community, mergeLine } from "./fixtures.ts";
import type { ProjectGridProps } from "./ProjectCards.tsx";

export const meta: ComponentMeta<ProjectGridProps> = {
  args: { projects: community, mergeLine },
  examples: { OnePage: { projects: community.slice(0, 3) } },
};
