/** Project discovery follows the current admin placement and project state. */
import { PROJECTS, type ProjectDefinition } from "./projects.mjs";

function isOpenProject(project: ProjectDefinition): boolean {
  return (
    project.status === "active" &&
    (!hasBountyOverview(project) || project.securityBounty?.status === "open")
  );
}

export function homeProjects() {
  return PROJECTS.filter(
    (project) => project.listingTier === "featured" && isOpenProject(project),
  );
}

export function communityProjects() {
  return PROJECTS.filter(
    (project) => project.listingTier === "community" && isOpenProject(project),
  );
}

/** Only an explicitly bounty-only program replaces ordinary project work. */
export function hasBountyOverview(
  project: Pick<ProjectDefinition, "securityBounty">,
): boolean {
  return project.securityBounty?.rewardMode === "bounty-only";
}
