/**
 * Ordered registry of the GitHub repositories the eliza.army program targets.
 * The first entry is the primary repository: it remains the backward-compatible
 * `snapshot.repository` value and the default `--repo` for the bundled skill.
 * Scoring caps stay global per contributor across every entry, so adding a
 * repository never grants extra scoring capacity. Plain JavaScript so the Node
 * evidence scripts and the TypeScript site share one source of truth.
 */

export const TARGET_REPOSITORIES = Object.freeze([
  Object.freeze({
    id: "elizaOS/eliza",
    owner: "elizaOS",
    name: "eliza",
    displayName: "elizaOS/eliza",
    githubUrl: "https://github.com/elizaOS/eliza",
    description: "Core elizaOS agent framework and runtime.",
    role: "primary",
  }),
  Object.freeze({
    id: "lalalune/arklib",
    owner: "lalalune",
    name: "arklib",
    displayName: "lalalune/arklib",
    githubUrl: "https://github.com/lalalune/arklib",
    description:
      "Formally verified arguments of knowledge in Lean 4. Hosts the δ* programme on Reed–Solomon proximity, machine-checking progress toward the Ethereum Foundation's Proximity Prize.",
    role: "member",
  }),
]);

export const PRIMARY_REPOSITORY = TARGET_REPOSITORIES[0];

const REPOSITORIES_BY_LOWERCASE_ID = new Map(
  TARGET_REPOSITORIES.map((repository) => [
    repository.id.toLowerCase(),
    repository,
  ]),
);

/**
 * Returns the registry entry for an owner/name pair, matching GitHub's
 * case-insensitive repository identity, or null when the pair is not a
 * registered target repository.
 */
export function findTargetRepository(owner, name) {
  if (typeof owner !== "string" || typeof name !== "string") {
    return null;
  }
  return (
    REPOSITORIES_BY_LOWERCASE_ID.get(`${owner}/${name}`.toLowerCase()) ?? null
  );
}

/** Returns the registry entry whose id matches, or null. */
export function findTargetRepositoryById(id) {
  if (typeof id !== "string") {
    return null;
  }
  return REPOSITORIES_BY_LOWERCASE_ID.get(id.toLowerCase()) ?? null;
}
