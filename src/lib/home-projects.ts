/** Project discovery uses bundled manifests and validated committed history. */
import {
  type PromotionCycle,
  projectPromotionEligible,
} from "./allocation-funding";
import history from "./project-promotion.generated.json" with { type: "json" };
import { PROJECTS } from "./projects.mjs";

export function homeProjects(now = new Date()) {
  const cycleId = now.toISOString().slice(0, 7);
  return PROJECTS.filter((project) =>
    projectPromotionEligible(
      project,
      history as PromotionCycle[],
      Date.parse(project.reward.rewardStartAt) <= now.getTime()
        ? cycleId
        : null,
    ),
  );
}
