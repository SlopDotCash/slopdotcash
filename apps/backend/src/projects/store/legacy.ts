// spec/backend/projectRegistry.md, "Each permanent repository id and each path key belongs to at most one project"
import projects from "../legacyProjects.json" with { type: "json" };

/** @throws {never} */
export function legacyHolder(key: string): string | undefined {
  const lowered = key.toLowerCase();
  return projects.find((project) => project.repositories.some((repository) => [repository.id, ...repository.aliases].some((path) => path.toLowerCase() === lowered)))?.id;
}

/** @throws {never} */
export function isLegacyProject(projectId: string): boolean {
  return projects.some((project) => project.id === projectId);
}
