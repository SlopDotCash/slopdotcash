/** Local-only adapter to Slop's production OAuth flow. No GitHub secret is read. */
import { randomBytes } from "node:crypto";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { readBoundedJson } from "../src/lib/browser-json";
import type { IdentityPersistence } from "../workers/identity/contracts";

const REMOTE = "https://identity.slop.cash";
type Flow = {
  authorizationUrl: string;
  pollCapability: string;
  expiresAt: string;
};
export function devIdentityBridge(
  origin: string,
  persistence: IdentityPersistence,
  requestRemote: typeof fetch = fetch,
) {
  const flows = new Map<string, Flow>();
  const json = (status: number, body: object) =>
    Response.json(body, { status, headers: { "cache-control": "no-store" } });
  async function remote(path: string, body: object) {
    return requestRemote(`${REMOTE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  }
  return async (request: Request): Promise<Response> => {
    for (const [id, flow] of flows)
      if (Date.parse(flow.expiresAt) <= Date.now()) flows.delete(id);
    const url = new URL(request.url);
    if (
      url.hostname === "identity.internal" &&
      url.pathname === "/v1/assertions/consume"
    ) {
      const body = (await readBoundedJson(request, 4096, "Local identity")) as {
        audience?: string;
      };
      const token = /^Bearer (slop_assert_v1_[A-Za-z0-9_-]{40,128})$/u.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (!token || body.audience !== "slop-points-web")
        return json(401, { error: "unauthorized" });
      const identity = await persistence.consumeAssertion(
        await sha256Hex(token),
        body.audience,
        new Date().toISOString(),
      );
      return identity
        ? json(200, {
            githubActorId: identity.githubActorId,
            githubLogin: identity.githubLogin,
            githubNodeId: identity.githubNodeId,
            audience: identity.audience,
          })
        : json(401, { error: "unauthorized" });
    }
    if (
      url.origin !== origin ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !== origin)
    )
      return json(403, { error: "origin_forbidden" });
    if (request.method === "GET" && url.pathname === "/v1/oauth/authorize") {
      const flow = flows.get(url.searchParams.get("flow_id") ?? "");
      if (!flow || new URL(flow.authorizationUrl).search !== url.search)
        return json(410, { error: "flow_expired" });
      return new Response(null, {
        status: 302,
        headers: {
          location: flow.authorizationUrl,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (request.method !== "POST") return json(404, { error: "not_found" });
    const body = (await readBoundedJson(
      request,
      4096,
      "Local sign-in",
    )) as Record<string, unknown>;
    if (body.audience !== "slop-points-web")
      return json(400, { error: "invalid_audience" });
    if (url.pathname === "/v1/oauth/start") {
      const response = await remote("/v1/local/start", {
        audience: body.audience,
        returnOrigin: origin,
      });
      if (!response.ok)
        return json(503, {
          error: "local_login_unavailable",
          message: "Slop's local sign-in handoff is not available yet.",
        });
      const result = (await readBoundedJson(
        response,
        16384,
        "Slop identity",
      )) as {
        flowId: string;
        pollCapability: string;
        authorizationUrl: string;
        expiresAt: string;
        pollAfterSeconds: number;
      };
      const auth = new URL(result.authorizationUrl);
      if (
        auth.origin !== REMOTE ||
        auth.pathname !== "/v1/oauth/authorize" ||
        auth.searchParams.get("flow_id") !== result.flowId ||
        Date.parse(result.expiresAt) <= Date.now()
      )
        return json(502, { error: "invalid_identity_response" });
      flows.set(result.flowId, result);
      return json(201, {
        ...result,
        authorizationUrl: `${origin}${auth.pathname}${auth.search}`,
      });
    }
    if (url.pathname === "/v1/oauth/poll") {
      const flow =
        typeof body.flowId === "string" ? flows.get(body.flowId) : undefined;
      if (!flow || flow.pollCapability !== body.pollCapability)
        return json(410, { error: "flow_expired" });
      const response = await remote("/v1/local/poll", body);
      const result = (await readBoundedJson(
        response,
        16384,
        "Slop identity",
      )) as Record<string, unknown>;
      if (response.status === 202) return json(202, result);
      if (!response.ok)
        return json(response.status, { error: "identity_unavailable" });
      if (
        result.returnOrigin !== origin ||
        typeof result.githubActorId !== "string" ||
        !/^[1-9][0-9]*$/u.test(result.githubActorId) ||
        typeof result.githubLogin !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(result.githubLogin) ||
        typeof result.githubNodeId !== "string"
      )
        return json(502, { error: "invalid_identity_response" });
      flows.delete(body.flowId as string);
      const assertion = `slop_assert_v1_${randomBytes(32).toString("base64url")}`;
      const expiresAt = new Date(Date.now() + 90_000).toISOString();
      const stored = await persistence.createAssertion({
        tokenHash: await sha256Hex(assertion),
        githubActorId: result.githubActorId,
        githubLogin: result.githubLogin,
        githubNodeId: result.githubNodeId,
        audience: "slop-points-web",
        createdAt: new Date().toISOString(),
        expiresAt,
        consumedAt: null,
      });
      if (!stored) return json(503, { error: "local_identity_unavailable" });
      return json(200, {
        status: "complete",
        assertion,
        assertionType: "SlopIdentity",
        expiresAt,
      });
    }
    return json(404, { error: "not_found" });
  };
}
