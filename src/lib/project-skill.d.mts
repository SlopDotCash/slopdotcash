/** Types for the generated project skill renderer. */

import type { ProjectDefinition } from "./projects.mjs";

export declare function renderProjectSkill(input: {
  role: "contributor" | "reviewer";
  templateFiles: Record<string, string | Uint8Array>;
  manifest: ProjectDefinition;
  registry: { revision: number; manifestSha256: string };
}): Record<string, Uint8Array>;
export declare function usesGeneratedSkills(
  manifest: ProjectDefinition,
): boolean;
