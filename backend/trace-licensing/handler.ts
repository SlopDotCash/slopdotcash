/**
 * Trace licensing consent (design 2026-11-22, contract version 2). A signed-in
 * contributor lists their finalized traces, turns the account setting on or
 * off, and opts earlier traces in. Every change is one D1 batch that writes
 * its append-only history in the same transaction. No route returns a trace
 * body or digest.
 *
 * Each statement of a batch carries the state guard it was decided on, and
 * the statement that changes that state runs last, so a lost race writes
 * nothing. A toggle to the state already in force writes nothing.
 */

import {
  TRACE_LICENCES_API,
  TRACE_LICENSING_API,
  TRACES_ME_API,
} from "../../src/lib/trace-licensing";
import type { D1QueryStatement, D1TransactionalDatabase } from "../d1";
import {
  apiErrorResponse,
  exactKeys,
  fail,
  isSameOriginJsonWrite,
  json,
  requireActor,
  requireJsonObject,
} from "../http";
import { PARTICIPATION_BAN_QUERY } from "../projects/account-bans";

/** The terms every licence and setting change here is made under. */
const TERMS_VERSION = "private-trace-v2";
const PAGE_SIZE = 100;
const MAX_RUN_IDS = 500;
/** Room for 500 run ids of the longest accepted form. */
const MAX_BODY_BYTES = 80 * 1024;
const RUN_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

export type TraceLicensingDependencies = {
  db: D1TransactionalDatabase<D1QueryStatement>;
  sessionActor(request: Request): Promise<{ githubId: string } | null>;
  now(): Date;
};

type Setting = {
  enabled: boolean;
  since: string | null;
  providerTermsConfirmed: boolean;
};

// Guards bound with one GitHub id each.
const CLOSED = `EXISTS (SELECT 1 FROM points_members member
  WHERE member.github_id = ? AND member.closed_at IS NOT NULL)`;
const BANNED = `EXISTS (${PARTICIPATION_BAN_QUERY})`;
const ENABLED = `EXISTS (SELECT 1 FROM trace_licensing_settings setting
  WHERE setting.github_id = ? AND setting.enabled = 1)`;
/** The latest account event of a kind; inside its own batch, the one just written. */
const LATEST_EVENT = `(SELECT MAX(event.id) FROM trace_licensing_events event
  WHERE event.github_id = ? AND event.kind = ?)`;

/**
 * The account's finalized runs that are not currently licensed. Bound with
 * the GitHub id, then (when `chosen`) a JSON array of run ids.
 */
function eligibleRuns(chosen: boolean): string {
  return `SELECT run.id AS run_id FROM trace_runs run
    WHERE run.github_user_id = ? AND run.state = 'finalized'
      AND NOT EXISTS (SELECT 1 FROM trace_licences licence
        WHERE licence.run_id = run.id AND licence.state = 'licensed')
      ${chosen ? "AND run.id IN (SELECT value FROM json_each(?))" : ""}`;
}

async function readSetting(
  db: TraceLicensingDependencies["db"],
  githubId: string,
): Promise<Setting> {
  const row = await db
    .prepare(
      "SELECT enabled, provider_terms_confirmed, changed_at FROM trace_licensing_settings WHERE github_id = ?",
    )
    .bind(githubId)
    .first<{
      enabled: number;
      provider_terms_confirmed: number;
      changed_at: string;
    }>();
  return {
    enabled: row?.enabled === 1,
    since: row?.enabled === 1 ? row.changed_at : null,
    providerTermsConfirmed: row?.provider_terms_confirmed === 1,
  };
}

