import { describe, expect, test } from "bun:test";
import { parseConfig } from "./config";
import {
  type ChainClient,
  type ConversionRow,
  message,
  type PreparedSend,
  type Quote,
  type QuoteResult,
  type RunDependencies,
  runNetwork,
  type SendStatus,
} from "./core";
import { createEvmClient } from "./evm";
import { runOnce } from "./index";
import { sqliteD1 } from "./sqlite-d1";
import { D1ConversionStore, projectRewardTokens } from "./store";

const TOKEN = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";

function config(extra: Record<string, string> = {}) {
  return parseConfig({
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: "base",
    FEE_WALLET_BASE: WALLET,
    FEE_CONVERTER_ALLOWLIST: JSON.stringify({ base: [TOKEN] }),
    ...extra,
  });
}

/** A quote that pays one stablecoin micro-unit per input unit, 50 bps slippage. */
function linearQuote(amount: bigint, overrides: Partial<Quote> = {}): Quote {
  return {
    route: "kyberswap",
    amountIn: amount,
    amountOut: amount,
    minAmountOut: (amount * 9_950n) / 10_000n,
    priceImpactBps: 10,
    gasCostMicro: 10_000n,
    summary: { aggregator: "test" },
    ...overrides,
  };
}

interface FakeChain extends ChainClient {
  balances: Map<string, bigint>;
  prepared: number;
  sent: string[];
  statusFor: (row: ConversionRow) => SendStatus;
  quoteFor: (token: string, amount: bigint) => QuoteResult;
  broadcastError: Error | null;
}

function fakeChain(): FakeChain {
  let txCounter = 0;
  const chain: FakeChain = {
    balances: new Map([[TOKEN, 20_000_000n]]),
    prepared: 0,
    sent: [],
    broadcastError: null,
    statusFor: () => ({ kind: "pending" }),
    quoteFor: (_token, amount) => linearQuote(amount),
    async balance(token) {
      return chain.balances.get(token) ?? 0n;
    },
    async quote(token, amount) {
      return chain.quoteFor(token, amount);
    },
    async prepare(_token, quote): Promise<PreparedSend> {
      chain.prepared += 1;
      txCounter += 1;
      return {
        txId: `0x${txCounter.toString(16).padStart(64, "0")}`,
        rawTx: `0xraw${txCounter}`,
        evmNonce: txCounter,
        expiresAt: 2_000_000_000,
        approvalTxId: null,
        minAmountOut: quote.minAmountOut,
      };
    },
    async broadcast(raw) {
      if (chain.broadcastError) throw chain.broadcastError;
      chain.sent.push(raw);
    },
    async status(row) {
      return chain.statusFor(row);
    },
  };
  return chain;
}

function harness(
  options: {
    mode?: "dry_run" | "live";
    env?: Record<string, string>;
    projectTokens?: string[];
    clock?: { now: Date };
  } = {},
) {
  const { db, sqlite } = sqliteD1();
  const chain = fakeChain();
  const clock = options.clock ?? { now: new Date("2026-10-18T12:00:00Z") };
  const parsed = config(options.env);
  let id = 0;
  const events: Record<string, unknown>[] = [];
  const deps: RunDependencies = {
    mode: options.mode ?? "live",
    limits: parsed.limits,
    store: new D1ConversionStore(db),
    now: () => clock.now,
    randomId: () => `id-${String(++id).padStart(6, "0")}`,
    projectTokens: async () => options.projectTokens ?? [],
    client: () => chain,
    log: (event) => events.push(event),
  };
  const rows = () =>
    sqlite
      .query("SELECT * FROM fee_conversions ORDER BY rowid")
      .all() as Record<string, string | number | null>[];
  return {
    db,
    sqlite,
    chain,
    deps,
    network: parsed.networks[0],
    rows,
    clock,
    events,
  };
}

