/**
 * Personal read-only keys for the private security reads (operator decision,
 * 25 November 2026; PRD section 8). A website session lasts an hour for most
 * accounts, so a reviewer could not run a script against their own queue. A
 * signed-in member creates one key; a request that carries it as
 * `Authorization: Bearer <key>` is read as that member on GET requests for a list or one record
 * of `security-cases` and `security-submissions` only. Every access check then
 * runs exactly as for a signed-in read, so a key never sees more than its
 * account, and no write route ever accepts one.
 *
 * Only a key's SHA-256 is stored. The key is returned once, when created.
 */
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { GithubActor } from "../../src/lib/project-contracts";
import {
  SECURITY_READ_KEY_PATTERN,
  SECURITY_READ_KEY_PREFIX,
  SECURITY_READ_KEY_ROUTES,
  type SecurityReadKeyCreated,
  type SecurityReadKeyStatus,
} from "../../src/lib/security-read-key";
import type { D1Statement, D1TransactionalDatabase } from "../d1";
import {
  apiErrorResponse,
  fail,
  isSameOriginJsonWrite,
  json,
  pathParts,
  requireActor,
} from "../http";

export type SecurityReadKeyDependencies = {
  db: D1TransactionalDatabase<D1Statement>;
  sessionActor: (request: Request) => Promise<GithubActor | null>;
  now: () => Date;
  /** 32 random bytes; injected in tests. */
  randomBytes?: () => Uint8Array;
};

/** How often a key's last use is rewritten, to keep reads from writing. */
const LAST_USED_STEP_MS = 60 * 60 * 1000;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function status(
  db: SecurityReadKeyDependencies["db"],
  githubId: string,
): Promise<SecurityReadKeyStatus> {
  const row = await db
    .prepare(
      "SELECT created_at, last_used_at FROM security_read_keys WHERE github_id = ? AND revoked_at IS NULL",
    )
    .bind(githubId)
    .first<{ created_at: string; last_used_at: string | null }>();
  return {
    key: row
      ? { createdAt: row.created_at, lastUsedAt: row.last_used_at }
      : null,
  };
}

/** The member's own key: read its status, create or replace it, revoke it. */
export async function handleSecurityReadKey(
  request: Request,
  deps: SecurityReadKeyDependencies,
): Promise<Response | null> {
  const parts = pathParts(request);
  if (parts.length !== 1 || parts[0] !== "security-read-key") return null;
  try {
    if (!["GET", "POST", "DELETE"].includes(request.method))
      fail(405, "method_not_allowed", "Method not allowed");
    if (request.method !== "GET" && !isSameOriginJsonWrite(request))
      fail(403, "origin_forbidden", "Requests must come from this site");
    // Only the website session manages a key; a key cannot mint another.
    const actor = await requireActor(request, deps);
    if (request.method === "GET")
      return json(200, await status(deps.db, actor.githubId));
    const at = deps.now().toISOString();
    const revoke = deps.db
      .prepare(
        "UPDATE security_read_keys SET revoked_at = ? WHERE github_id = ? AND revoked_at IS NULL",
      )
      .bind(at, actor.githubId);
    if (request.method === "DELETE") {
      await deps.db.batch([revoke]);
      return json(200, await status(deps.db, actor.githubId));
    }
    const bytes =
      deps.randomBytes?.() ?? crypto.getRandomValues(new Uint8Array(32));
    const secret = `${SECURITY_READ_KEY_PREFIX}${base64Url(bytes)}`;
    // One transaction: the old key stops before the new one starts.
    await deps.db.batch([
      revoke,
      deps.db
        .prepare(
          "INSERT INTO security_read_keys (key_sha256, github_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(await sha256Hex(secret), actor.githubId, at),
    ]);
    const created: SecurityReadKeyCreated = {
      ...(await status(deps.db, actor.githubId)),
      secret,
    };
    return json(201, created);
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "security read key API failure",
      respond: json,
    });
  }
}

/**
 * The account a read-only key stands for, or null. Null for any request that
 * is not a GET under the key's routes, so no write and no other API can be
 * reached with a key. A closed account's key reads nothing.
 */
export async function securityReadKeyActor(
  request: Request,
  db: SecurityReadKeyDependencies["db"],
  now: Date,
): Promise<GithubActor | null> {
  if (request.method !== "GET") return null;
  // A list or one record: `security-cases[/<id>]`, `security-submissions[/<id>]`.
  // Deeper paths, such as the GitHub authorization callback, are not reads.
  const parts = pathParts(request);
  if (
    parts.length < 1 ||
    parts.length > 2 ||
    !(SECURITY_READ_KEY_ROUTES as readonly string[]).includes(parts[0])
  )
    return null;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const secret = header.slice("Bearer ".length);
  if (!SECURITY_READ_KEY_PATTERN.test(secret)) return null;
  const hash = await sha256Hex(secret);
  const row = await db
    .prepare(
      "SELECT m.github_id, m.login, k.last_used_at FROM security_read_keys k JOIN points_members m ON m.github_id = k.github_id WHERE k.key_sha256 = ? AND k.revoked_at IS NULL AND m.closed_at IS NULL",
    )
    .bind(hash)
    .first<{ github_id: string; login: string; last_used_at: string | null }>();
  if (row === null) return null;
  if (
    row.last_used_at === null ||
    now.getTime() - Date.parse(row.last_used_at) >= LAST_USED_STEP_MS
  )
    await db
      .prepare(
        "UPDATE security_read_keys SET last_used_at = ? WHERE key_sha256 = ? AND revoked_at IS NULL",
      )
      .bind(now.toISOString(), hash)
      .run();
  return { githubId: row.github_id, githubLogin: row.login };
}
