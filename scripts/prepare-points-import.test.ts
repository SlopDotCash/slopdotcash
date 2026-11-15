import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointsIndex,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import { pointShardRows, pointsSql } from "./generate-points";
import { preparePointsImport } from "./prepare-points-import";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const hash = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixture(journal: PointsJournal) {
  const root = await mkdtemp(join(tmpdir(), "slop-points-import-"));
  directories.push(root);
  await mkdir(join(root, "data/points"), { recursive: true });
  const index: PointsIndex = {
    schemaVersion: "1",
    ruleVersion: journal.ruleVersion,
    generatedAt: journal.generatedAt,
    coverage: journal.coverage,
    revisionCount: journal.revisions.length,
    shards: [],
  };
  for (const [i, rows] of pointShardRows(journal).entries()) {
    const bytes = `${JSON.stringify(rows)}\n`;
    await writeFile(join(root, `data/points/${i.toString(16)}.json`), bytes);
    index.shards.push({
      path: `/data/points/${i.toString(16)}.json`,
      sha256: hash(bytes),
      count: rows.length,
    });
  }
  await writeFile(join(root, "data/points.json"), JSON.stringify(index));
  return { root, sql: join(root, "import.sql") };
}
function journals() {
  const before = appendPointAwards(
    emptyPointsJournal("2026-11-13T00:00:00.000Z"),
    [
      {
        key: pointKey(
          "eliza",
          "actor_1234",
          "merged-pull-request",
          "source_1234",
        ),
        actor: { id: "actor_1234", login: "carrier" },
        projectId: "eliza",
        category: "merged-pull-request",
        sourceId: "source_1234",
        sourceUrl: "https://github.com/elizaOS/eliza/pull/1",
        workUnitId: "wu_eliza_pr_1",
        amount: 10,
        occurredAt: "2026-01-01T00:00:00.000Z",
        provisional: false,
      },
    ],
    "a".repeat(64),
    "slop-score-v1",
    "2026-11-13T00:00:00.000Z",
  );
  const after = appendPointAwards(
    before,
    [{ ...before.revisions[0].award, amount: 0 }],
    "b".repeat(64),
    "slop-score-v2",
    "2026-11-13T01:00:00.000Z",
  );
  return { before, after };
}

test("an older known SQL batch cannot publish after a newer correction", async () => {
  const { before, after } = journals();
  const f = await fixture(before);
  // SQL's known-batch replay is intentionally idempotent. Publication needs
  // this independent freshness guard even when the old SQL is still valid.
  expect(pointsSql(before)).toContain(
    "WHERE NOT EXISTS (SELECT 1 FROM points_batches",
  );
  await expect(
    preparePointsImport(f.root, f.sql, "https://slop.cash", async () => after),
  ).rejects.toThrow("prefix");
  await expect(readFile(f.sql)).rejects.toThrow();
});

test("a new candidate can retain the complete public prefix", async () => {
  const { before, after } = journals();
  const f = await fixture(after);
  await preparePointsImport(
    f.root,
    f.sql,
    "https://slop.cash",
    async () => before,
  );
  expect(await readFile(f.sql, "utf8")).toBe(pointsSql(after));
});

test("coverage-only updates cannot be dropped even with identical revisions", async () => {
  const { before } = journals();
  const current = {
    ...before,
    coverage: [
      {
        repository: "elizaOS/eliza",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
        digest: "c".repeat(64),
      },
    ],
  };
  const f = await fixture(before);
  await expect(
    preparePointsImport(
      f.root,
      f.sql,
      "https://slop.cash",
      async () => current,
    ),
  ).rejects.toThrow("coverage");
  await expect(readFile(f.sql)).rejects.toThrow();
});

test("current-state read failures and arbitrary origins refuse before writing SQL", async () => {
  const f = await fixture(journals().before);
  await expect(
    preparePointsImport(f.root, f.sql, "https://slop.cash", async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  await expect(
    preparePointsImport(f.root, f.sql, "https://slop.cash", async () => null),
  ).rejects.toThrow("unavailable");
  await expect(
    preparePointsImport(
      f.root,
      f.sql,
      "https://other.example",
      async () => journals().before,
    ),
  ).rejects.toThrow("production");
  await expect(readFile(f.sql)).rejects.toThrow();
});

test("local and staging preparation keeps its existing offline behavior", async () => {
  const { before } = journals();
  const f = await fixture(before);
  await preparePointsImport(f.root, f.sql, undefined, async () => {
    throw new Error("must not fetch");
  });
  expect(await readFile(f.sql, "utf8")).toBe(pointsSql(before));
});