describe("release gates", () => {
  test("mode defaults to off and runs nothing", async () => {
    const { db, sqlite } = sqliteD1();
    expect(parseConfig({}).mode).toBe("off");
    expect(
      await runOnce({ FEE_DB: db, FEE_CONVERTER_NETWORKS: "base" }),
    ).toEqual([]);
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM fee_conversions").get(),
    ).toEqual({ n: 0 });
  });

  test("an enabled network without a fee wallet is refused", () => {
    expect(() =>
      parseConfig({
        FEE_CONVERTER_MODE: "dry_run",
        FEE_CONVERTER_NETWORKS: "robinhood",
      }),
    ).toThrow(/FEE_WALLET_ROBINHOOD/);
  });

  test("live mode refuses a network whose key is missing, and dry_run never loads a key", async () => {
    const { db } = sqliteD1();
    const errors: string[] = [];
    const original = console.error;
    console.error = (line: string) => errors.push(line);
    try {
      expect(
        await runOnce({
          FEE_DB: db,
          FEE_CONVERTER_MODE: "live",
          FEE_CONVERTER_NETWORKS: "base",
          FEE_WALLET_BASE: WALLET,
        }),
      ).toEqual([]);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain("live mode needs FEE_WALLET_KEY_BASE");
  });

  test("a key that does not control the configured fee wallet is refused", async () => {
    const { createEvmClient } = await import("./evm");
    const { generatePrivateKey } = await import("viem/accounts");
    expect(() =>
      createEvmClient({
        config: config().networks[0],
        limits: config().limits,
        kyberClientId: "test",
        privateKey: generatePrivateKey(),
      }),
    ).toThrow(/does not control the configured fee wallet/);
  });
});

describe("conversion policy", () => {
  test("dry_run records the quote and never prepares or signs", async () => {
    const h = harness({ mode: "dry_run" });
    const result = await runNetwork(h.network, h.deps);
    expect(result.records.quoted).toBe(1);
    expect(h.chain.prepared).toBe(0);
    expect(h.rows()[0]).toMatchObject({
      mode: "dry_run",
      state: "quoted",
      amount_in: "20000000",
      min_amount_out: "19900000",
      tx_id: null,
    });
  });

  test("the record keeps the fee-wallet balances before and after", async () => {
    const h = harness();
    h.chain.balances.set(USDC, 3_000_000n);
    await runNetwork(h.network, h.deps);
    h.chain.balances.set(TOKEN, 0n);
    h.chain.balances.set(USDC, 22_990_000n);
    h.chain.statusFor = () => ({ kind: "finalized", amountOut: 19_990_000n });
    await runNetwork(h.network, h.deps);
    expect(h.rows()[0]).toMatchObject({
      token_balance_before: "20000000",
      target_balance_before: "3000000",
      target_balance_after: "22990000",
      amount_out: "19990000",
    });
  });

  test("the stablecoin and empty balances are never quoted", async () => {
    const h = harness({ projectTokens: [USDC, OTHER] });
    h.chain.balances.set(USDC, 50_000_000n);
    h.chain.quoteFor = (token, amount) => {
      if (token !== TOKEN) throw new Error(`quoted ${token}`);
      return linearQuote(amount);
    };
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => row.token)).toEqual([TOKEN]);
  });

  test("small amounts are skipped below the minimum and below the gas multiple", async () => {
    const h = harness({ mode: "dry_run" });
    h.chain.balances.set(TOKEN, 4_000_000n);
    await runNetwork(h.network, h.deps);
    h.chain.balances.set(TOKEN, 6_000_000n);
    h.chain.quoteFor = (_t, amount) =>
      linearQuote(amount, { gasCostMicro: 700_000n });
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => row.reason)).toEqual([
      "below the minimum conversion value",
      "below the gas-cost multiple",
    ]);
  });

  test("unknown or excessive price impact and loose minimums are skipped", async () => {
    const h = harness({ mode: "dry_run" });
    const cases: Partial<Quote>[] = [
      { priceImpactBps: null },
      { priceImpactBps: 201 },
      { minAmountOut: 19_700_000n },
    ];
    for (const overrides of cases) {
      h.chain.quoteFor = (_t, amount) => linearQuote(amount, overrides);
      await runNetwork(h.network, h.deps);
    }
    expect(h.rows().map((row) => row.reason)).toEqual([
      "price impact unknown",
      "price impact above the cap",
      "minimum output outside the slippage limit",
    ]);
  });

  test("an unchanged skip is recorded once, not every run", async () => {
    const h = harness({ mode: "dry_run" });
    h.chain.balances.set(TOKEN, 1_000n);
    await runNetwork(h.network, h.deps);
    await runNetwork(h.network, h.deps);
    expect(h.rows()).toHaveLength(1);
    h.chain.balances.set(TOKEN, 2_000n);
    await runNetwork(h.network, h.deps);
    expect(h.rows()).toHaveLength(2);
  });

  test("a large balance is scaled to fit the per-run cap across tokens", async () => {
    const h = harness({
      env: { FEE_CONVERTER_RUN_CAP_MICRO: "30000000" },
      projectTokens: [OTHER],
    });
    h.chain.balances.set(TOKEN, 25_000_000n);
    h.chain.balances.set(OTHER, 25_000_000n);
    // Output falls behind input for a larger order, as with real pools.
    h.chain.quoteFor = (_t, amount) =>
      linearQuote(amount, {
        amountOut: amount - amount / 100n,
        minAmountOut: ((amount - amount / 100n) * 9_950n) / 10_000n,
      });
    await runNetwork(h.network, h.deps);
    const rows = h.rows();
    const total = rows.reduce(
      (sum, row) => sum + Number(row.quote_value_micro),
      0,
    );
    expect(rows.map((row) => row.state)).toEqual(["submitted", "submitted"]);
    expect(total).toBeLessThanOrEqual(30_000_000);
    expect(Number(rows[1].amount_in)).toBeLessThan(25_000_000);
  });

  test("live sends in the last 24 hours count against the daily cap", async () => {
    const clock = { now: new Date("2026-10-18T12:00:00Z") };
    const h = harness({
      env: { FEE_CONVERTER_DAILY_CAP_MICRO: "20000000" },
      clock,
    });
    await runNetwork(h.network, h.deps);
    h.chain.statusFor = () => ({ kind: "finalized", amountOut: 20_000_000n });
    clock.now = new Date("2026-10-18T13:00:00Z");
    h.chain.balances.set(TOKEN, 10_000_000n);
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => [row.state, row.reason])).toEqual([
      ["finalized", null],
      ["skipped", "daily value cap reached"],
    ]);
    clock.now = new Date("2026-10-19T12:30:00Z");
    await runNetwork(h.network, h.deps);
    expect(h.rows()[2].state).toBe("submitted");
  });
});

