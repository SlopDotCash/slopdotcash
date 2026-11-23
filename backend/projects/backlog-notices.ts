/**
 * Owner notices of the backlog rule (operator decision, 23 November 2026;
 * PRD section 5; `src/lib/backlog-rule.mjs`). The scheduled Slopbot run sends
 * them right after it refreshes the stored merge activity, from the same
 * stored rows the public pages and discovery read:
 *
 * - before the rule starts, once per project that would be out of rotation
 *   on current figures (`backlog-rule:<project>:preview`);
 * - from the start, when dormancy is near
 *   (`backlog-rule:<project>:warn:<last merge>`);
 * - from the start, when a project leaves rotation
 *   (`backlog-rule:<project>:out:<reason>:<last merge or none>`), so a
 *   project out for many days gets one notice per episode.
 *
 * A failure never fails the merge activity read; the next run retries, and
 * the event keys keep every notice once.
 */

import {
  backlogOutDetail,
  backlogPreviewDetail,
  backlogState,
  backlogWarningDetail,
  dormancyNear,
} from "../../src/lib/backlog-rule.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { D1Database, D1QueryStatement } from "../d1";
import { notifyBacklogRule } from "../notifications/events";
import { readIntakeCounts } from "./merge-activity";

type Database = D1Database<D1QueryStatement>;

export type BacklogNotice = {
  projectId: string;
  eventKey: string;
  detail: string;
};

/** The notices the stored figures call for at `now`, at most one a project. */
export function backlogNotices(
  projects: readonly ProjectDefinition[],
  counts: Map<string, Parameters<typeof backlogState>[1]>,
  now: Date,
): BacklogNotice[] {
  const notices: BacklogNotice[] = [];
  for (const project of projects) {
    const state = backlogState(project, counts.get(project.id), now);
    const key = `backlog-rule:${project.id}`;
    if (!state.started) {
      if (state.wouldBeOut)
        notices.push({
          projectId: project.id,
          eventKey: `${key}:preview`,
          detail: backlogPreviewDetail(state),
        });
    } else if (state.outOfRotation)
      notices.push({
        projectId: project.id,
        eventKey: `${key}:out:${state.reason}:${state.figures?.lastMergedAt ?? "none"}`,
        detail: backlogOutDetail(state),
      });
    else if (dormancyNear(state))
      notices.push({
        projectId: project.id,
        eventKey: `${key}:warn:${state.figures?.lastMergedAt ?? "none"}`,
        detail: backlogWarningDetail(state),
      });
  }
  return notices;
}

/** Writes the due notices. Never throws; returns how many were attempted. */
export async function sendBacklogNotices(
  db: Database,
  projects: readonly ProjectDefinition[],
  now: Date,
): Promise<{ attempted: number; failed: number }> {
  let counts: Awaited<ReturnType<typeof readIntakeCounts>>;
  try {
    counts = await readIntakeCounts(db);
  } catch {
    console.error("backlog rule notices: merge activity unavailable");
    return { attempted: 0, failed: 0 };
  }
  const at = now.toISOString();
  let failed = 0;
  const notices = backlogNotices(projects, counts, now);
  for (const notice of notices) {
    try {
      await notifyBacklogRule(
        db,
        notice.projectId,
        notice.eventKey,
        notice.detail,
        at,
      ).run();
    } catch {
      failed += 1;
    }
  }
  if (failed > 0)
    console.error(`backlog rule notices: ${failed} could not be written`);
  return { attempted: notices.length, failed };
}
