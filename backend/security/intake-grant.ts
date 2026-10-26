/**
 * The reporter's own authorization for automatic private intake (PRD
 * section 8, SEC-07, SEC-17). A dedicated intake GitHub App issues a user
 * access token through a web-flow PKCE authorization for one submission.
 * GitHub then records the reporter as the author; Slop never files as the
 * App and never substitutes for the reporter.
 *
 * No token is stored at rest. The token lives only in an AES-GCM encrypted,
 * HttpOnly cookie bound to the submission and to the site session that
 * began the authorization, and it expires well before GitHub's 8 hours.
 * `/user` must name the signed-in account, so a reporter cannot authorize
 * as one GitHub account and report as another.
 */

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  decodeBase64Url,
  encodeBase64Url,
  ownedBuffer,
} from "../../src/lib/byte-encoding";
import {
  constantTimeEqual,
  pkceChallenge,
  randomToken,
} from "../../workers/identity/crypto";
import { cookieValue } from "../http";
import {
  type IntakeInstallationCheck,
  type PrivateAdvisoryClient,
  type ReporterGrant,
  reporterGrant,
} from "./github-advisories";
import type { PrivateReportAnalyzer } from "./report-analysis";

export interface IntakeOAuth {
  /** Exchanges an authorization code for a user access token, or null. */
  exchange(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<string | null>;
}

export type IntakeConfig = {
  mode: "on" | "off";
  /** 32-byte base64url AES-GCM key (SLOP_INTAKE_GRANT_KEY). */
  grantKey: string;
  /** The intake App's OAuth client id; never the identity App's. */
  clientId: string;
  /** https://github.com, or a loopback fixture in local tests. */
  authorizeOrigin: string;
  oauth: IntakeOAuth;
  advisories: PrivateAdvisoryClient;
  installation: IntakeInstallationCheck;
  analyzer: PrivateReportAnalyzer;
};

const GRANT_COOKIE = "__Secure-slop_intake_grant";
const FLOW_COOKIE = "__Secure-slop_intake_flow";
/** Cookies reach only the submission routes. `__Host-` would force Path=/. */
const COOKIE_PATH = "/api/v1/security-submissions";
const GRANT_SECONDS = 2 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
const SESSION_COOKIE = "__Host-slop_points";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

async function aesKey(secret: string): Promise<CryptoKey> {
  const bytes = decodeBase64Url(secret);
  if (bytes.byteLength !== 32)
    throw new Error("Intake grant key must be 32 bytes");
  return crypto.subtle.importKey("raw", ownedBuffer(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function seal(
  secret: string,
  aad: string,
  value: Record<string, unknown>,
): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(iv),
      additionalData: encoder.encode(aad),
    },
    await aesKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

async function open(
  secret: string,
  aad: string,
  sealed: string,
): Promise<Record<string, unknown> | null> {
  try {
    const [iv, ciphertext, extra] = sealed.split(".");
    if (!iv || !ciphertext || extra !== undefined) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedBuffer(decodeBase64Url(iv)),
        additionalData: encoder.encode(aad),
      },
      await aesKey(secret),
      ownedBuffer(decodeBase64Url(ciphertext)),
    );
    const value = JSON.parse(decoder.decode(plaintext));
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

/** A hash of the site session cookie; binds the grant to that session. */
async function sessionBinding(request: Request): Promise<string | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,128}$/u.test(token)) return null;
  return sha256Hex(`slop-intake-session:v1:${token}`);
}

function cookie(
  name: string,
  value: string,
  seconds: number,
  sameSite: "Strict" | "Lax",
): string {
  return `${name}=${value}; Path=${COOKIE_PATH}; Max-Age=${seconds}; Secure; HttpOnly; SameSite=${sameSite}`;
}

export function clearGrantCookie(): string {
  return cookie(GRANT_COOKIE, "", 0, "Strict");
}

