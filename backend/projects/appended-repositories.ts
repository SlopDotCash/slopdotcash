/**
 * Verifies repositories an owner appends to a project (PRD section 4 "Setup
 * requirements", section 8 "Clear a project before execution"). Each one
 * must be a public, non-fork, non-archived GitHub repository whose permanent
 * ids, current name and integration branch match the entry; the owner needs
 * write, maintain or admin access through its own Slopbot installation; and
 * it counts from the first instant of the next UTC month by the server clock.
 */
import type { GithubActor } from "../../src/lib/project-contracts";
import { nextUtcMonthStart } from "../../src/lib/project-repositories.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { fail } from "../http";
import {
  type GithubFetch,
  GithubLookupError,
  lookupGitHubRepository,
} from "./github-lookup";
import {
  type AccessCheck,
  type RepositoryAccessReader,
  setupAuthority,
} from "./setup";

type RepositoryEntry = ProjectDefinition["repositories"][number];

export type AppendedRepositoryDependencies = {
  github: { fetch: GithubFetch; token?: string; apiOrigin?: string };
  repositoryAccess?: RepositoryAccessReader;
};

const UNAVAILABLE = "GitHub or Slopbot did not answer for";

async function readAccess(
  reader: RepositoryAccessReader | undefined,
  entry: RepositoryEntry & { githubId: string },
  actor: GithubActor,
): Promise<AccessCheck> {
  if (reader === undefined)
    return {
      state: "retry",
      message:
        "Slop cannot reach Slopbot to check the installation right now. Try again later.",
    };
  try {
    return {
      state: "read",
      access: await reader({ path: entry.id, githubId: entry.githubId }, actor),
    };
  } catch {
    return {
      state: "retry",
      message: `${UNAVAILABLE} ${entry.id}. Try again.`,
    };
  }
}

type ListedProject = { id: string; manifest: ProjectDefinition };

/**
 * Refuses an appended repository whose permanent GitHub id any project
 * already lists, under any name: another project's first repository
 * (`authority.repositoryId`) or appended entry (`githubId`), this project's
 * own first repository or entries, or an earlier entry of the same
 * submission. Runs on the submitted entries before schema validation, so a
 * renamed repository appended again is a registry conflict, not a manifest
 * error.
 */
export function assertAppendedIdentitiesUnlisted(
  projects: readonly ListedProject[],
  project: ListedProject,
  submittedRepositories: unknown,
): void {
  if (
    !Array.isArray(submittedRepositories) ||
    submittedRepositories.length <= project.manifest.repositories.length
  )
    return;
  const listed = new Map<string, string>();
  for (const candidate of [
    project,
    ...projects.filter((entry) => entry.id !== project.id),
  ]) {
    const { manifest } = candidate;
    const ids = [
      manifest.authority?.repositoryId,
      ...manifest.repositories.slice(1).map((entry) => entry.githubId),
    ];
    for (const githubId of ids)
      if (typeof githubId === "string" && !listed.has(githubId))
        listed.set(githubId, candidate.id);
  }
  for (const entry of submittedRepositories.slice(
    project.manifest.repositories.length,
  )) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, githubId } = entry as { id?: unknown; githubId?: unknown };
    if (typeof githubId !== "string") continue;
    const owner = listed.get(githubId);
    if (owner !== undefined)
      fail(
        409,
        "registry_conflict",
        `GitHub repository ${githubId}${typeof id === "string" ? ` (${id})` : ""} is already listed by project ${owner}`,
      );
    listed.set(githubId, project.id);
  }
}

async function verifyOne(
  deps: AppendedRepositoryDependencies,
  actor: GithubActor,
  entry: RepositoryEntry,
  countsFrom: string,
): Promise<void> {
  if (entry.countsFrom !== countsFrom)
    fail(
      422,
      "invalid_repository_start",
      `${entry.id} must count from ${countsFrom}, the start of the next UTC month.`,
    );
  if (entry.displayName !== entry.id)
    fail(
      422,
      "invalid_repository",
      `The display name of ${entry.id} must be ${entry.id}.`,
    );
  if (entry.githubId === undefined || entry.nodeId === undefined)
    fail(
      422,
      "invalid_repository",
      `${entry.id} needs its permanent GitHub ids.`,
    );
  let facts: Awaited<ReturnType<typeof lookupGitHubRepository>>;
  try {
    facts = await lookupGitHubRepository(
      deps.github.fetch,
      deps.github.token,
      entry.id,
      deps.github.apiOrigin,
    );
  } catch (error) {
    if (
      error instanceof GithubLookupError &&
      (error.status === 400 || error.status === 404)
    )
      fail(
        422,
        "invalid_repository",
        `GitHub has no public repository named ${entry.id}.`,
      );
    fail(
      503,
      "github_unavailable",
      `GitHub could not be checked for ${entry.id}. Try again.`,
    );
  }
  const refusal =
    facts.fork !== false
      ? `${entry.id} is a fork. Add the original repository instead.`
      : facts.archived !== false
        ? `${entry.id} is archived on GitHub.`
        : facts.numericId !== entry.githubId ||
            facts.nodeId !== entry.nodeId ||
            facts.repository !== entry.id
          ? `GitHub reports different facts for ${entry.id}. Look it up again.`
          : !facts.branches.includes(entry.integrationBranch)
            ? `${entry.id} has no branch named ${entry.integrationBranch}.`
            : null;
  if (refusal !== null) fail(422, "invalid_repository", refusal);
  const access = await readAccess(
    deps.repositoryAccess,
    { ...entry, githubId: entry.githubId },
    actor,
  );
  const authority = setupAuthority(access, actor, entry.id);
  if (authority.state === "retry")
    fail(503, "github_unavailable", authority.message);
  if (access.state === "read" && access.access.installation !== "installed")
    fail(409, "slopbot_required", authority.message);
  if (authority.state === "denied")
    fail(403, "authority_required", authority.message);
  // Slopbot reads the repository by its permanent id; any identity it
  // reports must be the entry's.
  const observed =
    access.state === "read" && access.access.installation === "installed"
      ? access.access.repository
      : undefined;
  if (
    observed !== undefined &&
    (String(observed.id) !== entry.githubId ||
      observed.node_id !== entry.nodeId)
  )
    fail(
      422,
      "invalid_repository",
      `GitHub reports different facts for ${entry.id}. Look it up again.`,
    );
}

/**
 * Refuses the owner revision unless every appended repository passes, in
 * manifest order. Runs before the revision is appended; registry conflicts
 * with other projects are refused afterwards by the registry check.
 */
export async function verifyAppendedRepositories(
  deps: AppendedRepositoryDependencies,
  actor: GithubActor,
  appended: readonly RepositoryEntry[],
  now: Date,
): Promise<void> {
  const countsFrom = nextUtcMonthStart(now);
  for (const entry of appended) await verifyOne(deps, actor, entry, countsFrom);
}
