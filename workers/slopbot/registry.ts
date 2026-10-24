import { repositoryIdentity } from "../../backend/projects/enforcement";
import {
  evaluateProjectCapabilities,
  type ProjectCapabilities,
  type ProjectRestrictionState,
} from "../../src/lib/project-capabilities.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { Job } from "./contracts";
import type { D1Database } from "./persistence";

type RepositoryJob = Pick<Job, "owner" | "repo" | "repositoryId">;

/** What Slopbot may do on a repository right now. "contributor" is the full
 * review (scoring, labels and eligible closure); "security" is the advisory
 * security review PRD section 5 keeps for paused, flagged or removed projects.
 */
export type ReviewScope = "contributor" | "security";

const UNREGISTERED: ProjectCapabilities = evaluateProjectCapabilities({
  registered: false,
});

/** Read the live registry, not the release's generated snapshot. Installation
 * access alone does not authorize reviews. Database failures must propagate.
 * Slopbot does not read funding, so payment execution is never derived here.
 */
export async function repositoryCapabilities(
  db: D1Database,
  job: RepositoryJob,
): Promise<{
  projectId: string | null;
  project: ProjectDefinition | null;
  capabilities: ProjectCapabilities;
}> {
  const key = `${job.owner}/${job.repo}`.toLowerCase();
  const row = await db
    .prepare(`SELECT p.status, p.manifest FROM project_repositories r
      JOIN projects p ON p.id = r.project_id
      WHERE r.repository_key = ?`)
    .bind(key)
    .first<{ status: string; manifest: string }>();
  if (row === null)
    return { projectId: null, project: null, capabilities: UNREGISTERED };
  const project = assertProjectDefinition(JSON.parse(row.manifest));
  const index = project.repositories.findIndex(
    (repository) =>
      new URL(repository.githubUrl).pathname
        .replace(/^\/|\/$/gu, "")
        .toLowerCase() === key,
  );
  // Old aliases are history, not permission to review a reused repository name.
  if (
    index < 0 ||
    (index === 0 && String(job.repositoryId) !== project.authority.repositoryId)
  )
    return { projectId: null, project: null, capabilities: UNREGISTERED };
  const identity = repositoryIdentity(project);
  // An enforcement can be effective before its paused revision is appended.
  // Match the current restriction of every project sharing this identity.
  const restricted = await db
    .prepare(`SELECT e.state_after AS state FROM project_enforcements e
      WHERE NOT EXISTS (SELECT 1 FROM project_enforcements newer
        WHERE newer.project_id = e.project_id AND newer.sequence > e.sequence)
      AND e.state_after <> 'clear'
      AND (e.project_id = ? OR e.repository_github_id = ? OR EXISTS (
        SELECT 1 FROM json_each(e.repository_keys) old_key
        JOIN json_each(?) current_key ON old_key.value = current_key.value))
      ORDER BY e.state_after = 'banned' DESC LIMIT 1`)
    .bind(project.id, identity.githubId, JSON.stringify(identity.keys))
    .first<{ state: ProjectRestrictionState }>();
  return {
    projectId: project.id,
    project,
    capabilities: evaluateProjectCapabilities({
      registered: true,
      // The row status and the manifest status must agree before work opens.
      status:
        row.status === "active" && project.status === "active"
          ? "active"
          : "paused",
      listingTier: project.listingTier,
      restriction: restricted?.state ?? "clear",
    }),
  };
}

/** The review Slopbot may run, or null for an unregistered repository. */
export async function reviewRegistration(
  db: D1Database,
  job: RepositoryJob,
): Promise<{ scope: ReviewScope; projectId: string } | null> {
  const { projectId, capabilities } = await repositoryCapabilities(db, job);
  if (projectId === null) return null;
  if (capabilities.mayOfferContributorWork)
    return { scope: "contributor", projectId };
  return capabilities.mayReviewForSecurity
    ? { scope: "security", projectId }
    : null;
}

/** True when the repository still permits the given scope. A contributor
 * review loses authority when the project is paused; a security review keeps
 * it while the repository stays registered.
 */
export async function scopeAllowed(
  db: D1Database,
  job: RepositoryJob,
  scope: ReviewScope,
): Promise<boolean> {
  const { capabilities } = await repositoryCapabilities(db, job);
  return scope === "contributor"
    ? capabilities.mayOfferContributorWork
    : capabilities.mayReviewForSecurity;
}

export async function requireScope(
  db: D1Database,
  job: RepositoryJob,
  scope: ReviewScope,
) {
  if (!(await scopeAllowed(db, job, scope)))
    throw new Error(
      scope === "contributor"
        ? "Repository is not active in the Slop project registry"
        : "Repository is not registered in the Slop project registry",
    );
}

/** Contributor work: scoring, value assessment and eligible closure. */
export async function registeredRepository(
  db: D1Database,
  job: RepositoryJob,
): Promise<boolean> {
  return scopeAllowed(db, job, "contributor");
}

export async function requireRegisteredRepository(
  db: D1Database,
  job: RepositoryJob,
) {
  await requireScope(db, job, "contributor");
}

/** Current validated metadata for contributor work. The same live authority
 * check supplies the manifest, so a release snapshot cannot gate new projects.
 */
export async function registeredProject(db: D1Database, job: RepositoryJob) {
  const { project, capabilities } = await repositoryCapabilities(db, job);
  return capabilities.mayOfferContributorWork ? project : null;
}
