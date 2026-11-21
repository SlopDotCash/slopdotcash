/** Exercise the deployed staging API and a persisted OAuth flow without logging capabilities. */
import { stagingAcceptanceRequest as request } from "./staging-acceptance-request.mjs";

const site = "https://staging.slop.cash";
const identity = "https://identity-staging.slop.cash";
const post = (origin, path, body, browserOrigin = site, cookie = "") =>
  request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: browserOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const audience = "slop-points-web";
const start = await post(identity, "/v1/oauth/start", { audience });
if (
  start.status !== 201 ||
  start.headers.get("access-control-allow-origin") !== site
)
  throw new Error(`Staging identity start failed: ${start.status}`);
const flow = await start.json();
// A website flow is bound to the browser that started it by a cookie; this
// probe is that browser, so it presents the cookie on authorize and poll.
const binding =
  start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((pair) =>
      pair.startsWith(`__Host-slop_oauth_bind_${flow.flowId}=`),
    ) ?? "";
if (
  !binding ||
  start.headers.get("access-control-allow-credentials") !== "true"
)
  throw new Error("Staging identity did not bind the flow to its browser");
const authorization = new URL(flow.authorizationUrl);
if (
  authorization.origin !== identity ||
  authorization.pathname !== "/v1/oauth/authorize"
)
  throw new Error("Staging identity returned a different authority");
const unbound = await request(authorization.href);
if (unbound.status !== 403)
  throw new Error(
    "Staging authorized a flow in a browser that did not start it",
  );
await unbound.body?.cancel();
const authorize = await request(authorization.href, {
  headers: { Cookie: binding },
});
if (authorize.status !== 302)
  throw new Error("Staging authorization redirect failed");
const github = new URL(authorize.headers.get("location"));
if (
  github.origin !== "https://github.com" ||
  github.pathname !== "/login/oauth/authorize" ||
  github.searchParams.get("redirect_uri") !== `${identity}/v1/oauth/callback` ||
  github.searchParams.get("client_id") !== process.env.GITHUB_APP_CLIENT_ID
)
  throw new Error("Staging OAuth application or callback mismatch");
const poll = await post(
  identity,
  "/v1/oauth/poll",
  { audience, flowId: flow.flowId, pollCapability: flow.pollCapability },
  site,
  binding,
);
if (poll.status !== 202 || (await poll.json()).status !== "pending")
  throw new Error("Staging did not persist and read its OAuth flow");
const forbidden = await post(
  identity,
  "/v1/oauth/start",
  { audience },
  "https://slop.cash",
);
if (forbidden.status !== 403)
  throw new Error("Staging accepted the production browser origin");
const me = await request(`${site}/api/v1/points/me`);
if (me.status !== 200 || (await me.json()) !== null)
  throw new Error("Staging anonymous account state is invalid");
const payments = await request(`${site}/api/v1/payments/me`);
if (
  payments.status !== 401 ||
  (await payments.json()).error !== "not_signed_in"
)
  throw new Error(
    `Staging payment authentication is unavailable: ${payments.status}`,
  );
const write = await post(site, "/api/v1/points/visibility", { public: true });
if (write.status !== 401)
  throw new Error("Staging accepted an unauthenticated account write");
console.log(
  "Staging OAuth persistence, browser binding, callback routing, browser isolation, anonymous account, and write authentication verified. Interactive login acceptance is separate.",
);
