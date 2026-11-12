/** Types for appended project repositories. */

import type { ProjectDefinition } from "./projects.mjs";

export type ProjectRepository = ProjectDefinition["repositories"][number];

export declare function nextUtcMonthStart(now: Date): string;
export declare function appendedRepositories(
  previous: Pick<ProjectDefinition, "repositories">,
  next: Pick<ProjectDefinition, "repositories">,
): ProjectRepository[] | null;
export declare function repositoryIdentity(
  manifest: Pick<ProjectDefinition, "repositories" | "authority">,
  repositoryId: string,
): { githubId: string; nodeId: string } | null;
export declare function repositoryCountsFrom(
  manifest: Pick<ProjectDefinition, "repositories">,
  repositoryId: string,
): number | null;
export declare function repositoriesCountedFor(
  manifest: Pick<ProjectDefinition, "repositories">,
  monthStartMs: number,
): ProjectRepository[];
