/** Types for the project-owned target-repository registry. */

import type { ProjectId } from "./projects.mjs";

export type RepositoryId = string;

export interface TargetRepository {
  readonly id: RepositoryId;
  readonly owner: string;
  readonly name: string;
  readonly displayName: string;
  readonly githubUrl: string;
  readonly description: string;
  readonly integrationBranch: string;
  readonly projectId: ProjectId;
  readonly role: "primary" | "member";
}

export declare const TARGET_REPOSITORIES: readonly TargetRepository[];

export declare const PRIMARY_REPOSITORY: TargetRepository;

export declare function findTargetRepository(
  owner: string,
  name: string,
): TargetRepository | null;

export declare function findTargetRepositoryById(
  id: string,
): TargetRepository | null;
