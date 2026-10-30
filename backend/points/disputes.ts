/** PRD section 7: a private dispute of a retained, immutable Points revision. */
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { githubUserIdFromNodeId } from "../../src/lib/github-actor";
import { type PointRevision, pointRevisionId } from "../../src/lib/points";
import {
  APPEAL_RESOLUTION_DAYS,
  appealByKey,
} from "../../workers/slopbot/appeals";
import type { D1TransactionalDatabase } from "../d1";
import { fail, json, readJsonObject } from "../http";
import { notifyPointsDispute } from "../notifications/events";

type Database = D1TransactionalDatabase;
export const POINTS_DISPUTE_URL = "https://slopbot.internal/v1/points-disputes";
export const POINTS_DISPUTE_KEY = /^points-dispute:[a-f0-9]{64}$/u;
export type PointsDisputeDependencies = {
  db: Database;
  now(): Date;
  moderators?: ReadonlySet<string>;
  process?: (key: string) => Promise<void>;
  waitUntil?: (promise: Promise<unknown>) => void;
};
export async function retainedPointRevision(db: Database, id: string) {
  const row = await db
    .prepare("SELECT payload FROM points_revisions WHERE id=?")
    .bind(id)
    .first<{ payload: string }>();
  if (!row) fail(404, "not_found", "Points record not found.");
  const revision = JSON.parse(row.payload) as PointRevision;
  const { id: savedId, ...payload } = revision;
  if (
    savedId !== id ||
    pointRevisionId(payload) !== id ||
    !revision.award ||
    !githubUserIdFromNodeId(revision.award.actor.id)
  )
    throw new Error("Points revision integrity failed");
  return revision;
}
function view(appeal: NonNullable<Awaited<ReturnType<typeof appealByKey>>>) {
  return {
    id: appeal.appeal_key,
    openedAt: appeal.opened_at,
    dueAt: appeal.due_at,
    draft: appeal.draft,
    escalatedAt: appeal.escalated_at,
    resolution: appeal.resolution,
    resolvedAt: appeal.resolved_at,
    state: appeal.resolved_at
      ? "resolved"
      : appeal.escalated_at
        ? "review"
        : "triage",
  };
}

