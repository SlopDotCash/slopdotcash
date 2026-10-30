import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { childEnvironment } from "../../scripts/child-environment.mjs";
import {
  readMonthlySchedule,
  readRegistryDatabase,
} from "../payments/registry-database.mjs";
import { paymentStack } from "./configure.mjs";
import {
  assembleMainnetBindings,
  prepareMainnetRelease,
  publishMainnetRelease,
} from "./release-mainnets.mjs";
import { mainnetReleasePlan } from "./release-plan.mjs";

// Real generated configuration and native Workerd/SQLite Durable Object.
// The test-only observer records access names, never secret values. No keys,
// provider credentials, chain, deployment or production bindings are used.
const directory = await mkdtemp(join(tmpdir(), "slop-inactive-attester-"));
let runtime;
try {
  const input = {
    stack: "production",
    network: "base-mainnet",
    deployments: [],
    registry: [],
    registryDatabase: await readRegistryDatabase(),
    monthlySchedule: await readMonthlySchedule(),
  };
  const { configs } = paymentStack(input);
  const config = configs.attester;
  const configPath = join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify(config));
  const env = childEnvironment(process.env, {
    CI: "true",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG: "error",
  });
  const dryRun = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "deploy",
      "--dry-run",
      "--config",
      configPath,
      "--outdir",
      join(directory, "dry-run"),
    ],
    { encoding: "utf8", env, timeout: 180_000 },
  );
  assert.equal(dryRun.status, 0, dryRun.stderr);

  // Execute the same release helper the protected workflow invokes. Only
  // Cloudflare replies are controlled; configurations and publication files are real.
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  for (const scenario of [
    "absent",
    "existing",
    "auth",
    "wrong-account",
    "wrong-source",
  ]) {
    const folder = join(directory, scenario);
    const calls = [];
    const provider = async (args) => {
      calls.push(args);
      if (args[0] === "deployments" && args[1] === "list") {
        if (scenario === "existing") return { status: 0, stdout: "[]" };
        const account = (scenario === "wrong-account" ? "1" : "0").repeat(32);
        return {
          status: 1,
          stderr: `A request to the Cloudflare API (/accounts/${account}/workers/scripts/${config.name}/deployments) failed. [code: ${scenario === "auth" ? "10000" : "10007"}]`,
        };
      }
      if (args[0] === "deploy") return { status: 0, stdout: "" };
      if (args[0] === "versions")
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "fixture",
              annotations: {
                "workers/tag": (scenario === "wrong-source" ? "b" : "a").repeat(
                  40,
                ),
              },
            },
          ]),
        };
      if (args[1] === "status")
        return {
          status: 0,
          stdout: JSON.stringify({
            versions: [{ version_id: "fixture", percentage: 100 }],
          }),
        };
      throw new Error("Unexpected provider operation");
    };
    const run = async () => {
      await prepareMainnetRelease({
        directory: folder,
        account: "0".repeat(32),
        sha: "a".repeat(40),
        registry: [],
        provider,
      });
      const path = join(folder, "wrangler.jsonc");
      await writeFile(
        path,
        JSON.stringify({
          vars: {},
          services: [],
          env: { preview: { services: [] } },
        }),
      );
      await publishMainnetRelease({
        directory: folder,
        sha: "a".repeat(40),
        provider,
      });
      await assembleMainnetBindings({
        directory: folder,
        sha: "a".repeat(40),
        path,
      });
      const pages = JSON.parse(await readFile(path, "utf8"));
      assert.deepEqual(pages.env.preview.services, []);
      assert.deepEqual(JSON.parse(pages.vars.PAYMENT_NETWORKS), [
        "base-mainnet",
      ]);
      assert.equal(pages.services.length, scenario === "existing" ? 0 : 2);
      if (scenario === "absent")
        assert.deepEqual(pages.services[0], {
          binding: "BINDING_RECOVERY",
          service: config.name,
          entrypoint: "BindingRecovery",
        });
    };
    if (["absent", "existing"].includes(scenario)) await run();
    else
      await assert.rejects(
        run,
        scenario === "wrong-source"
          ? /does not match tested source/
          : /Cannot prove .* absent/,
      );
    if (["existing", "auth", "wrong-account"].includes(scenario))
      assert(!calls.some((args) => args[0] === "deploy"));
    assert(!calls.some((args) => args[0] === "secret"));
  }
  // The application already accepts the private payment RPC map. Its
  // installation must pass the real Pages release guard without admitting
  // a signing key into Pages.
  const secretStart = workflow.indexOf('          node - "$pages_secrets"');
  const secretEnd = workflow.indexOf("\n          NODE", secretStart);
  assert(secretStart >= 0 && secretEnd > secretStart);
  const secretGuard = workflow
    .slice(secretStart, secretEnd + "\n          NODE".length)
    .replace(/^ {10}/gm, "");
  for (const extra of ["PAYMENT_RPC_URLS", "SIGNER_PRIVATE_KEY"]) {
    const secretPath = join(directory, "pages-secret-names.txt");
    await writeFile(
      secretPath,
      ["OPERATOR_GITHUB_IDS", "TRACE_AUTH_SECRET", extra]
        .map((name) => `- ${name}: Value Encrypted`)
        .join("\n"),
    );
    const checked = spawnSync("bash", ["-euc", secretGuard], {
      encoding: "utf8",
      env: childEnvironment(process.env, { pages_secrets: secretPath }),
      timeout: 10_000,
    });
    if (extra === "PAYMENT_RPC_URLS")
      assert.equal(checked.status, 0, checked.stderr);
    else
      assert.notEqual(
        checked.status,
        0,
        "Pages must reject a signing-key secret",
      );
  }
  // Hypothetical configuration only: exercise disabled-network code without
  // changing the actual execution policy or publishing any service.
  const prepared = mainnetReleasePlan({
    ...input,
    execution: {
      ethereum: true,
      "robinhood-mainnet": true,
      "solana-mainnet": true,
    },
  }).map((entry) => entry.config);
  for (const inactive of [config, ...prepared]) {
    const config = inactive;
    const generatedPath = join(directory, `${config.name}.json`);
    await writeFile(generatedPath, JSON.stringify(config));
    const dry = spawnSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "deploy",
        "--dry-run",
        "--config",
        generatedPath,
        "--outdir",
        join(directory, `${config.name}-dry-run`),
      ],
      { encoding: "utf8", env, timeout: 25_000 },
    );
    assert.equal(dry.status, 0, dry.stderr);
    const entry = join(directory, "observer.mjs");
    await writeFile(
      entry,
      `
import worker, { PaymentSignerJournal as OriginalJournal } from ${JSON.stringify(resolve("workers/payment-executor/index.ts"))};
const watched = new Set(["PAYMENT_RPC_URLS", "SIGNER_PRIVATE_KEY", "SOLANA_SIGNER_SEED", "TEST_SIGNER_PRIVATE_KEY", "TEST_SOLANA_SIGNER_SEED"]);
export class PaymentSignerJournal extends OriginalJournal {
  constructor(state, env) {
    const accesses = [];
    super(state, new Proxy(env, { get(target, name) {
      if (watched.has(name)) { accesses.push(name); throw new Error("Unexpected secret or RPC access"); }
      return target[name];
    } }));
    this.accesses = accesses;
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/fixture/accesses") return Response.json(this.accesses);
    return super.fetch(request);
  }
}
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/fixture/scheduled") {
      try { await worker.scheduled({}, env); return new Response("unexpected success"); }
      catch { return new Response("scheduled refusal", { status: 409 }); }
    }
    return worker.fetch(request, env);
  }
};
`,
    );
    const bundle = join(directory, "worker.mjs");
    const buildArgs = [
      "build",
      entry,
      "--target=browser",
      `--outfile=${bundle}`,
    ];
    const build =
      process.platform === "win32"
        ? spawnSync(
            `bun build "${entry}" --target=browser "--outfile=${bundle}"`,
            { encoding: "utf8", env, timeout: 20_000, shell: true },
          )
        : spawnSync("bun", buildArgs, {
            encoding: "utf8",
            env,
            timeout: 20_000,
          });
    assert.equal(build.error, undefined, build.error?.message);
    assert.equal(build.status, 0, build.stderr);
    let outbound = 0;
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        name: config.name,
        modules: true,
        script: await readFile(bundle, "utf8"),
        // The pinned native binary predates the existing production date.
        // Wrangler above validates the unchanged generated 2026-10-06 config;
        // this explicit local-only date permits the HTTP refusal proof.
        compatibilityDate: "2026-09-14",
        compatibilityFlags: config.compatibility_flags,
        bindings: config.vars,
        durableObjects: {
          JOURNAL: { className: "PaymentSignerJournal", useSQLite: true },
        },
        d1Databases: ["PAYMENTS_DB", "REGISTRY_DB"],
        outboundService: () => {
          outbound += 1;
          return new Response("Unexpected RPC", { status: 502 });
        },
      }),
    );
    await runtime.ready;
    const routes = {
      "/v1/bind-destinations": 409,
      "/v1/monthly-authorization": 409,
      "/v1/commit-monthly": 404,
      "/v1/pay": 404,
      "/v1/complete-bind": 404,
      "/v1/attempt-status": 404,
      "/v1/cancel-unsubmitted": 404,
    };
    for (const [path, status] of Object.entries(routes)) {
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await runtime.dispatchFetch(
            `https://attester.internal${path}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "accept-encoding": "identity",
              },
              body: JSON.stringify({
                projectId: "fixture",
                period: "2026-11",
                network: "base-mainnet",
                snapshotSha256: "1".repeat(64),
                vault: `0x${"1".repeat(40)}`,
              }),
            },
          );
          await response.text();
          break;
        } catch (err) {
          const isTransportReset =
            err?.message?.includes("terminated") ||
            err?.code === "ECONNRESET" ||
            err?.cause?.code === "ECONNRESET" ||
            err?.cause?.message?.includes("ECONNRESET");
          if (attempt === 2 || !isTransportReset) throw err;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      if (config.name === "slop-payments-base-mainnet-attester")
        assert.equal(response.status, status, path);
      else assert(response.status >= 400, `${config.name} accepted ${path}`);
    }
    const scheduled = await runtime.dispatchFetch(
      "https://attester.internal/fixture/scheduled",
    );
    await scheduled.text();
    assert.equal(
      scheduled.status,
      409,
      "An accidental empty cron must fail visibly",
    );
    const observation = await runtime.dispatchFetch(
      "https://attester.internal/fixture/accesses",
    );
    assert.deepEqual(await observation.json(), []);
    assert.equal(outbound, 0);
    await runtime.dispose();
    runtime = undefined;
  }
  console.log(
    "PASS: all four generated private empty attesters, Wrangler dry runs, release absence/existing/uncertain/source boundaries, native signing-route refusals, accidental-cron refusal, zero key/RPC reads or outbound calls; local runtime date2026-09-14 only; no deployment",
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
