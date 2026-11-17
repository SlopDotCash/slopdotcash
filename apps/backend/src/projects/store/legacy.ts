// spec/backend/projectRegistry.md, "Each permanent repository id and each path key belongs to at most one project"
import projects from "../legacyProjects.json" with { type: "json" };

export interface LegacyRepository {
  readonly id: string;
  readonly aliases: ReadonlyArray<string>;
}

export interface LegacyProject {
  readonly id: string;
  readonly name: string;
  readonly repositories: ReadonlyArray<LegacyRepository>;
}

export const legacyProjects: ReadonlyArray<LegacyProject> = projects;

/** @throws {never} */
export function legacyHolder(key: string): string | undefined {
  const lowered = key.toLowerCase();
  return legacyProjects.find((project) => project.repositories.some((repository) => [repository.id, ...repository.aliases].some((path) => path.toLowerCase() === lowered)))?.id;
}

/** @throws {never} */
export function isLegacyProject(projectId: string): boolean {
  return legacyProjects.some((project) => project.id === projectId);
}
