/** Actual local Workerd/D1/R2/queue run of the disposable hosted entry. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { prepareFlagsEntry } from "./build";
import { flagsSchema } from "./qualification";

const directory = await mkdtemp(join(tmpdir(), "slop-flags-qualification-"));
let runtime: Miniflare | undefined;
let outboundRequests = 0;
try {
  const root = process.cwd();
  const { entry, migrations } = await prepareFlagsEntry(root, directory);
  const output = join(directory, "worker.mjs");
  execFileSync(
    "bun",
    [
      "--no-env-file",
      "build",
      entry,
      "--target=node",
      `--outfile=${output}`,
      "--external=node:crypto",
    ],
    { stdio: "pipe" },
  );
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: "flag-qualification",
      modules: true,
      script: await readFile(output, "utf8"),
      compatibilityDate: "2026-07-30",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { QUALIFICATION_RUN: "slop-vet-flags-12345-1" },
      d1Databases: ["EVIDENCE_DATABASE"],
      r2Buckets: ["EVIDENCE_SOURCE"],
      queueProducers: { WORK: { queueName: "flags" } },
      queueConsumers: {
        flags: { maxBatchSize: 1, maxBatchTimeout: 0, maxRetries: 0 },
      },
      outboundService: () => {
        outboundRequests++;
        return new Response(null, { status: 599 });
      },
    }),
  );
  await runtime.ready;
  const db = await runtime.getD1Database("EVIDENCE_DATABASE");
  for (const sql of splitSqlQuery(flagsSchema)) await db.prepare(sql).run();
  for (const path of migrations)
    for (const sql of splitSqlQuery(
      await readFile(join(root, "migrations", path), "utf8"),
    ))
      await db.prepare(sql).run();
  assert.equal(
    (await runtime.dispatchFetch("https://qualification.invalid/")).status,
    404,
  );
  const queue = await runtime.getQueueProducer("WORK");
  async function send(action: string, ordinal: number) {
    const delivery = `${action}-${ordinal}`;
    await queue.send({
      qualification: "slop-vet-flags-12345-1",
      action,
      delivery,
    });
    const until = Date.now() + 180000;
    for (;;) {
      const error = await db
        .prepare("SELECT result FROM qualification_results WHERE phase=?")
        .bind(`failed-${action}`)
        .first<{ result: string }>();
      assert.equal(error, null, error?.result);
      if (
        await db
          .prepare("SELECT id FROM qualification_deliveries WHERE id=?")
          .bind(`command:${delivery}`)
          .first()
      )
        break;
      assert.ok(Date.now() < until, "Fixture command timed out");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await send("flags", 1);
  const first = await db
    .prepare("SELECT result FROM qualification_results WHERE phase='flags'")
    .first<{ result: string }>();
  assert.ok(first);
  await send("flags", 2);
  const repeated = await db
    .prepare("SELECT result FROM qualification_results WHERE phase='flags'")
    .first<{ result: string }>();
  assert.equal(repeated?.result, first.result);
  const counts = await db
    .prepare(
      "SELECT (SELECT count(*) FROM projects) projects,(SELECT count(*) FROM project_flags) flags,(SELECT count(*) FROM vetting_assessments) assessments,(SELECT count(*) FROM project_enforcements) enforcements,(SELECT count(*) FROM points_sessions) sessions,(SELECT count(*) FROM notifications) notifications,(SELECT count(*) FROM vetting_evidence_objects) evidenceObjects",
    )
    .first();
  assert.deepEqual(counts, JSON.parse(first.result).counts);
  await send("empty", 3);
  const source = (await runtime.getR2Bucket("EVIDENCE_SOURCE")) as unknown as {
    list(): Promise<{ objects: unknown[] }>;
  };
  assert.equal((await source.list()).objects.length, 0);
  assert.equal(outboundRequests, 0, "Fixture reached network transport");
  console.log(
    JSON.stringify({
      ...JSON.parse(first.result),
      replayUnchanged: true,
      publicRoute: 404,
      externalNetworkRequests: outboundRequests,
      cleanup: true,
    }),
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
