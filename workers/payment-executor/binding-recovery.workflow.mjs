import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { childEnvironment } from "../../scripts/child-environment.mjs";

// The caller receives the real compiled named entrypoint, not the signing
// service. Native Workerd and the SQLite Durable Object have no signer keys,
// chain credentials, D1 data, pending attempts or reviewed deployments.
const directory = await mkdtemp(join(tmpdir(), "slop-binding-recovery-"));
let runtime;
try {
  const bundle = join(directory, "entrypoint.mjs");
  const build = spawnSync(
    "bun",
    [
      "--no-env-file",
      "build",
      "workers/payment-executor/entrypoint.ts",
      "--target=browser",
      "--external=cloudflare:workers",
      `--outfile=${bundle}`,
    ],
    {
      encoding: "utf8",
      env: childEnvironment(process.env, { CI: "true" }),
      timeout: 20_000,
    },
  );
  assert.equal(build.status, 0, build.stderr);
  let outbound = 0;
  const shared = {
    modules: true,
    // Local native Workerd date only; production configuration is unchanged.
    compatibilityDate: "2026-09-14",
    compatibilityFlags: ["nodejs_compat"],
  };
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      workers: [
        {
          name: "recovery-caller",
          ...shared,
          script:
            "export default { fetch(request, env) { return env.RECOVERY.fetch(request); } };",
          serviceBindings: {
            RECOVERY: {
              name: "recovery-attester",
              entrypoint: "BindingRecovery",
            },
          },
        },
        {
          name: "monthly-release-caller",
          ...shared,
          script:
            "export default { fetch(request, env) { return env.RELEASE.fetch(request); } };",
          serviceBindings: {
            RELEASE: {
              name: "recovery-attester",
              entrypoint: "MonthlyReserveRelease",
            },
          },
        },
        {
          name: "solana-binding-caller",
          ...shared,
          script:
            "export default { fetch(request, env) { return env.BINDING.fetch(request); } };",
          serviceBindings: {
            BINDING: { name: "solana-attester", entrypoint: "SolanaBinding" },
          },
        },
        {
          name: "solana-attester",
          ...shared,
          script: await readFile(bundle, "utf8"),
          bindings: {
            SIGNER_STACK: "production",
            SIGNER_ROLE: "attester",
            CHAIN_FAMILY: "solana",
            PAYMENT_DEPLOYMENTS: "[]",
            SECURITY_PAYMENT_DEPLOYMENTS: "[]",
            PAYMENT_RPC_URLS: "{}",
          },
          durableObjects: {
            JOURNAL: { className: "PaymentSignerJournal", useSQLite: true },
          },
          outboundService: () => {
            outbound += 1;
            return new Response("Unexpected external request", { status: 502 });
          },
        },
        {
          name: "recovery-attester",
          ...shared,
          script: await readFile(bundle, "utf8"),
          bindings: {
            SIGNER_STACK: "production",
            SIGNER_ROLE: "attester",
            CHAIN_FAMILY: "evm",
            PAYMENT_DEPLOYMENTS: "[]",
            SECURITY_PAYMENT_DEPLOYMENTS: "[]",
            PAYMENT_RPC_URLS: "{}",
          },
          durableObjects: {
            JOURNAL: {
              className: "PaymentSignerJournal",
              useSQLite: true,
            },
          },
          outboundService: () => {
            outbound += 1;
            return new Response("Unexpected external request", { status: 502 });
          },
        },
      ],
    }),
  );
  await runtime.ready;
  const caller = await runtime.getWorker("recovery-caller");
  const request = async (path, method, body) => {
    const response = await caller.fetch(`https://recovery.internal${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    return { status: response.status, body: await response.text() };
  };
  const input = {
    network: "base-mainnet",
    vault: `0x${"1".repeat(40)}`,
    originalTransactionId: `0x${"2".repeat(64)}`,
    winnerTransactionId: `0x${"3".repeat(64)}`,
  };
  for (const scope of ["ordinary", "security-bounty"]) {
    const result = await request("/v1/reconcile-binding", "POST", {
      ...input,
      scope,
    });
    assert.equal(result.status, 409, scope);
    assert.deepEqual(JSON.parse(result.body), {
      error: "binding_recovery_pending_or_rejected",
    });
  }
  const malformed = await request("/v1/reconcile-binding", "POST", input);
  assert.equal(malformed.status, 400);
  for (const path of [
    "/v1/pay",
    "/v1/bind-destinations",
    "/v1/monthly-authorization",
    "/v1/commit-monthly",
    "/v1/security/pay",
    "/v1/attempt-status",
    "/v1/cancel-unsubmitted",
    "/v1/reconcile-binding/extra",
  ]) {
    const result = await request(path, "POST", { ...input, scope: "ordinary" });
    assert.equal(result.status, 404, path);
  }
  assert.equal((await request("/v1/reconcile-binding", "GET")).status, 404);
  const release = await runtime.getWorker("monthly-release-caller");
  for (const path of [
    "/v1/pay",
    "/v1/commit-monthly",
    "/v1/monthly-authorization",
    "/v1/bind-destinations",
    "/v1/security/monthly-reserve-release",
    "/v1/reconcile-binding",
  ])
    assert.equal(
      (
        await release.fetch(`https://release.internal${path}`, {
          method: "POST",
          body: "{}",
        })
      ).status,
      404,
      path,
    );
  assert.equal(
    (await release.fetch("https://release.internal/v1/monthly-reserve-release"))
      .status,
    404,
  );
  // No registry means no proof; the named route reaches the real DO and refuses before key/RPC use.
  assert.equal(
    (
      await release.fetch(
        "https://release.internal/v1/monthly-reserve-release",
        { method: "POST", body: "{}" },
      )
    ).status,
    404,
  );
  const solana = await runtime.getWorker("solana-binding-caller");
  for (const path of [
    "/v1/commit-monthly",
    "/v1/monthly-authorization",
    "/v1/monthly-reserve-release",
    "/v1/reconcile-binding",
    "/v1/bind-destinations",
    "/v1/attempt-status",
    "/v1/cancel-unsubmitted",
    "/v1/security/pay/extra",
  ]) {
    const response = await solana.fetch(`https://binding.internal${path}`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 404, path);
    await response.text();
  }
  for (const path of [
    "/v1/pay",
    "/v1/complete-bind",
    "/v1/security/pay",
    "/v1/security/complete-bind",
  ]) {
    const get = await solana.fetch(`https://binding.internal${path}`);
    assert.equal(get.status, 404, path);
    await get.text();
    const post = await solana.fetch(`https://binding.internal${path}`, {
      method: "POST",
      body: "{}",
    });
    assert(post.status >= 400, "No pinned deployment may bind");
    await post.text();
  }
  assert.equal(outbound, 0);
  console.log(
    "PASS: compiled BindingRecovery service binding reached native SQLite Durable Object without keys; ordinary/private missing-attempt refusal, malformed-scope refusal, eight non-recovery routes and GET denied, zero external requests. No chain or finalized-winner qualification is claimed.",
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
