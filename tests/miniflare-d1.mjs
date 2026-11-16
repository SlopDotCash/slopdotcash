/**
 * Native Miniflare D1 harness for workflow checks. It applies every
 * repository migration in name order, one batch per file, and can bundle a
 * synthetic Worker entry that imports the real handler under test.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { childEnvironment } from "../scripts/child-environment.mjs";

const migrations = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Applies every repository migration to a native D1 binding. */
export async function applyRepositoryMigrations(db) {
  for (const name of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.batch(
      splitSqlQuery(await readFile(join(migrations, name), "utf8")).map((sql) =>
        db.prepare(sql),
      ),
    );
}

/**
 * Bundles `entrySource` for the browser target and serves it from Miniflare.
 * `d1` names the `DB` binding, which receives every repository migration.
 * `outbound` and `serviceBindings` pass through unchanged. `dispose` stops
 * the runtime and removes the temporary bundle folder.
 */
export async function startHandlerWorker({
  entrySource,
  d1,
  outbound,
  serviceBindings,
}) {
  const directory = await mkdtemp(join(tmpdir(), "slop-handler-worker-"));
  let runtime;
  const dispose = async () => {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const entry = join(directory, "worker.ts");
    const output = join(directory, "worker.mjs");
    await writeFile(entry, entrySource);
    const build = spawnSync(
      "bun",
      [
        "--no-env-file",
        "build",
        entry,
        "--target=browser",
        "--outfile",
        output,
      ],
      { encoding: "utf8", env: childEnvironment(), timeout: 30_000 },
    );
    assert.equal(build.status, 0, build.stderr);
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        host: "127.0.0.1",
        port: 0,
        modules: true,
        compatibilityDate: "2026-09-14",
        script: await readFile(output, "utf8"),
        ...(d1 === undefined ? {} : { d1Databases: { DB: d1 } }),
        ...(serviceBindings === undefined ? {} : { serviceBindings }),
        ...(outbound === undefined ? {} : { outboundService: outbound }),
      }),
    );
    const db = d1 === undefined ? undefined : await runtime.getD1Database("DB");
    if (db) await applyRepositoryMigrations(db);
    return { runtime, db, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