function clearFlowCookie(): string {
  return cookie(FLOW_COOKIE, "", 0, "Lax");
}

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/api/v1/security-submissions/authorize/callback`;
}

/**
 * Starts the per-submission consent. The flow cookie is SameSite=Lax so the
 * top-level return from GitHub carries it; it holds the PKCE verifier, the
 * submission, the signed-in GitHub id and the session binding.
 */
export async function beginAuthorization(
  request: Request,
  config: IntakeConfig,
  input: { submissionId: string; githubId: string; githubLogin: string },
  now: Date,
): Promise<{ authorizeUrl: string; cookie: string } | null> {
  const session = await sessionBinding(request);
  if (session === null) return null;
  const verifier = randomToken(48);
  const state = randomToken(24);
  const sealed = await seal(config.grantKey, "slop-intake-flow:v1", {
    v: 1,
    s: input.submissionId,
    g: input.githubId,
    h: session,
    n: state,
    p: verifier,
    e: Math.floor(now.getTime() / 1000) + FLOW_SECONDS,
  });
  const url = new URL("/login/oauth/authorize", config.authorizeOrigin);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(request));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("login", input.githubLogin);
  url.searchParams.set("allow_signup", "false");
  return {
    authorizeUrl: url.href,
    cookie: cookie(FLOW_COOKIE, sealed, FLOW_SECONDS, "Lax"),
  };
}

export type GrantFailure =
  | "grant_flow_missing"
  | "grant_state_mismatch"
  | "grant_exchange_failed"
  | "grant_identity_mismatch";

/**
 * Finishes the consent on GitHub's redirect. The site session cookie is
 * SameSite=Strict and does not arrive on this cross-site return, so the
 * identity binding comes from the flow cookie that the signed-in session
 * created; when a session does arrive, it must name the same account too.
 * The token is checked against `/user` before any cookie holds it.
 */
export async function completeAuthorization(
  request: Request,
  config: IntakeConfig,
  now: Date,
  sessionGithubId: string | null,
): Promise<
  | { ok: true; submissionId: string; cookies: string[] }
  | {
      ok: false;
      submissionId: string | null;
      code: GrantFailure;
      cookies: string[];
    }
> {
  const url = new URL(request.url);
  const sealed = cookieValue(request, FLOW_COOKIE);
  const flow =
    sealed === null
      ? null
      : await open(config.grantKey, "slop-intake-flow:v1", sealed);
  const clear = [clearFlowCookie()];
  if (
    flow === null ||
    flow.v !== 1 ||
    typeof flow.s !== "string" ||
    typeof flow.g !== "string" ||
    typeof flow.h !== "string" ||
    typeof flow.n !== "string" ||
    typeof flow.p !== "string" ||
    typeof flow.e !== "number" ||
    flow.e <= Math.floor(now.getTime() / 1000)
  )
    return {
      ok: false,
      submissionId: null,
      code: "grant_flow_missing",
      cookies: clear,
    };
  const submissionId = flow.s;
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (
    !constantTimeEqual(state, flow.n) ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(code)
  )
    return {
      ok: false,
      submissionId,
      code: "grant_state_mismatch",
      cookies: clear,
    };
  let token = await config.oauth.exchange(code, flow.p, callbackUrl(request));
  if (token === null)
    return {
      ok: false,
      submissionId,
      code: "grant_exchange_failed",
      cookies: clear,
    };
  try {
    const user = await config.advisories.currentUser(
      reporterGrant(token, flow.g),
    );
    if (!user.ok)
      return {
        ok: false,
        submissionId,
        code: "grant_exchange_failed",
        cookies: clear,
      };
    if (
      user.id !== flow.g ||
      (sessionGithubId !== null && sessionGithubId !== flow.g)
    )
      return {
        ok: false,
        submissionId,
        code: "grant_identity_mismatch",
        cookies: clear,
      };
    const grant = await seal(
      config.grantKey,
      `slop-intake-grant:v1:${submissionId}:${flow.h}`,
      {
        v: 1,
        g: flow.g,
        l: user.login,
        t: token,
        e: Math.floor(now.getTime() / 1000) + GRANT_SECONDS,
      },
    );
    return {
      ok: true,
      submissionId,
      cookies: [...clear, cookie(GRANT_COOKIE, grant, GRANT_SECONDS, "Strict")],
    };
  } finally {
    token = "";
  }
}

/**
 * The reporter grant for this submission and session, or null when it is
 * missing, expired, tampered, or bound to another submission, session or
 * account. A null grant never reaches GitHub.
 */
export async function readGrant(
  request: Request,
  config: IntakeConfig,
  submissionId: string,
  reporterGithubId: string,
  now: Date,
): Promise<ReporterGrant | null> {
  const sealed = cookieValue(request, GRANT_COOKIE);
  const session = await sessionBinding(request);
  if (sealed === null || session === null) return null;
  const value = await open(
    config.grantKey,
    `slop-intake-grant:v1:${submissionId}:${session}`,
    sealed,
  );
  if (
    value === null ||
    value.v !== 1 ||
    value.g !== reporterGithubId ||
    typeof value.t !== "string" ||
    typeof value.e !== "number" ||
    value.e <= Math.floor(now.getTime() / 1000)
  )
    return null;
  return reporterGrant(value.t, reporterGithubId);
}

/** The real code exchange with the intake App's client credentials. */
export function githubIntakeOAuth(options: {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  oauthOrigin: string;
  clientId: string;
  clientSecret: string;
}): IntakeOAuth {
  return {
    async exchange(code, verifier, redirectUri) {
      try {
        const response = await options.fetch(
          `${options.oauthOrigin}/login/oauth/access_token`,
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/x-www-form-urlencoded",
              "user-agent": "slop.cash-private-intake",
            },
            body: new URLSearchParams({
              client_id: options.clientId,
              client_secret: options.clientSecret,
              code,
              code_verifier: verifier,
              redirect_uri: redirectUri,
            }).toString(),
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) return null;
        const body = (await readBoundedJson(response, 64 * 1024, "GitHub")) as {
          access_token?: unknown;
          token_type?: unknown;
        };
        const token = body?.access_token;
        if (
          typeof token !== "string" ||
          token.length < 16 ||
          token.length > 512 ||
          (body.token_type !== "bearer" && body.token_type !== "Bearer")
        )
          return null;
        // The refresh token, if any, is dropped (OPEN_QUESTION 3).
        return token;
      } catch {
        return null;
      }
    },
  };
}
