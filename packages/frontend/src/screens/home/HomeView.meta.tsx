import type { ComponentMeta } from "vibestack/stories";
import { community, copied, current, failed, listed, origin, pool, totals } from "./fixtures.ts";
import type { HomeViewProps } from "./HomePage.tsx";

export const meta: ComponentMeta<HomeViewProps> = {
  args: { projects: current(listed), totals: current(totals), origin, journey: "Contributor", onJourney: () => undefined, onCopy: copied },
  examples: {
    Maintainer: { journey: "Maintainer" },
    DiscoveryFailed: { projects: failed(), totals: failed() },
    NoProjects: { projects: current([]) },
    CommunityOnly: { projects: current(community) },
    FeaturedOnly: { projects: current([pool]) },
  },
};
