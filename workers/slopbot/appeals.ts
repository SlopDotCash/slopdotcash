// Appeal triage state (owner decision D8, PRD sections 5 and 11). Slopbot
// triages each appeal first and drafts a resolution. A moderator decides an
// escalated appeal. Identifiers, the draft and the outcome only; no source,
// prompt or model text is stored here.

import { notifySlopbotAppeal } from "../../backend/notifications/events";
import { PARTICIPATION_BAN_QUERY } from "../../backend/projects/account-bans";
import { githubIdSet } from "../../src/lib/github-ids";
import { type Category, CLOSE_CONFIDENCE, type Job } from "./contracts";
import { dispatchDueJobs } from "./maintainer-holds";
import type { D1Database, D1TransactionalDatabase } from "./persistence";

export const APPEAL_RESOLUTION_DAYS = 7;
export const ESCALATION_DEBIT_THIRDS = 24;
export const MODERATOR_LABEL = "slopbot: moderator";

export type AppealDueJob = Extract<Job, { kind: "appeal_due" }>;
export type Appeal = {
  appeal_key: string;
  item_node_id: string;
  appellant_github_id: string;
  opened_at: string;
  due_at: string;
  draft: "uphold" | "deny" | null;
  draft_confidence: number | null;
  escalated_at: string | null;
  escalation: string | null;
  resolved_at: string | null;
  resolution: "upheld" | "denied" | null;
  resolved_by: "appellant" | "maintainer" | "moderator" | null;
};

/** The published escalation criteria that Slopbot can decide by itself.
 * Rejection of the draft and the 7-day limit are recorded by their own paths.
 * The caller checks current account bans; private security cases use their
 * separate appeal path.
 */
export function escalationFor(input: {
  category: Category;
  debitThirds: number;
  moderatorReview: boolean;
  draftConfidence: number;
}): string | null {
  if (input.category === "scam" || input.moderatorReview)
    return "the finding is a confirmed-malicious result";
  if (input.debitThirds >= ESCALATION_DEBIT_THIRDS)
    return `the debit at stake is ${ESCALATION_DEBIT_THIRDS} thirds or more`;
  if (input.draftConfidence < CLOSE_CONFIDENCE)
    return `Slopbot confidence is below ${CLOSE_CONFIDENCE}`;
  return null;
}

const COLUMNS = `appeal_key, item_node_id, appellant_github_id, opened_at, due_at,
  draft, draft_confidence, escalated_at, escalation, resolved_at, resolution,
  resolved_by`;

/** Opens one appeal per item revision. A replayed appeal keeps the first. */
export async function openAppeal(
  db: D1Database,
  input: {
    appealKey: string;
    job: Extract<Job, { kind: "appeal" | "human_reopen" }>;
    itemNodeId: string;
    appellantId: number;
  },
): Promise<Appeal> {
  const opened = new Date();
  const due: AppealDueJob = {
    kind: "appeal_due",
    appealKey: input.appealKey,
    deliveryId: `appeal-due:${input.appealKey}`,
    installationId: input.job.installationId,
    repositoryId: input.job.repositoryId,
    owner: input.job.owner,
    repo: input.job.repo,
    itemKind: input.job.itemKind,
    number: input.job.number,
  };
  await db
    .prepare(
      `INSERT OR IGNORE INTO slopbot_appeals
       (appeal_key, repository_id, item_node_id, appellant_github_id, job_json, opened_at, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.appealKey,
      input.job.repositoryId,
      input.itemNodeId,
      String(input.appellantId),
      JSON.stringify(due),
      opened.toISOString(),
      new Date(
        opened.getTime() + APPEAL_RESOLUTION_DAYS * 86_400_000,
      ).toISOString(),
    )
    .run();
  const appeal = await appealByKey(db, input.appealKey);
  if (appeal === null) throw new Error("Appeal was not stored");
  return appeal;
}

export async function appealByKey(
  db: D1Database,
  appealKey: string,
): Promise<Appeal | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM slopbot_appeals WHERE appeal_key = ?`)
    .bind(appealKey)
    .first<Appeal>();
}

/** The newest appeal for an item, which commands act on. A resolved appeal
 * is returned too, so that a retry can finish its recorded writes.
 */
export async function latestAppealFor(
  db: D1Database,
  itemNodeId: string,
): Promise<Appeal | null> {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM slopbot_appeals WHERE item_node_id = ?
       ORDER BY opened_at DESC, appeal_key DESC LIMIT 1`,
    )
    .bind(itemNodeId)
    .first<Appeal>();
}

/** Stores the first draft only; a retry keeps it. */
export async function recordDraft(
  db: D1Database,
  appealKey: string,
  draft: "uphold" | "deny",
  confidence: number,
): Promise<Appeal> {
  await db
    .prepare(
      `UPDATE slopbot_appeals SET draft = ?, draft_confidence = ?, drafted_at = ?
       WHERE appeal_key = ? AND draft IS NULL AND resolved_at IS NULL`,
    )
    .bind(draft, confidence, new Date().toISOString(), appealKey)
    .run();
  const appeal = await appealByKey(db, appealKey);
  if (appeal === null) throw new Error("Appeal is missing");
  return appeal;
}

/** Escalates once; the first reason is kept. */
export async function escalateAppeal(
  db: D1TransactionalDatabase,
  appealKey: string,
  reason: string,
  moderators: ReadonlySet<string>,
): Promise<boolean> {
  const at = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE slopbot_appeals SET escalated_at = ?, escalation = ?
       WHERE appeal_key = ? AND escalated_at IS NULL AND resolved_at IS NULL`,
      )
      .bind(at, reason.slice(0, 200), appealKey),
    ...[...moderators].map((id) => notifySlopbotAppeal(db, appealKey, id, at)),
  ]);
  return (results[0].meta?.changes ?? 0) === 1;
}

/** Resolves once. Returns false when another path resolved it first. */
export async function resolveAppeal(
  db: D1Database,
  appealKey: string,
  resolution: "upheld" | "denied",
  by: "appellant" | "maintainer" | "moderator",
  draftAppellantId?: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE slopbot_appeals SET resolved_at = ?, resolution = ?, resolved_by = ?
       WHERE appeal_key = ? AND resolved_at IS NULL
         AND (? IS NULL OR (escalated_at IS NULL
           AND NOT EXISTS (${PARTICIPATION_BAN_QUERY})))`,
    )
    .bind(
      new Date().toISOString(),
      resolution,
      by,
      appealKey,
      draftAppellantId ?? null,
      draftAppellantId ?? "",
    )
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/** Queue each appeal that is still unresolved and unescalated 7 days after
 * it opened. A lost queue message is sent again after a day; the one-time
 * escalation prevents a duplicate.
 */
export function dispatchDueAppeals(
  db: D1Database,
  queue: { send(job: Job): Promise<void> },
): Promise<number> {
  return dispatchDueJobs<AppealDueJob>(db, queue, {
    table: "slopbot_appeals",
    key: "appeal_key",
    also: " AND escalated_at IS NULL",
    keyOf: (job) => job.appealKey,
  });
}

export function moderatorIds(value: string | undefined): Set<string> {
  return githubIdSet(value, "PROJECT_MODERATOR_GITHUB_IDS");
}
