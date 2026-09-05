import type { ProjectDefinition } from "./projects.mjs";
export declare function assertProjectFundingAuthority(
  value: unknown,
  project: ProjectDefinition,
): Record<string, unknown>;
export declare function verifyProjectFundingAuthority(
  project: ProjectDefinition,
  options?: { fetchImpl?: typeof fetch },
): Promise<void>;
export declare function verifyFundingAddressTransitions(
  previous: ReadonlyMap<string, ProjectDefinition>,
  current: ReadonlyMap<string, ProjectDefinition>,
  options?: { fetchImpl?: typeof fetch },
): Promise<void>;
