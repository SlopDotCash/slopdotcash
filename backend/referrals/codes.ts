/**
 * Custom referral codes (PRD section 11, "Referral program"). A signed-in
 * member chooses a name for their own referral link. `/referral/<code>`
 * forwards to the project form with that member's GitHub login as the
 * referrer, so capture (`resolveReferrer` in `backend/projects/handler.ts`),
 * the immutable project record and accrual are unchanged: a code is only a
 * pointer to a GitHub account, never a second referrer identity.
 *
 * A code cannot be a reserved name or another GitHub account's login, and a
 * Slop team account cannot hold one, because it can never be recorded as a
 * referrer. A member has one code in use and may replace it; a replaced code
 * stops forwarding and stays theirs, so nobody else can take a name that once
 * forwarded to them. An account can hold `REFERRAL_CODE_LIMIT` names in all.
 */

import {
  REFERRAL_CODE_API,
  REFERRAL_CODE_RULE,
  REFERRAL_LINK_PREFIX,
  type ReferralCodeAccount,
  referralCodeKey,
  validReferralCode,
} from "../../src/lib/referral-code";
import type { D1Statement, D1TransactionalDatabase } from "../d1";
import {
  apiErrorResponse,
  exactKeys,
  fail,
  isSameOriginJsonWrite,
  json,
  requireActor,
  requireJsonObject,
} from "../http";
import {
  type GithubFetch,
  githubJson,
  validGithubLogin,
} from "../projects/github-lookup";

/** Names one account can ever hold, in use or replaced. */
export const REFERRAL_CODE_LIMIT = 5;

const MAX_BODY_BYTES = 1024;

/** Compared after hyphens and underscores are removed from the lowercase code. */
const RESERVED = new Set([
  "api",
  "eliza",
  "elizalabs",
  "elizaos",
  "help",
  "new",
  "null",
  "referral",
  "referrals",
  "security",
  "shaw",
  "shawwalters",
  "slop",
  "slopbot",
  "slopcash",
  "slopdesk",
  "slopdotcash",
  "team",
  "umia",
  "umiafinance",
  "undefined",
]);
const RESERVED_PARTS = ["admin", "moderator", "official", "staff", "support"];

function reserved(key: string): boolean {
  const plain = key.replace(/[-_]/gu, "");
  return RESERVED.has(plain) || RESERVED_PARTS.some((p) => plain.includes(p));
}

type ReferralCodeDependencies = {
  db: D1TransactionalDatabase<D1Statement>;
  sessionActor(request: Request): Promise<{ githubId: string } | null>;
  /** Administrators and moderators: never recorded as referrers. */
  teamGithubIds: ReadonlySet<string>;
  github: { fetch: GithubFetch; token: string | undefined; apiOrigin: string };
  now: () => Date;
};

type CodeRow = { code: string; github_id: string; retired_at: string | null };

function codeRow(db: ReferralCodeDependencies["db"], key: string) {
  return db
    .prepare(
      "SELECT code, github_id, retired_at FROM referral_codes WHERE code_key = ?",
    )
    .bind(key)
    .first<CodeRow>();
}

