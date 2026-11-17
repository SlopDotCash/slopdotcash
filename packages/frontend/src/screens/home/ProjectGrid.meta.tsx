import type { ComponentMeta } from "vibestack/stories";
import { bounty, community, mergeLine, pool, prize } from "./fixtures.ts";
import type { ProjectGridProps } from "./ProjectCards.tsx";

export const meta: ComponentMeta<ProjectGridProps> = {
  args: { projects: [pool, bounty, prize], mergeLine },
  examples: { Community: { projects: community.slice(0, 3) } },
};
