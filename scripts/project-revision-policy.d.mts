import type { ProjectDefinition } from "../src/lib/projects.mjs";

export interface ProjectRevisionPolicy {
  project: ProjectDefinition;
  revision: number;
  manifestSha256: string;
  bytes: Buffer;
}

export declare function currentProjectPolicies(
  root: string,
): Promise<ProjectRevisionPolicy[]>;
