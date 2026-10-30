import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  type DeploymentTier,
  deploymentOrigins,
} from "../../src/lib/deployment";
import { POINTS_RULE } from "../../src/lib/points";
import type { GithubActor } from "../../src/lib/project-contracts";
import { randomToken } from "../../workers/identity/crypto";
import { consumeExactRateLimit } from "../../workers/identity/rate-limit";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import {
  apiErrorResponse,
  cookieValue,
  isSameOriginJsonWrite,
  json as jsonResponse,
  readJsonObject,
} from "../http";
import { consumeIdentityAssertion } from "../identity-assertion";
import {
  handlePointsDisputes,
  type PointsDisputeDependencies,
} from "./disputes";
import { handleX, type XConfiguration } from "./x";

export interface PointsDependencies {
  tier?: DeploymentTier;
  db: D1Database;
  rateLimitSecret: string;
  identity: { fetch(request: Request): Promise<Response> };
  now?: () => Date;
  /** Trusted deployment origins; never request-supplied. */
  allowedOrigins?: readonly string[];
  x?: XConfiguration;
  xFetch?: (input: string, init: RequestInit) => Promise<Response>;
  disputes?: Pick<
    PointsDisputeDependencies,
    "moderators" | "process" | "waitUntil"
  >;
}
const SESSION_COOKIE = "__Host-slop_points";
function json(status: number, body: unknown, cookie?: string) {
  return jsonResponse(status, body, {
    cacheControl: "no-store",
    headers: cookie ? { "set-cookie": cookie } : undefined,
  });
}
/**
 * Resolves the signed-in GitHub account from the site session cookie. Other
 * same-origin APIs reuse this sign-in instead of minting their own sessions.
 */
export async function sessionGithubActor(
  request: Request,
  db: D1Database,
  now: string,
): Promise<GithubActor | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) return null;
  const member = await db
    .prepare(
      "SELECT m.github_id,m.login FROM points_members m JOIN points_sessions s ON s.actor_id=m.actor_id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .bind(await sha256Hex(token), now)
    .first<{ github_id: string; login: string }>();
  return member
    ? { githubId: member.github_id, githubLogin: member.login }
    : null;
}
function sessionCookie(token: string, seconds: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;
}
type Member = {
  actor_id: string;
  github_id: string;
  login: string;
  joined_at: string;
  public: number;
  welcome: number;
  social_points?: number;
};
/**
 * Welcome and X-connection points ended on 24 October 2026 (PRD section 11).
 * The legacy `welcome` column keeps its fixed value; only a membership that
 * joined before this instant reports its historical award. Likewise only an X
 * award recorded before this instant counts; production still recorded some
 * on that day. `joined_at` and `awarded_at` are immutable.
 */