async function choose(
  request: Request,
  deps: ReferralCodeDependencies,
  githubId: string,
): Promise<ReferralCodeAccount> {
  const body = await requireJsonObject(
    request,
    MAX_BODY_BYTES,
    "Referral code",
  );
  exactKeys(body, ["code"]);
  const code = body.code;
  if (!validReferralCode(code)) fail(422, "invalid_code", REFERRAL_CODE_RULE);
  if (deps.teamGithubIds.has(githubId))
    fail(
      422,
      "team_account",
      "Slop team accounts cannot be recorded as referrers.",
    );
  const key = referralCodeKey(code);
  if (reserved(key))
    fail(422, "reserved_code", "That name is reserved. Choose another.");
  const existing = await codeRow(deps.db, key);
  if (existing !== null && existing.github_id !== githubId)
    fail(409, "code_taken", "That name is taken. Choose another.");
  // A name that is someone's GitHub login would read as that person's link.
  if (existing === null && validGithubLogin(code)) {
    const owner = await githubJson(
      deps.github.fetch,
      deps.github.token,
      `/users/${code}`,
      deps.github.apiOrigin,
    );
    if (owner !== null && String(owner.id) !== githubId)
      fail(
        409,
        "code_is_github_account",
        "That name is another GitHub account. Choose another.",
      );
  }
  const now = deps.now().toISOString();
  // One transaction: record the name unused, retire the name in use, then put
  // this one in use. The last two act only when the row is this account's,
  // so a lost race changes nothing.
  await deps.db.batch([
    deps.db
      .prepare(
        `INSERT INTO referral_codes (code_key, code, github_id, created_at, retired_at)
         SELECT ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM referral_codes WHERE code_key = ?)
            AND (SELECT count(*) FROM referral_codes WHERE github_id = ?) < ?`,
      )
      .bind(key, code, githubId, now, now, key, githubId, REFERRAL_CODE_LIMIT),
    deps.db
      .prepare(
        `UPDATE referral_codes SET retired_at = ?
          WHERE github_id = ? AND retired_at IS NULL AND code_key <> ?
            AND EXISTS (SELECT 1 FROM referral_codes
                         WHERE code_key = ? AND github_id = ?)`,
      )
      .bind(now, githubId, key, key, githubId),
    deps.db
      .prepare(
        "UPDATE referral_codes SET retired_at = NULL, code = ? WHERE code_key = ? AND github_id = ?",
      )
      .bind(code, key, githubId),
  ]);
  const stored = await codeRow(deps.db, key);
  if (stored === null)
    fail(
      409,
      "code_limit",
      `You have used all ${REFERRAL_CODE_LIMIT} of your names. Choose one you used before.`,
    );
  if (stored.github_id !== githubId)
    fail(409, "code_taken", "That name is taken. Choose another.");
  return { code: stored.code };
}

export async function handleReferralCode(
  request: Request,
  deps: ReferralCodeDependencies,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== REFERRAL_CODE_API) return null;
  if (request.method !== "POST" || !isSameOriginJsonWrite(request))
    return json(403, { error: "origin_forbidden" });
  try {
    const actor = await requireActor(request, deps);
    return json(200, await choose(request, deps, actor.githubId));
  } catch (caught) {
    return apiErrorResponse(caught, { label: "referral code API failure" });
  }
}

const PROJECT_FORM = "/projects/new";

/**
 * `/referral/<code>` forwards to the project form. A code in use names its
 * member as the referrer; any other name forwards without one, so the visitor
 * can still list a project. A failed read answers 503: forwarding without the
 * referrer would drop a referral that exists.
 */
export async function referralRedirect(
  request: Request,
  db: ReferralCodeDependencies["db"],
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(REFERRAL_LINK_PREFIX)) return null;
  const headers = {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", { status: 405, headers });
  const code = url.pathname
    .slice(REFERRAL_LINK_PREFIX.length)
    .replace(/\/$/u, "");
  let login: string | null = null;
  if (validReferralCode(code)) {
    try {
      login =
        (
          await db
            .prepare(
              `SELECT m.login FROM referral_codes c
                 JOIN points_members m ON m.github_id = c.github_id
                WHERE c.code_key = ? AND c.retired_at IS NULL
                  AND m.closed_at IS NULL`,
            )
            .bind(referralCodeKey(code))
            .first<{ login: string }>()
        )?.login ?? null;
    } catch {
      console.error("referral link read failure");
      return new Response("This referral link is unavailable. Retry.", {
        status: 503,
        headers,
      });
    }
  }
  const target = new URL(PROJECT_FORM, url.origin);
  if (login !== null) target.searchParams.set("ref", login);
  return new Response(null, {
    status: 302,
    headers: { ...headers, location: target.toString() },
  });
}
