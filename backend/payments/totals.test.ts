import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { handlePaymentsApi } from "./handler";
import { storeVaultSnapshot, type VaultTotals } from "./vault-snapshots";

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
  position = "12345",
) {
  sqlite
    .query(
      `INSERT INTO payment_chain_cursors (project_id,network,position,synced_at)
       VALUES(?,?,?,?)`,
    )
    .run(project, network, position, when);
}

interface TotalsBody {
  assets?: {
    network: string; assetAddress: string; assetDecimals: number;
    totalNetPaidBase: string; payoutFeesPaidBase: string;
    reservedNetBase: string; reservedFeeBase: string;
  }[];
  error?: string;
  network?: string | null;
  coverage?: { kind: string; completeThrough: string | null };
  syncedAt?: string | null;
}

function amountRow(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  id: string,
  project: string,
  options: { network?: string; asset?: string; vault?: string; decimals?: number; gross: string; fee: string; paid: boolean },
) {
  const digest = createHash("sha256").update(id).digest("hex");
  sqlite.query(`INSERT INTO payment_obligations
    (id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,
     gross_base,fee_base,source_digest,state,created_at,paid_transaction)
    VALUES(?,?, '123',?,'base',?,?,?,?,?,?,?, ?,?)`)
    .run(id, project, options.network ?? "base-mainnet", options.vault ?? vault,
      options.asset ?? asset, options.decimals ?? 6, options.gross, options.fee, digest,
      options.paid ? "paid" : "reserved", when, options.paid ? `0x${digest}` : null);
}

test("project totals keep exact paid and reserved amounts separate from another project's asset", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    const gross = "340282366920938463463374607431768211455";
    amountRow(sqlite, "sum-paid", "sum-project", { gross, fee: "2", paid: true });
    amountRow(sqlite, "sum-reserved", "sum-project", { gross: "101", fee: "3", paid: false });
    const otherAsset = `0x${"4".repeat(40)}`;
    amountRow(sqlite, "sum-other", "other-project", { gross: "9000000000", fee: "180000000", paid: true,
      asset: otherAsset, vault: `0x${"5".repeat(40)}`, decimals: 9 });
    const result = await totals(db, "sum-project");
    expect(result.status).toBe(200);
    expect(result.body.assets).toEqual([
      { network: "base-mainnet", assetAddress: asset, assetDecimals: 6,
        totalNetPaidBase: (BigInt(gross) - 2n).toString(), payoutFeesPaidBase: "2",
        reservedNetBase: "98", reservedFeeBase: "3" },
    ]);
    expect(result.body.coverage?.completeThrough).toBeNull();
    expect((await totals(db, "other-project")).body.assets).toEqual([
      { network: "base-mainnet", assetAddress: otherAsset, assetDecimals: 9,
        totalNetPaidBase: "8820000000", payoutFeesPaidBase: "180000000",
        reservedNetBase: "0", reservedFeeBase: "0" },
    ]);
  } finally { sqlite.close(); }
});

test("a cursor-only project returns known coverage and no invented amount rows", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    insertCursor(sqlite, "cursor-only", "base-mainnet", "200");
    const result = await totals(db, "cursor-only");
    expect(result.status).toBe(200);
    expect(result.body.assets).toEqual([]);
    expect(result.body.network).toBe("base-mainnet");
    expect(result.body.coverage?.completeThrough).toBe("200");
    expect(result.body.syncedAt).toBe(when);
  } finally { sqlite.close(); }
});

test("totals capture amount rows before a later cursor observation", async () => {
  const { db, sqlite } = sqliteD1();
  amountRow(sqlite, "race-1", "race-project", { gross: "10", fee: "2", paid: false });
  insertCursor(sqlite, "race-project", "base-mainnet", "100");
  let changed = false;
  const wrapper: typeof db = {
    ...db,
    prepare(sql) {
      const wrap = (statement: ReturnType<typeof db.prepare>): ReturnType<typeof db.prepare> => ({
        ...statement,
        bind: (...values) => wrap(statement.bind(...values)),
        first: async <T>() => {
          const captured = await statement.first<T>();
          if (!changed && sql.includes("SELECT * FROM payment_obligations WHERE project_id=?")) {
            changed = true;
            sqlite.query("UPDATE payment_obligations SET state='paid',paid_transaction=? WHERE id='race-1'")
              .run(`0x${"6".repeat(64)}`);
            sqlite.query("UPDATE payment_chain_cursors SET position='200' WHERE project_id='race-project'").run();
          }
          return captured;
        },
      });
      return wrap(db.prepare(sql));
    },
  };
  try {
    const result = await totals(wrapper, "race-project");
    expect(changed).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body.assets?.[0]).toMatchObject({ totalNetPaidBase: "0", reservedNetBase: "8" });
    expect(result.body.coverage?.completeThrough).toBe("200");
    const later = await totals(db, "race-project");
    expect(later.body.assets?.[0]).toMatchObject({ totalNetPaidBase: "8", reservedNetBase: "0" });
  } finally { sqlite.close(); }
});

test("a failed cursor read returns no captured amount prefix or private error", async () => {
  const { db, sqlite } = sqliteD1();
  amountRow(sqlite, "read-failure", "failed-project", { gross: "10", fee: "2", paid: true });
  const wrapper: typeof db = {
    ...db,
    prepare(sql) {
      if (sql.includes("FROM payment_chain_cursors")) throw new Error("private database connection detail");
      return db.prepare(sql);
    },
  };
  try {
    const result = await totals(wrapper, "failed-project");
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: "payments_unavailable" });
  } finally { sqlite.close(); }
});

