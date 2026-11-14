import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  pointProtectionQuery,
  protectedPointAwardSql,
} from "./points-protection-sql";

function database() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE monthly_payment_runs(project_id TEXT,period TEXT);
    CREATE TABLE monthly_allocation_changes(project_id TEXT,period TEXT);
    CREATE TABLE payment_direct_transfers(project_id TEXT,contribution_month TEXT);
    CREATE TABLE payment_obligations(project_id TEXT,network TEXT,vault TEXT,source_digest TEXT);
    CREATE TABLE monthly_payment_obligations(project_id TEXT,network TEXT,vault TEXT,source_digest TEXT);
  `);
  return db;
}

const scopes = [
  { projectId: "eliza", period: "2026-10" },
  { projectId: "eliza", period: "2026-11" },
  { projectId: "other", period: "2026-10" },
];

for (const table of [
  "monthly_payment_runs",
  "monthly_allocation_changes",
  "payment_direct_transfers",
]) {
  test(`${table} protects only the matching project and contribution period`, () => {
    const db = database();
    try {
      db.exec(`INSERT INTO ${table} VALUES ('eliza','2026-10')`);
      const rows = db.query(pointProtectionQuery(scopes)).all() as Array<{
        project_id: string;
        period: string;
        protected: number;
      }>;
      expect(rows.map((row) => row.protected)).toEqual([1, 0, 0]);
      for (const row of rows) {
        const payload = JSON.stringify({
          award: {
            projectId: row.project_id,
            occurredAt: `${row.period}-01T00:00:00.000Z`,
          },
        });
        const actual = db
          .query(
            `SELECT ${protectedPointAwardSql("r.payload")} AS protected FROM (SELECT ? AS payload) r`,
          )
          .get(payload) as { protected: number };
        expect(actual.protected).toBe(row.protected);
      }
    } finally {
      db.close();
    }
  });
}

test("unmapped legacy obligations protect every month of their project", () => {
  const db = database();
  try {
    db.exec(
      "INSERT INTO payment_obligations VALUES ('eliza','base','vault','source')",
    );
    expect(
      db
        .query<{ protected: number }, []>(pointProtectionQuery(scopes))
        .all()
        .map((row) => row.protected),
    ).toEqual([1, 1, 0]);
    db.exec(
      "INSERT INTO monthly_payment_obligations VALUES ('eliza','base','vault','source')",
    );
    expect(
      db
        .query<{ protected: number }, []>(pointProtectionQuery(scopes))
        .all()
        .map((row) => row.protected),
    ).toEqual([0, 0, 0]);
    db.exec("INSERT INTO monthly_payment_runs VALUES ('eliza','2026-10')");
    expect(
      db
        .query<{ protected: number }, []>(pointProtectionQuery(scopes))
        .all()
        .map((row) => row.protected),
    ).toEqual([1, 0, 0]);
  } finally {
    db.close();
  }
});

test("preflight handles empty, duplicate and quoted scopes without changing its selection", () => {
  const db = database();
  try {
    expect(db.query(pointProtectionQuery([])).all()).toEqual([]);
    expect(
      db.query(pointProtectionQuery([scopes[0], scopes[0]])).all(),
    ).toHaveLength(1);
    const quoted = "eliza'); DROP TABLE monthly_payment_runs; --";
    expect(
      db
        .query(pointProtectionQuery([{ projectId: quoted, period: "2026-10" }]))
        .get(),
    ).toEqual({ project_id: quoted, period: "2026-10", protected: 0 });
    expect(db.query("SELECT * FROM monthly_payment_runs").all()).toEqual([]);
  } finally {
    db.close();
  }
});

test("malformed scope and non-column SQL are refused", () => {
  expect(() =>
    pointProtectionQuery([{ projectId: "eliza", period: "2026-13" }]),
  ).toThrow();
  expect(() =>
    pointProtectionQuery([{ projectId: "bad\0id", period: "2026-10" }]),
  ).toThrow();
  expect(() => protectedPointAwardSql("r.payload) OR 1=1")).toThrow();
});
