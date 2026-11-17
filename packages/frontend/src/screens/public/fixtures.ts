// spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"
import type { LiveFootprint, WhoBuildsSnapshot } from "./WhoBuilds.tsx";

export const whoBuilds: WhoBuildsSnapshot = {
  generatedAt: "2026-09-17",
  externalReposExMass: 1_204,
  externalPrsExMass: 9_317,
  aiRepoMedianStars: 41,
  aiRepoShareUnder10: 0.37,
  cohorts: [{ size: 412, classifiable: 360, aiPrimary: 151, aiExternalPr: 98 }],
  focus: [
    { area: "AI agents and LLM tooling", repos: 380, prs: 4_210, primaryContributors: 151 },
    { area: "Web and apps", repos: 290, prs: 2_030, primaryContributors: 97 },
  ],
  recognizable: [{ repo: "vercel/next.js", prs: 12, stars: 131_000 }],
  massAccounts: [{}, {}],
};

export const live: LiveFootprint = { contributors: 188, windowDays: 35, scoredEvents: 2_400, mergedPullRequests: 900, mergedPullRequestsWithModel: 612 };