const snapshotInput = (network = "base-mainnet"): VaultTotals => ({
  network, vault, asset, decimals: 6, blockNumber: "1000", blockTime: "2020-01-01T00:00:00.000Z",
  totalDeposited: "100", totalPaid: "10", totalPayoutFees: "2", totalGrossWithdrawn: "0",
  totalWithdrawalFees: "0", freeBalance: null, reservedPrincipal: "20", reservedFees: "1",
  accruedFees: "2", reserved: null,
});
const publicVaultUrl = "https://slop.cash/api/v1/payments/projects/public-vault/vault";

test("public vault returns retained stale observations with current servedAt", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    await storeVaultSnapshot(db, { projectId: "public-vault", network: "base-mainnet", chain: "base", vault, asset },
      snapshotInput(), "2020-01-01T00:05:00.000Z");
    const response = await handlePaymentsApi(new Request(publicVaultUrl), { db, now: () => new Date(when) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    const body = await response.json();
    expect(body.servedAt).toBe(when);
    expect(body.staleAfterMs).toBe(1_800_000);
    expect(body.snapshots[0]).toMatchObject({ observedAt: "2020-01-01T00:05:00.000Z", freeBalance: null, totalPaid: "10" });
  } finally { sqlite.close(); }
});

test("public vault cache retains original servedAt until a different key is built", async () => {
  const { db, sqlite } = sqliteD1();
  const entries = new Map<string, Response>();
  const edgeCache = {
    match: async (request: Request) => entries.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => { entries.set(request.url, response.clone()); },
    delete: async (request: Request) => entries.delete(request.url),
  };
  try {
    await storeVaultSnapshot(db, { projectId: "public-vault", network: "base-mainnet", chain: "base", vault, asset },
      snapshotInput(), "2020-01-01T00:05:00.000Z");
    const first = await handlePaymentsApi(new Request(publicVaultUrl), { db, edgeCache, now: () => new Date(when) });
    const firstBody = await first.json();
    sqlite.query("DELETE FROM vault_snapshots").run();
    const later = "2026-12-05T13:00:00.000Z";
    const hit = await handlePaymentsApi(new Request(publicVaultUrl), { db, edgeCache, now: () => new Date(later) });
    expect(hit.headers.get("x-slop-cache")).toBe("hit");
    expect(await hit.json()).toEqual(firstBody);
    const differentKey = await handlePaymentsApi(new Request(`${publicVaultUrl}?refresh=1`), { db, edgeCache, now: () => new Date(later) });
    expect(differentKey.headers.get("x-slop-cache")).toBe("miss");
    expect(await differentKey.json()).toMatchObject({ snapshots: [], servedAt: later });
  } finally { sqlite.close(); }
});

test("cache read and write failures preserve a successful public vault response", async () => {
  const { db, sqlite } = sqliteD1();
  const edgeCache = {
    match: async (): Promise<Response | undefined> => { throw new Error("cache read failed"); },
    put: async () => { throw new Error("cache write failed"); },
    delete: async () => false,
  };
  try {
    const response = await handlePaymentsApi(new Request(publicVaultUrl), { db, edgeCache, now: () => new Date(when) });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-slop-cache")).toBe("miss");
    expect(await response.json()).toMatchObject({ snapshots: [], servedAt: when });
  } finally { sqlite.close(); }
});

test("staging and production vault cache keys keep their own network projections", async () => {
  const { db, sqlite } = sqliteD1();
  const entries = new Map<string, Response>();
  const edgeCache = {
    match: async (request: Request) => entries.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => { entries.set(request.url, response.clone()); },
    delete: async (request: Request) => entries.delete(request.url),
  };
  try {
    await storeVaultSnapshot(db, { projectId: "public-vault", network: "base-sepolia", chain: "base", vault, asset },
      snapshotInput("base-sepolia"), "2020-01-01T00:05:00.000Z");
    const staging = await handlePaymentsApi(new Request(publicVaultUrl.replace("https://slop.cash", "https://staging.slop.cash")),
      { db, edgeCache, tier: "staging" });
    expect((await staging.json()).snapshots).toHaveLength(1);
    const production = await handlePaymentsApi(new Request(publicVaultUrl), { db, edgeCache });
    expect(production.headers.get("x-slop-cache")).toBe("miss");
    expect((await production.json()).snapshots).toEqual([]);
    expect(entries.size).toBe(2);
  } finally { sqlite.close(); }
});

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

// Both insertion orders: the result must follow the network, never the row order.
for (const order of [
  ["solana-devnet", "solana-mainnet"],
  ["solana-mainnet", "solana-devnet"],
] as const) {
  test(`project totals report a production cursor beside a testnet cursor that sorts first (${order.join(" then ")})`, async () => {
    const { db, sqlite } = sqliteD1();
    const database = db as unknown as D1TransactionalDatabase;
    // A Solana project scanned on devnet and on mainnet keeps both cursors;
    // "solana-devnet" sorts before "solana-mainnet" in the cursor key.
    const blocks = { "solana-devnet": "111", "solana-mainnet": "222" } as const;
    for (const network of order)
      insertCursor(sqlite, "project-solana", network, blocks[network]);

    const production = await totals(database, "project-solana");
    expect(production.status).toBe(200);
    expect(production.body.network).toBe("solana-mainnet");
    expect(production.body.coverage).toEqual({
      kind: "finalized-payment-events",
      completeThrough: "222",
    });
    expect(production.body.syncedAt).toBe(when);
  });
}