describe("idempotent sends", () => {
  test("an unknown send blocks a new attempt until it is reconciled", async () => {
    const h = harness();
    h.chain.broadcastError = new Error(
      "HTTP request failed. URL: https://rpc.example/v1/SECRETKEY Request body: {}",
    );
    await runNetwork(h.network, h.deps);
    const [row] = h.rows();
    expect(row.state).toBe("unknown");
    // Provider URLs can hold an API key; it never reaches D1.
    expect(String(row.reason)).not.toContain("SECRETKEY");
    expect(row.raw_tx).toBe("0xraw1");

    h.chain.broadcastError = null;
    h.chain.statusFor = () => ({ kind: "pending" });
    await runNetwork(h.network, h.deps);
    expect(h.chain.prepared).toBe(1);
    expect(h.rows()).toHaveLength(1);

    h.chain.statusFor = () => ({ kind: "rebroadcast" });
    await runNetwork(h.network, h.deps);
    expect(h.chain.sent).toEqual(["0xraw1"]);
    expect(h.chain.prepared).toBe(1);
    expect(h.rows()[0].state).toBe("submitted");

    h.chain.statusFor = () => ({ kind: "finalized", amountOut: 19_990_000n });
    h.chain.balances.set(TOKEN, 0n);
    await runNetwork(h.network, h.deps);
    expect(h.rows()).toHaveLength(1);
    expect(h.rows()[0]).toMatchObject({
      state: "finalized",
      amount_out: "19990000",
      reason: null,
    });
  });

  test("a send proven unable to land frees the token for a new attempt", async () => {
    const h = harness();
    await runNetwork(h.network, h.deps);
    h.chain.statusFor = () => ({
      kind: "failed",
      reason: "router deadline passed before inclusion",
    });
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => row.state)).toEqual(["failed", "submitted"]);
    expect(h.chain.prepared).toBe(2);
  });

  test("a failed prepare leaves no signed bytes and no open row", async () => {
    const h = harness();
    h.chain.prepare = async () => {
      throw new Error("price moved below the recorded minimum");
    };
    await runNetwork(h.network, h.deps);
    expect(h.rows()[0]).toMatchObject({
      state: "failed",
      reason: "prepare: price moved below the recorded minimum",
      raw_tx: null,
    });
  });

  test("a concurrent run on the same network is locked out", async () => {
    const h = harness();
    expect(
      await h.deps.store.acquireLock("base", "other-run", h.clock.now),
    ).toBe(true);
    const result = await runNetwork(h.network, h.deps);
    expect(result.status).toBe("locked");
    expect(h.rows()).toHaveLength(0);
    h.clock.now = new Date(h.clock.now.getTime() + 15 * 60 * 1000);
    expect((await runNetwork(h.network, h.deps)).status).toBe("ran");
  });
});