export async function handlePointsDisputes(
  request: Request,
  deps: PointsDisputeDependencies,
  actor: { githubId: string; githubLogin: string },
): Promise<Response> {
  const url = new URL(request.url);
  const key = decodeURIComponent(
    url.pathname.slice("/api/v1/points/disputes".length).replace(/^\//u, ""),
  );
  const now = deps.now().toISOString();
  const process = (id: string) => {
    const work = deps.process?.(id).catch(() => {
      console.error("Points dispute triage unavailable");
    });
    if (work) deps.waitUntil?.(work);
  };
  if (!key && request.method === "GET") {
    const cursor = url.searchParams.get("before") ?? "0";
    if (
      !/^(0|[1-9][0-9]*)$/u.test(cursor) ||
      !Number.isSafeInteger(Number(cursor))
    )
      fail(400, "invalid_cursor", "Invalid Points page.");
    const rows = await deps.db
      .prepare(`SELECT json_group_array(json_object('cursor',cursor,'id',id,'payload',payload,'disputeId',disputeId)) AS rows FROM (SELECT r.rowid AS cursor,r.id,r.payload,d.appeal_key AS disputeId
      FROM points_revisions r JOIN points_members m ON m.actor_id=json_extract(r.payload,'$.award.actor.id')
      LEFT JOIN points_disputes d ON d.revision_id=r.id AND d.appellant_github_id=m.github_id
      WHERE m.github_id=? AND (?=0 OR r.rowid<?)
        AND NOT EXISTS(SELECT 1 FROM points_revisions newer WHERE newer.source_key=r.source_key AND newer.rowid>r.rowid)
      ORDER BY r.rowid DESC LIMIT 26)`)
      .bind(actor.githubId, Number(cursor), Number(cursor))
      .first<{ rows: string }>();
    const records = JSON.parse(rows?.rows ?? "[]") as {
      cursor: number;
      id: string;
      payload: string;
      disputeId: string | null;
    }[];
    const awards = records.slice(0, 25).map((row) => ({
      revisionId: row.id,
      disputeId: row.disputeId,
      award: (JSON.parse(row.payload) as PointRevision).award,
    }));
    return json(200, {
      awards,
      next: records.length > 25 ? String(records[24].cursor) : null,
    });
  }
  if (!key && request.method === "POST") {
    const body = await readJsonObject(request, 20_000, "Points dispute");
    if (
      !body ||
      Object.keys(body).sort().join() !== "reason,revisionId" ||
      typeof body.revisionId !== "string" ||
      !/^[a-f0-9]{64}$/u.test(body.revisionId) ||
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      body.reason.trim().length > 4000
    )
      fail(
        400,
        "invalid_request",
        "Select a Points record and enter a reason.",
      );
    const revision = await retainedPointRevision(deps.db, body.revisionId);
    if (githubUserIdFromNodeId(revision.award.actor.id) !== actor.githubId)
      fail(
        403,
        "not_authorized",
        "Only the recipient can dispute this Points record.",
      );
    const id = `points-dispute:${await sha256Hex(`${body.revisionId}:${actor.githubId}`)}`;
    await deps.db.batch([
      deps.db
        .prepare(`INSERT OR IGNORE INTO points_disputes
        (appeal_key,revision_id,item_node_id,appellant_github_id,statement,opened_at,due_at)
        VALUES(?,?,?,?,?,?,?)`)
        .bind(
          id,
          body.revisionId,
          body.revisionId,
          actor.githubId,
          body.reason.trim(),
          now,
          new Date(
            Date.parse(now) + APPEAL_RESOLUTION_DAYS * 86_400_000,
          ).toISOString(),
        ),
      notifyPointsDispute(deps.db, id, "opened", now),
    ]);
    const stored = await deps.db
      .prepare("SELECT statement FROM points_disputes WHERE appeal_key=?")
      .bind(id)
      .first<{ statement: string }>();
    if (stored?.statement !== body.reason.trim())
      fail(
        409,
        "already_submitted",
        "This Points record already has a dispute. Open it in Inbox.",
      );
    process(id);
    const created = await appealByKey(deps.db, id, "points_disputes");
    if (!created) throw new Error("Points dispute was not retained");
    return json(201, view(created));
  }
  if (!POINTS_DISPUTE_KEY.test(key))
    fail(404, "not_found", "Points dispute not found.");
  const appeal = await appealByKey(deps.db, key, "points_disputes");
  if (!appeal) fail(404, "not_found", "Points dispute not found.");
  const own = appeal.appellant_github_id === actor.githubId;
  const moderator = !own && deps.moderators?.has(actor.githubId) === true;
  if (!own && !(moderator && appeal.escalated_at))
    fail(404, "not_found", "Points dispute not found.");
  const saved = await deps.db
    .prepare(
      "SELECT revision_id,statement,resolution_reason FROM points_disputes WHERE appeal_key=?",
    )
    .bind(key)
    .first<{
      revision_id: string;
      statement: string;
      resolution_reason: string | null;
    }>();
  if (!saved) throw new Error("Points dispute source missing");
  if (request.method === "GET")
    return json(200, {
      ...view(appeal),
      revision: await retainedPointRevision(deps.db, saved.revision_id),
      reason: saved.statement,
      resolutionReason: saved.resolution_reason,
      mayDecide: moderator && !!appeal.escalated_at && !appeal.resolved_at,
    });
  if (request.method !== "POST")
    return json(405, { error: "method_not_allowed" });
  const body = await readJsonObject(request, 20_000, "Points dispute decision");
  if (body?.action === "retry" && Object.keys(body).join() === "action") {
    if (appeal.resolved_at)
      fail(409, "already_resolved", "The dispute is resolved.");
    process(key);
    return json(202, view(appeal));
  }
  if (!moderator || !appeal.escalated_at)
    fail(403, "not_authorized", "An independent moderator must decide.");
  if (
    !body ||
    Object.keys(body).sort().join() !== "action,reason" ||
    (body.action !== "uphold" && body.action !== "deny") ||
    typeof body.reason !== "string" ||
    !body.reason.trim() ||
    body.reason.trim().length > 4000
  )
    fail(400, "invalid_request", "Enter a decision and reason.");
  const resolution = body.action === "uphold" ? "upheld" : "denied";
  await deps.db.batch([
    deps.db
      .prepare(`UPDATE points_disputes SET resolved_at=?,resolution=?,resolved_by='moderator',
      resolution_reason=?,resolver_github_id=? WHERE appeal_key=? AND resolved_at IS NULL AND escalated_at IS NOT NULL`)
      .bind(now, resolution, body.reason.trim(), actor.githubId, key),
    notifyPointsDispute(deps.db, key, "resolved", now),
  ]);
  const current = await appealByKey(deps.db, key, "points_disputes");
  const recorded = await deps.db
    .prepare(
      "SELECT resolver_github_id,resolution_reason FROM points_disputes WHERE appeal_key=?",
    )
    .bind(key)
    .first<{ resolver_github_id: string; resolution_reason: string }>();
  if (!current) throw new Error("Points dispute was not retained");
  if (
    current.resolution !== resolution ||
    recorded?.resolver_github_id !== actor.githubId ||
    recorded.resolution_reason !== body.reason.trim()
  )
    fail(409, "already_resolved", "A decision has already been recorded.");
  return json(200, view(current));
}
