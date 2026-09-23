import { readBoundedJson } from "../../src/lib/browser-json";
import {
  decryptPkceVerifier,
  encryptPkceVerifier,
  pkceChallenge,
  randomToken,
  sha256Hex,
} from "../../workers/identity/crypto";
import type { PointsDependencies } from "./handler";

export interface XConfiguration {
  clientId: string;
  clientSecret: string;
}
const flowCookie = "__Host-slop_x_flow";
function cookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
function flowHeader(value: string, seconds: number) {
  return `${flowCookie}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
function finish(status: "connected" | "cancelled" | "failed") {
  return new Response(null, {
    status: 303,
    headers: {
      location: `/points?x=${status}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "set-cookie": flowHeader("", 0),
    },
  });
}
async function session(
  request: Request,
  deps: PointsDependencies,
  now: string,
) {
  const token = cookie(request, "__Host-slop_points");
  if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const row = await deps.db
    .prepare(
      "SELECT actor_id FROM points_sessions WHERE token_hash=? AND expires_at>?",
    )
    .bind(hash, now)
    .first<{ actor_id: string }>();
  return row ? { actor: row.actor_id, hash } : null;
}
async function provider(
  deps: PointsDependencies,
  path: string,
  init: RequestInit,
) {
  return (deps.xFetch ?? fetch)(`https://api.x.com${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
}
function basic(config: XConfiguration) {
  return `Basic ${btoa(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`)}`;
}
type Flow = {
  actor_id: string;
  session_hash: string;
  verifier: string;
  iv: string;
  public: number;
};
/** OAuth proves the X numeric ID; an entered handle can never create a link or award. */
export async function handleX(
  request: Request,
  deps: PointsDependencies,
  now: string,
): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname.replace("/api/v1/points/x", "");
  const config = deps.x?.clientId && deps.x?.clientSecret ? deps.x : null;
  if (route === "/profile" && request.method === "GET") {
    const actor = url.searchParams.get("actor") ?? "";
    if (!/^[A-Za-z0-9_=-]{4,256}$/.test(actor))
      return json(400, { error: "invalid_actor" });
    const link = await deps.db
      .prepare(
        "SELECT l.x_id id,l.username,l.verified_at verifiedAt FROM points_x_links l JOIN points_members m ON m.actor_id=l.actor_id WHERE l.actor_id=? AND l.public=1 AND m.public=1",
      )
      .bind(actor)
      .first();
    return json(200, link);
  }
  if (route === "/callback" && request.method === "GET") {
    const state = url.searchParams.get("state") ?? "",
      cap = cookie(request, flowCookie) ?? "";
    if (
      !config ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(cap)
    )
      return finish("failed");
    const hash = await sha256Hex(state);
    const flow = await deps.db
      .prepare(
        "UPDATE points_x_flows SET status='processing' WHERE state_hash=? AND browser_hash=? AND status='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM points_sessions s WHERE s.token_hash=points_x_flows.session_hash AND s.actor_id=points_x_flows.actor_id AND s.expires_at>?) RETURNING actor_id,session_hash,verifier,iv,public",
      )
      .bind(hash, await sha256Hex(cap), now, now)
      .first<Flow>();
    if (!flow) return finish("failed");
    let token: string | undefined;
    let stage = "callback";
    // Never log provider bodies, OAuth codes, tokens, cookies, or identities.
    const fail = (status?: number) => {
      console.warn("[Slop X] Connection failed", { stage, status });
      return finish("failed");
    };
    try {
      if (url.searchParams.has("error")) return finish("cancelled");
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048) return finish("failed");
      stage = "decrypt_verifier";
      const verifier = await decryptPkceVerifier(
        flow.verifier,
        flow.iv,
        `slop-x:${hash}`,
        await pkceChallenge(`slop-x-pkce:${deps.rateLimitSecret}`),
      );
      stage = "token_exchange";
      const exchanged = await provider(deps, "/2/oauth2/token", {
        method: "POST",
        headers: {
          authorization: basic(config),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${url.origin}/api/v1/points/x/callback`,
          code_verifier: verifier,
        }).toString(),
      });
      if (!exchanged.ok) return fail(exchanged.status);
      stage = "token_response";
      const tokens = (await readBoundedJson(
        exchanged,
        16384,
        "X authentication",
      )) as { access_token?: unknown; token_type?: unknown; scope?: unknown };
      if (
        typeof tokens.access_token !== "string" ||
        tokens.access_token.length > 4096 ||
        !tokens.access_token ||
        String(tokens.token_type).toLowerCase() !== "bearer"
      )
        return fail();
      token = tokens.access_token;
      stage = "identity_request";
      const response = await provider(deps, "/2/users/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) return fail(response.status);
      stage = "identity_response";
      const value = (await readBoundedJson(response, 16384, "X identity")) as {
        data?: { id?: unknown; username?: unknown };
      };
      const id = value.data?.id,
        username = value.data?.username;
      if (
        typeof id !== "string" ||
        !/^[0-9]{1,30}$/.test(id) ||
        typeof username !== "string" ||
        !/^[A-Za-z0-9_]{1,15}$/.test(username)
      )
        return fail();
      // Session must still be valid after the provider roundtrip (signout cancels linking).
      const verifiedAt = (deps.now?.() ?? new Date()).toISOString();
      stage = "record_connection";
      const result = await deps.db.batch([
        deps.db
          .prepare(
            "INSERT INTO points_x_claims(x_id,actor_id,claimed_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM points_sessions WHERE token_hash=? AND actor_id=? AND expires_at>?) AND EXISTS(SELECT 1 FROM points_x_flows WHERE state_hash=? AND status='processing') ON CONFLICT(x_id) DO NOTHING",
          )
          .bind(
            id,
            flow.actor_id,
            verifiedAt,
            flow.session_hash,
            flow.actor_id,
            verifiedAt,
            hash,
          ),
        deps.db
          .prepare(
            "INSERT INTO points_x_awards(actor_id,x_id,awarded_at,points) SELECT actor_id,x_id,?,10 FROM points_x_claims WHERE x_id=? AND actor_id=? AND EXISTS(SELECT 1 FROM points_sessions WHERE token_hash=? AND expires_at>?) AND EXISTS(SELECT 1 FROM points_x_flows WHERE state_hash=? AND status='processing') ON CONFLICT(actor_id) DO NOTHING",
          )
          .bind(
            verifiedAt,
            id,
            flow.actor_id,
            flow.session_hash,
            verifiedAt,
            hash,
          ),
        deps.db
          .prepare(
            "INSERT INTO points_x_links(actor_id,x_id,username,verified_at,public) SELECT actor_id,x_id,?,?,? FROM points_x_claims WHERE x_id=? AND actor_id=? AND EXISTS(SELECT 1 FROM points_sessions WHERE token_hash=? AND expires_at>?) AND EXISTS(SELECT 1 FROM points_x_flows WHERE state_hash=? AND status='processing') ON CONFLICT(actor_id) DO UPDATE SET x_id=excluded.x_id,username=excluded.username,verified_at=excluded.verified_at,public=excluded.public",
          )
          .bind(
            username,
            verifiedAt,
            flow.public,
            id,
            flow.actor_id,
            flow.session_hash,
            verifiedAt,
            hash,
          ),
      ]);
      if (result.some((r) => !r.success) || result[2].meta?.changes !== 1)
        return fail();
      return finish("connected");
    } catch {
      return fail();
    } finally {
      await deps.db
        .prepare("DELETE FROM points_x_flows WHERE state_hash=?")
        .bind(hash)
        .run();
      if (token) {
        try {
          const response = await provider(deps, "/2/oauth2/revoke", {
            method: "POST",
            headers: {
              authorization: basic(config),
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              token,
              client_id: config.clientId,
            }).toString(),
          });
          await response.body?.cancel();
        } catch {
          /* No token is retained. Provider revocation failure cannot undo a verified identity. */
        }
      }
    }
  }
  const current = await session(request, deps, now);
  if (!current) return json(401, { error: "not_signed_in" });
  if (route === "/me" && request.method === "GET") {
    const account = await deps.db
      .prepare(
        "SELECT x_id id,username,verified_at verifiedAt,public FROM points_x_links WHERE actor_id=?",
      )
      .bind(current.actor)
      .first();
    const award = await deps.db
      .prepare(
        "SELECT points,awarded_at awardedAt FROM points_x_awards WHERE actor_id=?",
      )
      .bind(current.actor)
      .first();
    return json(200, { configured: !!config, account, award });
  }
  if (route === "/start" && request.method === "POST") {
    if (!config) return json(503, { error: "x_not_configured" });
    const body = (await readBoundedJson(
      request as unknown as Response,
      256,
      "X connection",
    )) as Record<string, unknown>;
    if (
      !body ||
      Object.keys(body).join() !== "public" ||
      typeof body.public !== "boolean"
    )
      return json(400, { error: "invalid_request" });
    const state = randomToken(32),
      cap = randomToken(32),
      hash = await sha256Hex(state),
      verifier = randomToken(32);
    const encrypted = await encryptPkceVerifier(
      verifier,
      `slop-x:${hash}`,
      await pkceChallenge(`slop-x-pkce:${deps.rateLimitSecret}`),
    );
    const expires = new Date(Date.parse(now) + 10 * 60000).toISOString();
    await deps.db.batch([
      deps.db
        .prepare("DELETE FROM points_x_flows WHERE actor_id=? OR expires_at<=?")
        .bind(current.actor, now),
      deps.db
        .prepare(
          "INSERT INTO points_x_flows(state_hash,browser_hash,session_hash,actor_id,verifier,iv,expires_at,public,status) VALUES(?,?,?,?,?,?,?,?,'pending')",
        )
        .bind(
          hash,
          await sha256Hex(cap),
          current.hash,
          current.actor,
          encrypted.ciphertext,
          encrypted.iv,
          expires,
          body.public ? 1 : 0,
        ),
    ]);
    const authorize = new URL("https://x.com/i/oauth2/authorize");
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: `${url.origin}/api/v1/points/x/callback`,
      scope: "tweet.read users.read",
      state,
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    const response = json(200, { authorizationUrl: authorize.href });
    response.headers.set("set-cookie", flowHeader(cap, 600));
    return response;
  }
  if (route === "/disconnect" && request.method === "POST") {
    await deps.db.batch([
      deps.db
        .prepare("DELETE FROM points_x_links WHERE actor_id=?")
        .bind(current.actor),
      deps.db
        .prepare("DELETE FROM points_x_flows WHERE actor_id=?")
        .bind(current.actor),
    ]);
    return json(200, { disconnected: true });
  }
  if (route === "/visibility" && request.method === "POST") {
    const body = (await readBoundedJson(
      request as unknown as Response,
      256,
      "X visibility",
    )) as Record<string, unknown>;
    if (
      !body ||
      Object.keys(body).join() !== "public" ||
      typeof body.public !== "boolean"
    )
      return json(400, { error: "invalid_request" });
    const result = await deps.db
      .prepare("UPDATE points_x_links SET public=? WHERE actor_id=?")
      .bind(body.public ? 1 : 0, current.actor)
      .run();
    return result.meta?.changes === 1
      ? json(200, { updated: true })
      : json(404, { error: "not_connected" });
  }
  return json(404, { error: "not_found" });
}
