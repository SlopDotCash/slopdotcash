import type { ComponentMeta } from "vibestack/stories";
import { community, copied, current, failed, listed, mergeLine, origin, totals } from "./fixtures.ts";
import type { HomeViewProps } from "./HomePage.tsx";

export const meta: ComponentMeta<HomeViewProps> = {
  args: { projects: current(listed), mergeLine, totals: current(totals), origin, onCopy: copied },
  examples: { DiscoveryFailed: { projects: failed(), totals: failed() }, NoProjects: { projects: current([]) }, CommunityOnly: { projects: current(community) } },
};
