import type { ProjectDefinition } from "../src/lib/projects.mjs";
export function projectImageApiFixture(project: ProjectDefinition): Promise<{
  fetch(request: Request): Promise<Response>;
  stored(): Promise<{ revision: number; project: ProjectDefinition }>;
  dispose(): Promise<void>;
}>;
