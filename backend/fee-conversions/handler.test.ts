import { describe, expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { FEE_CONVERSIONS_PATH, handleFeeConversionsApi } from "./handler";

const WALLET = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";
const TOKEN = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function seeded() {
  const { db, sqlite } = sqliteD1();
  const insert = (
    id: string,
    amountIn: string,
    amountOut: string,
    txId: string,
  ) =>
    sqlite.exec(`INSERT INTO fee_conversions
      (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, route,
       quote_amount_out, min_amount_out, quote_value_micro, tx_id, raw_tx, expires_at,
       amount_out, state, created_at, updated_at, submitted_at, finalized_at)
      VALUES ('${id}', 'run-00001', 'base', 'live', '${WALLET}', '${TOKEN}', '${USDC}',
       '${amountIn}', 'kyberswap', '${amountOut}', '${amountOut}', 1, '${txId}', '0xsignedbytes', 1,
       '${amountOut}', 'finalized', '${new Date().toISOString()}', 'now', 'now', 'now')`);
  // Two 18-decimal amounts whose sum exceeds a signed 64-bit integer.
  insert("conv-0001", "9000000000000000000000", "7000000", "0xaa");
  insert("conv-0002", "9000000000000000000001", "7000001", "0xbb");
  return db;
}

const request = (method = "GET") =>
  new Request(`https://slop.cash${FEE_CONVERSIONS_PATH}`, { method });

describe("admin fee-conversions route", () => {
  test("signed-out and non-admin sessions are refused", async () => {
    const db = seeded();
    const signedOut = await handleFeeConversionsApi(request(), {
      db,
      adminGithubIds: new Set(["1"]),
      sessionActor: async () => null,
    });
    const member = await handleFeeConversionsApi(request(), {
      db,
      adminGithubIds: new Set(["1"]),
      sessionActor: async () => ({ githubId: "2" }),
    });
    expect(signedOut?.status).toBe(401);
    expect(member?.status).toBe(403);
  });

  test("admins get recent records and exact per-token totals without signed bytes", async () => {
    const response = await handleFeeConversionsApi(request(), {
      db: seeded(),
      adminGithubIds: new Set(["1"]),
      sessionActor: async () => ({ githubId: "1" }),
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    const text = await (response as Response).text();
    expect(text).not.toContain("0xsignedbytes");
    const body = JSON.parse(text);
    expect(body.recent.map((row: { id: string }) => row.id)).toEqual([
      "conv-0002",
      "conv-0001",
    ]);
    expect(body.totals).toEqual([
      {
        network: "base",
        token: TOKEN,
        targetToken: USDC,
        conversions: 2,
        amountIn: "18000000000000000000001",
        amountOut: "14000001",
      },
    ]);
    expect(body.last24Hours).toEqual([
      { network: "base", mode: "live", state: "finalized", count: 2 },
    ]);
    // Robinhood retains received fees without converting them to another asset.
    const robinhood = body.routes.find(
      (route: { network: string }) => route.network === "robinhood",
    );
    expect(robinhood).toEqual({
      network: "robinhood",
      targetToken: null,
      status: "not_converted",
    });
    expect(
      body.routes.find(
        (route: { network: string }) => route.network === "base",
      ),
    ).toEqual({ network: "base", targetToken: USDC, status: "usdc" });
    expect(body.buyback).toEqual({ recent: [], totals: [] });
  });

  test("the buyback ledger shows each deposit's outcome and exact totals, without signed bytes", async () => {
    const { db, sqlite } = sqliteD1();
    const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
    const SLOP = "0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae";
    const order = (n: number) => `0x${String(n).repeat(64)}`;
    const row = (
      id: string,
      kind: string,
      network: string,
      token: string,
      target: string,
      amountIn: string,
      amountOut: string,
      quote: string,
    ) =>
      sqlite.exec(`INSERT INTO fee_conversions
        (id, kind, run_id, network, mode, fee_wallet, token, target_token, amount_in, route,
         min_amount_out, quote, tx_id, raw_tx, expires_at, amount_out, state, created_at,
         updated_at, submitted_at, finalized_at)
        VALUES ('${id}', '${kind}', 'run-00001', '${network}', 'live', '${WALLET}', '${token}',
         '${target}', '${amountIn}', ${kind === "burn" ? "NULL" : kind === "bridge" ? "'debridge'" : "'kyberswap'"},
         ${kind === "burn" ? "NULL" : "'1'"}, '${quote}', '0x${id}', '0xsignedbytes', ${kind === "buyback" ? "1" : "NULL"},
         '${amountOut}', 'finalized', '2026-11-11T00:00:0${id.at(-1)}.000Z', 'now', 'now', 'now')`);
    const terms = (n: number, take: string) =>
      JSON.stringify({ orderId: order(n), takeAmount: take, receiver: WALLET });
    row(
      "bridge-0001",
      "bridge",
      "base",
      USDC,
      USDG,
      "500000000",
      "500000000",
      terms(1, "498000000"),
    );
    row(
      "bridge-0002",
      "bridge",
      "base",
      USDC,
      USDG,
      "300000000",
      "300000000",
      terms(2, "299000000"),
    );
    row(
      "bridge-0003",
      "bridge",
      "base",
      USDC,
      USDG,
      "200000000",
      "200000000",
      terms(3, "199000000"),
    );
    row(
      "buy-000004",
      "buyback",
      "robinhood",
      USDG,
      SLOP,
      "498000000",
      "9000000000000000000001",
      "{}",
    );
    row(
      "burn-00005",
      "burn",
      "robinhood",
      SLOP,
      SLOP,
      "4500000000000000000000",
      "4500000000000000000000",
      "{}",
    );
    sqlite.exec(`INSERT INTO fee_converter_locks (network, run_id, expires_at) VALUES
      ('robinhood', 'run-00001', '2999-01-01T00:00:00.000Z'), ('base', 'run-00001', '2999-01-01T00:00:00.000Z')`);
    const outcome = (
      id: string,
      n: number,
      kind: string,
      token: string,
      amount: string,
      network: string,
    ) =>
      sqlite.exec(`INSERT INTO fee_bridge_outcomes (bridge_id, source_network, order_id, outcome, token,
         amount, evidence_network, evidence_block, evidence_block_hash, run_id, observed_at)
        VALUES ('${id}', 'base', '${order(n)}', '${kind}', '${token}', '${amount}', '${network}', 7,
         '0x${"ab".repeat(32)}', 'run-00001', '2026-11-11T00:00:00.000Z')`);
    outcome("bridge-0001", 1, "arrived", USDG, "498000000", "robinhood");
    outcome("bridge-0002", 2, "refunded", USDC, "300000000", "base");
    const response = await handleFeeConversionsApi(request(), {
      db,
      adminGithubIds: new Set(["1"]),
      sessionActor: async () => ({ githubId: "1" }),
    });
    const text = await (response as Response).text();
    expect(text).not.toContain("0xsignedbytes");
    const { buyback, recent, totals } = JSON.parse(text);
    // Buyback sends never appear as conversions or in conversion totals.
    expect(recent).toEqual([]);
    expect(totals).toEqual([]);
    expect(
      buyback.recent.map((entry: { id: string; outcome: string | null }) => [
        entry.id,
        entry.outcome,
      ]),
    ).toEqual([
      ["burn-00005", null],
      ["buy-000004", null],
      ["bridge-0003", null],
      ["bridge-0002", "refunded"],
      ["bridge-0001", "arrived"],
    ]);
    expect(buyback.totals).toEqual([
      {
        network: "base",
        kind: "bridge",
        token: USDC,
        sends: 3,
        amountIn: "1000000000",
        amountOut: "1000000000",
        inTransit: "200000000",
        refunded: "300000000",
      },
      {
        network: "robinhood",
        kind: "burn",
        token: SLOP,
        sends: 1,
        amountIn: "4500000000000000000000",
        amountOut: "4500000000000000000000",
        inTransit: "0",
        refunded: "0",
      },
      {
        network: "robinhood",
        kind: "buyback",
        token: USDG,
        sends: 1,
        amountIn: "498000000",
        amountOut: "9000000000000000000001",
        inTransit: "0",
        refunded: "0",
      },
    ]);
  });
});
