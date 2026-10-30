import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { childEnvironment } from "../../scripts/child-environment.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Actual named Worker RPC, App JWT/token adapter, native D1 and Pages routing.
// All identities and GitHub responses are synthetic; outbound traffic is closed.
const directory = await mkdtemp(join(tmpdir(), "slop-reporting-readiness-"));
const site = "https://slop.cash";
const repository = "example/reporting-fixture";
const legacyToken = "ghs_synthetic_reporting_fixture_only";
// GitHub completed its stateless installation-token rollout in October 2026.
// These are synthetic opaque bytes, not a GitHub-issued or client-validated JWT.
const statelessToken = `ghs_1_${"a".repeat(180)}.${"b".repeat(180)}.${"c".repeat(180)}`;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = keys.privateKey.export({ format: "pem", type: "pkcs8" });
let runtime;
const state = {
  token: legacyToken,
  enabled: true,
  installed: true,
  status: 200,
  id: 123456789,
  node: "R_example",
};
let requests = 0;
let reportWrites = 0;
const stages = [];
const checks = [];
try {
  async function build(name, source) {
    const entry = join(directory, `${name}.ts`);
    const output = join(directory, `${name}.mjs`);
    await writeFile(entry, source);
    const result = spawnSync(
      "bun",
      [
        "--no-env-file",
        "build",
        entry,
        "--target=browser",
        "--external=cloudflare:workers",
        `--outfile=${output}`,
      ],
      {
        encoding: "utf8",
        env: childEnvironment(),
        timeout: 30_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return readFile(output, "utf8");
  }
  const pages = await build(
    "pages",
    `import { onRequest } from ${JSON.stringify(resolve("functions/api/v1/[[path]].ts"))};
export default { fetch(request, env, ctx) { return onRequest({request, env, waitUntil: ctx.waitUntil.bind(ctx)}); } };`,
  );
  const publisher = await build(
    "publisher",
    `export { default, ReportingReadinessRefresher } from ${JSON.stringify(resolve("workers/slopbot/repository-access-entrypoint.ts"))};`,
  );
  const scheduler = await build(
    "scheduler",
    `import identity from ${JSON.stringify(resolve("workers/identity/index.ts"))};
export default { async fetch(request, env) {
  if (new URL(request.url).pathname === "/scheduled") { await identity.scheduled({}, env); return Response.json({completed:true}); }
  return Response.json(await env.REPORTING_READINESS.refreshReportingReadiness());
} };`,
  );
  const identity = async () =>
    Response.json({
      githubActorId: "900000102",
      githubNodeId: "U_reporter",
      githubLogin: "reporter",
      audience: "slop-points-web",
    });
  const upstream = async (request) => {
    requests += 1;
    const url = new URL(request.url);
    stages.push({ method: request.method, path: url.pathname });
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(request.headers.get("x-github-api-version"), "2022-11-28");
    const auth = request.headers.get("authorization")?.slice("Bearer ".length);
    if (
      url.pathname.endsWith("/installation") ||
      url.pathname.includes("/access_tokens")
    ) {
      const parts = auth?.split(".");
      assert.equal(parts?.length, 3);
      assert.equal(
        verify(
          "RSA-SHA256",
          Buffer.from(`${parts[0]}.${parts[1]}`),
          keys.publicKey,
          Buffer.from(parts[2], "base64url"),
        ),
        true,
      );
      if (url.pathname.endsWith("/installation"))
        return state.installed
          ? Response.json({ id: 4242 })
          : new Response(null, { status: 404 });
      assert.deepEqual(await request.json(), {
        repositories: ["reporting-fixture"],
        permissions: { repository_advisories: "read" },
      });
      return Response.json({ token: state.token }, { status: 201 });
    }
    assert.equal(auth, state.token);
    if (url.pathname === `/repos/${repository}`)
      return Response.json({
        id: state.id,
        node_id: state.node,
        full_name: repository,
      });
    if (url.pathname === `/repos/${repository}/private-vulnerability-reporting`)
      return state.status === 200
        ? Response.json({ enabled: state.enabled })
        : new Response(null, { status: state.status });
    reportWrites += 1;
    throw new Error("Unexpected provider operation");
  };
  const shared = { modules: true, compatibilityDate: "2026-09-14" };
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      workers: [
        {
          name: "pages",
          ...shared,
          script: pages,
          d1Databases: { SLOP_DB: "reporting-db" },
          bindings: {
            TRACE_AUTH_SECRET: "synthetic-reporting-workflow-secret-0123456789",
            SLOP_PRIVATE_INTAKE_MODE: "on",
            GITHUB_INTAKE_APP_ID: "1",
            GITHUB_INTAKE_APP_PRIVATE_KEY: key,
            GITHUB_INTAKE_APP_CLIENT_ID: "Iv1.reportingfixture",
            GITHUB_INTAKE_APP_CLIENT_SECRET: "synthetic-client-secret",
            SLOP_INTAKE_GRANT_KEY: Buffer.alloc(32, 7).toString("base64url"),
          },
          serviceBindings: { SLOP_IDENTITY: identity },
          outboundService: upstream,
        },
        {
          name: "refresher",
          ...shared,
          script: publisher,
          d1Databases: { SLOPBOT_DB: "reporting-db" },
          bindings: { SLOPBOT_APP_ID: "1", SLOPBOT_APP_PRIVATE_KEY: key },
          outboundService: upstream,
        },
        {
          name: "schedule-disabled",
          ...shared,
          script: scheduler,
          d1Databases: { IDENTITY_DB: "reporting-db" },
          bindings: {
            SLOP_ENVIRONMENT: "staging",
            IDENTITY_PUBLIC_ORIGIN: "https://identity-staging.slop.cash",
          },
        },
        {
          name: "schedule-caller",
          ...shared,
          script: scheduler,
          d1Databases: { IDENTITY_DB: "reporting-db" },
          bindings: {
            SLOP_ENVIRONMENT: "staging",
            IDENTITY_PUBLIC_ORIGIN: "https://identity-staging.slop.cash",
          },
          serviceBindings: {
            REPORTING_READINESS: {
              name: "refresher",
              entrypoint: "ReportingReadinessRefresher",
            },
          },
        },
      ],
    }),
  );
  await runtime.ready;
  const db = await runtime.getD1Database("SLOP_DB", "pages");
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.batch(
      splitSqlQuery(await readFile(`migrations/${name}`, "utf8")).map((sql) =>
        db.prepare(sql),
      ),
    );
  const manifest = applicationManifest("reporting-fixture", repository);
  manifest.rewardAsset = {
    ...manifest.rewardAsset,
    chainId: "1",
    cluster: null,
    decimals: 6,
    verifiedAt: new Date().toISOString(),
  };
  async function revision(number) {
    const bytes = JSON.stringify(manifest);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const at = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at,actor_github_id,actor_github_login) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        manifest.id,
        number,
        bytes,
        hash,
        "synthetic workflow",
        at,
        "900000101",
        "maintainer",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,revision=excluded.revision,manifest=excluded.manifest,manifest_sha256=excluded.manifest_sha256,updated_at=excluded.updated_at",
      )
      .bind(manifest.id, manifest.status, number, bytes, hash, at, at)
      .run();
  }
  await revision(1);
  const pageWorker = { fetch: (...args) => runtime.dispatchFetch(...args) };
  const caller = await runtime.getWorker("schedule-caller");
  const refresh = async () =>
    (
      await caller.fetch("https://fixture.internal/refresh", { method: "POST" })
    ).json();
  const row = () =>
    db
      .prepare(
        "SELECT * FROM repository_reporting_status WHERE project_id=? AND project_revision=1",
      )
      .bind(manifest.id)
      .first();
  let publicRead = 0;
  const readiness = async () => {
    const before = requests;
    const response = await pageWorker.fetch(
      `${site}/api/v1/security-programs/${manifest.id}/intake?observation=${++publicRead}`,
    );
    assert.equal(response.status, 200);
    assert.equal(requests, before, "Public readiness must not call GitHub");
    return response.json();
  };
  const expiredKey = "e".repeat(64);
  const expired = () =>
    db
      .prepare(
        "INSERT INTO identity_rate_limits(key_hash,request_count,window_started_at,expires_at) VALUES(?,1,1,2)",
      )
      .bind(expiredKey)
      .run();
  const cleanupFinished = async () =>
    assert.equal(
      await db
        .prepare("SELECT key_hash FROM identity_rate_limits WHERE key_hash=?")
        .bind(expiredKey)
        .first(),
      null,
    );
  await expired();
  const beforeDisabled = requests;
  const disabledSchedule = await runtime.getWorker("schedule-disabled");
  assert.equal(
    (await disabledSchedule.fetch("https://fixture.internal/scheduled")).status,
    200,
  );
  await cleanupFinished();
  assert.equal(requests, beforeDisabled);
  assert.equal(await row(), null);
  assert.equal((await readiness()).state, "unavailable");
  checks.push(
    "deliberately omitted binding keeps cleanup and unknown readiness",
  );
  assert.equal(
    (await caller.fetch("https://fixture.internal/scheduled")).status,
    200,
  );
  checks.push("existing identity schedule invokes the named refresher");
  const initial = await refresh();
  assert.deepEqual(
    initial,
    { checked: 1, failed: 0 },
    JSON.stringify({ stages, row: await row() }),
  );
  const good = await readiness();
  assert.equal(good.state, "ready");
  assert.equal(good.stale, false);
  assert.equal(good.automatic, "ready");
  const original = await row();
  checks.push("native App-authenticated refresh and provider-free public read");

  for (const token of [statelessToken, legacyToken]) {
    state.token = token;
    assert.deepEqual(await refresh(), { checked: 1, failed: 0 });
    assert.equal((await readiness()).state, "ready");
    assert.equal((await readiness()).stale, false);
  }
  checks.push("legacy and stateless tokens reach verified native D1 readiness");

  const lastGood = await row();
  for (const token of [
    undefined,
    null,
    42,
    "",
    " leading-space",
    "embedded space",
    "tab\tvalue",
    "value\r\nx-injected: yes",
    "non-ascii-\u0080",
    "x".repeat(64 * 1024),
  ]) {
    state.token = token;
    const firstStage = stages.length;
    assert.deepEqual(await refresh(), { checked: 1, failed: 1 });
    assert.equal(
      stages
        .slice(firstStage)
        .some(
          (stage) =>
            stage.path === `/repos/${repository}` ||
            stage.path.endsWith("/private-vulnerability-reporting"),
        ),
      false,
      "Invalid token must stop before any authenticated repository request",
    );
    const retained = await row();
    assert.equal(retained.verified_at, lastGood.verified_at);
    assert.equal(retained.enabled, lastGood.enabled);
    assert.equal((await readiness()).stale, true);
  }
  checks.push(
    "malformed, header-unsafe and oversized token responses preserve stale last-good state",
  );
  state.token = statelessToken;
  assert.deepEqual(await refresh(), { checked: 1, failed: 0 });
  const latestGood = await readiness();

  state.status = 403;
  await expired();
  await assert.rejects(caller.fetch("https://fixture.internal/scheduled"));
  await cleanupFinished();
  checks.push(
    "configured refresh failure stays explicit and cleanup completes",
  );
  assert.deepEqual(await refresh(), { checked: 1, failed: 1 });
  const failed = await readiness();
  assert.equal(failed.state, "ready");
  assert.equal(failed.stale, true);
  assert.equal(failed.checkedAt, latestGood.checkedAt);
  assert.equal(failed.automatic, "unavailable");
  assert.equal((await row()).repository_id, original.repository_id);
  checks.push("failed read preserves last-good bytes and stale distinction");

  state.status = 200;
  state.enabled = false;
  assert.deepEqual(await refresh(), { checked: 1, failed: 0 });
  assert.equal((await readiness()).state, "disabled");
  assert.equal((await readiness()).stale, false);
  checks.push("fresh disabled is distinct from failed refresh");

  state.enabled = true;
  await refresh();
  state.id += 1;
  assert.deepEqual(await refresh(), { checked: 1, failed: 1 });
  assert.equal((await row()).failure, "identity-mismatch");
  assert.equal((await row()).repository_id, original.repository_id);
  state.id -= 1;
  state.node = "R_wrong";
  assert.deepEqual(await refresh(), { checked: 1, failed: 1 });
  assert.equal((await row()).repository_node_id, original.repository_node_id);
  state.node = "R_example";
  checks.push("immutable database and node identity mismatch refuse");

  state.installed = false;
  assert.deepEqual(await refresh(), { checked: 1, failed: 0 });
  assert.equal((await readiness()).automatic, "app-not-installed");
  assert.equal((await readiness()).stale, true);
  checks.push(
    "App revocation preserves old fact without claiming current access",
  );

  manifest.status = "active";
  await revision(2);
  assert.deepEqual(await refresh(), { checked: 1, failed: 1 });
  assert.equal((await readiness()).automatic, "app-not-installed");
  checks.push(
    "active App revocation still fails the refresh without granting access",
  );

  manifest.status = "paused";
  await revision(3);
  assert.equal((await readiness()).state, "unavailable");
  assert.equal((await readiness()).checkedAt, null);
  checks.push("new registry revision cannot inherit earlier readiness");
  state.installed = true;
  const joinResponse = await pageWorker.fetch(`${site}/api/v1/points/join`, {
    method: "POST",
    headers: { origin: site, "content-type": "application/json" },
    body: JSON.stringify({
      assertion: `slop_assert_v1_${"x".repeat(43)}`,
      public: false,
    }),
  });
  assert.equal(joinResponse.status, 200, await joinResponse.clone().text());
  const cookie = joinResponse.headers.get("set-cookie").split(";")[0];
  const create = () =>
    pageWorker.fetch(`${site}/api/v1/security-submissions`, {
      method: "POST",
      headers: { origin: site, cookie, "content-type": "application/json" },
      body: JSON.stringify({
        projectId: manifest.id,
        idempotencyKey: crypto.randomUUID(),
        origin: "slop",
      }),
    });
  state.enabled = false;
  assert.equal((await create()).status, 409);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM security_submissions").first())
      .n,
    0,
  );
  // Cache still says disabled; the new live fact permits the draft.
  state.enabled = true;
  assert.equal((await create()).status, 201);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM security_submissions").first())
      .n,
    1,
  );
  checks.push(
    "fresh sensitive check refuses disabled and accepts enabled despite old cache",
  );
  state.installed = false;
  assert.equal((await create()).status, 409);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM security_submissions").first())
      .n,
    1,
  );
  checks.push("revoked App cannot create a new draft");
  assert.equal(reportWrites, 0);
  const privateWorker = await runtime.getWorker("refresher");
  for (const method of ["GET", "POST"])
    assert.equal(
      (
        await privateWorker.fetch(
          "https://fixture.internal/refreshReportingReadiness",
          { method },
        )
      ).status,
      404,
    );
  checks.push("default Worker fetch exposes no refresh route");
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      providerRequests: requests,
      privateReportWrites: reportWrites,
      productionRequests: 0,
    }),
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