describe("D1 contract", () => {
  test("the schema refuses a second open send, a submitted row without bytes, and edits to final rows", async () => {
    const h = harness();
    await runNetwork(h.network, h.deps);
    const insertOpen = () =>
      h.sqlite.exec(`INSERT INTO fee_conversions
        (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, tx_id, raw_tx,
         expires_at, min_amount_out, state, created_at, updated_at, submitted_at)
        VALUES ('id-second', 'run-second', 'base', 'live', '${WALLET}', '${TOKEN}', '${USDC}', '1',
         '0xdead', '0xbeef', 1, '1', 'submitted', 'now', 'now', 'now')`);
    expect(insertOpen).toThrow(/UNIQUE/);
    expect(() =>
      h.sqlite.exec(`INSERT INTO fee_conversions
        (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, state, created_at, updated_at)
        VALUES ('id-third', 'run-third', 'base', 'live', '${WALLET}', '${OTHER}', '${USDC}', '1',
         'submitted', 'now', 'now')`),
    ).toThrow(/CHECK/);
    expect(() =>
      h.sqlite.exec(`INSERT INTO fee_conversions
        (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, tx_id, raw_tx,
         expires_at, min_amount_out, state, created_at, updated_at, submitted_at)
        VALUES ('id-fourth', 'run-fourth', 'base', 'dry_run', '${WALLET}', '${OTHER}', '${USDC}', '1',
         '0xfeed', '0xbeef', 1, '1', 'submitted', 'now', 'now', 'now')`),
    ).toThrow(/CHECK/);
    h.chain.statusFor = () => ({ kind: "finalized", amountOut: 1n });
    await runNetwork(h.network, h.deps);
    expect(() =>
      h.sqlite.exec("UPDATE fee_conversions SET amount_out = '2'"),
    ).toThrow(/final/);
    expect(() => h.sqlite.exec("DELETE FROM fee_conversions")).toThrow(
      /permanent/,
    );
  });

  test("candidate tokens come only from reviewed manifests on the network", async () => {
    const { db, sqlite } = sqliteD1();
    const THIRD = "0x3333333333333333333333333333333333333333";
    const add = (id: string, manifest: Record<string, unknown>) => {
      const text = JSON.stringify({ id, status: "paused", ...manifest });
      sqlite.exec(`INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at)
        VALUES ('${id}', 1, '${text}', '${"a".repeat(64)}', 'test', 'now')`);
      sqlite.exec(`INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at)
        VALUES ('${id}', 'paused', 1, '${text}', '${"a".repeat(64)}', 'now', 'now')`);
    };
    add("escrowed", {
      escrow: {
        deployments: [
          { network: "base-mainnet", asset: TOKEN },
          { network: "base-sepolia", asset: OTHER },
        ],
      },
    });
    add("token-reward", {
      rewardAsset: { network: "base", kind: "token", address: THIRD },
    });
    add("stable-reward", {
      rewardAsset: { network: "base", kind: "stablecoin", address: USDC },
    });
    add("eth-reward", {
      rewardAsset: { network: "ethereum", kind: "token", address: OTHER },
    });
    expect(
      (await projectRewardTokens(db, "base", ["base-mainnet"])).sort(),
    ).toEqual([TOKEN, THIRD]);
    expect(await projectRewardTokens(db, "ethereum", ["ethereum"])).toEqual([
      OTHER,
    ]);
    expect(await projectRewardTokens(db, "solana", ["solana-mainnet"])).toEqual(
      [],
    );
  });

  test("live Solana signing stays blocked outside the local harness", async () => {
    const { chainClient } = await import("./index");
    const env = {
      FEE_CONVERTER_MODE: "live",
      FEE_CONVERTER_NETWORKS: "solana",
      FEE_WALLET_SOLANA: "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
      FEE_WALLET_KEY_SOLANA: JSON.stringify(new Array(64).fill(1)),
    };
    const parsed = parseConfig(env);
    expect(() => chainClient(env, parsed, parsed.networks[0])).toThrow(
      /live Solana conversion is blocked/,
    );
  });

  test("error text drops URLs and echoed request bodies", () => {
    expect(
      message(
        new Error(
          'failed. URL: https://x.example/key/abc123 Request body: {"raw":"0x"}',
        ),
      ),
    ).toBe("failed. URL: <url>");
  });
});

