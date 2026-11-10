import { describe, expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { FEE_CONVERSIONS_PATH, handleFeeConversionsApi } from "./handler";

const WALLET = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";
const TOKEN = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
// A rotated USDC target address: the same network and source token, but the
// conversion target changed between the two finalized conversions.
const USDC_ROTATED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function seededWithRotatedTarget() {
  const { db, sqlite } = sqliteD1();
  const insert = (
    id: string,
    target: string,
    amountIn: string,
    amountOut: string,
    txId: string,
  ) =>
    sqlite.exec(`INSERT INTO fee_conversions
      (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, route,
       quote_amount_out, min_amount_out, quote_value_micro, tx_id, raw_tx, expires_at,
       amount_out, state, created_at, updated_at, submitted_at, finalized_at)
      VALUES ('${id}', 'run-00001', 'base', 'live', '${WALLET}', '${TOKEN}', '${target}',
       '${amountIn}', 'kyberswap', '${amountOut}', '${amountOut}', 1, '${txId}', '0xsignedbytes', 1,
       '${amountOut}', 'finalized', '${new Date().toISOString()}', 'now', 'now', 'now')`);
  insert("conv-0001", USDC, "100", "90", "0xaa");
  insert("conv-0002", USDC_ROTATED, "200", "180", "0xbb");
  return db;
}

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
  });

  test("admin totals split by target token when the conversion target rotates", async () => {
    const response = await handleFeeConversionsApi(request(), {
      db: seededWithRotatedTarget(),
      adminGithubIds: new Set(["1"]),
      sessionActor: async () => ({ githubId: "1" }),
    });
    expect(response?.status).toBe(200);
    const body = JSON.parse(await (response as Response).text());
    expect(body.totals).toEqual([
      {
        network: "base",
        token: TOKEN,
        targetToken: USDC,
        conversions: 1,
        amountIn: "100",
        amountOut: "90",
      },
      {
        network: "base",
        token: TOKEN,
        targetToken: USDC_ROTATED,
        conversions: 1,
        amountIn: "200",
        amountOut: "180",
      },
    ]);
  });
});
