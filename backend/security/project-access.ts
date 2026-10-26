/** Registered-project reporting authority. This grants no financial role. */
import type { GithubActor } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { fail } from "../http";
import {
  type RepositoryAccessReader,
  readRepositoryAccess,
  setupAuthority,
} from "../projects/setup";

export async function repositoryReportingAuthority(
  reader: RepositoryAccessReader | undefined,
  manifest: ProjectDefinition,
  actor: GithubActor,
): Promise<boolean> {
  const checked = await readRepositoryAccess(reader, manifest, actor);
  const authority = setupAuthority(checked, actor, manifest.repositories[0].id);
  if (authority.state === "retry")
    fail(503, "github_unavailable", authority.message);
  if (
    authority.state !== "verified" ||
    checked.state !== "read" ||
    checked.access.installation !== "installed"
  )
    return false;
  const facts = checked.access.repository;
  if (!facts)
    fail(
      503,
      "github_unavailable",
      "Slopbot did not return the repository identity. Try again.",
    );
  const steward = manifest.steward.github;
  if (
    String(facts.id) !== manifest.authority.repositoryId ||
    facts.node_id !== manifest.authority.repositoryNodeId ||
    facts.full_name.toLowerCase() !==
      manifest.repositories[0].id.toLowerCase() ||
    facts.private ||
    String(facts.owner.id) !== steward.actorId ||
    facts.owner.node_id !== steward.nodeId ||
    facts.owner.type !== steward.type ||
    facts.owner.login.toLowerCase() !== steward.login.toLowerCase()
  )
    return false;
  return (
    actor.githubId === steward.actorId || checked.access.permission === "admin"
  );
}

/** Permission-provider outages are retryable, never a denial or empty scope. */
export function reportingAuthorityUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "github_unavailable"
  );
}
