import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedJson, readBoundedText } from "../src/lib/browser-json";
import { loadEvaluatorAwardEvents } from "../src/lib/evaluator-awards";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import { payoutPointAwards } from "../src/lib/payout-points";
import {
  appendPointAwards,
  applyPointsSnapshot,
  assemblePoints,
  assertPointsJournal,
  awardForScore,
  latestPoints,
  type PointsIndex,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";
import { syncCycleIndex } from "./sync-cycle-index";

function hash(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
export async function loadPublishedPoints(
  bootstrap = false,
): Promise<PointsJournal | null> {
  let cursor: number | null = 0;
  let batch: string | undefined;
  let journal: PointsJournal | undefined;
  do {
    const url = new URL("https://slop.cash/api/v1/points/journal");
    url.searchParams.set("after", String(cursor));
    if (batch) url.searchParams.set("batch", batch);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/json" },
    });
    const value = (await readBoundedJson(
      response,
      8 * 1024 * 1024,
      "published points",
    )) as Record<string, unknown>;
    if (
      bootstrap &&
      cursor === 0 &&
      [404, 503].includes(response.status) &&
      ["points_not_published", "not_found"].includes(String(value.error))
    ) {
      const existing = await fetch("https://slop.cash/data/points.json", {
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
      await existing.body?.cancel();
      if (existing.status !== 404)
        throw new Error(
          "Refusing bootstrap: published points may already exist",
        );
      return null;
    }
    if (!response.ok)
      throw new Error(
        `Points history returned ${response.status}; refusing to discard history`,
      );
    if (
      typeof value.batch !== "string" ||
      !Array.isArray(value.revisions) ||
      !Number.isSafeInteger(value.total) ||
      Number(value.total) > 250000
    )
      throw new Error("Invalid points history page");
    if (batch && batch !== value.batch)
      throw new Error("Points batch changed during pagination");
    batch = value.batch;
    journal ??= {
      schemaVersion: "1",
      ruleVersion: "slop-points-v1",
      generatedAt: value.generatedAt as string,
      coverage: value.coverage as PointsJournal["coverage"],
      revisions: [],
    };
    journal.revisions.push(...value.revisions);
    if (
      value.next !== null &&
      (!Number.isSafeInteger(value.next) ||
        Number(value.next) <= Number(cursor))
    )
      throw new Error("Invalid points history cursor");
    cursor = value.next as number | null;
    if (cursor === null && journal.revisions.length !== value.total)
      throw new Error("Incomplete points history");
  } while (cursor !== null);
  if (!journal) throw new Error("Missing points history");
  assertPointsJournal(journal);
  if (hash(JSON.stringify(journal)) !== batch)
    throw new Error("Points batch digest mismatch");
  // Scheduled refreshes have Pages-only authority. Retain their published journal
  // as well as the latest protected-release D1 checkpoint; neither may fork history.
  const indexResponse = await fetch("https://slop.cash/data/points.json", {
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (!indexResponse.ok)
    throw new Error("Published points projection unavailable");
  const index = (await readBoundedJson(
    indexResponse,
    1024 * 1024,
    "points index",
  )) as PointsIndex;
  if (!Array.isArray(index.shards) || index.shards.length !== 16)
    throw new Error("Invalid published points index");
  const parts = await Promise.all(
    index.shards.map(async (shard, i) => {
      if (shard.path !== `/data/points/${i.toString(16)}.json`)
        throw new Error("Invalid published points shard path");
      const response = await fetch(`https://slop.cash${shard.path}`, {
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Published points history unavailable");
      return readBoundedText(response, 8 * 1024 * 1024, "points shard");
    }),
  );
  return retainPublishedHistory(journal, assemblePoints(index, parts));
}
export function retainPublishedHistory(
  checkpoint: PointsJournal,
  published: PointsJournal,
): PointsJournal {
  assertPointsJournal(checkpoint);
  assertPointsJournal(published);
  const [earlier, later] =
    checkpoint.revisions.length > published.revisions.length
      ? [published, checkpoint]
      : [checkpoint, published];
  if (
    earlier.revisions.some(
      (revision, i) => later.revisions[i]?.id !== revision.id,
    )
  )
    throw new Error("Published points history diverged from its checkpoint");
  return later;
}
export function pointsSql(journal: PointsJournal): string {
  assertPointsJournal(journal);
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const digest = hash(JSON.stringify(journal));
  const statements = journal.revisions.map(
    (r, sequence) =>
      `INSERT INTO points_staging(batch_id,sequence,payload) VALUES(${quote(digest)},${sequence},${quote(JSON.stringify(r))}) ON CONFLICT(batch_id,sequence) DO NOTHING;`,
  );
  statements.push(
    `INSERT INTO points_batches(digest,generated_at,coverage,revision_count) VALUES(${quote(digest)},${quote(journal.generatedAt)},${quote(JSON.stringify(journal.coverage))},${journal.revisions.length}) ON CONFLICT(digest) DO NOTHING;`,
  );
  return statements.join("\n") + "\n";
}
async function archivePaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const e of entries) {
    if (e.isDirectory())
      paths.push(...(await archivePaths(join(directory, e.name))));
    else if (e.name === "source-snapshot.json")
      paths.push(join(directory, e.name));
  }
  return paths;
}
export async function generatePoints(
  options: { online?: boolean; bootstrap?: boolean } = {},
) {
  const history: unknown = JSON.parse(
    await readFile("data/points/history.json", "utf8"),
  );
  assertPointsJournal(history);
  let journal: PointsJournal = history;
  const published = options.online
    ? await loadPublishedPoints(options.bootstrap)
    : null;
  if (published) {
    // The checked-in history is an ancestor, never a second award source.
    const ids = new Set(published.revisions.map((r) => r.id));
    if (history.revisions.some((r) => !ids.has(r.id)))
      throw new Error(
        "Published points history diverges from checked-in backfill",
      );
    journal = published;
  }
  const now = new Date().toISOString();
  const snapshots = [];
  for (const path of [
    ...(await archivePaths("cycles")),
    "public/data/leaderboard.json",
  ]) {
    const bytes = await readFile(path, "utf8");
    const snapshot: unknown = JSON.parse(bytes);
    assertLeaderboardSnapshot(snapshot);
    snapshots.push({ snapshot, digest: hash(bytes) });
  }
  snapshots.sort((a, b) =>
    a.snapshot.generatedAt.localeCompare(b.snapshot.generatedAt),
  );
  // Replaying an older archive after a newer batch must not roll back corrections.
  const applied = new Set(journal.coverage.map((c) => c.digest));
  for (const { snapshot, digest } of snapshots) {
    if (!applied.has(digest))
      journal = applyPointsSnapshot(journal, snapshot, digest, now);
  }
  const cycles = await syncCycleIndex({
    checkOnly: true,
    online: options.online,
    generatedAt: now,
  });
  journal = appendPointAwards(
    journal,
    payoutPointAwards(cycles),
    hash(JSON.stringify(cycles)),
    "verified-payout-v1",
    now,
  );
  const evaluations = loadEvaluatorAwardEvents();
  const reviews = JSON.parse(
    await readFile("data/accepted-review-history.json", "utf8"),
  );
  const existingKeys = latestPoints(journal);
  const reviewed = [
    ...reviews.events.filter(
      (e: Parameters<typeof awardForScore>[0]) =>
        !existingKeys.has(awardForScore(e).key),
    ),
    ...evaluations,
  ];
  journal = appendPointAwards(
    journal,
    reviewed.map(awardForScore),
    hash(JSON.stringify(reviewed)),
    "slop-score-v2",
    now,
  );
  journal.generatedAt = now;
  assertPointsJournal(journal);
  await mkdir("public/data", { recursive: true });
  await mkdir("public/data/points", { recursive: true });
  const index: PointsIndex = {
    schemaVersion: "1",
    ruleVersion: journal.ruleVersion,
    generatedAt: journal.generatedAt,
    coverage: journal.coverage,
    revisionCount: journal.revisions.length,
    shards: [],
  };
  for (let i = 0; i < 16; i++) {
    const name = i.toString(16);
    const rows = journal.revisions
      .map((revision, sequence) => ({ sequence, revision }))
      .filter((r) => r.revision.award.key.startsWith(name));
    const bytes = JSON.stringify(rows) + "\n";
    if (Buffer.byteLength(bytes) > 8 * 1024 * 1024)
      throw new Error("Points shard exceeds size limit");
    await writeFile(`public/data/points/${name}.json`, bytes);
    index.shards.push({
      path: `/data/points/${name}.json`,
      sha256: hash(bytes),
      count: rows.length,
    });
  }
  await writeFile("public/data/points.json.tmp", JSON.stringify(index) + "\n");
  await rename("public/data/points.json.tmp", "public/data/points.json");
  await mkdir(".points-build", { recursive: true });
  await writeFile(".points-build/import.sql", pointsSql(journal));
  const members = pointMembers(journal);
  await writeFile(
    ".points-build/report.json",
    JSON.stringify(
      {
        generatedAt: now,
        revisionCount: journal.revisions.length,
        contributors: members.length,
        points: members.reduce((sum, m) => sum + m.total, 0),
        coverage: journal.coverage,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[points] ${members.length} contributors; ${journal.revisions.length} historical revisions`,
  );
  return journal;
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((a) => !["--online", "--bootstrap"].includes(a)))
    throw new Error("Usage: generate-points.ts [--online] [--bootstrap]");
  await generatePoints({
    online: args.includes("--online") || process.env.SLOP_POINTS_ONLINE === "1",
    bootstrap:
      args.includes("--bootstrap") || process.env.SLOP_POINTS_BOOTSTRAP === "1",
  });
}
