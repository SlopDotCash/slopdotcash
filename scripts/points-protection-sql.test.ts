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
    CREATE TABLE payment_obligations(id TEXT PRIMARY KEY,project_id TEXT,network TEXT,vault TEXT,source_digest TEXT,state TEXT NOT NULL DEFAULT 'reserved',paid_transaction TEXT);
    CREATE TABLE payment_events(network TEXT,transaction_id TEXT,event_index INTEGER,kind TEXT,obligation_id TEXT,evidence_json TEXT);
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
      "INSERT INTO payment_obligations (project_id,network,vault,source_digest) VALUES ('eliza','base','vault','source')",
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

test("only the reconciled non-reward Base qualification leaves unpaid Points eligible", () => {
  const db = database();
  try {
    const id =
      "0xe63ed9a7de8b38d1e847c4d850c7cb08d15ca429615c933eaefd9683b6367c4c";
    const vault = "0x6c1297c3b96a00347cb501f572cb5811c2a8ed36";
    const source =
      "991cdcc980c86dee602eccb30c79290a51a67f4569b2292efad7211d62086ee3";
    const paidTx =
      "0x4b9290966d9bacbe77d0e936ccb749cc8c0b9622331bf8f4a42b965c1fa704d8";
    const insert = db.query(
      "INSERT INTO payment_obligations VALUES (?,'slopdotcash',?,?,?,?,?)",
    );
    const preflight = db.query<{ protected: number }, []>(
      pointProtectionQuery([{ projectId: "slopdotcash", period: "2026-10" }]),
    );
    const importGuard = db.query<{ protected: number }, [string]>(
      `SELECT ${protectedPointAwardSql("r.payload")} AS protected FROM (SELECT ? AS payload) r`,
    );
    const award = JSON.stringify({
      award: {
        projectId: "slopdotcash",
        occurredAt: "2026-10-01T00:00:00.000Z",
      },
    });
    insert.run(id, "base-mainnet", vault, source, "paid", paidTx);
    expect(preflight.get()?.protected).toBe(1);
    expect(importGuard.get(award)?.protected).toBe(1);
    const insertEvidence = db.query(
      "INSERT INTO payment_events VALUES ('base-mainnet',?,982,'paid',?,?)",
    );
    insertEvidence.run(paidTx, id, '{"projectId":"other"}');
    expect(preflight.get()?.protected).toBe(1);
    expect(importGuard.get(award)?.protected).toBe(1);
    db.exec("DELETE FROM payment_events");
    insertEvidence.run(paidTx, id, '{"projectId":"slopdotcash"}');
    expect(preflight.get()?.protected).toBe(0);
    expect(importGuard.get(award)?.protected).toBe(0);

    for (const row of [
      [id, "base-mainnet", vault, source, "reserved", null],
      [id, "base-mainnet", vault, source, "paid", null],
      [id, "base-mainnet", vault, source, "paid", "other-transaction"],
      [id, "base-mainnet", vault, "other-source", "paid", paidTx],
      [id, "base-mainnet", "other-vault", source, "paid", paidTx],
      [id, "other-network", vault, source, "paid", paidTx],
      ["other-id", "base-mainnet", vault, source, "paid", paidTx],
    ] as const) {
      db.exec("DELETE FROM payment_obligations");
      insert.run(...row);
      expect(preflight.get()?.protected).toBe(1);
      expect(importGuard.get(award)?.protected).toBe(1);
    }

    db.exec("DELETE FROM payment_obligations");
    insert.run(id, "base-mainnet", vault, source, "paid", paidTx);
    insert.run(
      "other-id",
      "base-mainnet",
      vault,
      "earned-award",
      "reserved",
      null,
    );
    expect(preflight.get()?.protected).toBe(1);
    expect(importGuard.get(award)?.protected).toBe(1);

    db.exec("DELETE FROM payment_obligations WHERE id='other-id'");
    db.exec(
      "INSERT INTO monthly_payment_runs VALUES ('slopdotcash','2026-10')",
    );
    expect(preflight.get()?.protected).toBe(1);
    expect(importGuard.get(award)?.protected).toBe(1);
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
