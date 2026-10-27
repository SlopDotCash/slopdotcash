import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { chromium } from "playwright";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";

// Real Pages routing, native D1 transactions and native R2. The identity service
// returns controlled local identities; no GitHub, private trace or key is used.
const directory = await mkdtemp(join(tmpdir(), "slop-trace-operator-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const site = "https://slop.cash";
const api = "https://api.slop.cash";
const secret = "local-trace-workflow-only-secret-0123456789";
const identities = new Map();
let runtime;
let browser;
let server;
let proxy;
const sockets = new Set();
try {
  const entry = join(directory, "entry.ts");
  const bundle = join(directory, "worker.mjs");
  await writeFile(
    entry,
    `import { onRequest } from ${JSON.stringify(resolve("functions/api/v1/[[path]].ts"))};
export default { fetch(request, env, ctx) {
  return onRequest({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
}};`,
  );
  const build = spawnSync(
    "bun",
    ["build", entry, "--target=browser", `--outfile=${bundle}`],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const script = await readFile(bundle, "utf8");
  const options = (operators = "91,92") =>
    convertV4MiniflareOptions({
      name: "trace-operator-workflow",
      modules: true,
      script,
      compatibilityDate: "2026-07-30",
      bindings: {
        TRACE_AUTH_SECRET: secret,
        OPERATOR_GITHUB_IDS: operators,
        ADMIN_GITHUB_IDS: "93",
      },
      d1Databases: ["SLOP_DB"],
      r2Buckets: ["PRIVATE_TRACES"],
      d1Persist: join(directory, "d1"),
      r2Persist: join(directory, "r2"),
      serviceBindings: {
        SLOP_IDENTITY: async (request) => {
          const identity = identities.get(request.headers.get("authorization"));
          if (!identity)
            return Response.json({ error: "unauthorized" }, { status: 401 });
          const { audience } = await request.json();
          identities.delete(request.headers.get("authorization"));
          return Response.json({ ...identity, audience });
        },
      },
    });
  runtime = new Miniflare(options());
  await runtime.ready;
  let db = await runtime.getD1Database("SLOP_DB");
  let bucket = await runtime.getR2Bucket("PRIVATE_TRACES");
  for (const migration of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const queries = splitSqlQuery(
      await readFile(`migrations/${migration}`, "utf8"),
    );
    await db.batch(queries.map((query) => db.prepare(query)));
  }
  const call = (
    path,
    { origin = site, method = "POST", cookie, headers = {}, body } = {},
  ) =>
    runtime.dispatchFetch(`${site}${path}`, {
      method,
      headers: {
        ...(origin === null ? {} : { origin }),
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function signIn(id) {
    const assertion = `slop_assert_v1_${id.padEnd(43, "a")}`;
    identities.set(`Bearer ${assertion}`, {
      githubActorId: id,
      githubNodeId: `NODE_${id}`,
      githubLogin: `fixture-${id}`,
    });
    const response = await call("/api/v1/points/join", {
      body: { assertion, public: false },
    });
    assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
    return cookie.split(";")[0];
  }
  const operator = await signIn("91");
  const otherOperator = await signIn("92");
  const nonoperator = await signIn("93");
  const nonoperatorSession = await (
    await call("/api/v1/project-session", {
      method: "GET",
      cookie: nonoperator,
    })
  ).json();
  assert.equal(nonoperatorSession.session.admin, true);
  assert.equal(nonoperatorSession.session.traceOperator, false);

  const contents = [
    Buffer.from("Synthetic trace fixture. No private content.\n"),
    Buffer.from("A different synthetic trace.\n"),
  ];
  const digests = contents.map(hash);
  for (const [index, bytes] of contents.entries()) {
    const digest = digests[index];
    const key = `traces/sha256/${digest.slice(0, 2)}/${digest}`;
    await bucket.put(key, bytes, {
      customMetadata: { sha256: digest },
      httpMetadata: { contentType: "text/plain" },
    });
    await db
      .prepare(
        "INSERT INTO trace_objects(sha256,r2_key,size_bytes,content_type,created_by_github_id,created_at) VALUES(?,?,?,'text/plain','93',?)",
      )
      .bind(digest, key, bytes.length, new Date().toISOString())
      .run();
  }
  const trace = `/api/v1/operator/traces/${digests[0]}`;
  const reason = "Review the synthetic contribution evidence";
  const create = (cookie = operator, extra = {}) =>
    call(`${trace}/grant`, { cookie, body: { reason }, ...extra });
  const read = (grant, cookie = operator, path = trace, extra = {}) =>
    call(path, {
      method: "GET",
      cookie,
      headers: { "x-trace-read-grant": grant },
      ...extra,
    });
  const initial = await create();
  assert.equal(
    initial.status,
    201,
    "signed-in designated operator must obtain a trace grant",
  );
  const grant = await initial.json();
  assert.equal(grant.traceObjectId, `sha256:${digests[0]}`);
  const row = await db
    .prepare("SELECT * FROM trace_read_grants WHERE token_hash=?")
    .bind(hash(grant.grant))
    .first();
  assert.equal(row.operator_github_id, "91");
  assert.equal(row.reason, reason);
  assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 60_000);
  assert.equal((await read(grant.grant, otherOperator)).status, 403);
  assert.equal(
    (await read(grant.grant, operator, `/api/v1/operator/traces/${digests[1]}`))
      .status,
    403,
  );
  assert.equal((await read(grant.grant, nonoperator)).status, 403);
  assert.equal(
    (await read(grant.grant, operator, trace, { origin: null })).status,
    403,
  );
  assert.equal(
    (await read(grant.grant, operator, trace, { origin: "https://slop.tech" }))
      .status,
    403,
  );
  const attempts = await Promise.all([read(grant.grant), read(grant.grant)]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 403]);
  const exact = attempts.find((r) => r.status === 200);
  assert.equal(hash(Buffer.from(await exact.arrayBuffer())), digests[0]);
  assert.equal(exact.headers.get("cache-control"), "no-store");
  assert.equal(exact.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    exact.headers.get("content-security-policy"),
    "default-src 'none'; sandbox",
  );
  assert.match(exact.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await read(grant.grant)).status, 403);
  const audit = (
    await db
      .prepare(
        "SELECT actor_github_id,action,target,details_json FROM private_audit_events ORDER BY created_at,id",
      )
      .all()
  ).results;
  assert.equal(audit.length, 2);
  assert.deepEqual(audit.map((r) => r.action).sort(), [
    "trace.read_grant.consumed",
    "trace.read_grant.created",
  ]);
  assert.ok(
    audit.every(
      (r) => r.actor_github_id === "91" && r.target === `sha256:${digests[0]}`,
    ),
  );
  assert.ok(!JSON.stringify(audit).includes(grant.grant));
  console.log(
    "PASS: exact-byte one-use read, actor/digest binding, reason, 60-second expiry and atomic audit",
  );

  for (const extra of [
    { origin: null },
    { origin: "https://evil.example" },
    { origin: "https://slop.tech" },
  ])
    assert.equal((await create(operator, extra)).status, 403);
  assert.equal((await create("")).status, 401);
  assert.equal(
    (await create(nonoperator)).status,
    403,
    "admin membership must not confer operator access",
  );
  assert.equal(
    (await create(operator, { body: { reason: "short" } })).status,
    400,
  );
  assert.equal(
    (
      await call("/api/v1/operator/wallet-claims", {
        cookie: operator,
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(`${api}/api/v1/operator/wallet-claims`, {
        method: "POST",
        headers: { cookie: operator, origin: api },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await runtime.dispatchFetch(`https://untrusted.example${trace}/grant`, {
        method: "POST",
        headers: { cookie: operator, origin: "https://untrusted.example" },
        body: JSON.stringify({ reason }),
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(trace, { method: "GET", cookie: operator })).status,
    403,
  );
  assert.equal(
    (await call("/api/v1/traces", { method: "GET", cookie: operator })).status,
    404,
  );

  const expiring = await (await create()).json();
  await db
    .prepare("UPDATE trace_read_grants SET expires_at=? WHERE token_hash=?")
    .bind(new Date(Date.now() - 1000).toISOString(), hash(expiring.grant))
    .run();
  assert.equal((await read(expiring.grant)).status, 403);
  const revoked = await (await create()).json();
  await runtime.setOptions(options("92"));
  assert.equal((await read(revoked.grant)).status, 403);
  assert.equal((await create()).status, 403);
  await runtime.setOptions(options());
  db = await runtime.getD1Database("SLOP_DB");
  bucket = await runtime.getR2Bucket("PRIVATE_TRACES");
  const tokenHash = hash(operator.split("=")[1]);
  await db
    .prepare("UPDATE points_sessions SET expires_at=? WHERE token_hash=?")
    .bind(new Date(Date.now() - 1000).toISOString(), tokenHash)
    .run();
  assert.equal((await read(revoked.grant)).status, 401);
  assert.equal((await create()).status, 401);
  const fresh = await signIn("91");
  const signedOutGrant = await (await create(fresh)).json();
  assert.equal(
    (await call("/api/v1/points/signout", { cookie: fresh, body: {} })).status,
    200,
  );
  assert.equal((await create(fresh)).status, 401);
  assert.equal((await read(signedOutGrant.grant, fresh)).status, 401);
  console.log(
    "PASS: same-origin, designated operator, session expiry/revocation, allowlist revocation and route isolation",
  );

  const assertion = `slop_assert_v1_${"c".repeat(43)}`;
  identities.set(`Bearer ${assertion}`, {
    githubActorId: "91",
    githubNodeId: "NODE_91",
    githubLogin: "fixture-91",
  });
  const exchanged = await runtime.dispatchFetch(`${api}/api/v1/auth/session`, {
    method: "POST",
    headers: { "x-slop-identity-assertion": assertion },
  });
  assert.equal(exchanged.status, 200, "contributor assertion exchange");
  const { token } = await exchanged.json();
  assert.equal(
    (
      await runtime.dispatchFetch(`${api}${trace}/grant`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      })
    ).status,
    403,
  );
  const authBundle = join(directory, "auth.mjs");
  const authBuild = spawnSync(
    "bun",
    [
      "build",
      "backend/trace/auth.ts",
      "--target=browser",
      `--outfile=${authBundle}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(authBuild.status, 0, authBuild.stderr);
  const { signApiToken } = await import(pathToFileURL(authBundle).href);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "slop.cash",
    aud: "private-trace-api",
    sub: "github:91",
    githubId: "91",
    githubLogin: "fixture-91",
    roles: ["operator"],
    iat: now,
    exp: now + 301,
    jti: "local-proof-only-12345",
  };
  const tooLong = await signApiToken(claims, secret);
  const tokenGrant = async (bearer) =>
    runtime.dispatchFetch(`${api}${trace}/grant`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ reason }),
    });
  assert.equal((await tokenGrant(tooLong)).status, 401);
  const bounded = await signApiToken({ ...claims, exp: now + 300 }, secret);
  assert.equal((await tokenGrant(bounded)).status, 201);
  console.log(
    "PASS: contributor exchange cannot elevate; existing five-minute bearer boundary is unchanged",
  );

  // Real HTTPS preserves browser-generated Fetch Metadata, which Playwright
  // interception sees before the network stack adds it. This loopback proxy
  // permits only the fixture host and never connects to the public site.
  const certificate = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=slop.cash",
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    certificate.status,
    0,
    "generate ephemeral local TLS certificate",
  );
  const observedReads = [];
  server = createHttpsServer(
    {
      key: await readFile(join(directory, "key.pem")),
      cert: await readFile(join(directory, "cert.pem")),
    },
    async (request, response) => {
      try {
        assert.equal(request.headers.host, "slop.cash");
        if (request.url === "/") {
          response.writeHead(200, { "content-type": "text/html" });
          response.end("<!doctype html><title>Local trace workflow</title>");
          return;
        }
        const headers = Object.fromEntries(
          Object.entries(request.headers).filter(
            ([, value]) => typeof value === "string",
          ),
        );
        if (
          request.method === "GET" &&
          request.url.startsWith("/api/v1/operator/traces/")
        )
          observedReads.push({
            origin: headers.origin ?? null,
            site: headers["sec-fetch-site"] ?? null,
          });
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const result = await runtime.dispatchFetch(`${site}${request.url}`, {
          method: request.method,
          headers,
          ...(body.length ? { body } : {}),
        });
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        response.writeHead(500);
        response.end("Local workflow bridge failed");
      }
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  proxy = createHttpServer((_, response) => {
    response.writeHead(403);
    response.end();
  });
  proxy.on("connect", (request, client, head) => {
    if (request.url !== "slop.cash:443") {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const target = connect(server.address().port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) target.write(head);
      client.pipe(target);
      target.pipe(client);
    });
    for (const socket of [client, target]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {
        client.destroy();
        target.destroy();
      });
    }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    proxy: { server: `http://127.0.0.1:${proxy.address().port}` },
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(site);
  const browserAssertion = `slop_assert_v1_${"d".repeat(43)}`;
  identities.set(`Bearer ${browserAssertion}`, {
    githubActorId: "91",
    githubNodeId: "NODE_91",
    githubLogin: "fixture-91",
  });
  const result = await page.evaluate(
    async ({ assertion, trace, reason }) => {
      const signedIn = await fetch("/api/v1/points/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assertion, public: false }),
      });
      const { session } = await (await fetch("/api/v1/project-session")).json();
      const grantResponse = await fetch(`${trace}/grant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (grantResponse.status !== 201)
        return { signedIn: signedIn.status, grant: grantResponse.status };
      const { grant } = await grantResponse.json();
      const response = await fetch(trace, {
        headers: { "x-trace-read-grant": grant },
      });
      const bytes = await response.arrayBuffer();
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const replay = await fetch(trace, {
        headers: { "x-trace-read-grant": grant },
      });
      return {
        signedIn: signedIn.status,
        grant: grantResponse.status,
        read: response.status,
        replay: replay.status,
        digest,
        cookies: document.cookie,
        operator: session.traceOperator,
        admin: session.admin,
      };
    },
    { assertion: browserAssertion, trace, reason },
  );
  console.log("Browser transport metadata", observedReads);
  assert.deepEqual(result, {
    signedIn: 200,
    grant: 201,
    read: 200,
    replay: 403,
    digest: digests[0],
    cookies: "",
    operator: true,
    admin: false,
  });
  assert.deepEqual(observedReads, [
    { origin: null, site: "same-origin" },
    { origin: null, site: "same-origin" },
  ]);
  for (const siteValue of ["same-site", "cross-site", "none"])
    assert.equal(
      (
        await read(grant.grant, otherOperator, trace, {
          origin: null,
          headers: {
            "x-trace-read-grant": grant.grant,
            "sec-fetch-site": siteValue,
          },
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await read(grant.grant, otherOperator, trace, {
        origin: "https://slop.tech",
        headers: {
          "x-trace-read-grant": grant.grant,
          "sec-fetch-site": "same-origin",
        },
      })
    ).status,
    403,
  );
  console.log(
    "PASS: actual Chromium sign-in, operator-only session flag, browser-controlled same-origin GET, exact bytes and replay refusal",
  );

  console.log(
    "Private trace operator Pages/D1/R2 workflow passed. Local synthetic content only.",
  );
} finally {
  await browser?.close();
  for (const socket of sockets) socket.destroy();
  for (const listener of [proxy, server])
    if (listener) await new Promise((resolve) => listener.close(resolve));
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
