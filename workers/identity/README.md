# Slop identity Worker

`slop-identity` is the only component that handles GitHub sign-in. It uses the
GitHub authorization-code flow with PKCE and returns a one-time, 90-second
identity assertion. It never accepts an existing PAT, `gh auth token`, workflow
token, or GitHub device token.

The public authority is fixed to `https://identity.slop.cash`. The only OAuth
callback is:

```text
https://identity.slop.cash/v1/oauth/callback
```

There is no caller-supplied callback or return URL. Assertion consumption uses
the `https://identity.internal` host through a Cloudflare service binding. The
public custom domain cannot reach that host-routed endpoint.

## Installed-client contract

The installed client keeps `flowId`, `pollCapability`, the returned assertion,
and the final Slop session token only in process memory. It must not put them in
argv, environment variables, files, stdout, logs, traces, receipts, or model
context.

Start sign-in:

```http
POST https://identity.slop.cash/v1/oauth/start
Content-Type: application/json

{"audience":"private-trace-api"}
```

Success is HTTP 201:

```json
{
  "flowId": "flow_<opaque>",
  "authorizationUrl": "https://identity.slop.cash/v1/oauth/authorize?...",
  "pollCapability": "<opaque>",
  "expiresAt": "2026-08-15T20:05:00.000Z",
  "pollAfterSeconds": 2
}
```

Show only `authorizationUrl` to the user. Printing it is acceptable; do not
print the rest of the response. The safest portable behavior is to ask the user
to open that URL. An OS browser API may open it directly if that API does not
invoke a shell or log the URL.

Poll no faster than `pollAfterSeconds`:

```http
POST https://identity.slop.cash/v1/oauth/poll
Content-Type: application/json

{
  "flowId": "flow_<opaque>",
  "pollCapability": "<opaque>",
  "audience": "private-trace-api"
}
```

Before the callback completes, HTTP 202 returns:

```json
{"status":"pending","retryAfterSeconds":2}
```

After verified GitHub sign-in, exactly one poll returns HTTP 200:

```json
{
  "status": "complete",
  "assertion": "slop_assert_v1_<opaque>",
  "assertionType": "SlopIdentity",
  "expiresAt": "2026-08-15T20:01:30.000Z"
}
```

Immediately send the assertion once to the trace API:

```http
POST https://api.slop.cash/api/v1/auth/session
X-Slop-Identity-Assertion: slop_assert_v1_<opaque>
```

Then overwrite the in-memory assertion. Repeated polling returns HTTP 410.
Wrong, expired, or already-used capabilities return HTTP 410 without revealing
whether the browser completed sign-in. The trace API's session exchange
returns the separate ten-minute contributor session described in
`backend/trace/README.md`.

## Security properties

- OAuth state is 256 random bits, hash-only in D1, and bound to an HttpOnly,
  Secure, SameSite=Lax `__Host-` cookie.
- The PKCE verifier is encrypted in D1 with AES-256-GCM and flow-bound
  additional authenticated data. The atomic callback claim clears its
  ciphertext before contacting GitHub.
- GitHub's authorization code and user access token exist only in the callback
  request/runtime. The access token is used once to read `/user`, is never
  persisted or returned, and is cleared before returning.
- No OAuth scopes are requested. The only retained identity is the immutable
  numeric GitHub actor ID and validated login.
- Poll capabilities and assertions are stored only as SHA-256 digests.
- Assertions are fixed to `private-trace-api`, consumed atomically, and never
  carry an operator role. The identity Worker has no role-issuance endpoint.
- Worker-native counters limit OAuth starts to 12 per minute and polls to 120
  per minute per connecting address and Cloudflare location. Counters are
  eventually consistent abuse controls, not accounting records, and never
  enter D1.
- Expired flows and assertions are removed hourly. Trace retention is
  unaffected.
- Response bodies and application logs never contain GitHub codes or access
  tokens. Persisted Worker invocation logs are disabled because OAuth codes
  arrive in the standard callback query parameter. Do not enable full-URL
  Logpush fields or production request tails for this Worker.

## Provisioning

Create a GitHub App owned by the designated Slop operator organization:

- Homepage: `https://slop.cash`
- Callback: `https://identity.slop.cash/v1/oauth/callback`
- Webhooks: disabled for this App
- Repository permissions: none
- Organization permissions: none
- Account permissions: none. The authenticated `/user` identity lookup uses
  the user access token's intrinsic identity without requesting extra account
  data.

Use a dedicated App. Do not reuse an App that has repository, workflow, or
administration permissions.

The Worker reuses the private D1 database. After provisioning the database, add
its actual `database_id` to the `IDENTITY_DB` entry in `wrangler.toml`, then:

```bash
bunx wrangler d1 migrations apply slop-private --remote --config workers/identity/wrangler.toml
bunx wrangler secret put GITHUB_APP_CLIENT_ID --config workers/identity/wrangler.toml
bunx wrangler secret put GITHUB_APP_CLIENT_SECRET --config workers/identity/wrangler.toml
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' \
  | bunx wrangler secret put IDENTITY_STATE_KEY --config workers/identity/wrangler.toml
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' \
  | bunx wrangler secret put IDENTITY_ASSERTION_KEY --config workers/identity/wrangler.toml
bunx wrangler deploy --config workers/identity/wrangler.toml
```

`IDENTITY_STATE_KEY` and `IDENTITY_ASSERTION_KEY` are independent random
32-byte base64url values. Bind the Worker to the Pages trace API as
`SLOP_IDENTITY`. Keep `workers_dev = false`; only the custom OAuth domain and
service binding should invoke it.

The final `wrangler deploy` above is a one-time provisioning operation because
it creates the custom domain and cron trigger. Normal production releases use
the protected workflow's `wrangler versions upload` followed by
`wrangler versions deploy`; that updates the active code and bindings without
requesting zone-level Workers Routes authority or rewriting the established
domain.

Before enabling clients, verify the custom domain's DNS and TLS separately and
prove rate limiting, assertion replay, and CSRF rejection in production. Zone
WAF rules remain defense in depth and must not replace the route-specific
Worker counters.
