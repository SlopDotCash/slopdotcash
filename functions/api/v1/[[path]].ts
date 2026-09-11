import {
  CloudflareTracePersistence,
  type D1Database,
  type R2Bucket,
} from "../../../backend/trace/cloudflare-persistence";
import { handleTraceApi } from "../../../backend/trace/handler";

type Env = {
  SLOP_DB: D1Database;
  PRIVATE_TRACES: R2Bucket;
  TRACE_AUTH_SECRET: string;
  OPERATOR_GITHUB_IDS?: string;
  SLOP_IDENTITY: { fetch(request: Request): Promise<Response> };
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

type PagesContext = {
  request: Request;
  env: Env;
};

export const MAX_IDENTITY_RESPONSE_BYTES = 16 * 1024;
export const MAX_PRIVATE_INTAKE_RESPONSE_BYTES = 16 * 1024;
type PrivateIntakeStatus =
  | { status: "verified"; enabled: boolean; verifiedAt: string }
  | { status: "rate_limited"; resetAt: string }
  | { status: "unavailable" };

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)
  ) {
    throw new Error("Response exceeds the allowed size");
  }
  if (response.body === null) throw new Error("Response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response too large");
        throw new Error("Response exceeds the allowed size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function privateIntakeStatus(
  db: D1Database,
  now = new Date(),
): Promise<PrivateIntakeStatus> {
  try {
    const row = await db
      .prepare(
        "SELECT enabled, verified_at FROM private_intake_status WHERE singleton = 1",
      )
      .first<{ enabled: number; verified_at: string }>();
    if (
      !row ||
      ![0, 1].includes(row.enabled) ||
      typeof row.verified_at !== "string"
    )
      return { status: "unavailable" };
    const age = now.getTime() - Date.parse(row.verified_at);
    if (!Number.isFinite(age) || age < -300000 || age > 24 * 60 * 60 * 1000)
      return { status: "unavailable" };
    return {
      status: "verified",
      enabled: row.enabled === 1,
      verifiedAt: row.verified_at,
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function verifyIdentityAssertion(
  identityService: Env["SLOP_IDENTITY"],
  assertion: string,
): Promise<{ githubId: string; githubLogin: string } | null> {
  const response = await identityService.fetch(
    new Request("https://identity.internal/v1/assertions/consume", {
      method: "POST",
      headers: {
        authorization: `Bearer ${assertion}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ audience: "private-trace-api" }),
    }),
  );
  if (!response.ok) return null;
  const body = await readBoundedJson(response, MAX_IDENTITY_RESPONSE_BYTES);
  if (typeof body !== "object" || body === null) return null;
  const id = (body as { githubActorId?: unknown }).githubActorId;
  const login = (body as { githubLogin?: unknown }).githubLogin;
  if (
    typeof id !== "string" ||
    !/^\d+$/u.test(id) ||
    typeof login !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login)
  ) {
    return null;
  }
  return { githubId: id, githubLogin: login };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleTraceApi(context.request, {
    persistence: new CloudflareTracePersistence(
      context.env.SLOP_DB,
      context.env.PRIVATE_TRACES,
    ),
    authSecret: context.env.TRACE_AUTH_SECRET,
    operatorGithubIds: new Set(
      (context.env.OPERATOR_GITHUB_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^\d+$/u.test(value)),
    ),
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    verifyIdentityAssertion: (assertion) =>
      verifyIdentityAssertion(context.env.SLOP_IDENTITY, assertion),
    privateIntakeStatus: () => privateIntakeStatus(context.env.SLOP_DB),
  });
}
