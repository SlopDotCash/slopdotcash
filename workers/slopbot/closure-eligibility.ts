// Automatic closure scope (PRD section 5): only verified slop.cash members
// using the Slop skill, never project maintainers. This is an authority
// boundary, separate from the review itself: advisory review stays broad.
import { currentRepositoryPath } from "../../backend/projects/setup";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import type { Exemption } from "./github";
import type { D1Database } from "./persistence";

export type ClosureEvidence = {
  itemKind: "issue" | "pull_request";
  exemption: Exemption;
  /** A slop.cash member record matched by the author's immutable GitHub ID. */
  member: boolean;
  /** The author's own authenticated Slop run whose pull_request_opened event
   * names this exact pull request node ID (owner decision D6, PRD section 11).
   */
  recordedSkillRun: boolean;
};

export type ClosureEligibility =
  | { eligible: true; why: string }
  | { eligible: false; why: string };

/** Every condition must hold. The "Made via @slopdotcash" marker is never an
 * input: anyone can paste it, so it proves neither membership nor authorship.
 */
export function closureEligibility(
  evidence: ClosureEvidence,
): ClosureEligibility {
  if (evidence.exemption === "exempt")
    return { eligible: false, why: "maintainers are never closed by Slopbot" };
  if (evidence.exemption !== "not-exempt")
    return { eligible: false, why: "maintainer status unknown" };
  // The Slop skill submits pull requests only; it never opens issues.
  if (evidence.itemKind !== "pull_request")
    return {
      eligible: false,
      why: "only Slop-skill pull requests can be closed",
    };
  if (!evidence.member)
    return {
      eligible: false,
      why: "author is not a verified slop.cash member",
    };
  if (!evidence.recordedSkillRun)
    return {
      eligible: false,
      why: "no recorded Slop run for this pull request",
    };
  return {
    eligible: true,
    why: "verified member with a recorded Slop run for this pull request",
  };
}

export async function isMember(
  db: D1Database,
  githubId: number,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM points_members WHERE github_id = ?")
    .bind(String(githubId))
    .first();
  return row !== null;
}

/** The owner-approved closure evidence (D6, PRD section 11): a trace_runs row
 * that the author created through their own authenticated Slop session for
 * this project's repository, with a pull_request_opened event that names this
 * exact pull request node ID. The session comes from the author's own GitHub
 * login, so a copied marker, receipt or footer cannot produce this record for
 * another person. A URL alone does not match.
 */
export async function hasRecordedSkillRun(
  db: D1Database,
  item: {
    authorId: number;
    projectId: string;
    owner: string;
    repo: string;
    nodeId: string;
  },
): Promise<boolean> {
  const repository = `${item.owner}/${item.repo}`.toLowerCase();
  const accepted = new Set([repository]);
  const registered = await db
    .prepare("SELECT manifest FROM projects WHERE id = ?")
    .bind(item.projectId)
    .first<{ manifest: string }>();
  if (registered) {
    const project = assertProjectDefinition(JSON.parse(registered.manifest));
    for (const entry of project.repositories) {
      const names = [
        entry.id,
        ...(entry.aliases ?? []),
        currentRepositoryPath(entry),
      ].map((name) => name.toLowerCase());
      if (names.includes(repository)) {
        for (const name of names) accepted.add(name);
      }
    }
  }
  const repositories = [...accepted];
  const placeholders = repositories.map(() => "?").join(", ");
  const row = await db
    .prepare(`SELECT 1 AS ok FROM run_progress_events e
      JOIN trace_runs r ON r.id = e.run_id AND r.github_user_id = e.github_user_id
      WHERE e.github_user_id = ? AND e.kind = 'pull_request_opened'
        AND r.project_id = ? AND lower(r.repository) IN (${placeholders})
        AND e.github_object_id = ?
      LIMIT 1`)
    .bind(String(item.authorId), item.projectId, ...repositories, item.nodeId)
    .first();
  return row !== null;
}
