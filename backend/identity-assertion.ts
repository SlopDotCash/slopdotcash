/** The identity Worker's one-time assertion consume call (points and traces). */
import { readBoundedJson } from "../src/lib/browser-json";

export type ConsumedIdentity = {
  githubId: string;
  githubLogin: string;
  /** Absent on assertions issued before node ids were recorded. */
  githubNodeId: unknown;
};

const MAX_IDENTITY_RESPONSE_BYTES = 16 * 1024;

/**
 * "expired" when the identity Worker rejects the assertion with 401, and
 * "invalid" when it answers for another audience or without a GitHub account.
 */
export async function consumeIdentityAssertion(
  identity: { fetch(request: Request): Promise<Response> },
  assertion: string,
  audience: string,
): Promise<ConsumedIdentity | "expired" | "invalid"> {
  const response = await identity.fetch(
    new Request("https://identity.internal/v1/assertions/consume", {
      method: "POST",
      headers: {
        authorization: `Bearer ${assertion}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ audience }),
    }),
  );
  if (response.status === 401) return "expired";
  if (!response.ok) throw new Error("Identity service unavailable");
  const body = await readBoundedJson(
    response,
    MAX_IDENTITY_RESPONSE_BYTES,
    "identity",
  );
  if (typeof body !== "object" || body === null) return "invalid";
  const {
    audience: answered,
    githubActorId,
    githubLogin,
    githubNodeId,
  } = body as Record<string, unknown>;
  if (
    answered !== audience ||
    typeof githubActorId !== "string" ||
    !/^\d+$/u.test(githubActorId) ||
    typeof githubLogin !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(githubLogin)
  )
    return "invalid";
  return { githubId: githubActorId, githubLogin, githubNodeId };
}