describe("EVM status lookup", () => {
  const TX = `0x${"ab".repeat(32)}`;
  const NOW = new Date("2026-10-19T12:00:00.000Z");

  type Rpc = Record<string, (params: unknown[]) => unknown>;

  /** A JSON-RPC endpoint answering from `handlers`; other methods are rate limited. */
  function rpcFetch(handlers: Rpc): typeof fetch {
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      const handler = handlers[body.method];
      if (!handler) return new Response("rate limited", { status: 429 });
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: handler(body.params),
      });
    }) as unknown as typeof fetch;
    return fetcher;
  }

  function statusHarness(handlers: Rpc) {
    const config = parseConfig({
      FEE_CONVERTER_MODE: "live",
      FEE_CONVERTER_NETWORKS: "base",
      FEE_WALLET_BASE: WALLET,
    });
    const network = config.networks[0];
    const fetcher = rpcFetch(handlers);
    const client = createEvmClient({
      config: network,
      limits: config.limits,
      kyberClientId: "test",
      fetch: fetcher,
      sleep: async () => {},
      now: () => NOW,
    });
    const { db, sqlite } = sqliteD1();
    const store = new D1ConversionStore(db);
    const events: string[] = [];
    const deps: RunDependencies = {
      mode: "live",
      limits: config.limits,
      store,
      now: () => NOW,
      randomId: () => "run-0002",
      projectTokens: async () => [],
      client: () => client,
      log: (entry) => events.push(String(entry.event)),
    };
    const row: ConversionRow = {
      id: "row-0001",
      runId: "run-0001",
      network: "base",
      mode: "live",
      feeWallet: WALLET,
      token: TOKEN,
      targetToken: network.definition.stablecoin,
      amountIn: "20000000",
      route: "kyberswap",
      quoteAmountOut: "20000000",
      minAmountOut: "19800000",
      quoteValueMicro: 20_000_000,
      priceImpactBps: 10,
      quote: "{}",
      approvalTxId: null,
      txId: TX,
      rawTx: "0xraw",
      evmNonce: 7,
      expiresAt: Math.floor(Date.parse("2026-10-19T12:15:00.000Z") / 1000),
      amountOut: null,
      tokenBalanceBefore: "20000000",
      targetBalanceBefore: "0",
      targetBalanceAfter: null,
      state: "submitted",
      reason: null,
      createdAt: "2026-10-19T11:50:00.000Z",
      updatedAt: "2026-10-19T11:50:00.000Z",
      submittedAt: "2026-10-19T11:50:00.000Z",
      finalizedAt: null,
    };
    const stored = () =>
      sqlite
        .query(
          "SELECT state, reason FROM fee_conversions WHERE id = 'row-0001'",
        )
        .get() as { state: string; reason: string | null };
    return { network, client, store, deps, row, events, stored };
  }

  // The wallet's finalized nonce is past the row's nonce in both cases: that is
  // what the row's own mined swap looks like from the nonce alone.
  const FINALIZED_NONCE = "0x8";

  test("a failed receipt lookup keeps the swap submitted and inside the caps", async () => {
    const h = statusHarness({
      eth_chainId: () => "0x2105",
      eth_getTransactionCount: () => FINALIZED_NONCE,
    });
    await h.store.insert(h.row);
    const before = await h.store.liveValueSince(
      "base",
      "2026-10-19T00:00:00.000Z",
    );
    await expect(h.client.status(h.row)).rejects.toThrow();
    const result = await runNetwork(h.network, h.deps);
    expect(result.reconciled).toBe(0);
    expect(h.stored()).toEqual({ state: "submitted", reason: null });
    expect(h.events).toContain("fee_conversion_reconcile_error");
    expect(
      await h.store.liveValueSince("base", "2026-10-19T00:00:00.000Z"),
    ).toBe(before);
    expect(before).toBe(20_000_000n);
  });

  test("a transaction the chain does not know with a used nonce is failed", async () => {
    const h = statusHarness({
      eth_chainId: () => "0x2105",
      eth_getTransactionReceipt: () => null,
      eth_getTransactionByHash: () => null,
      eth_getTransactionCount: () => FINALIZED_NONCE,
    });
    await h.store.insert(h.row);
    expect(await h.client.status(h.row)).toEqual({
      kind: "failed",
      reason: "nonce used by another transaction",
    });
    const result = await runNetwork(h.network, h.deps);
    expect(result.reconciled).toBe(1);
    expect(h.stored()).toEqual({
      state: "failed",
      reason: "nonce used by another transaction",
    });
  });
});
