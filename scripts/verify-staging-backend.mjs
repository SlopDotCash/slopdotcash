/** Exercise the deployed staging API and a persisted OAuth flow without logging capabilities. */
const site = "https://staging.slop.cash";
const identity = "https://identity-staging.slop.cash";
async function request(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
}
const post = (origin, path, body, browserOrigin = site) =>
  request(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: browserOrigin },
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
const authorization = new URL(flow.authorizationUrl);
if (
  authorization.origin !== identity ||
  authorization.pathname !== "/v1/oauth/authorize"
)
  throw new Error("Staging identity returned a different authority");
const authorize = await request(authorization.href);
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
const poll = await post(identity, "/v1/oauth/poll", {
  audience,
  flowId: flow.flowId,
  pollCapability: flow.pollCapability,
});
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
const write = await post(site, "/api/v1/points/visibility", { public: true });
if (write.status !== 401)
  throw new Error("Staging accepted an unauthenticated account write");
console.log(
  "Staging OAuth persistence, callback routing, browser isolation, anonymous account, and write authentication verified. Interactive login acceptance is separate.",
);
