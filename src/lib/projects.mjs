/**
 * Defines the public project registry and launch reward policies. Project
 * instructions may evolve in their repositories, while financial and trust
 * fields change only through review in this registry.
 */

import LEGACY_PROJECTS from "./legacy-projects.json" with { type: "json" };
import { RAW_PROJECT_DEFINITIONS } from "./project-registry.generated.mjs";
import { RAW_PROJECT_DEFINITIONS as INGESTED_PROJECT_DEFINITIONS } from "./project-registry.ingested.mjs";
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

/** Sorts and freezes one registry; retired manifests only resolve history. */
function buildRegistry(rawDefinitions) {
  const historical = Object.freeze(
    assertProjectRegistry(rawDefinitions)
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
          // Equal pools keep the root publisher first, so a cap change alone
          // cannot move the primary leaderboard repository.
          Number(right.skill.publishAtRoot === true) -
            Number(left.skill.publishAtRoot === true) ||
          left.id.localeCompare(right.id),
      )
      .map(freezeTree),
  );
  return {
    historical,
    listed: Object.freeze(
      historical.filter((project) => project.listingTier !== "retired"),
    ),
  };
}

/**
 * The registry as it is now. In the browser it is the D1 registry the page
 * loaded at startup; in Node it is the committed snapshot.
 */
const CURRENT = buildRegistry(RAW_PROJECT_DEFINITIONS);
/** Every manifest, including retired ones kept only to resolve history. */
const HISTORICAL_PROJECTS = CURRENT.historical;
/** Listed projects. Retired manifests never reach a page, skill, or list. */
const PROJECTS = CURRENT.listed;

/**
 * The registry snapshot the published ledger was collected from. The browser
 * validates the ledger against it, so a project approved or activated after
 * the last ingestion is listed at once without invalidating the ledger.
 */
const INGESTED = buildRegistry(INGESTED_PROJECT_DEFINITIONS);
const INGESTED_HISTORICAL_PROJECTS = INGESTED.historical;
const INGESTED_PROJECTS = INGESTED.listed;
const INGESTED_PROJECTS_BY_REPOSITORY = new Map(
  INGESTED_HISTORICAL_PROJECTS.flatMap((project) =>
    project.repositories.flatMap((repository) =>
      [repository.id, ...(repository.aliases ?? [])].map((repositoryId) => [
        repositoryId.toLowerCase(),
        project,
      ]),
    ),
  ),
);

const PROJECTS_BY_ID = new Map(
  PROJECTS.map((project) => [project.id, project]),
);
const PROJECTS_BY_REPOSITORY = new Map(
  PROJECTS.flatMap((project) =>
    project.repositories.flatMap((repository) =>
      [repository.id, ...(repository.aliases ?? [])].map((repositoryId) => [
        repositoryId.toLowerCase(),
        project,
      ]),
    ),
  ),
);

const HISTORICAL_PROJECTS_BY_ID = new Map(
  HISTORICAL_PROJECTS.map((project) => [project.id, project]),
);
const HISTORICAL_PROJECTS_BY_REPOSITORY = new Map(
  HISTORICAL_PROJECTS.flatMap((project) =>
    project.repositories.flatMap((repository) =>
      [repository.id, ...(repository.aliases ?? [])].map((repositoryId) => [
        repositoryId.toLowerCase(),
        project,
      ]),
    ),
  ),
);

/** Resolves a project id in immutable history, including retired projects. */
export function findHistoricalProject(projectId) {
  if (typeof projectId !== "string") return null;
  return HISTORICAL_PROJECTS_BY_ID.get(projectId) ?? null;
}

/** Resolves a repository in immutable history, including retired projects. */
export function findHistoricalProjectByRepositoryId(repositoryId) {
  if (typeof repositoryId !== "string") return null;
  return (
    HISTORICAL_PROJECTS_BY_REPOSITORY.get(repositoryId.toLowerCase()) ?? null
  );
}

