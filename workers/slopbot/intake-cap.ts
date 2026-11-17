// A maintainer's intake cap (operator decision, 17 November 2026; PRD
// section 5). While a project is over the cap its owner set, Slopbot skips
// its free advisory review of pull requests from outside contributors that it
// has not reviewed before. Value assessment, points and payment never read
// this, so work a maintainer merges scores exactly as before.

import { INTAKE_COUNT_MAX_AGE_MS } from "../../src/lib/intake-cap.mjs";
import type { D1Database } from "./persistence";

/** Recorded as the review's skip reason when the intake cap refuses it. */
export const INTAKE_CAP_REASON = "intake-cap";

/**
 * True when the project of this pull request has paused new contributors and
 * Slopbot has not completed a review of the pull request before. The pause
 * uses the stored open counts of the scheduled merge activity read, by the
 * same rule as the public pages (`intakePaused`): no cap, a count that was
 * never read, or a count older than three days pauses nothing. A pull request
 * already reviewed once keeps its reviews on later pushes.
 */
export async function intakeCapRefuses(
  db: D1Database,
  projectId: string,
  repositoryId: number,
  authorId: number,
  itemNumber: number,
  at: Date = new Date(),
): Promise<boolean> {
  const project = await db
    .prepare(
      "SELECT json_extract(manifest, '$.slopbot.intakeCap') AS cap FROM projects WHERE id = ? AND status = 'active'",
    )
    .bind(projectId)
    .first<{ cap: number | null }>();
  const cap = project?.cap;
  if (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 1)
    return false;
  // `observed_at` is always written by toISOString, so text order is time
  // order. The same age limit as `countAtCap` on the public pages.
  const recent = await db
    .prepare(
      "SELECT MAX(open_outside) AS open FROM repository_merge_activity WHERE project_id = ? AND open_outside IS NOT NULL AND observed_at IS NOT NULL AND observed_at >= ?",
    )
    .bind(
      projectId,
      new Date(at.getTime() - INTAKE_COUNT_MAX_AGE_MS).toISOString(),
    )
    .first<{ open: number | null }>();
  if (typeof recent?.open !== "number" || recent.open < cap) return false;
  const reviewed = await db
    .prepare(
      "SELECT 1 AS ok FROM slopbot_reviews WHERE repository_id = ? AND author_id = ? AND item_kind = 'pull_request' AND item_number = ? AND status = 'completed' LIMIT 1",
    )
    .bind(repositoryId, authorId, itemNumber)
    .first();
  return reviewed === null;
}
