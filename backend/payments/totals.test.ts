import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { handlePaymentsApi } from "./handler";

const when = "2026-12-05T12:00:00.000Z";
const asset = `0x${"2".repeat(40)}`;
const vault = `0x${"3".repeat(40)}`;

function insertObligation(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  project: string,
  network: string,
) {
  const id = `${project}-award`;
  const digest = project
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0)
    .toString(16)
    .padStart(64, "0");
  sqlite
    .query(
      `INSERT INTO payment_obligations
      (id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,
       gross_base,fee_base,source_digest,state,created_at,paid_transaction)
      VALUES(?,?, '123',?,'base',?,?,6,'10000','200',?,'paid',?,?)`,
    )
    .run(id, project, network, vault, asset, digest, when, `0x${digest}`);
}

function insertCursor(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  project: string,
  network: string,
) {
  sqlite
    .query(
      `INSERT INTO payment_chain_cursors (project_id,network,position,synced_at)
       VALUES(?,?,?,?)`,
    )
    .run(project, network, "12345", when);
}

interface TotalsBody {
  assets?: { network: string }[];
  error?: string;
  network?: string | null;
}

async function totals(
  database: D1TransactionalDatabase,
  project: string,
  tier?: "staging" | "production",
) {
  const origin =
    tier === "staging" ? "https://staging.slop.cash" : "https://slop.cash";
  const response = await handlePaymentsApi(
    new Request(`${origin}/api/v1/payments/projects/${project}/totals`),
    tier ? { db: database, tier } : { db: database },
  );
  return {
    status: response.status,
    body: (await response.json()) as TotalsBody,
  };
}

const networks = (body: TotalsBody): string[] =>
  (body.assets ?? []).map((asset) => asset.network);

test("project totals exclude testnet networks in production but keep them in staging", async () => {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  insertObligation(sqlite, "project-main", "base-mainnet");
  insertObligation(sqlite, "project-test", "base-sepolia");

  const mainnet = await totals(database, "project-main");
  expect(mainnet.status).toBe(200);
  expect(networks(mainnet.body)).toEqual(["base-mainnet"]);

  const testnet = await totals(database, "project-test");
  // Production hides testnet award totals: with no reportable mainnet rows
  // and no cursor, the project reads as not indexed, same as a project
  // with no obligations at all.
  expect(testnet.status).toBe(503);
  expect(testnet.body).toEqual({ error: "project_payments_not_indexed" });

  const staging = await totals(database, "project-test", "staging");
  expect(staging.status).toBe(200);
  expect(networks(staging.body)).toContain("base-sepolia");
});

test("project totals ignore a testnet chain cursor in production but keep it in staging", async () => {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  insertObligation(sqlite, "project-test", "base-sepolia");
  insertCursor(sqlite, "project-test", "base-sepolia");

  // The stored testnet cursor must not keep a testnet-only project reportable
  // in production: no amount rows and no usable cursor reads as not indexed.
  const production = await totals(database, "project-test");
  expect(production.status).toBe(503);
  expect(production.body).toEqual({ error: "project_payments_not_indexed" });

  const staging = await totals(database, "project-test", "staging");
  expect(staging.status).toBe(200);
  expect(staging.body.network).toBe("base-sepolia");
  expect(networks(staging.body)).toContain("base-sepolia");
});
