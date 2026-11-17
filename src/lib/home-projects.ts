/** Project discovery follows the current admin placement and project state. */
import { hasProjectCardBounty } from "./project-reward-summary";
import { PROJECTS, type ProjectDefinition } from "./projects.mjs";

function isOpenProject(project: ProjectDefinition): boolean {
  return (
    project.status === "active" &&
    (!hasBountyOverview(project) || project.securityBounty?.status === "open")
  );
}

/**
 * Every open project for the homepage's Featured and Community sections.
 * A bounty-only card belongs in the Security bounties section instead.
 */
export function homeProjects() {
  return PROJECTS.filter(
    (project) =>
      (project.listingTier === "featured" ||
        project.listingTier === "community") &&
      isOpenProject(project) &&
      !hasProjectCardBounty(project),
  );
}

export function homeProjectDescription(description: string): string {
  if (description.length <= 500) return description;
  const characters = Array.from(description);
  return characters.length > 500
    ? `${characters.slice(0, 500).join("").trimEnd()}...`
    : description;
}

/**
 * Homepage order, given each project as shown this month: stablecoin
 * pools by monthly amount, largest first, then token pools, then external
 * prizes, then points-only projects. Equal entries keep featured placement
 * first, then registry order.
 */
export function homeProjectOrder<Project extends ProjectDefinition>(
  projects: readonly Project[],
): Project[] {
  const group = (project: ProjectDefinition) => {
    const reward = project.reward;
    if (reward.kind === "external-prize-share") return 2;
    if (reward.kind !== "monthly-pool" || reward.monthlyCapMinor === "0")
      return 3;
    return !project.rewardAsset || project.rewardAsset.kind === "stablecoin"
      ? 0
      : 1;
  };
  return projects
    .map((project, index) => ({ project, index, group: group(project) }))
    .sort((left, right) => {
      if (left.group !== right.group) return left.group - right.group;
      if (left.group === 0) {
        const a = BigInt(left.project.reward.monthlyCapMinor);
        const b = BigInt(right.project.reward.monthlyCapMinor);
        if (a !== b) return a > b ? -1 : 1;
      }
      const tier = (entry: { project: ProjectDefinition }) =>
        entry.project.listingTier === "featured" ? 0 : 1;
      return tier(left) - tier(right) || left.index - right.index;
    })
    .map((entry) => entry.project);
}

/** Only an explicitly bounty-only program replaces ordinary project work. */
export function hasBountyOverview(
  project: Pick<ProjectDefinition, "securityBounty">,
): boolean {
  return project.securityBounty?.rewardMode === "bounty-only";
}
