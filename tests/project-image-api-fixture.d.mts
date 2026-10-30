import type { D1QueryStatement, D1TransactionalDatabase } from "../backend/d1";
import type { ProjectDefinition } from "../src/lib/projects.mjs";

type ProjectFixture = {
  fetch(request: Request): Promise<Response>;
  stored(): Promise<{ revision: number; project: ProjectDefinition }>;
  dispose(): Promise<void>;
};

export function projectImageApiFixture(
  project: ProjectDefinition,
  options: { incompleteAssessments: true },
): Promise<ProjectFixture & { db: D1TransactionalDatabase<D1QueryStatement> }>;
export function projectImageApiFixture(
  project: ProjectDefinition,
): Promise<ProjectFixture>;
