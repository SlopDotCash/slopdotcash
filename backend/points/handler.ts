import { readBoundedJson } from "../../src/lib/browser-json";
import { POINTS_RULE } from "../../src/lib/points";
import { randomToken, sha256Hex } from "../../workers/identity/crypto";
import { consumeExactRateLimit } from "../../workers/identity/rate-limit";
import type { D1Database } from "../trace/cloudflare-persistence";
import { handleX, type XConfiguration } from "./x";

export interface PointsDependencies {
  db: D1Database;
  rateLimitSecret: string;
  identity: { fetch(request: Request): Promise<Response> };
  now?: () => Date;
  x?: XConfiguration;
  xFetch?: (input: string, init: RequestInit) => Promise<Response>;
}
const origins = new Set([
  "https://slop.cash",
  "https://slop.tech",
  "https://eliza.army",
]);
const cookieName = "__Host-slop_points";
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
function json(status: number, body: unknown, cookie?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, ...(cookie ? { "set-cookie": cookie } : {}) },
  });
}
function cookie(request: Request) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
function sessionCookie(token: string, seconds: number) {
  return `${cookieName}=${token}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;
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
function publicMember(m: Member) {
  return {
    actor: { id: m.actor_id, login: m.login },
    joinedAt: m.joined_at,
    public: m.public === 1,
    welcome: m.welcome,
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
  if (!origins.has(url.origin)) return json(403, { error: "origin_forbidden" });
  if (
    request.method !== "GET" &&
    (request.method !== "POST" ||
      request.headers.get("origin") !== url.origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json")
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
    if (route.startsWith("/x/")) return handleX(request, deps, now);
    if (route === "/people" && request.method === "GET") {
      const after = url.searchParams.get("after") ?? "";
      if (after && !/^[A-Za-z0-9_=-]{4,256}$/.test(after))
        return json(400, { error: "invalid_cursor" });
      const result = await deps.db
        .prepare(
          "SELECT json_group_array(json(item)) items FROM (SELECT json_object('actor',json_object('id',m.actor_id,'login',m.login),'welcome',m.welcome,'socialPoints',COALESCE(a.points,0),'x',CASE WHEN l.public=1 THEN json_object('id',l.x_id,'username',l.username,'verifiedAt',l.verified_at) ELSE NULL END) item FROM points_members m LEFT JOIN points_x_awards a ON a.actor_id=m.actor_id LEFT JOIN points_x_links l ON l.actor_id=m.actor_id WHERE m.public=1 AND m.actor_id>? ORDER BY m.actor_id LIMIT 26)",
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
      const value = (await readBoundedJson(
        request as unknown as Response,
        4096,
        "points join",
      )) as Record<string, unknown>;
      if (
        Object.keys(value).sort().join() !== "assertion,public" ||
        typeof value.assertion !== "string" ||
        !/^slop_assert_v1_[A-Za-z0-9_-]{40,128}$/.test(value.assertion) ||
        typeof value.public !== "boolean"
      )
        return json(400, { error: "invalid_request" });
      const response = await deps.identity.fetch(
        new Request("https://identity.internal/v1/assertions/consume", {
          method: "POST",
          headers: {
            authorization: `Bearer ${value.assertion}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ audience: "slop-points-web" }),
        }),
      );
      if (!response.ok) return json(401, { error: "identity_expired" });
      const identity = (await readBoundedJson(
        response,
        16384,
        "identity",
      )) as Record<string, unknown>;
      const {
        githubActorId: id,
        githubNodeId: node,
        githubLogin: login,
      } = identity;
      if (
        identity.audience !== "slop-points-web" ||
        typeof id !== "string" ||
        !/^\d+$/.test(id) ||
        typeof node !== "string" ||
        !/^[A-Za-z0-9_=-]{4,256}$/.test(node) ||
        typeof login !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login)
      )
        return json(401, { error: "invalid_identity" });
      const token = randomToken(32);
      const hash = await sha256Hex(token);
      const expires = new Date(Date.parse(now) + 60 * 60 * 1000).toISOString();
      // A unique actor/numeric identity and one atomic batch make retries safe.
      const results = await deps.db.batch([
        deps.db
          .prepare(
            "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET login=excluded.login, public=excluded.public WHERE points_members.github_id=excluded.github_id",
          )
          .bind(node, id, login, now, value.public ? 1 : 0),
        deps.db
          .prepare(
            "INSERT INTO points_sessions(token_hash,actor_id,expires_at) SELECT ?,actor_id,? FROM points_members WHERE actor_id=? AND github_id=?",
          )
          .bind(hash, expires, node, id),
        deps.db
          .prepare("DELETE FROM points_sessions WHERE expires_at <= ?")
          .bind(now),
      ]);
      if (results.some((r) => !r.success) || results[1].meta?.changes !== 1)
        throw new Error("Points transaction failed");
      const member = await deps.db
        .prepare(
          "SELECT m.*,COALESCE((SELECT points FROM points_x_awards a WHERE a.actor_id=m.actor_id),0) social_points FROM points_members m WHERE actor_id=?",
        )
        .bind(node)
        .first<Member>();
      if (!member) throw new Error("Missing joined member");
      return json(200, publicMember(member), sessionCookie(token, 3600));
    }
    if (route === "/me" || route === "/signout" || route === "/visibility") {
      const token = cookie(request);
      if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token))
        return route === "/me" && request.method === "GET"
          ? json(200, null)
          : json(401, { error: "not_signed_in" });
      const hash = await sha256Hex(token);
      const member = await deps.db
        .prepare(
          "SELECT m.*,COALESCE((SELECT points FROM points_x_awards a WHERE a.actor_id=m.actor_id),0) social_points FROM points_members m JOIN points_sessions s ON s.actor_id=m.actor_id WHERE s.token_hash=? AND s.expires_at>?",
        )
        .bind(hash, now)
        .first<Member>();
      if (!member)
        return route === "/me" && request.method === "GET"
          ? json(200, null, sessionCookie("", 0))
          : json(401, { error: "session_expired" }, sessionCookie("", 0));
      if (route === "/me" && request.method === "GET")
        return json(200, publicMember(member));
      if (route === "/signout" && request.method === "POST") {
        await deps.db
          .prepare("DELETE FROM points_sessions WHERE token_hash=?")
          .bind(hash)
          .run();
        return json(200, { signedOut: true }, sessionCookie("", 0));
      }
      if (route === "/visibility" && request.method === "POST") {
        const body = (await readBoundedJson(
          request as unknown as Response,
          256,
          "visibility",
        )) as Record<string, unknown>;
        if (
          Object.keys(body).join() !== "public" ||
          typeof body.public !== "boolean"
        )
          return json(400, { error: "invalid_request" });
        await deps.db
          .prepare("UPDATE points_members SET public=? WHERE actor_id=?")
          .bind(body.public ? 1 : 0, member.actor_id)
          .run();
        return json(
          200,
          publicMember({ ...member, public: body.public ? 1 : 0 }),
        );
      }
    }
    if (route === "/member" && request.method === "GET") {
      const login = url.searchParams.get("login") ?? "";
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))
        return json(400, { error: "invalid_login" });
      // Login collisions fail closed; numeric actor identity remains canonical.
      const row = await deps.db
        .prepare(
          "SELECT CASE WHEN COUNT(*)=1 THEN json_object('actor',json_object('id',actor_id,'login',login),'joinedAt',joined_at,'public',json('true'),'welcome',welcome,'socialPoints',COALESCE((SELECT points FROM points_x_awards a WHERE a.actor_id=points_members.actor_id),0)) ELSE NULL END AS member FROM points_members WHERE lower(login)=lower(?) AND public=1",
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
          "SELECT generated_at,coverage,revision_count,digest FROM points_batches ORDER BY generated_at DESC,digest DESC LIMIT 1",
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
    return json(503, { error: "points_unavailable" });
  }
}
