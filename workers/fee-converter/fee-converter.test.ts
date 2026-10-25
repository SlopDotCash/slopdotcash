import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  type SolanaEscrowConfig,
  solanaBase58,
  solanaVaultAddress,
} from "../../contracts/solana/adapter";
import { ata } from "../../contracts/solana/transactions";
import { parseConfig } from "./config";
import {
  type ChainClient,
  type ConversionRow,
  type FeeVault,
  message,
  type PreparedSend,
  type Quote,
  type QuoteResult,
  type RunDependencies,
  runNetwork,
  type SendStatus,
} from "./core";
import worker, { runOnce, triggerAt } from "./index";
import { createSolanaClient, parseTransaction } from "./solana";
import { sqliteD1 } from "./sqlite-d1";
import { D1ConversionStore, projectRewardTokens, projectVaults } from "./store";

const TOKEN = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

/** Test limits only; production limits come from the reviewed wrangler.toml. */
const LIMITS = {
  FEE_CONVERTER_MIN_VALUE_MICRO: "5000000",
  FEE_CONVERTER_GAS_MULTIPLE: "10",
  FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
  FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
  FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
  FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
};

function config(extra: Record<string, string> = {}) {
  return parseConfig({
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: "base",
    FEE_WALLET_BASE: WALLET,
    FEE_CONVERTER_ALLOWLIST: JSON.stringify({ base: [TOKEN] }),
    ...LIMITS,
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
  const locks = () =>
    sqlite
      .query("SELECT run_id, expires_at FROM fee_converter_locks")
      .all() as { run_id: string; expires_at: string }[];
  return {
    db,
    sqlite,
    chain,
    deps,
    network: parsed.networks[0],
    rows,
    locks,
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

  test("scheduled startup failures reject after every enabled network is attempted", async () => {
    const { db, sqlite } = sqliteD1();
    const errors: string[] = [];
    const original = console.error;
    console.error = (line: string) => errors.push(line);
    try {
      let work: Promise<unknown> | undefined;
      await worker.scheduled(
        undefined,
        {
          FEE_DB: db,
          FEE_CONVERTER_MODE: "live",
          FEE_CONVERTER_NETWORKS: "base,ethereum",
          FEE_WALLET_BASE: WALLET,
          FEE_WALLET_ETHEREUM: WALLET,
          ...LIMITS,
        },
        {
          waitUntil(promise) {
            work = promise;
          },
        },
      );
      expect(work).toBeDefined();
      await expect(work!).rejects.toThrow(
        "fee conversion failed on 2 networks",
      );
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain("live mode needs FEE_WALLET_KEY_BASE");
      expect(errors[1]).toContain("live mode needs FEE_WALLET_KEY_ETHEREUM");
      expect(
        sqlite.query("SELECT COUNT(*) AS n FROM fee_converter_locks").get(),
      ).toEqual({ n: 0 });
      expect(
        sqlite.query("SELECT COUNT(*) AS n FROM fee_conversions").get(),
      ).toEqual({ n: 0 });
    } finally {
      console.error = original;
      sqlite.close();
    }
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

  test("a running converter refuses to start without an owner-set dust threshold", () => {
    for (const mode of ["dry_run", "live"])
      for (const name of [
        "FEE_CONVERTER_MIN_VALUE_MICRO",
        "FEE_CONVERTER_GAS_MULTIPLE",
      ])
        expect(() => config({ FEE_CONVERTER_MODE: mode, [name]: "" })).toThrow(
          `${name} awaits the owner's decision`,
        );
    expect(() => config({ FEE_CONVERTER_MAX_SLIPPAGE_BPS: "" })).toThrow(
      "FEE_CONVERTER_MAX_SLIPPAGE_BPS is required",
    );
    // An owner may choose to convert every received fee.
    expect(
      config({
        FEE_CONVERTER_MIN_VALUE_MICRO: "0",
        FEE_CONVERTER_GAS_MULTIPLE: "0",
      }).limits,
    ).toMatchObject({ minValueMicro: 0n, gasMultiple: 0n });
    expect(
      parseConfig({ FEE_CONVERTER_MODE: "off", FEE_CONVERTER_NETWORKS: "" })
        .mode,
    ).toBe("off");
  });

  test("the checked-in configuration carries the owner's recorded dust threshold and stays off", async () => {
    const toml = await Bun.file(
      new URL("./wrangler.toml", import.meta.url),
    ).text();
    expect(toml).toMatch(/^FEE_CONVERTER_MODE = "off"$/mu);
    expect(toml).toMatch(/^FEE_CONVERTER_MIN_VALUE_MICRO = "5000000"$/mu);
    expect(toml).toMatch(/^FEE_CONVERTER_GAS_MULTIPLE = "10"$/mu);
  });
});

describe("USDC routes", () => {
  test("a network without a verified USDC target stays pending and never quotes, signs or loads a key", async () => {
    const { db, sqlite } = sqliteD1();
    const events: string[] = [];
    const original = console.log;
    console.log = (line: string) => events.push(line);
    try {
      const results = await runOnce({
        FEE_DB: db,
        FEE_CONVERTER_MODE: "live",
        FEE_CONVERTER_NETWORKS: "robinhood",
        FEE_WALLET_ROBINHOOD: WALLET,
        FEE_CONVERTER_ALLOWLIST: JSON.stringify({ robinhood: [TOKEN, USDG] }),
        ...LIMITS,
      });
      expect(results).toEqual([
        expect.objectContaining({
          network: "robinhood",
          status: "route_pending",
        }),
      ]);
      expect(
        events.some((line) =>
          line.includes('"event":"fee_conversion_route_pending"'),
        ),
      ).toBe(true);
      // No record means no quote, and nothing names USDG or any other token
      // as a USDC substitute.
      expect(
        sqlite.query("SELECT COUNT(*) AS n FROM fee_conversions").get(),
      ).toEqual({ n: 0 });
      expect(
        sqlite.query("SELECT COUNT(*) AS n FROM fee_converter_locks").get(),
      ).toEqual({ n: 0 });
    } finally {
      console.log = original;
      sqlite.close();
    }
  });

  test("EVM clients refuse to quote a network without a verified USDC target", async () => {
    const { createEvmClient } = await import("./evm");
    const parsed = parseConfig({
      FEE_CONVERTER_MODE: "dry_run",
      FEE_CONVERTER_NETWORKS: "robinhood",
      FEE_WALLET_ROBINHOOD: WALLET,
      ...LIMITS,
    });
    let fetched = false;
    const client = createEvmClient({
      config: parsed.networks[0],
      limits: parsed.limits,
      kyberClientId: "test",
      fetch: (async () => {
        fetched = true;
        throw new Error("no network in unit tests");
      }) as unknown as typeof fetch,
    });
    await expect(client.quote(TOKEN, 1_000n)).rejects.toThrow(
      "no verified USDC target on robinhood",
    );
    expect(fetched).toBe(false);
  });

  test("records name the network USDC as the target", async () => {
    const h = harness({ mode: "dry_run" });
    await runNetwork(h.network, h.deps);
    expect(h.rows()[0]).toMatchObject({ target_token: USDC, state: "quoted" });
  });
});

describe("receipt-triggered conversion", () => {
  test("cron minutes alternate receipt checks with a recovery scan", () => {
    expect(triggerAt(Date.parse("2026-10-18T12:00:00Z"))).toBe("recovery");
    expect(triggerAt(Date.parse("2026-10-18T12:01:00Z"))).toBe("receipts");
    expect(triggerAt(Date.parse("2026-10-18T12:14:00Z"))).toBe("receipts");
    expect(triggerAt(Date.parse("2026-10-18T12:45:00Z"))).toBe("recovery");
  });

  test("a receipt run converts a newly received fee and leaves an unchanged balance alone", async () => {
    const h = harness({ mode: "dry_run" });
    h.deps.trigger = "receipts";
    let quotes = 0;
    h.chain.quoteFor = (_t, amount) => {
      quotes += 1;
      return linearQuote(amount);
    };
    // First sighting of a fee is a receipt.
    await runNetwork(h.network, h.deps);
    expect(quotes).toBe(1);
    expect(h.rows()).toHaveLength(1);
    // Same balance: no new receipt, so no quote and no record.
    await runNetwork(h.network, h.deps);
    expect(quotes).toBe(1);
    expect(h.rows()).toHaveLength(1);
    // A new fee arrives.
    h.chain.balances.set(TOKEN, 26_000_000n);
    await runNetwork(h.network, h.deps);
    expect(quotes).toBe(2);
    expect(h.rows().map((row) => row.amount_in)).toEqual([
      "20000000",
      "26000000",
    ]);
  });

  test("a repeated fee amount after finalization is a new receipt", async () => {
    const h = harness();
    h.deps.trigger = "receipts";
    await runNetwork(h.network, h.deps);
    expect(h.chain.sent).toHaveLength(1);
    // The first balance was spent, then an equal fee arrived before the next tick.
    h.chain.statusFor = () => ({ kind: "finalized", amountOut: 20_000_000n });
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => row.state)).toEqual([
      "finalized",
      "submitted",
    ]);
    expect(h.chain.sent).toHaveLength(2);
  });

  test("the recovery scan retries a token that a receipt run leaves alone", async () => {
    const h = harness();
    h.deps.trigger = "receipts";
    h.chain.prepare = async () => {
      throw new Error("price moved below the recorded minimum");
    };
    await runNetwork(h.network, h.deps);
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => row.state)).toEqual(["failed"]);
    h.deps.trigger = "recovery";
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => row.state)).toEqual(["failed", "failed"]);
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

  test("small amounts stay pending below the minimum and below the gas multiple", async () => {
    const h = harness({ mode: "dry_run" });
    h.chain.balances.set(TOKEN, 4_000_000n);
    const first = await runNetwork(h.network, h.deps);
    expect(first.records).toMatchObject({ pending: 1, skipped: 0 });
    h.chain.balances.set(TOKEN, 6_000_000n);
    h.chain.quoteFor = (_t, amount) =>
      linearQuote(amount, { gasCostMicro: 700_000n });
    await runNetwork(h.network, h.deps);
    expect(h.rows().map((row) => [row.state, row.reason])).toEqual([
      ["pending", "below the minimum conversion value"],
      ["pending", "below the gas-cost multiple"],
    ]);
    expect(h.chain.prepared).toBe(0);
  });

  test("a pending fee converts once a later receipt lifts it over the threshold", async () => {
    const h = harness();
    h.chain.balances.set(TOKEN, 4_000_000n);
    await runNetwork(h.network, h.deps);
    h.chain.balances.set(TOKEN, 9_000_000n);
    await runNetwork(h.network, { ...h.deps, trigger: "receipts" });
    expect(h.rows().map((row) => [row.state, row.amount_in])).toEqual([
      ["pending", "4000000"],
      ["submitted", "9000000"],
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
  test("an approval is recorded before it can be broadcast", async () => {
    const h = harness();
    h.chain.prepare = async (_token, quote, recordApproval) => {
      await recordApproval({ txId: `0x${"a".repeat(64)}`, evmNonce: 7 });
      expect(h.rows()[0]).toMatchObject({
        state: "quoted",
        approval_tx_id: `0x${"a".repeat(64)}`,
        raw_tx: null,
        evm_nonce: 7,
      });
      throw new Error(`approval broadcast failed for ${quote.amountIn}`);
    };

    await runNetwork(h.network, h.deps);

    expect(h.rows()[0]).toMatchObject({
      state: "failed",
      approval_tx_id: `0x${"a".repeat(64)}`,
      raw_tx: null,
      evm_nonce: 7,
      reason: "prepare: approval broadcast failed for 20000000",
    });
  });

  test("a recorded approval does not block the swap that follows", async () => {
    const h = harness();
    const prepareSwap = h.chain.prepare;
    h.chain.prepare = async (token, quote, recordApproval) => {
      await recordApproval({ txId: `0x${"a".repeat(64)}`, evmNonce: 6 });
      const swap = await prepareSwap(token, quote, recordApproval);
      return { ...swap, approvalTxId: `0x${"a".repeat(64)}` };
    };

    await runNetwork(h.network, h.deps);

    expect(h.chain.sent).toEqual(["0xraw1"]);
    expect(h.rows()[0]).toMatchObject({
      state: "submitted",
      approval_tx_id: `0x${"a".repeat(64)}`,
      raw_tx: "0xraw1",
      evm_nonce: 1,
    });
  });

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

  test("a run that lost its lease never deletes the successor's lock", async () => {
    const h = harness();
    const at = (minutes: number) =>
      new Date(h.clock.now.getTime() + minutes * 60 * 1000);
    // Run A takes the lease (expires at +14 minutes).
    expect(await h.deps.store.acquireLock("base", "run-a", at(0))).toBe(true);
    // The next cron tick legitimately takes the lease A let lapse.
    expect(await h.deps.store.acquireLock("base", "run-c", at(15))).toBe(true);
    expect(h.locks()).toEqual([
      { run_id: "run-c", expires_at: at(29).toISOString() },
    ]);
    // A returns after its lease expired: it must not delete C's row.
    await h.deps.store.releaseLock("base", "run-a", at(22));
    expect(h.locks()).toEqual([
      { run_id: "run-c", expires_at: at(29).toISOString() },
    ]);
    // So a third run is still locked out while C is signing.
    expect(await h.deps.store.acquireLock("base", "run-d", at(28))).toBe(false);
  });

  test("a stale run cannot release a lease it already let lapse", async () => {
    const h = harness();
    const at = (minutes: number) =>
      new Date(h.clock.now.getTime() + minutes * 60 * 1000);
    // A lease A took at t=0 lapses at t=14 while the run is still working.
    expect(await h.deps.store.acquireLock("base", "run-a", at(0))).toBe(true);
    // A releases at t=22 with no successor: the row is A's but expired, so
    // the release leaves it for acquireLock to reclaim on expiry.
    await h.deps.store.releaseLock("base", "run-a", at(22));
    expect(h.locks()).toEqual([
      { run_id: "run-a", expires_at: at(14).toISOString() },
    ]);
    // Release of the same row while it is still live does delete it.
    await h.deps.store.releaseLock("base", "run-a", at(10));
    expect(h.locks()).toEqual([]);
  });

  test("a run that still owns an unexpired lease releases it", async () => {
    const h = harness();
    const at = (minutes: number) =>
      new Date(h.clock.now.getTime() + minutes * 60 * 1000);
    expect(await h.deps.store.acquireLock("base", "run-a", at(0))).toBe(true);
    await h.deps.store.releaseLock("base", "run-a", at(5));
    expect(h.locks()).toEqual([]);
    // The network is free for the next tick.
    expect(await h.deps.store.acquireLock("base", "run-b", at(5))).toBe(true);
  });

  test("a run renews its lease so a long run keeps the lock", async () => {
    const h = harness();
    const at = (minutes: number) =>
      new Date(h.clock.now.getTime() + minutes * 60 * 1000);
    // A lease taken at t=0 lapses at t=14 without renewal.
    expect(await h.deps.store.acquireLock("base", "run-a", at(0))).toBe(true);
    expect(await h.deps.store.acquireLock("base", "run-b", at(15))).toBe(true);

    // A run that renews inside its lease still owns it past the old expiry.
    expect(await h.deps.store.acquireLock("base", "run-x", at(100))).toBe(true);
    expect(await h.deps.store.renewLock("base", "run-x", at(107))).toBe(true);
    expect(await h.deps.store.acquireLock("base", "run-y", at(115))).toBe(
      false,
    );
    // A lapsed lease cannot be renewed, and renewal never claims another run.
    expect(await h.deps.store.renewLock("base", "run-x", at(122))).toBe(false);
    expect(await h.deps.store.renewLock("base", "run-other", at(110))).toBe(
      false,
    );
  });

  test("a run renews the lease before starting a later chunk", async () => {
    // Three tokens, one send each. A send takes 8 simulated minutes, which is
    // more than RUN_BUDGET_MS (7 minutes): the second chunk starts with the
    // lease due for renewal, and the third chunk proves the lease was really
    // extended rather than merely left in place.
    const THIRD = "0x3333333333333333333333333333333333333333";
    const h = harness({ projectTokens: [OTHER, THIRD] });
    h.chain.balances.set(TOKEN, 20_000_000n);
    h.chain.balances.set(OTHER, 20_000_000n);
    h.chain.balances.set(THIRD, 20_000_000n);
    const prepare = h.chain.prepare;
    // The lease this run holds at the moment each chunk starts to sign.
    const leaseAtSign: string[] = [];
    h.chain.prepare = async (token, quote, recordApproval) => {
      leaseAtSign.push(h.locks()[0]?.expires_at ?? "none");
      h.clock.now = new Date(h.clock.now.getTime() + 8 * 60 * 1000);
      return prepare(token, quote, recordApproval);
    };
    h.chain.statusFor = () => ({ kind: "finalized", amountOut: 1n });
    const startedAt = h.clock.now.getTime();
    const minute = (n: number) =>
      new Date(startedAt + n * 60 * 1000).toISOString();

    await runNetwork(h.network, h.deps);

    expect(h.chain.prepared).toBe(3);
    // Chunks sign at minutes 0, 8 and 16. The third one signs under a lease
    // that expires at minute 30, past the original 14-minute lease, so only
    // the renewal that ran before it can keep this run's lease alive.
    expect(leaseAtSign).toEqual([minute(14), minute(22), minute(30)]);
    // The lease was still this run's at the end, so releasing it left no row.
    expect(h.locks()).toEqual([]);
    expect(h.events).not.toContainEqual(
      expect.objectContaining({ event: "fee_conversion_lock_lost" }),
    );
  });

  test("a run stops starting new chunks once it loses its lease", async () => {
    // Two tokens: the first signs and the clock jumps past the lease, so the
    // second chunk must not start once renewal fails.
    const h = harness({ projectTokens: [OTHER] });
    h.chain.balances.set(TOKEN, 20_000_000n);
    h.chain.balances.set(OTHER, 20_000_000n);
    const prepare = h.chain.prepare;
    h.chain.prepare = async (token, quote, recordApproval) => {
      // A send waits for receipts; this one outlives the lease and the
      // successor run takes it before the next chunk.
      h.clock.now = new Date(h.clock.now.getTime() + 15 * 60 * 1000);
      await h.deps.store.acquireLock("base", "successor", h.clock.now);
      return prepare(token, quote, recordApproval);
    };

    const result = await runNetwork(h.network, h.deps);

    // The first chunk signed; the loop stopped instead of signing a second.
    expect(h.chain.prepared).toBe(1);
    expect(result.records.submitted).toBe(1);
    expect(h.events).toContainEqual(
      expect.objectContaining({ event: "fee_conversion_lock_lost" }),
    );
  });
});

describe("EVM reconciliation", () => {
  /**
   * A node after the recorded swap (nonce 1) landed in a finalized block: the
   * finalized nonce count is 2. Methods in `failing` answer HTTP 429; the
   * node knows no receipt and no transaction for the other lookups.
   */
  function rpcAfterLandedSwap(failing: string[]): typeof fetch {
    return (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const requests: { id: number; method: string }[] = Array.isArray(body)
        ? body
        : [body];
      if (requests.some((request) => failing.includes(request.method)))
        return new Response("rate limited", { status: 429 });
      const replies = requests.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result:
          request.method === "eth_getTransactionCount"
            ? "0x2"
            : request.method === "eth_call"
              ? `0x${"0".repeat(64)}`
              : null,
      }));
      return Response.json(Array.isArray(body) ? replies : replies[0]);
    }) as unknown as typeof fetch;
  }

  async function reconcileThroughEvm(failing: string[]) {
    const { createEvmClient } = await import("./evm");
    const h = harness();
    await runNetwork(h.network, h.deps);
    expect(h.rows()[0]).toMatchObject({ state: "submitted", evm_nonce: 1 });
    const since = new Date(
      h.clock.now.getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const counted = await h.deps.store.liveValueSince("base", since);
    h.deps.client = (network) =>
      createEvmClient({
        config: network,
        limits: h.deps.limits,
        kyberClientId: "test",
        fetch: rpcAfterLandedSwap(failing),
        sleep: async () => {},
      });
    await runNetwork(h.network, h.deps);
    return {
      h,
      counted,
      countedAfter: await h.deps.store.liveValueSince("base", since),
    };
  }

  test.each([
    "eth_getTransactionReceipt",
    "eth_getTransactionByHash",
    "eth_getTransactionReceipt,eth_getTransactionByHash",
  ])("a failed %s lookup leaves the send open", async (methods) => {
    const { h, counted, countedAfter } = await reconcileThroughEvm(
      methods.split(","),
    );
    // A finalized nonce cannot tell this swap from another transaction. Only
    // the receipt can, so the row waits for a run whose lookups succeed.
    const [row] = h.rows();
    expect([row.state, row.reason]).toEqual(["submitted", null]);
    expect(countedAfter).toBe(counted);
    expect(h.events).toContainEqual(
      expect.objectContaining({ event: "fee_conversion_reconcile_error" }),
    );
  });

  test("a send the node does not know fails once its nonce is finalized", async () => {
    const { h, countedAfter } = await reconcileThroughEvm([]);
    const [row] = h.rows();
    expect([row.state, row.reason]).toEqual([
      "failed",
      "nonce used by another transaction",
    ]);
    expect(countedAfter).toBe(0n);
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

  test("a pending row needs its reason and is final", async () => {
    const h = harness({ mode: "dry_run" });
    const insert = (id: string, reason: string) =>
      h.sqlite.exec(`INSERT INTO fee_conversions
        (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, state, reason,
         created_at, updated_at)
        VALUES ('${id}', 'run-pending', 'base', 'dry_run', '${WALLET}', '${TOKEN}', '${USDC}', '1',
         'pending', ${reason}, 'now', 'now')`);
    expect(() => insert("id-no-reason", "NULL")).toThrow(/CHECK/);
    insert("id-pending", "'below the minimum conversion value'");
    expect(() =>
      h.sqlite.exec(
        "UPDATE fee_conversions SET state = 'quoted' WHERE id = 'id-pending'",
      ),
    ).toThrow(/final/);
  });

  test("fee conversion rebuilds keep every earlier record and its guards", async () => {
    const { Database } = await import("bun:sqlite");
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../../migrations/", import.meta.url);
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const pendingMigration = "0076_fee_conversion_pending.sql";
    const sqlite = new Database(":memory:");
    for (const file of files.filter((file) => file < pendingMigration))
      sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
    sqlite.exec(`INSERT INTO fee_conversions
      (id, run_id, network, mode, fee_wallet, token, target_token, amount_in, state, reason,
       created_at, updated_at)
      VALUES ('id-earlier', 'run-earlier', 'base', 'dry_run', '${WALLET}', '${TOKEN}', '${USDC}',
       '7', 'skipped', 'below the minimum conversion value', 'then', 'then')`);
    sqlite.exec(readFileSync(new URL(pendingMigration, dir), "utf8"));
    sqlite.exec(
      readFileSync(
        new URL("0078_fee_conversion_transaction_size.sql", dir),
        "utf8",
      ),
    );
    expect(
      sqlite
        .query("SELECT id, state, reason, amount_in FROM fee_conversions")
        .all(),
    ).toEqual([
      {
        id: "id-earlier",
        state: "skipped",
        reason: "below the minimum conversion value",
        amount_in: "7",
      },
    ]);
    expect(() => sqlite.exec("DELETE FROM fee_conversions")).toThrow(
      /permanent/,
    );
    expect(() =>
      sqlite.exec("UPDATE fee_conversions SET state = 'pending'"),
    ).toThrow(/final/);
    sqlite.exec(`INSERT INTO fee_conversions
      (id, run_id, network, mode, fee_wallet, token, target_token, amount_in,
       route, quote, tx_id, raw_tx, evm_nonce, expires_at, min_amount_out,
       state, created_at, updated_at, submitted_at, amount_out, finalized_at)
      VALUES
      ('id-submitted', 'run-existing', 'base', 'live', '${WALLET}', '${TOKEN}', '${USDC}',
       '10', 'kyberswap', '{"route":"existing"}', '0xabc1', '0x0102', 4, 1234, '5',
       'submitted', 'then', 'then', 'then', NULL, NULL),
      ('id-finalized', 'run-existing', 'base', 'live', '${WALLET}', '${OTHER}', '${USDC}',
       '20', 'kyberswap', '{"route":"settled"}', '0xabc2', '0x0304', 3, 1233, '7',
       'finalized', 'before', 'then', 'before', '8', 'then')`);
    const before = sqlite
      .query("SELECT * FROM fee_conversions ORDER BY id")
      .all() as Record<string, unknown>[];
    sqlite.exec(
      readFileSync(new URL("0082_fee_claim_journal.sql", dir), "utf8"),
    );
    const after = sqlite
      .prepare("SELECT * FROM fee_conversions ORDER BY id")
      .all() as Record<string, unknown>[];
    expect(
      after.map(({ kind, ...row }) => {
        expect(kind).toBe("conversion");
        return row;
      }),
    ).toEqual(before);
    for (const sql of [
      "UPDATE fee_conversions SET raw_tx = '0x9999' WHERE id = 'id-submitted'",
      "UPDATE fee_conversions SET kind = 'claim' WHERE id = 'id-submitted'",
      "UPDATE fee_conversions SET quote = '{}' WHERE id = 'id-finalized'",
      "DELETE FROM fee_conversions WHERE id = 'id-submitted'",
      "DELETE FROM fee_conversions WHERE id = 'id-finalized'",
    ])
      expect(() => sqlite.exec(sql)).toThrow(/immutable|final|permanent/);
    expect(
      sqlite.prepare("SELECT * FROM fee_conversions ORDER BY id").all(),
    ).toEqual(after);
    sqlite.close();
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
          { network: "base-mainnet", asset: TOKEN, vault: WALLET },
          { network: "base-sepolia", asset: OTHER },
        ],
      },
    });
    add("bounty-only", {
      securityBounty: {
        settlement: {
          deployments: [
            { network: "base-mainnet", asset: OTHER, vault: THIRD },
            { network: "base-sepolia", asset: USDC, vault: TOKEN },
          ],
        },
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
    ).toEqual([TOKEN, OTHER, THIRD].sort());
    expect(
      (await projectVaults(db, ["base-mainnet"]))
        .map((entry) => [entry.projectId, entry.payoutPolicy, entry.vault])
        .sort(),
    ).toEqual(
      [
        ["bounty-only", "security-bounty", THIRD],
        ["escrowed", "ordinary", WALLET],
      ].sort(),
    );
    expect(await projectVaults(db, ["ethereum"])).toEqual([]);
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
      ...LIMITS,
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

describe("Solana vault fee claims", () => {
  const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const SYSTEM_PROGRAM = "11111111111111111111111111111111";
  const key = (n: number) => solanaBase58(new Uint8Array(32).fill(n));
  const seed = new Uint8Array(32).fill(7);
  const publicKey = ed25519.getPublicKey(seed);
  const wallet = solanaBase58(publicKey);
  const keypair = JSON.stringify([...seed, ...publicKey]);
  const PROGRAM = key(11);
  const PROJECT = key(12);
  const VAULT = solanaVaultAddress(PROGRAM, PROJECT);
  const VAULT_BALANCE = 50_000_000n;
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const unb64 = (text: string) =>
    Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  function deployment(overrides: Record<string, unknown> = {}) {
    return {
      network: "solana-mainnet",
      vault: VAULT,
      programId: PROGRAM,
      upgradeAuthority: key(16),
      projectPda: PROJECT,
      networkDomain: "ab".repeat(32),
      asset: SOLANA_USDC,
      owner: key(13),
      identityAuthority: key(14),
      feeRecipient: wallet,
      rotationAuthority: key(15),
      deploymentTransaction: "reviewed",
      sourceCommit: "a".repeat(40),
      codeSha256: "c".repeat(64),
      bindingDelaySeconds: "0",
      rotationDelaySeconds: "604800",
      factory: null,
      factoryCodeSha256: null,
      registrar: null,
      ...overrides,
    };
  }

  function vault(
    overrides: Record<string, unknown> = {},
    payoutPolicy: FeeVault["payoutPolicy"] = "ordinary",
  ): FeeVault {
    const record = deployment(overrides);
    return {
      vault: record.vault as string,
      projectId: "solana-project",
      payoutPolicy,
      deployment: record,
    };
  }

  function projectBytes(accrued: bigint): Uint8Array {
    const bytes = new Uint8Array(PROJECT_SIZE);
    bytes.set(
      Uint8Array.from(PROJECT_DISCRIMINATOR.match(/../g) ?? [], (pair) =>
        Number.parseInt(pair, 16),
      ),
    );
    new DataView(bytes.buffer).setBigUint64(316, accrued, true);
    return bytes;
  }

  function tokenAccount(amount: bigint): Uint8Array {
    const bytes = new Uint8Array(165);
    new DataView(bytes.buffer).setBigUint64(64, amount, true);
    return bytes;
  }

  /** A Solana RPC that knows one project with accrued fees in USDC. */
  function solanaChain() {
    const state = {
      finalizedAccrued: 10_000_000n,
      confirmedAccrued: 10_000_000n,
      unfinalized: false,
      /** Fee-wallet credit the claim receipt reports; null means the accrued fee. */
      receipt: null as bigint | null,
      sent: [] as string[],
      verified: [] as SolanaEscrowConfig[],
    };
    const rpcFetch = (async (_url: string, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body)) as {
        method: string;
        params: unknown[];
      };
      const reply = (result: unknown) =>
        Response.json({ jsonrpc: "2.0", id: 1, result });
      switch (method) {
        case "getAccountInfo":
          return reply({
            value: {
              owner: PROGRAM,
              data: [b64(projectBytes(state.confirmedAccrued)), "base64"],
            },
          });
        case "getSignaturesForAddress":
          return reply([
            {
              err: null,
              confirmationStatus: state.unfinalized ? "confirmed" : "finalized",
            },
          ]);
        case "getLatestBlockhash":
          return reply({
            value: { blockhash: key(20), lastValidBlockHeight: 500 },
          });
        case "getTokenAccountBalance":
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            error: { message: "Invalid param: could not find account" },
          });
        case "simulateTransaction":
          return reply({
            value: {
              err: null,
              accounts: [
                {
                  data: [b64(tokenAccount(state.confirmedAccrued)), "base64"],
                },
              ],
            },
          });
        case "sendTransaction": {
          const raw = unb64(params[0] as string);
          state.sent.push(params[0] as string);
          return reply(solanaBase58(raw.slice(1, 65)));
        }
        case "getSignatureStatuses":
          return reply({
            value: [{ err: null, confirmationStatus: "confirmed" }],
          });
        case "getTransaction": {
          const credit = state.receipt ?? state.confirmedAccrued;
          const balance = (owner: string, amount: bigint) => ({
            owner,
            mint: SOLANA_USDC,
            uiTokenAmount: { amount: amount.toString() },
          });
          return reply({
            meta: {
              err: null,
              preTokenBalances: [
                balance(wallet, 0n),
                balance(PROJECT, VAULT_BALANCE),
              ],
              postTokenBalances: [
                balance(wallet, credit),
                balance(PROJECT, VAULT_BALANCE - state.confirmedAccrued),
              ],
            },
          });
        }
        case "getBlockHeight":
          return reply(100);
        default:
          throw new Error(`unexpected RPC ${method}`);
      }
    }) as unknown as typeof fetch;
    const network = parseConfig({
      FEE_CONVERTER_MODE: "live",
      FEE_CONVERTER_NETWORKS: "solana",
      FEE_WALLET_SOLANA: wallet,
      ...LIMITS,
    });
    const client = (signing: boolean) =>
      createSolanaClient({
        config: network.networks[0],
        limits: network.limits,
        jupiterApiUrl: "https://jupiter.invalid",
        jupiterApiKey: null,
        keypair: signing ? keypair : undefined,
        fetch: rpcFetch,
        sleep: async () => {},
        verifyDeployment: async (escrow) => {
          state.verified.push(escrow);
          return projectBytes(state.finalizedAccrued);
        },
      });
    return { state, client, network };
  }

  function solanaRun(mode: "dry_run" | "live") {
    const chain = solanaChain();
    const { db } = sqliteD1();
    const events: Record<string, unknown>[] = [];
    let id = 0;
    const deps: RunDependencies = {
      mode,
      trigger: "recovery",
      limits: chain.network.limits,
      store: new D1ConversionStore(db),
      now: () => new Date("2026-10-24T12:00:00Z"),
      randomId: () => `id-${String(++id).padStart(6, "0")}`,
      projectTokens: async () => [],
      projectVaults: async () => [vault()],
      client: () => chain.client(mode === "live"),
      log: (event) => events.push(event),
    };
    return { ...chain, deps, events, config: chain.network.networks[0] };
  }

  test("accrued fees are read only after the reviewed deployment verifies", async () => {
    const { state, client } = solanaChain();
    const fees = client(false).vaultFees;
    expect(await fees?.accrued(vault({}, "security-bounty"))).toEqual({
      asset: SOLANA_USDC,
      amount: 10_000_000n,
    });
    expect(state.verified).toEqual([
      expect.objectContaining({
        genesisHash: MAINNET_GENESIS,
        programId: PROGRAM,
        projectPda: PROJECT,
        vault: VAULT,
        mint: SOLANA_USDC,
        feeRecipient: wallet,
        payoutPolicy: "security-bounty",
      }),
    ]);
    state.finalizedAccrued = 0n;
    expect(await fees?.accrued(vault())).toBeNull();
  });

  test("another fee recipient, a forged vault or an incomplete record is never claimed", async () => {
    const { state, client } = solanaChain();
    const fees = client(true).vaultFees;
    expect(await fees?.accrued(vault({ feeRecipient: key(40) }))).toBeNull();
    await expect(fees?.accrued(vault({ vault: key(41) }))).rejects.toThrow(
      /not the reviewed project's vault address/,
    );
    await expect(
      fees?.accrued(vault({ rotationAuthority: undefined })),
    ).rejects.toThrow(/lacks rotationAuthority/);
    await expect(
      fees?.accrued(vault({ network: "base-mainnet" })),
    ).rejects.toThrow(/is not Solana/);
    await expect(fees?.claim(vault({ feeRecipient: key(40) }))).rejects.toThrow(
      /another fee recipient/,
    );
    expect(state.verified).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  test("a claim signs only claim_fees into the fee wallet's own token account", async () => {
    const { state, client } = solanaChain();
    const { txId } = (await client(true).vaultFees?.claim(vault())) ?? {};
    expect(state.sent).toHaveLength(1);
    const raw = unb64(state.sent[0]);
    const parsed = parseTransaction(raw);
    expect(parsed.signatureCount).toBe(1);
    expect(parsed.requiredSignatures).toBe(1);
    expect(parsed.staticKeys[0]).toBe(wallet);
    expect(parsed.programs).toEqual([ATA_PROGRAM, PROGRAM]);
    expect([...parsed.staticKeys].sort()).toEqual(
      [
        wallet,
        ata(SOLANA_USDC, wallet),
        PROJECT,
        VAULT,
        SOLANA_USDC,
        ATA_PROGRAM,
        PROGRAM,
        TOKEN_PROGRAM,
        SYSTEM_PROGRAM,
      ].sort(),
    );
    const signature = raw.slice(1, 65);
    expect(
      ed25519.verify(signature, raw.slice(parsed.messageOffset), publicKey),
    ).toBe(true);
    expect(txId).toBe(solanaBase58(signature));
  });

  test("an unfinalized earlier claim or project transaction blocks a new claim", async () => {
    const { state, client } = solanaChain();
    const fees = client(true).vaultFees;
    state.confirmedAccrued = 0n;
    await expect(fees?.claim(vault())).rejects.toThrow(
      /confirmed but not yet finalized/,
    );
    state.confirmedAccrued = 10_000_000n;
    state.unfinalized = true;
    await expect(fees?.claim(vault())).rejects.toThrow(/not yet finalized/);
    expect(state.sent).toEqual([]);
  });

  test("a receipt that does not match the vault fee fails the claim", async () => {
    const { state, client } = solanaChain();
    state.receipt = 9_000_000n;
    await expect(client(true).vaultFees?.claim(vault())).rejects.toThrow(
      /receipt does not match the vault fee/,
    );
  });

  test("a dry run reports the claim and signs nothing", async () => {
    const run = solanaRun("dry_run");
    const result = await runNetwork(run.config, run.deps);
    expect(result.claimed).toBe(0);
    expect(run.events).toContainEqual(
      expect.objectContaining({
        event: "fee_claim_quoted",
        network: "solana",
        vault: VAULT,
        amount: "10000000",
      }),
    );
    expect(run.state.sent).toEqual([]);
  });

  test("a live run claims once and a rerun finds nothing left to claim", async () => {
    const run = solanaRun("live");
    expect((await runNetwork(run.config, run.deps)).claimed).toBe(1);
    expect(run.events).toContainEqual(
      expect.objectContaining({ event: "fee_claim_included", vault: VAULT }),
    );
    run.state.finalizedAccrued = 0n;
    run.state.confirmedAccrued = 0n;
    expect((await runNetwork(run.config, run.deps)).claimed).toBe(0);
    expect(run.state.sent).toHaveLength(1);
  });

  test("a fee below the dust threshold keeps accruing in the vault", async () => {
    const run = solanaRun("live");
    run.state.finalizedAccrued = 1_000_000n;
    expect((await runNetwork(run.config, run.deps)).claimed).toBe(0);
    expect(run.events).toContainEqual(
      expect.objectContaining({
        event: "fee_claim_skipped",
        reason: "below the minimum conversion value",
      }),
    );
    expect(run.state.sent).toEqual([]);
  });
});
