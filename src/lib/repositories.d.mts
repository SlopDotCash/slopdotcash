/** Types for the shared target-repository registry. */

export type RepositoryId = "elizaOS/eliza" | "lalalune/arklib";

export interface TargetRepository {
  readonly id: RepositoryId;
  readonly owner: string;
  readonly name: string;
  readonly displayName: string;
  readonly githubUrl: string;
  readonly description: string;
  readonly role: "primary" | "member";
}

export declare const TARGET_REPOSITORIES: readonly TargetRepository[];

export declare const PRIMARY_REPOSITORY: TargetRepository & {
  readonly id: "elizaOS/eliza";
  readonly role: "primary";
};

export declare function findTargetRepository(
  owner: string,
  name: string,
): TargetRepository | null;

export declare function findTargetRepositoryById(
  id: string,
): TargetRepository | null;