const PARTICIPATION_POINTS_END = "2026-10-24T00:00:00.000Z";
const WELCOME_SQL = `CASE WHEN m.joined_at < '${PARTICIPATION_POINTS_END}' THEN m.welcome ELSE 0 END`;
const X_AWARD_SQL = `a.actor_id=m.actor_id AND a.awarded_at < '${PARTICIPATION_POINTS_END}'`;
function publicMember(m: Member) {
  return {
    actor: { id: m.actor_id, login: m.login },
    joinedAt: m.joined_at,
    public: m.public === 1,
    welcome: m.joined_at < PARTICIPATION_POINTS_END ? m.welcome : 0,
    socialPoints: m.social_points ?? 0,
  };
}
/** Dedicated points routes never construct the trace persistence adapter. */
export async function handlePointsApi(
  request: Request,
  deps: PointsDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname.replace("/api/v1/points", "");
  const now = (deps.now?.() ?? new Date()).toISOString();
  if (
    !new Set([
      ...deploymentOrigins(deps.tier).browserOrigins,
      ...(deps.allowedOrigins ?? []),
    ]).has(url.origin)
  )
    return json(403, { error: "origin_forbidden" });
  if (
    request.method !== "GET" &&
    (request.method !== "POST" || !isSameOriginJsonWrite(request))
  )
    return json(403, { error: "origin_forbidden" });
  try {
    if (request.method === "POST") {
      if (deps.rateLimitSecret.length < 32)
        throw new Error("Points limiter unavailable");
      const admission = await consumeExactRateLimit({
        db: deps.db,
        limit: 20,
        nowEpochSeconds: Math.floor(Date.parse(now) / 1000),
        principal: request.headers.get("cf-connecting-ip") ?? "unattributed",
        scope: "points-web",
        secret: deps.rateLimitSecret,
        windowSeconds: 60,
      });
      if (!admission.allowed) {
        const response = json(429, { error: "rate_limited" });
        response.headers.set(
          "retry-after",
          String(admission.retryAfterSeconds),
        );
        return response;
      }
    }
    if (route === "/disputes" || route.startsWith("/disputes/")) {
      const actor = await sessionGithubActor(request, deps.db, now);
      if (!actor) return json(401, { error: "not_signed_in" });
      const expected = request.headers.get("x-slop-expected-github-id");
      if (expected && expected !== actor.githubId)
        return json(409, { error: "account_changed" });
      try {
        return await handlePointsDisputes(
          request,
          {
            db: deps.db,
            now: () => new Date(now),
            ...deps.disputes,
          },
          actor,
        );
      } catch (error) {
        return apiErrorResponse(error, { label: "Points dispute unavailable" });
      }
    }
    if (route.startsWith("/x/")) return await handleX(request, deps, now);
    if (route === "/people" && request.method === "GET") {
      const after = url.searchParams.get("after") ?? "";
      if (after && !/^[A-Za-z0-9_=-]{4,256}$/.test(after))
        return json(400, { error: "invalid_cursor" });
      const result = await deps.db
        .prepare(
          `SELECT json_group_array(json(item)) items FROM (SELECT json_object('actor',json_object('id',m.actor_id,'login',m.login),'welcome',${WELCOME_SQL},'socialPoints',COALESCE(a.points,0),'x',CASE WHEN l.public=1 THEN json_object('id',l.x_id,'username',l.username,'verifiedAt',l.verified_at) ELSE NULL END) item FROM points_members m LEFT JOIN points_x_awards a ON ${X_AWARD_SQL} LEFT JOIN points_x_links l ON l.actor_id=m.actor_id WHERE m.public=1 AND m.actor_id>? ORDER BY m.actor_id LIMIT 26)`,
        )
        .bind(after)
        .first<{ items: string }>();
      const items = JSON.parse(result?.items ?? "[]") as {
        actor: { id: string };
      }[];
      return json(200, {
        people: items.slice(0, 25),
        next: items.length > 25 ? items[24].actor.id : null,
      });
    }
    if (route === "/join" && request.method === "POST") {
      const value = await readJsonObject(request, 4096, "points join");
      if (!value) return json(400, { error: "invalid_request" });
      const keys = Object.keys(value).sort().join();
      if (
        (keys !== "assertion,public" &&
          !(keys === "assertion,public,reopen" && value.reopen === true)) ||
        typeof value.assertion !== "string" ||
        !/^slop_assert_v1_[A-Za-z0-9_-]{40,128}$/.test(value.assertion) ||
        typeof value.public !== "boolean"
      )
        return json(400, { error: "invalid_request" });
      const identity = await consumeIdentityAssertion(
        deps.identity,
        value.assertion,
        "slop-points-web",
      );
      if (identity === "expired")
        return json(401, { error: "identity_expired" });
      const node = identity === "invalid" ? null : identity.githubNodeId;
      if (
        identity === "invalid" ||
        typeof node !== "string" ||
        !/^[A-Za-z0-9_=-]{4,256}$/.test(node)
      )
        return json(401, { error: "invalid_identity" });
      const { githubId: id, githubLogin: login } = identity;
      // A closed account opens again only when this sign-in asks to reopen
      // it, so closing is never undone by an ordinary sign-in.
      const closed = await deps.db
        .prepare(
          "SELECT closed_at FROM points_members WHERE actor_id=? AND github_id=? AND closed_at IS NOT NULL",
        )
        .bind(node, id)
        .first<{ closed_at: string }>();
      if (closed && value.reopen !== true)
        return json(409, {
          error: "account_closed",
          closedAt: closed.closed_at,
        });
      const token = randomToken(32);
      const hash = await sha256Hex(token);
      const expires = new Date(Date.parse(now) + 60 * 60 * 1000).toISOString();
      // A unique actor/numeric identity and one atomic batch make retries safe.
      // Sign-in and explicit reopening publish this membership and any
      // existing X link together. A disconnected link is never recreated.
      const results = await deps.db.batch([
        deps.db
          .prepare(
            "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1) ON CONFLICT(actor_id) DO UPDATE SET login=excluded.login, public=1, closed_at=NULL WHERE points_members.github_id=excluded.github_id AND (points_members.closed_at IS NULL OR ?)",
          )
          .bind(node, id, login, now, value.reopen ? 1 : 0),
        deps.db
          .prepare(
            "UPDATE points_x_links SET public=1 WHERE actor_id=? AND EXISTS(SELECT 1 FROM points_members WHERE actor_id=? AND github_id=? AND closed_at IS NULL)",
          )
          .bind(node, node, id),
        deps.db
          .prepare(
            "INSERT INTO points_sessions(token_hash,actor_id,expires_at) SELECT ?,actor_id,? FROM points_members WHERE actor_id=? AND github_id=?",
          )
          .bind(hash, expires, node, id),
        deps.db
          .prepare("DELETE FROM points_sessions WHERE expires_at <= ?")
          .bind(now),
      ]);
      if (results.some((r) => !r.success) || results[2].meta?.changes !== 1)
        throw new Error("Points transaction failed");
      const member = await deps.db
        .prepare(
          `SELECT m.*,COALESCE((SELECT points FROM points_x_awards a WHERE ${X_AWARD_SQL}),0) social_points FROM points_members m WHERE actor_id=?`,
        )
        .bind(node)
        .first<Member>();
      if (!member) throw new Error("Missing joined member");
      return json(200, publicMember(member), sessionCookie(token, 3600));
    }
    if (
      route === "/me" ||
      route === "/signout" ||
      route === "/visibility" ||
      route === "/sessions" ||
      route === "/sessions/revoke" ||
      route === "/account/close"
    ) {
      const token = cookieValue(request, SESSION_COOKIE);
      if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token))
        return route === "/me" && request.method === "GET"
          ? json(200, null)
          : json(401, { error: "not_signed_in" });
      const hash = await sha256Hex(token);
      const member = await deps.db
        .prepare(
          `SELECT m.*,COALESCE((SELECT points FROM points_x_awards a WHERE ${X_AWARD_SQL}),0) social_points FROM points_members m JOIN points_sessions s ON s.actor_id=m.actor_id WHERE s.token_hash=? AND s.expires_at>?`,
        )
        .bind(hash, now)
        .first<Member>();
      if (!member)
        return route === "/me" && request.method === "GET"
          ? json(200, null, sessionCookie("", 0))
          : json(401, { error: "session_expired" }, sessionCookie("", 0));
      if (route === "/me" && request.method === "GET")
        return json(200, publicMember(member));
      if (route === "/sessions" && request.method === "GET") {
        const row = await deps.db
          .prepare(
            "SELECT json_group_array(json_object('id', id, 'expiresAt', expiresAt, 'current', json(CASE WHEN is_current THEN 'true' ELSE 'false' END))) AS sessions FROM (SELECT substr(token_hash, 1, 24) AS id, expires_at AS expiresAt, token_hash = ? AS is_current FROM points_sessions WHERE actor_id = ? AND expires_at > ? ORDER BY expires_at DESC)",
          )
          .bind(hash, member.actor_id, now)
          .first<{ sessions: string }>();
        return json(200, { sessions: JSON.parse(row?.sessions ?? "[]") });
      }
      if (route === "/sessions/revoke" && request.method === "POST") {
        const body = await readJsonObject(request, 1024, "session");
        if (!body) return json(400, { error: "invalid_request" });
        if (typeof body.id !== "string" || !/^[a-f0-9]{24}$/.test(body.id))
          return json(400, { error: "invalid_session" });
        await deps.db
          .prepare(
            "DELETE FROM points_sessions WHERE actor_id = ? AND substr(token_hash, 1, 24) = ?",
          )
          .bind(member.actor_id, body.id)
          .run();
        return json(
          200,
          { revoked: true },
          body.id === hash.slice(0, 24) ? sessionCookie("", 0) : undefined,
        );
      }
      if (route === "/account/close" && request.method === "POST") {
        const body = await readJsonObject(request, 256, "account closure");
        if (!body) return json(400, { error: "invalid_request" });
        // The person confirms by typing their own GitHub login.
        if (
          Object.keys(body).join() !== "login" ||
          typeof body.login !== "string" ||
          body.login.toLowerCase() !== member.login.toLowerCase()
        )
          return json(400, { error: "confirmation_mismatch" });
        // One atomic batch: deactivate and hide the membership, remove the
        // optional connections and all email consent, then end every session.
        // Claims keep X and historical Telegram IDs reserved to this GitHub identity.
        // Wallets, unpaid obligations, payment and settlement records, private
        // cases, points history and public GitHub work are not touched.
        const results = await deps.db.batch([
          deps.db
            .prepare(
              "UPDATE points_members SET closed_at=?, public=0 WHERE actor_id=? AND closed_at IS NULL",
            )
            .bind(now, member.actor_id),
          deps.db
            .prepare("DELETE FROM points_x_flows WHERE actor_id=?")
            .bind(member.actor_id),
          deps.db
            .prepare("DELETE FROM points_x_links WHERE actor_id=?")
            .bind(member.actor_id),
          deps.db
            .prepare("DELETE FROM points_telegram_flows WHERE actor_id=?")
            .bind(member.actor_id),
          deps.db
            .prepare("DELETE FROM points_telegram_links WHERE actor_id=?")
            .bind(member.actor_id),
          // Opt-out triggers suppress both activity and security mail queues.
          deps.db
            .prepare(
              "UPDATE notification_email_preferences SET enabled=0, security_enabled=0, destination_version='', updated_at=? WHERE github_id=?",
            )
            .bind(now, member.github_id),
          deps.db
            .prepare(
              "UPDATE notification_email_verifications SET cancelled_at=? WHERE github_id=? AND consumed_at IS NULL AND cancelled_at IS NULL",
            )
            .bind(now, member.github_id),
          deps.db
            .prepare("DELETE FROM points_sessions WHERE actor_id=?")
            .bind(member.actor_id),
        ]);
        if (results.some((r) => !r.success))
          throw new Error("Account closure failed");
        // A repeated request that raced the first one finds the account
        // already closed; it reports that closure instead of failing.
        let closedAt: string | null = now;
        if (results[0].meta?.changes !== 1)
          closedAt =
            (
              await deps.db
                .prepare(
                  "SELECT closed_at FROM points_members WHERE actor_id=?",
                )
                .bind(member.actor_id)
                .first<{ closed_at: string | null }>()
            )?.closed_at ?? null;
        if (!closedAt) throw new Error("Account closure failed");
        return json(200, { closed: true, closedAt }, sessionCookie("", 0));
      }
      if (route === "/signout" && request.method === "POST") {
        await deps.db
          .prepare("DELETE FROM points_sessions WHERE token_hash=?")
          .bind(hash)
          .run();
        return json(200, { signedOut: true }, sessionCookie("", 0));
      }
      if (route === "/visibility" && request.method === "POST") {
        const body = await readJsonObject(request, 256, "visibility");
        if (!body) return json(400, { error: "invalid_request" });
        if (
          Object.keys(body).join() !== "public" ||
          typeof body.public !== "boolean"
        )
          return json(400, { error: "invalid_request" });
        if (!body.public)
          return json(409, { error: "public_visibility_required" });
        await deps.db
          .prepare("UPDATE points_members SET public=1 WHERE actor_id=?")
          .bind(member.actor_id)
          .run();
        return json(200, publicMember({ ...member, public: 1 }));
      }
    }
    if (route === "/member" && request.method === "GET") {
      const login = url.searchParams.get("login") ?? "";
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))
        return json(400, { error: "invalid_login" });
      // Login collisions fail closed; numeric actor identity remains canonical.
      const row = await deps.db
        .prepare(
          `SELECT CASE WHEN COUNT(*)=1 AND m.public=1 THEN json_object('actor',json_object('id',m.actor_id,'login',m.login),'joinedAt',m.joined_at,'public',json('true'),'welcome',${WELCOME_SQL},'socialPoints',COALESCE((SELECT points FROM points_x_awards a WHERE ${X_AWARD_SQL}),0)) ELSE NULL END AS member FROM points_members m WHERE lower(m.login)=lower(?)`,
        )
        .bind(login)
        .first<{ member: string | null }>();
      return row?.member ? json(200, JSON.parse(row.member)) : json(200, null);
    }
    if (route === "/journal" && request.method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      if (!Number.isSafeInteger(after) || after < 0)
        return json(400, { error: "invalid_cursor" });
      const batch = await deps.db
        .prepare(
          "SELECT generated_at,coverage,revision_count,digest FROM points_batches ORDER BY revision_count DESC,generated_at DESC,digest DESC LIMIT 1",
        )
        .first<{
          generated_at: string;
          coverage: string;
          revision_count: number;
          digest: string;
        }>();
      if (!batch) return json(503, { error: "points_not_published" });
      const pinned = url.searchParams.get("batch");
      if (pinned && pinned !== batch.digest)
        return json(409, { error: "journal_changed" });
      const page = await deps.db
        .prepare(
          "SELECT json_group_array(json(payload)) AS rows FROM (SELECT payload FROM points_revisions ORDER BY rowid LIMIT ? OFFSET ?)",
        )
        .bind(Math.min(500, Math.max(0, batch.revision_count - after)), after)
        .first<{ rows: string }>();
      const revisions = JSON.parse(page?.rows ?? "[]");
      return json(200, {
        schemaVersion: "1",
        ruleVersion: POINTS_RULE,
        generatedAt: batch.generated_at,
        coverage: JSON.parse(batch.coverage),
        revisions,
        batch: batch.digest,
        next:
          after + revisions.length < batch.revision_count
            ? after + revisions.length
            : null,
        total: batch.revision_count,
      });
    }
    return json(404, { error: "not_found" });
  } catch {
    // error-policy:J1 A failed database/identity operation never fabricates a balance.
    console.error("points API failure");
    return json(503, { error: "points_unavailable" });
  }
}
