import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { childEnvironment } from "../../scripts/child-environment.mjs";
import { stagingPaymentProject } from "../../tests/staging-payment-fixture.mjs";
import {
  STAGING_MONTHLY_RELEASES,
  stagingReleasePlan,
} from "./release-staging.mjs";

const directory = await mkdtemp(join(tmpdir(), "slop-staging-release-native-"));
let runtime;
try {
  const bundle = async (entry, name) => {
    const output = join(directory, `${name}.mjs`);
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
      { encoding: "utf8", env: childEnvironment(), timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    return readFile(output, "utf8");
  };
  const [caller, attester] = await Promise.all([
    bundle("tests/staging-monthly-release-caller.ts", "caller"),
    bundle("workers/payment-executor/entrypoint.ts", "attester"),
  ]);
  const ids = ["eliza", "slopdotcash", "thenetwork", "asi"];
  const projects = Object.keys(STAGING_MONTHLY_RELEASES).map((network, i) =>
    stagingPaymentProject(network, ids[i]),
  );
  const schedule =
    '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}';
  const plans = stagingReleasePlan({
    registry: projects,
    registryDatabase: {
      database_name: "slop-staging",
      database_id: "6fcddcc1-f3d7-4175-bdde-09afddd53a8a",
    },
    monthlySchedule: schedule,
  });
  let outbound = 0;
  const common = {
    modules: true,
    compatibilityDate: "2026-09-14",
    compatibilityFlags: ["nodejs_compat"],
    outboundService: () => {
      outbound++;
      return new Response("No external calls in this test", { status: 599 });
    },
  };
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      workers: plans.flatMap((plan, i) => [
        {
          name: `caller-${i}`,
          ...common,
          script: caller,
          // The local getWorker proxy checks Origin against registered route
          // hosts before dispatch. Both test hosts must reach the real handler.
          routes: i === 0 ? ["staging.slop.cash/*", "slop.cash/*"] : [],
          bindings: {
            PAYMENT_NETWORKS: JSON.stringify(
              Object.keys(STAGING_MONTHLY_RELEASES),
            ),
            MONTHLY_PAYMENT_SCHEDULE: schedule,
            TEST_RELEASE_BINDING: plan.binding.binding,
          },
          d1Databases: { SLOP_DB: "test-registry" },
          serviceBindings: {
            [plan.binding.binding]: {
              name: plan.config.name,
              entrypoint: plan.binding.entrypoint,
            },
          },
        },
        {
          name: plan.config.name,
          ...common,
          script: attester,
          bindings: { ...plan.config.vars, PAYMENT_RPC_URLS: "{}" },
          d1Databases: {
            PAYMENTS_DB: "test-registry",
            REGISTRY_DB: "test-registry",
          },
          durableObjects: {
            JOURNAL: { className: "PaymentSignerJournal", useSQLite: true },
          },
        },
      ]),
    }),
  );
  await runtime.ready;
  const db = await runtime.getD1Database("SLOP_DB", "caller-0");
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of splitSqlQuery(
      await readFile(join("migrations", file), "utf8"),
    ))
      await db.prepare(sql).run();
  const token = `staging-release-owner-${"a".repeat(43)}`,
    hash = createHash("sha256").update(token).digest("hex");
  await db
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('test-owner','18633264','owner','2026-10-01T00:00:00.000Z',0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO points_sessions VALUES(?, 'test-owner', '2027-01-01T00:00:00.000Z')",
    )
    .bind(hash)
    .run();
  for (const project of projects) {
    const text = JSON.stringify(project),
      digest = createHash("sha256").update(text).digest("hex");
    await db
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'fixture','2026-10-01T00:00:00.000Z')",
      )
      .bind(project.id, text, digest)
      .run();
    await db
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')",
      )
      .bind(project.id, project.status, text, digest)
      .run();
  }
  for (const [i, plan] of plans.entries()) {
    const project = projects[i],
      worker = await runtime.getWorker(`caller-${i}`);
    const body = {
      network: plan.network,
      manifestSha256: createHash("sha256")
        .update(JSON.stringify(project))
        .digest("hex"),
    };
    const request = async (
      changes = {},
      origin = "https://staging.slop.cash",
      signedIn = true,
    ) =>
      worker.fetch(
        `https://staging.slop.cash/api/v1/payments/projects/${project.id}/monthly/2026-11/reserve-release`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            ...(signedIn ? { cookie: `__Host-slop_points=${token}` } : {}),
          },
          body: JSON.stringify({ ...body, ...changes }),
        },
      );
    const foreign = await request({}, "https://slop.cash");
    // Finish native response bodies before assertions can dispose the runtime.
    const foreignBody = await foreign.json();
    assert.equal(foreign.status, 403);
    assert.equal(
      foreign.headers.get("x-fixture-transport-origin"),
      "https://staging.slop.cash",
    );
    assert.deepEqual(foreignBody, { error: "origin_forbidden" });
    const anonymous = await request({}, "https://staging.slop.cash", false);
    const anonymousBody = await anonymous.text();
    assert.equal(
      anonymous.status,
      401,
      `anonymous request from ${anonymous.headers.get("x-fixture-transport-origin")}: ${anonymousBody}`,
    );
    const injectedAmount = await request({ amount: "1" });
    await injectedAmount.text();
    assert.equal(injectedAmount.status, 400);
    const staleRevision = await request({ manifestSha256: "0".repeat(64) });
    await staleRevision.text();
    assert.equal(staleRevision.status, 409);
    const held = await request();
    const heldBody = await held.json();
    assert.equal(held.status, 200);
    assert.deepEqual(heldBody, {
      status: "held",
      reason: "allocation-unavailable",
    });
  }
  assert.equal(outbound, 0);
  console.log(
    "PASS: all four generated staging MonthlyReserveRelease bindings reached the actual owner handler, native D1 and test-stack Durable Object; missing allocation held without keys or external calls; foreign-origin, anonymous, injected-amount and stale-revision requests refused.",
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
