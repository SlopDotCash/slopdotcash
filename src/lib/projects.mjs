/**
 * Defines the public project registry and launch reward policies. Project
 * instructions may evolve in their repositories, while financial and trust
 * fields change only through review in this registry.
 */

import { RAW_PROJECT_DEFINITIONS } from "./project-registry.generated.mjs";
import { assertProjectRegistry } from "./project-schema.mjs";

function freezeTree(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
  return value;
}

function compareMinorDescending(left, right) {
  const leftMinor = BigInt(left);
  const rightMinor = BigInt(right);
  return leftMinor === rightMinor ? 0 : leftMinor > rightMinor ? -1 : 1;
}

const PROJECTS = Object.freeze(
  assertProjectRegistry(RAW_PROJECT_DEFINITIONS)
    .sort(
      (left, right) =>
        compareMinorDescending(
          left.reward.committedMinor,
          right.reward.committedMinor,
        ) ||
        compareMinorDescending(
          left.reward.monthlyCapMinor,
          right.reward.monthlyCapMinor,
        ) ||
        left.id.localeCompare(right.id),
    )
    .map(freezeTree),
);

const PROJECTS_BY_ID = new Map(
  PROJECTS.map((project) => [project.id, project]),
);
const PROJECTS_BY_REPOSITORY = new Map(
  PROJECTS.flatMap((project) =>
    project.repositories.map(({ id: repositoryId }) => [
      repositoryId.toLowerCase(),
      project,
    ]),
  ),
);

/** Returns the canonical project for an id or slug. */
export function findProject(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (
    PROJECTS_BY_ID.get(normalized) ??
    PROJECTS.find((project) => project.slug.toLowerCase() === normalized) ??
    null
  );
}

/** Returns the project owning a registered repository id. */
export function findProjectByRepositoryId(repositoryId) {
  if (typeof repositoryId !== "string") return null;
  return PROJECTS_BY_REPOSITORY.get(repositoryId.toLowerCase()) ?? null;
}

export { PROJECTS };