/**
 * Projects listed before the D1 registry were removed with their manifests.
 * Contributor points and profiles keep their ids and repositories as history
 * labels only; they are never listed, collected, scored, or paid.
 */
const LEGACY_PROJECT_IDS = new Set(
  LEGACY_PROJECTS.map((project) => project.id),
);
const HISTORY_REPOSITORIES = new Map(
  [
    ...LEGACY_PROJECTS.map((project) => ({
      id: project.id,
      repositories: project.repositories,
    })),
    ...HISTORICAL_PROJECTS,
  ].flatMap((project) =>
    project.repositories.flatMap((repository) =>
      [repository.id, ...(repository.aliases ?? [])].map((repositoryId) => [
        repositoryId.toLowerCase(),
        { projectId: project.id, repositoryId: repository.id },
      ]),
    ),
  ),
);

/** True for a registry project or a removed pre-registry project id. */
export function isHistoricalProjectId(projectId) {
  return (
    typeof projectId === "string" &&
    (HISTORICAL_PROJECTS_BY_ID.has(projectId) ||
      LEGACY_PROJECT_IDS.has(projectId))
  );
}

/**
 * Resolves a registry or removed pre-registry repository id or alias to its
 * owning project id and canonical repository id.
 */
export function findHistoricalRepository(repositoryId) {
  if (typeof repositoryId !== "string") return null;
  return HISTORY_REPOSITORIES.get(repositoryId.toLowerCase()) ?? null;
}

/** True for a registry repository or a removed pre-registry repository. */
export function isHistoricalRepositoryId(repositoryId) {
  return findHistoricalRepository(repositoryId) !== null;
}

/**
 * Every name a record lists for one repository, joined across records. A
 * removed pre-registry record keeps a transferred repository's old name with
 * its current name as an alias, while the registry may list the repository
 * under its current name only. That registry entry takes the current name in
 * HISTORY_REPOSITORIES, so the two names resolve to different canonical ids
 * there. Here the names stay one repository, named by the last record that
 * lists any of them, which is the registry entry when there is one.
 */
const HISTORY_REPOSITORY_IDENTITIES = new Map();
for (const repository of [...LEGACY_PROJECTS, ...HISTORICAL_PROJECTS].flatMap(
  (project) => project.repositories,
)) {
  const identity = { repositoryId: repository.id, names: new Set() };
  for (const name of [repository.id, ...(repository.aliases ?? [])]) {
    const key = name.toLowerCase();
    for (const linked of HISTORY_REPOSITORY_IDENTITIES.get(key)?.names ?? [key])
      identity.names.add(linked);
  }
  for (const name of identity.names)
    HISTORY_REPOSITORY_IDENTITIES.set(name, identity);
}

/**
 * Resolves any recorded name of a registry or removed pre-registry repository,
 * including a transferred repository's old name, to one canonical id.
 */
export function findHistoricalRepositoryIdentity(repositoryId) {
  if (typeof repositoryId !== "string") return null;
  return (
    HISTORY_REPOSITORY_IDENTITIES.get(repositoryId.toLowerCase())
      ?.repositoryId ?? null
  );
}

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

/**
 * Resolves a ledger repository in the registry snapshot the ledger was
 * collected from, including retired projects. Score events always resolve
 * here, even when the runtime registry no longer lists their project.
 */
export function findIngestedProjectByRepositoryId(repositoryId) {
  if (typeof repositoryId !== "string") return null;
  return (
    INGESTED_PROJECTS_BY_REPOSITORY.get(repositoryId.toLowerCase()) ?? null
  );
}

/** Returns the project owning a registered repository id. */
export function findProjectByRepositoryId(repositoryId) {
  if (typeof repositoryId !== "string") return null;
  return PROJECTS_BY_REPOSITORY.get(repositoryId.toLowerCase()) ?? null;
}

export {
  HISTORICAL_PROJECTS,
  INGESTED_HISTORICAL_PROJECTS,
  INGESTED_PROJECTS,
  PROJECTS,
};
