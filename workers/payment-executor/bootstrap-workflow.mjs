import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { childEnvironment } from "../../scripts/child-environment.mjs";
import {
  readMonthlySchedule,
  readRegistryDatabase,
} from "../payments/registry-database.mjs";
import { paymentStack } from "./configure.mjs";
import { prepareInactiveAttesters } from "./prepare-inactive.mjs";

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
  assert.deepEqual(Object.keys(configs), ["attester"]);
  assert.deepEqual(config.triggers, { crons: [] });
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.equal(config.services, undefined);
  assert.deepEqual(config.durable_objects.bindings, [
    { name: "JOURNAL", class_name: "PaymentSignerJournal" },
  ]);
  assert.deepEqual(config.migrations, [
    { tag: "v1", new_sqlite_classes: ["PaymentSignerJournal"] },
  ]);
  assert.throws(
    () =>
      paymentStack({
        ...input,
        stack: "test",
        network: "base-sepolia",
        databaseName: "slop-payments-base-sepolia-bootstrap",
        databaseId: "11111111-1111-4111-8111-111111111111",
      }),
    /Expected reviewed deployment array/,
  );
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

  // Execute the checked-in release preflight itself. Only the provider CLI
  // is a controlled fixture: absence, an existing service, and uncertain
  // lookups must choose distinct paths before any deployment or secret read.
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  const start = workflow.indexOf('          node - "$attester_config"');
  const end = workflow.indexOf(
    "          # Restore only absent cleanup triggers",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const preflight = workflow.slice(start, end).replace(/^ {10}/gm, "");
  const cliDirectory = join(directory, "node_modules/.bin");
  await mkdir(cliDirectory, { recursive: true });
  await writeFile(
    join(cliDirectory, "wrangler"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + "\\n");
if (args[0] !== "deployments" || args[1] !== "list") process.exit(90);
if (process.env.SCENARIO === "existing") { process.stdout.write("[]"); process.exit(0); }
const account = process.env.SCENARIO === "wrong-account" ? "1".repeat(32) : process.env.CLOUDFLARE_ACCOUNT_ID;
process.stderr.write("A request to the Cloudflare API (/accounts/" + account + "/workers/scripts/slop-payments-base-mainnet-attester/deployments) failed. [code: " + (process.env.SCENARIO === "auth" ? "10000" : "10007") + "]");
process.exit(1);
`,
    { mode: 0o700 },
  );
  for (const scenario of ["absent", "existing", "auth", "wrong-account"]) {
    const calls = join(directory, `${scenario}-calls.jsonl`);
    const decision = join(directory, `${scenario}-decision`);
    const run = spawnSync(
      "bash",
      ["-euc", `${preflight}\nprintf '%s' "$attester_release" > "$DECISION"`],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
        env: childEnvironment(process.env, {
          attester_dir: directory,
          attester_config: configPath,
          attester_vaults: "0",
          CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
          SCENARIO: scenario,
          CALLS: calls,
          DECISION: decision,
        }),
      },
    );
    if (scenario === "absent" || scenario === "existing") {
      assert.equal(run.status, 0, run.stderr);
      assert.equal(
        await readFile(decision, "utf8"),
        scenario === "absent" ? "true" : "false",
      );
    } else {
      assert.notEqual(run.status, 0, scenario);
      assert.match(run.stderr, /Cannot prove Base attester absent/);
    }
    const invoked = (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(invoked.length, 1);
    assert.deepEqual(invoked[0].slice(0, 2), ["deployments", "list"]);
  }
  // Execute the publication decision from the same workflow: an unchanged
  // zero-pin Worker may not yet export the new named entrypoint.
  const publicationStart = workflow.indexOf(
    '          if [ "$attester_release" != "true" ]; then',
  );
  const publicationEnd = workflow.indexOf(
    '          cp -R dist "$publish_dir/dist"',
    publicationStart,
  );
  assert(publicationStart >= 0 && publicationEnd > publicationStart);
  const publication = workflow
    .slice(publicationStart, publicationEnd)
    .replace(/^ {10}/gm, "");
  const parsedPages = spawnSync(
    "bun",
    [
      "--no-env-file",
      "-e",
      'process.stdout.write(JSON.stringify(Bun.TOML.parse(await Bun.file("wrangler.toml").text())))',
    ],
    { encoding: "utf8", env, timeout: 10_000 },
  );
  assert.equal(parsedPages.status, 0, parsedPages.stderr);
  const pages = JSON.parse(parsedPages.stdout);
  const recovery = pages.services.find(
    (service) => service.binding === "BINDING_RECOVERY",
  );
  assert.deepEqual(recovery, {
    binding: "BINDING_RECOVERY",
    service: config.name,
    entrypoint: "BindingRecovery",
  });
  for (const released of ["true", "false"]) {
    const output = join(directory, "wrangler.jsonc");
    await writeFile(output, JSON.stringify(pages));
    const result = spawnSync("bash", ["-euc", publication], {
      encoding: "utf8",
      timeout: 10_000,
      env: childEnvironment(process.env, {
        attester_release: released,
        publish_dir: directory,
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(actual, {
      ...pages,
      services:
        released === "true"
          ? pages.services
          : pages.services.filter(
              (service) => service.binding !== "BINDING_RECOVERY",
            ),
    });
    assert.deepEqual(actual.env.preview.services, []);
  }
  // Exercise the same non-Base publication helper the protected release uses.
  // Only the provider CLI is a controlled input; configs and Workerd are real.
  const prepared = [];
  for (const scenario of [
    "absent",
    "existing",
    "auth",
    "wrong-account",
    "wrong-source",
  ]) {
    const calls = [];
    const folder = join(directory, scenario);
    const run = () =>
      prepareInactiveAttesters({
        registry: [],
        directory: folder,
        account: "0".repeat(32),
        sha: "a".repeat(40),
        async provider(args) {
          calls.push(args);
          if (args[0] === "deployments" && args[1] === "list") {
            if (scenario === "existing") return { status: 0, stdout: "[]" };
            const name = args[args.indexOf("--name") + 1];
            const account = (scenario === "wrong-account" ? "1" : "0").repeat(
              32,
            );
            return {
              status: 1,
              stderr: `A request to the Cloudflare API (/accounts/${account}/workers/scripts/${name}/deployments) failed. [code: ${scenario === "auth" ? "10000" : "10007"}]`,
            };
          }
          if (args[0] === "deploy") {
            const generated = JSON.parse(
              await readFile(args[args.indexOf("--config") + 1], "utf8"),
            );
            if (scenario === "absent") prepared.push(generated);
            return { status: 0 };
          }
          if (args[0] === "versions")
            return {
              status: 0,
              stdout: JSON.stringify([
                {
                  id: "fixture",
                  annotations: {
                    "workers/tag": (scenario === "wrong-source"
                      ? "b"
                      : "a"
                    ).repeat(40),
                  },
                },
              ]),
            };
          if (args[0] === "deployments" && args[1] === "status")
            return {
              status: 0,
              stdout: JSON.stringify({
                versions: [{ version_id: "fixture", percentage: 100 }],
              }),
            };
          throw new Error("Unexpected provider operation");
        },
      });
    if (scenario === "absent" || scenario === "existing") {
      const results = await run();
      assert(
        results.every(
          (row) =>
            row.status ===
            (scenario === "absent"
              ? "inactive_released"
              : "existing_unchanged"),
        ),
      );
      if (scenario === "existing")
        assert(
          calls.every(
            (args) => args[0] === "deployments" && args[1] === "list",
          ),
        );
    } else {
      await assert.rejects(
        run,
        scenario === "wrong-source"
          ? /does not match tested source/
          : /Cannot prove .* absent/,
      );
      if (scenario !== "wrong-source")
        assert(!calls.some((args) => args[0] === "deploy"));
    }
    assert(!calls.some((args) => args[0] === "secret"));
  }
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
    const build = spawnSync(
      "bun",
      ["build", entry, "--target=browser", `--outfile=${bundle}`],
      { encoding: "utf8", env, timeout: 20_000 },
    );
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
      const response = await runtime.dispatchFetch(
        `https://attester.internal${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "fixture",
            period: "2026-11",
            network: "base-mainnet",
            snapshotSha256: "1".repeat(64),
            vault: `0x${"1".repeat(40)}`,
          }),
        },
      );
      if (config.name === "slop-payments-base-mainnet-attester")
        assert.equal(response.status, status, path);
      else assert(response.status >= 400, `${config.name} accepted ${path}`);
      await response.text();
    }
    const scheduled = await runtime.dispatchFetch(
      "https://attester.internal/fixture/scheduled",
    );
    assert.equal(
      scheduled.status,
      409,
      "An accidental empty cron must fail visibly",
    );
    await scheduled.text();
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
