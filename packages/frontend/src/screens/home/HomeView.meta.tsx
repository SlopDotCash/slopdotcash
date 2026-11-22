import type { ComponentMeta } from "vibestack/stories";
import { copied, current, failed, listed, manyCommunity, origin, pool } from "./fixtures.ts";
import type { HomeViewProps } from "./HomePage.tsx";

const loadingFunding = listed.map((project) => ({ ...project, funding: { ...project.funding, read: "PoolLoading" as const } }));

export const meta: ComponentMeta<HomeViewProps> = {
  args: { projects: current(listed), funding: "PoolCurrent", origin, journey: "Contributor", onJourney: () => undefined, onCopy: copied },
  examples: {
    Maintainer: { journey: "Maintainer" },
    DiscoveryFailed: { projects: failed() },
    FundingLoading: { projects: current(loadingFunding), funding: "PoolLoading" },
    NoProjects: { projects: current([]) },
    CommunityPages: { projects: current(manyCommunity) },
    FeaturedOnly: { projects: current([pool]) },
  },
};
