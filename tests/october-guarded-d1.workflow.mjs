/** Runs the emitted SQL on a disposable local Workerd D1 binding. */
import { rejects, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startHandlerWorker } from "./miniflare-d1.mjs";

const { sql, reviews, createdAt } = JSON.parse(readFileSync(0, "utf8"));
const runtime = await startHandlerWorker({
  entrySource: "export default { fetch: () => new Response('fixture') };",
  d1: "october-monthly-proposal-fixture",
});
try {
  const db = runtime.db;
  for (const { monthlyBase: base, manifest, revision } of reviews.projects) {
    await db
      .prepare(`INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at)
        VALUES(?,?,?,?,?,?)`)
      .bind(
        base.projectId,
        revision,
        manifest,
        base.manifestSha256,
        "synthetic native fixture",
        createdAt,
      )
      .run();
    await db
      .prepare(`INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at)
        VALUES(?,'active',?,?,?,?,?)`)
      .bind(
        base.projectId,
        revision,
        manifest,
        base.manifestSha256,
        createdAt,
        createdAt,
      )
      .run();
  }
  await db
    .prepare(
      "INSERT INTO points_batches(digest,generated_at,coverage,revision_count) VALUES(?,?,'[]',0)",
    )
    .bind(reviews.evidence.pointsBatch, createdAt)
    .run();
  await db
    .prepare(`CREATE TRIGGER synthetic_native_refusal BEFORE INSERT ON monthly_reward_base_rows
      WHEN NEW.project_id='slopdotcash' AND NEW.github_user_id='7102'
      BEGIN SELECT RAISE(IGNORE); END`)
    .run();
  const commands = sql.trimEnd().split("\n");
  const run = () =>
    db.batch(commands.map((statement) => db.prepare(statement)));
  const baseCount = () =>
    db
      .prepare("SELECT COUNT(*) AS count FROM monthly_reward_bases")
      .first("count");
  const rowCount = () =>
    db
      .prepare("SELECT COUNT(*) AS count FROM monthly_reward_base_rows")
      .first("count");
  await rejects(run(), /NOT NULL constraint failed|D1_ERROR/u);
  strictEqual(await baseCount(), 0);
  strictEqual(await rowCount(), 0);
  await db.prepare("DROP TRIGGER synthetic_native_refusal").run();
  await run();
  strictEqual(await baseCount(), 2);
  strictEqual(await rowCount(), 4);
  console.log("October D1 rollback and complete import passed");
} finally {
  await runtime.dispose();
}
