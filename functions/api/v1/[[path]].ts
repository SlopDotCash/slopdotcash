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
};

type PagesContext = {
  request: Request;
  env: Env;
};

export const MAX_IDENTITY_RESPONSE_BYTES = 16 * 1024;

async function readIdentityResponse(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_IDENTITY_RESPONSE_BYTES)
  ) {
    throw new Error("Identity response exceeds the allowed size");
  }
  if (response.body === null) throw new Error("Identity response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IDENTITY_RESPONSE_BYTES) {
        await reader.cancel("identity response too large");
        throw new Error("Identity response exceeds the allowed size");
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
  const body = await readIdentityResponse(response);
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
  });
}
