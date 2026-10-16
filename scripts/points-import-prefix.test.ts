import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { PointsJournal } from "../src/lib/points";
import { pointsSql } from "./generate-points";

test("points publication retains the exact permanent history prefix", () => {
  const checkpoint = JSON.parse(
    readFileSync("data/points/history.json", "utf8"),
  ) as PointsJournal;
  const first = { ...checkpoint, revisions: checkpoint.revisions.slice(0, 2) };
  const next = {
    ...checkpoint,
    generatedAt: new Date(
      Date.parse(checkpoint.generatedAt) + 1000,
    ).toISOString(),
    revisions: checkpoint.revisions.slice(0, 3),
  };
  const reordered = {
    ...next,
    revisions: [next.revisions[1], next.revisions[0], next.revisions[2]],
  };
  const db = new Database(":memory:");
  for (const path of readdirSync("migrations")
    .filter((path) => path.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${path}`, "utf8"));
  const apply = (journal: PointsJournal) => {
    db.transaction(() => {
      for (const statement of pointsSql(journal).trim().split("\n"))
        db.exec(statement);
    })();
  };
  const rows = () =>
    db.query("SELECT id,payload FROM points_revisions ORDER BY rowid").all();
  try {
    apply(first);
    const permanent = rows();
    // Each candidate is a valid journal; only its relationship to D1 differs.
    expect(() => apply(reordered)).toThrow("divergent points batch");
    expect(rows()).toEqual(permanent);
    expect(db.query("SELECT COUNT(*) AS n FROM points_batches").get()).toEqual({
      n: 1,
    });
    apply(next);
    expect(rows().map((row) => (row as { id: string }).id)).toEqual(
      next.revisions.map((revision) => revision.id),
    );
    expect(() => apply(next)).not.toThrow();
    expect(db.query("SELECT COUNT(*) AS n FROM points_staging").get()).toEqual({
      n: 0,
    });
  } finally {
    db.close();
  }
});
