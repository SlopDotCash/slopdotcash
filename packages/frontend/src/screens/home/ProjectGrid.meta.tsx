import type { ComponentMeta } from "vibestack/stories";
import { configured, listed, longDescription, pool, promised, tokenPool, unverified } from "./fixtures.ts";
import { homeProjectOrder, homeProjects } from "./listing.ts";
import type { ProjectGridProps } from "./ProjectCards.tsx";

export const meta: ComponentMeta<ProjectGridProps> = {
  args: { projects: homeProjectOrder(homeProjects(listed)) },
  examples: { Tagged: { projects: [pool, promised, configured, unverified] }, Token: { projects: [tokenPool] }, LongDescription: { projects: [longDescription] } },
};