async function isTrue(
  db: TraceLicensingDependencies["db"],
  condition: string,
  githubId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT ${condition} AS yes`)
    .bind(githubId)
    .first<{ yes: number }>();
  return row?.yes === 1;
}

async function refuseClosed(
  db: TraceLicensingDependencies["db"],
  githubId: string,
): Promise<void> {
  if (await isTrue(db, CLOSED, githubId))
    fail(403, "account_closed", "This account is closed.");
}

async function refuseBanned(
  db: TraceLicensingDependencies["db"],
  githubId: string,
): Promise<void> {
  if (await isTrue(db, BANNED, githubId))
    fail(
      403,
      "participation_banned",
      "This account cannot license traces while a participation ban is in force.",
    );
}

function parseCursor(raw: string | null): { at: string; runId: string } | null {
  if (raw === null) return null;
  const split = raw.lastIndexOf("|");
  const at = raw.slice(0, split);
  const runId = raw.slice(split + 1);
  if (
    split < 1 ||
    !RUN_ID.test(runId) ||
    Number.isNaN(Date.parse(at)) ||
    new Date(Date.parse(at)).toISOString() !== at
  )
    fail(400, "invalid_cursor", "The page cursor is invalid.");
  return { at, runId };
}

type TraceRow = {
  id: string;
  finalized_at: string;
  project_id: string;
  repository: string;
  provider: string;
  model: string;
  client: string;
  terms_version: string;
  licence: string | null;
  pull_request_url: string | null;
};

async function listTraces(
  request: Request,
  deps: TraceLicensingDependencies,
  githubId: string,
) {
  const cursor = parseCursor(new URL(request.url).searchParams.get("cursor"));
  const { db } = deps;
  const page = await db
    .prepare(
      `SELECT run.id, run.finalized_at, run.project_id, run.repository, run.provider,
          run.model, run.client,
          COALESCE(run.terms_version, 'private-trace-v1') AS terms_version,
          licence.state AS licence,
          (SELECT event.github_url FROM run_progress_events event
            WHERE event.run_id = run.id AND event.kind = 'pull_request_opened'
              AND event.github_url IS NOT NULL
            ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1) AS pull_request_url
        FROM trace_runs run
        LEFT JOIN trace_licences licence ON licence.run_id = run.id
        WHERE run.github_user_id = ? AND run.state = 'finalized'
          AND (? IS NULL OR run.finalized_at < ? OR (run.finalized_at = ? AND run.id < ?))
        ORDER BY run.finalized_at DESC, run.id DESC
        LIMIT ?`,
    )
    .bind(
      githubId,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.at ?? null,
      cursor?.runId ?? null,
      PAGE_SIZE + 1,
    )
    .all<TraceRow>();
  const rows = page.results ?? [];
  const shown = rows.slice(0, PAGE_SIZE);
  const last = shown.at(-1);
  const totals = await db
    .prepare(
      `SELECT count(*) AS traces,
          count(licence.run_id) AS licensed
        FROM trace_runs run
        LEFT JOIN trace_licences licence
          ON licence.run_id = run.id AND licence.state = 'licensed'
        WHERE run.github_user_id = ? AND run.state = 'finalized'`,
    )
    .bind(githubId)
    .first<{ traces: number; licensed: number }>();
  const traces = totals?.traces ?? 0;
  const licensed = totals?.licensed ?? 0;
  return {
    setting: await readSetting(db, githubId),
    totals: { traces, licensed, eligible: traces - licensed },
    traces: shown.map((row) => ({
      runId: row.id,
      finalizedAt: row.finalized_at,
      projectId: row.project_id,
      repository: row.repository,
      provider: row.provider,
      model: row.model,
      client: row.client,
      termsVersion: row.terms_version,
      licence: row.licence ?? "none",
      pullRequestUrl: row.pull_request_url,
    })),
    nextCursor:
      rows.length > PAGE_SIZE && last !== undefined
        ? `${last.finalized_at}|${last.id}`
        : null,
  };
}

async function changeSetting(
  request: Request,
  deps: TraceLicensingDependencies,
  githubId: string,
): Promise<{ setting: Setting; withdrawn: number }> {
  const body = await requireJsonObject(
    request,
    MAX_BODY_BYTES,
    "Trace licensing setting",
  );
  exactKeys(body, ["enabled"], ["providerTermsConfirmed"]);
  const { enabled, providerTermsConfirmed } = body;
  if (typeof enabled !== "boolean")
    fail(400, "invalid_request", "enabled must be true or false");
  if (
    providerTermsConfirmed !== undefined &&
    typeof providerTermsConfirmed !== "boolean"
  )
    fail(
      400,
      "invalid_request",
      "providerTermsConfirmed must be true or false",
    );
  const { db } = deps;
  await refuseClosed(db, githubId);
  // A toggle to the state in force is a no-op, with or without the tick.
  const current = await readSetting(db, githubId);
  if (current.enabled === enabled) return { setting: current, withdrawn: 0 };
  if (enabled && providerTermsConfirmed !== true)
    fail(
      422,
      "provider_terms_unconfirmed",
      "Confirm that your model provider's terms let you license these runs' output.",
    );
  // A ban refuses turning on; the account can still withdraw by turning off.
  if (enabled) await refuseBanned(db, githubId);
  const now = deps.now().toISOString();
  // Licences this request withdrew; only turning off withdraws any.
  let withdrawn = 0;
  if (enabled) {
    const guard = `NOT ${ENABLED} AND NOT ${BANNED} AND NOT ${CLOSED}`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO trace_licensing_events (github_id, kind, terms_version, affected_count, at)
           SELECT ?, 'enabled', ?, 0, ? WHERE ${guard}`,
        )
        .bind(githubId, TERMS_VERSION, now, githubId, githubId, githubId),
      db
        .prepare(
          `INSERT INTO trace_licensing_settings (github_id, enabled, provider_terms_confirmed, changed_at)
           SELECT ?, 1, 1, ? WHERE ${guard}
           ON CONFLICT (github_id) DO UPDATE SET enabled = 1,
             provider_terms_confirmed = 1, changed_at = excluded.changed_at`,
        )
        .bind(githubId, now, githubId, githubId, githubId),
    ]);
  } else {
    const guard = `${ENABLED} AND NOT ${CLOSED}`;
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO trace_licensing_events (github_id, kind, terms_version, affected_count, at)
           SELECT ?, 'disabled', ?,
             (SELECT count(*) FROM trace_licences WHERE github_id = ? AND state = 'licensed'), ?
           WHERE ${guard}`,
        )
        .bind(githubId, TERMS_VERSION, githubId, now, githubId, githubId),
      db
        .prepare(
          `INSERT INTO trace_licence_events (run_id, github_id, kind, reason, account_event_id, at)
           SELECT licence.run_id, licence.github_id, 'withdrawn', 'setting_off', ${LATEST_EVENT}, ?
           FROM trace_licences licence
           WHERE licence.github_id = ? AND licence.state = 'licensed' AND ${guard}`,
        )
        .bind(githubId, "disabled", now, githubId, githubId, githubId),
      db
        .prepare(
          `UPDATE trace_licences SET state = 'withdrawn', updated_at = ?
           WHERE github_id = ? AND state = 'licensed' AND ${guard}`,
        )
        .bind(now, githubId, githubId, githubId),
      db
        .prepare(
          `UPDATE trace_licensing_settings SET enabled = 0, changed_at = ?
           WHERE github_id = ? AND enabled = 1 AND NOT ${CLOSED}`,
        )
        .bind(now, githubId, githubId),
    ]);
    const changes = results[2]?.meta?.changes;
    if (typeof changes !== "number") throw new Error("D1 reported no changes");
    withdrawn = changes;
  }
  const after = await readSetting(db, githubId);
  if (after.enabled !== enabled) {
    // The guard refused inside the batch: report why.
    await refuseClosed(db, githubId);
    if (enabled) await refuseBanned(db, githubId);
    fail(409, "setting_changed", "The setting changed. Reload and try again.");
  }
  return { setting: after, withdrawn };
}

type OptInRequest =
  | { kind: "chosen"; runIds: string[] }
  | { kind: "all"; expectedCount: number };

function parseOptIn(body: Record<string, unknown>): OptInRequest {
  if (Object.hasOwn(body, "runIds")) {
    exactKeys(body, ["runIds"]);
    const { runIds } = body;
    if (
      !Array.isArray(runIds) ||
      runIds.length < 1 ||
      runIds.length > MAX_RUN_IDS ||
      !runIds.every((id) => typeof id === "string" && RUN_ID.test(id))
    )
      fail(
        422,
        "invalid_run_ids",
        `runIds must list 1 to ${MAX_RUN_IDS} run ids.`,
      );
    return { kind: "chosen", runIds: [...new Set(runIds as string[])] };
  }
  exactKeys(body, ["all", "expectedCount"]);
  const { all, expectedCount } = body;
  if (
    all !== true ||
    typeof expectedCount !== "number" ||
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 0
  )
    fail(
      422,
      "invalid_request",
      "Send all: true with the eligible count you confirmed.",
    );
  return { kind: "all", expectedCount };
}

async function optIn(
  request: Request,
  deps: TraceLicensingDependencies,
  githubId: string,
): Promise<{ licensed: number }> {
  const body = await requireJsonObject(
    request,
    MAX_BODY_BYTES,
    "Trace licence opt-in",
  );
  const choice = parseOptIn(body);
  const { db } = deps;
  await refuseClosed(db, githubId);
  await refuseBanned(db, githubId);
  if (!(await isTrue(db, ENABLED, githubId)))
    fail(
      409,
      "licensing_off",
      "Turn trace licensing on before opting traces in.",
    );
  const chosen = choice.kind === "chosen";
  const scope = chosen ? [githubId, JSON.stringify(choice.runIds)] : [githubId];
  if (chosen) {
    const owned = await db
      .prepare(
        `SELECT count(*) AS n FROM trace_runs
         WHERE github_user_id = ? AND state = 'finalized'
           AND id IN (SELECT value FROM json_each(?))`,
      )
      .bind(...scope)
      .first<{ n: number }>();
    if ((owned?.n ?? 0) !== choice.runIds.length)
      fail(404, "run_not_found", "A run is not one of your finalized traces.");
  }
  const eligible = eligibleRuns(chosen);
  const counted = await db
    .prepare(`SELECT count(*) AS n FROM (${eligible})`)
    .bind(...scope)
    .first<{ n: number }>();
  const expected = chosen ? (counted?.n ?? 0) : choice.expectedCount;
  if (!chosen && (counted?.n ?? 0) !== expected)
    fail(
      409,
      "count_changed",
      "The number of eligible traces changed. Review the list and confirm again.",
    );
  if (expected === 0) return { licensed: 0 };
  const now = deps.now().toISOString();
  // Bound with the scope, the expected count, then the GitHub id three times.
  const guard = `(SELECT count(*) FROM (${eligible})) = ?
    AND ${ENABLED} AND NOT ${BANNED} AND NOT ${CLOSED}`;
  const guardBinds = [...scope, expected, githubId, githubId, githubId];
  const [written] = await db.batch([
    db
      .prepare(
        `INSERT INTO trace_licensing_events (github_id, kind, terms_version, affected_count, at)
         SELECT ?, 'opted_in', ?, ?, ? WHERE ${guard}`,
      )
      .bind(githubId, TERMS_VERSION, expected, now, ...guardBinds),
    db
      .prepare(
        `INSERT INTO trace_licence_events (run_id, github_id, kind, reason, account_event_id, at)
         SELECT eligible.run_id, ?, 'granted', 'opt_in', ${LATEST_EVENT}, ?
         FROM (${eligible}) eligible WHERE ${guard}`,
      )
      .bind(githubId, githubId, "opted_in", now, ...scope, ...guardBinds),
    // The licences follow the grant events this batch just wrote, so this
    // statement does not depend on the count it changes. A grant licenses
    // only while it is still its trace's latest event and the setting holds,
    // so an older batch's grants never revive a withdrawn licence.
    db
      .prepare(
        `INSERT INTO trace_licences (run_id, github_id, state, basis, updated_at)
         SELECT granted.run_id, granted.github_id, 'licensed', 'opt_in', ?
         FROM trace_licence_events granted
         WHERE granted.account_event_id = ${LATEST_EVENT}
           AND granted.github_id = ? AND granted.kind = 'granted'
           AND granted.reason = 'opt_in' AND granted.at = ?
           AND NOT EXISTS (SELECT 1 FROM trace_licence_events later
             WHERE later.run_id = granted.run_id AND later.id > granted.id)
           AND ${ENABLED} AND NOT ${BANNED} AND NOT ${CLOSED}
         ON CONFLICT (run_id) DO UPDATE SET state = 'licensed', basis = 'opt_in',
           updated_at = excluded.updated_at
         WHERE trace_licences.state = 'withdrawn'`,
      )
      .bind(
        now,
        githubId,
        "opted_in",
        githubId,
        now,
        githubId,
        githubId,
        githubId,
      ),
  ]);
  // D1 reports changes per statement of a batch, so the first statement's
  // count says whether the guard held when the batch ran.
  if ((written?.meta?.changes ?? 0) !== 1) {
    await refuseClosed(db, githubId);
    await refuseBanned(db, githubId);
    if (!(await isTrue(db, ENABLED, githubId)))
      fail(
        409,
        "licensing_off",
        "Turn trace licensing on before opting traces in.",
      );
    fail(
      409,
      "count_changed",
      "The number of eligible traces changed. Review the list and confirm again.",
    );
  }
  return { licensed: expected };
}

const ROUTES: Record<string, string> = {
  [TRACES_ME_API]: "GET",
  [TRACE_LICENSING_API]: "PUT",
  [TRACE_LICENCES_API]: "POST",
};

export async function handleTraceLicensing(
  request: Request,
  deps: TraceLicensingDependencies,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const method = ROUTES[path];
  if (method === undefined) return null;
  if (request.method !== method)
    return json(
      405,
      { error: "method_not_allowed" },
      { headers: { allow: method } },
    );
  if (method !== "GET" && !isSameOriginJsonWrite(request))
    return json(403, { error: "origin_forbidden" });
  try {
    const actor = await requireActor(request, deps);
    if (path === TRACES_ME_API) {
      await refuseClosed(deps.db, actor.githubId);
      return json(200, await listTraces(request, deps, actor.githubId));
    }
    if (path === TRACE_LICENSING_API)
      return json(200, await changeSetting(request, deps, actor.githubId));
    return json(200, await optIn(request, deps, actor.githubId));
  } catch (caught) {
    return apiErrorResponse(caught, { label: "trace licensing API failure" });
  }
}
