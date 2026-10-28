/** Project discovery uses bundled manifests and validated committed history. */
import {
  type PromotionCycle,
  projectPromotionEligible,
} from "./allocation-funding";
import history from "./project-promotion.generated.json" with { type: "json" };
import { PROJECTS, type ProjectDefinition } from "./projects.mjs";

export function homeProjects(now = new Date()) {
  const cycleId = now.toISOString().slice(0, 7);
  return PROJECTS.filter(
    (project) =>
      project.listingTier === "featured" &&
      projectPromotionEligible(
        project,
        history as PromotionCycle[],
        Date.parse(project.reward.rewardStartAt) <= now.getTime()
          ? cycleId
          : null,
      ),
  );
}

/** Community-tier projects that are open for work; paused ones are not listed. */
export function communityProjects() {
  return PROJECTS.filter(
    (project) =>
      project.listingTier === "community" &&
      project.status !== "paused" &&
      !hasBountyOverview(project),
  );
}

/** A published bounty replaces the overview when no ordinary cash pool exists. */
export function hasBountyOverview(project: ProjectDefinition): boolean {
  return Boolean(
    project.securityBounty &&
      (project.securityBounty.rewardMode === "bounty-only" ||
        (project.reward.kind === "monthly-pool" &&
          project.reward.monthlyCapMinor === "0")),
  );
}
