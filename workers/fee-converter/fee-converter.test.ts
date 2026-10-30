import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { FeeCapTooLowError } from "viem";
import { handleFeeConversionsApi } from "../../backend/fee-conversions/handler";
import {
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  type SolanaEscrowConfig,
  solanaBase58,
  solanaVaultAddress,
} from "../../contracts/solana/adapter";
import { ata } from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { parseConfig } from "./config";
import {
  type ChainClient,
  type ConversionRow,
  type FeeVault,
  type PreparedSend,
  type Quote,
  type QuoteResult,
  type RunDependencies,
  runNetwork,
  type SendStatus,
} from "./core";
import { createEvmClient } from "./evm";
import worker, { runOnce } from "./index";
import { NativeGasJournal } from "./native-gas";
import { createSolanaClient, parseTransaction } from "./solana";
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
  FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({
    base: {
      perTransaction: "10000000000000000",
      perDay: "100000000000000000",
      additionalFeeReserve: "1000000000000",
    },
    ethereum: {
      perTransaction: "10000000000000000",
      perDay: "100000000000000000",
      additionalFeeReserve: "0",
    },
  }),
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
  test("a scheduled startup failure preserves completed network work, and off leaves its records unchanged", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const privateKey = `0x${"1".repeat(64)}` as const;
    const wallet = privateKeyToAccount(privateKey).address.toLowerCase();
    const { db, sqlite } = sqliteD1();
    const errors: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    const originalFetch = globalThis.fetch;
    const network = config({ FEE_WALLET_BASE: wallet }).networks[0];
    let requests = 0;
    globalThis.fetch = (async (input, init) => {
      requests++;
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === "https://aggregator-api.kyberswap.com") {
        return Response.json({
          code: 0,
          data: {
            routerAddress: network.definition.router,
            routeSummary: {
              tokenIn: TOKEN,
              tokenOut: USDC,
              amountIn: "4000000",
              amountOut: "4000000",
              amountInUsd: "4",
              amountOutUsd: "4",
              gasUsd: "0.01",
              l1FeeUsd: "0.01",
            },
          },
        });
      }
      if (url.origin !== "https://base.fixture.invalid")
        throw new Error(`Unexpected Worker origin ${url.origin}`);
      const rpc = await request.json();
      if (
        rpc.method !== "eth_call" ||
        !rpc.params[0].data.startsWith("0x70a08231")
      )
        throw new Error(`Unexpected Worker RPC ${rpc.method}`);
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: `0x${(rpc.params[0].to.toLowerCase() === TOKEN ? 4000000n : 0n).toString(16).padStart(64, "0")}`,
      });
    }) as typeof fetch;
    console.error = (line: string) => errors.push(line);
    console.log = () => {};
    const env = {
      FEE_DB: db,
      FEE_CONVERTER_MODE: "live",
      FEE_CONVERTER_NETWORKS: "ethereum,base",
      FEE_WALLET_BASE: wallet,
      FEE_WALLET_ETHEREUM: WALLET,
      RPC_URL_BASE: "https://base.fixture.invalid",
      FEE_WALLET_KEY_BASE: privateKey,
      FEE_CONVERTER_ALLOWLIST: JSON.stringify({ base: [TOKEN] }),
      ...LIMITS,
    };
    try {
      let work: Promise<unknown> | undefined;
      await worker.scheduled(undefined, env, {
        waitUntil(promise) {
          work = promise;
        },
      });
      if (!work)
        throw new Error("The scheduled Worker did not provide its work");
      await expect(work).rejects.toThrow("fee conversion failed on 1 networks");
      const records = () =>
        sqlite.query("SELECT * FROM fee_conversions ORDER BY id").all();
      const completed = records();
      expect(completed).toMatchObject([
        {
          network: "base",
          fee_wallet: wallet,
          token: TOKEN,
          amount_in: "4000000",
          quote_amount_out: "4000000",
          state: "pending",
          reason: "below the minimum conversion value",
          raw_tx: null,
        },
      ]);
      expect(completed).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("live mode needs FEE_WALLET_KEY_ETHEREUM");
      expect(sqlite.query("SELECT * FROM fee_converter_locks").all()).toEqual(
        [],
      );
      const beforeOff = requests;
      const { FEE_CONVERTER_MODE: _mode, ...defaultOff } = env;
      expect(await runOnce(defaultOff)).toEqual([]);
      expect(await runOnce({ ...env, FEE_CONVERTER_MODE: "off" })).toEqual([]);
      expect(records()).toEqual(completed);
      expect(requests).toBe(beforeOff);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalError;
      console.log = originalLog;
      sqlite.close();
    }
  });
});

describe("USDC routes", () => {
  test("retained Robinhood fees report not converted through receipt and recovery runs without quotes or keys", async () => {
    const { db, sqlite } = sqliteD1();
    const events: string[] = [];
    const original = console.log;
    console.log = (line: string) => events.push(line);
    try {
      const env = {
        FEE_DB: db,
        FEE_CONVERTER_MODE: "live",
        FEE_CONVERTER_NETWORKS: "robinhood",
        FEE_WALLET_ROBINHOOD: WALLET,
        FEE_CONVERTER_ALLOWLIST: JSON.stringify({ robinhood: [TOKEN, USDG] }),
        ...LIMITS,
        get FEE_WALLET_KEY_ROBINHOOD(): string {
          throw new Error("retained fees must not load a signing key");
        },
      };
      let requests = 0;
      for (const mode of ["dry_run", "live"])
        for (const trigger of ["receipts", "recovery"] as const) {
          const results = await runOnce(
            Object.assign(env, { FEE_CONVERTER_MODE: mode }),
            undefined,
            {
              fetch: (async () => {
                requests += 1;
                throw new Error(
                  "retained fees must not request a route or send",
                );
              }) as unknown as typeof fetch,
            },
            trigger,
          );
          expect(results).toEqual([
            expect.objectContaining({
              network: "robinhood",
              status: "not_converted",
              claimed: 0,
            }),
          ]);
        }
      expect(requests).toBe(0);
      const response = await handleFeeConversionsApi(
        new Request("https://slop.cash/api/v1/admin/fee-conversions"),
        {
          db,
          adminGithubIds: new Set(["1"]),
          sessionActor: async () => ({ githubId: "1" }),
        },
      );
      expect(response?.status).toBe(200);
      const report = await response?.json();
      expect(
        report.routes.find(
          (route: { network: string }) => route.network === "robinhood",
        ),
      ).toEqual({
        network: "robinhood",
        targetToken: null,
        status: "not_converted",
      });
      expect(report.totals).toEqual([]);
      expect(
        events.some((line) =>
          line.includes('"event":"fee_conversion_not_converted"'),
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
});

describe("Kyber gas pricing in the conversion workflow", () => {
  // The fields follow the live 2026-10-25 /routes response. The token and
  // amounts are synthetic; only gas pricing varies in the refusal controls.
  function quotedRun(
    network: "base" | "ethereum",
    costs: Record<string, unknown>,
  ) {
    const h = harness({
      env: {
        FEE_CONVERTER_NETWORKS: network,
        FEE_WALLET_ETHEREUM: WALLET,
        FEE_CONVERTER_ALLOWLIST: JSON.stringify({ [network]: [TOKEN] }),
      },
    });
    let requests = 0;
    const client = createEvmClient({
      config: h.network,
      limits: h.deps.limits,
      kyberClientId: "test",
      fetch: (async (input, init) => {
        const url = new URL(String(input));
        expect(init?.method ?? "GET").toBe("GET");
        expect(url.origin).toBe("https://aggregator-api.kyberswap.com");
        expect(url.pathname).toBe(`/${network}/api/v1/routes`);
        expect(url.searchParams.get("gasInclude")).toBe("true");
        requests++;
        return Response.json({
          code: 0,
          data: {
            routerAddress: h.network.definition.router,
            routeSummary: {
              tokenIn: TOKEN,
              tokenOut: h.network.definition.usdc,
              amountIn: "20000000",
              amountOut: "20000000",
              amountInUsd: "20",
              amountOutUsd: "20",
              gas: "330498",
              gasPrice: "6000000",
              gasUsd: "0.004650942632151648",
              l1FeeUsd: network === "base" ? "0.000010361403900382059" : "0",
              ...costs,
            },
          },
        });
      }) as typeof fetch,
    });
    h.chain.quote = client.quote;
    return { ...h, requests: () => requests };
  }

  for (const [network, field, value] of [
    ["base", "gasUsd", undefined],
    ["ethereum", "gasUsd", undefined],
    ["base", "gasUsd", null],
    ["ethereum", "gasUsd", "unpriced"],
    ["base", "gasUsd", "-1"],
    ["base", "l1FeeUsd", undefined],
    ["base", "l1FeeUsd", null],
    ["base", "l1FeeUsd", "unpriced"],
    ["ethereum", "l1FeeUsd", "unpriced"],
  ] as const) {
    test(`${network} ${field}=${String(value)} refuses before preparation`, async () => {
      const h = quotedRun(network, { [field]: value });
      try {
        await runNetwork(h.network, h.deps);
        expect(h.requests()).toBe(1);
        expect(h.chain.prepared).toBe(0);
        expect(h.chain.sent).toEqual([]);
        expect(h.rows()).toEqual([]);
        expect(h.events).toContainEqual({
          event: "fee_conversion_error",
          network,
          token: TOKEN,
          error: "KyberSwap gas cost is unavailable",
        });
        expect(h.locks()).toEqual([]);
      } finally {
        h.sqlite.close();
      }
    });
  }

  for (const [network, costs, state] of [
    ["base", {}, "submitted"],
    ["base", { gasUsd: "0", l1FeeUsd: "0" }, "submitted"],
    ["ethereum", { gasUsd: 0, l1FeeUsd: undefined }, "submitted"],
    ["ethereum", { gasUsd: "2.000001", l1FeeUsd: undefined }, "pending"],
    ["base", { gasUsd: "1", l1FeeUsd: "1.000001" }, "pending"],
  ] as const) {
    test(`${network} valid costs ${JSON.stringify(costs)} retain the 10x gate`, async () => {
      const h = quotedRun(network, costs);
      try {
        await runNetwork(h.network, h.deps);
        expect(h.requests()).toBe(1);
        expect(h.rows()).toHaveLength(1);
        expect(h.rows()[0]).toMatchObject({
          state,
          reason: state === "pending" ? "below the gas-cost multiple" : null,
        });
        expect(h.chain.prepared).toBe(state === "submitted" ? 1 : 0);
        expect(h.chain.sent).toHaveLength(state === "submitted" ? 1 : 0);
        expect(
          h.events.some((event) => event.event === "fee_conversion_error"),
        ).toBe(false);
      } finally {
        h.sqlite.close();
      }
    });
  }

  // The configured cap is 200 bps. 20 -> 19.6 USD is exactly 200 bps;
  // 20 -> 19.599 USD is 200.5 bps and must not round down to the cap.
  for (const [amountOutUsd, bps, state] of [
    ["19.6", 200, "submitted"],
    ["19.599", 201, "skipped"],
  ] as const) {
    test(`a Kyber price impact to ${amountOutUsd} USD counts as ${bps} bps`, async () => {
      const h = quotedRun("base", { amountOutUsd });
      try {
        await runNetwork(h.network, h.deps);
        expect(h.rows()[0]).toMatchObject({
          state,
          reason: state === "skipped" ? "price impact above the cap" : null,
        });
        expect(h.chain.prepared).toBe(state === "submitted" ? 1 : 0);
      } finally {
        h.sqlite.close();
      }
    });
  }
});

describe("receipt-triggered conversion", () => {
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
  test("an approval is journaled before an ambiguous broadcast and excludes conversion totals", async () => {
    const h = harness();
    h.chain.prepare = async () => ({
      kind: "approval",
      txId: `0x${"a".repeat(64)}`,
      rawTx: "0xapproval",
      evmNonce: 7,
      expiresAt: null,
      approvalTxId: `0x${"a".repeat(64)}`,
      minAmountOut: 0n,
    });
    h.chain.broadcast = async () => {
      expect(h.rows()[0]).toMatchObject({
        kind: "approval",
        state: "submitted",
        raw_tx: "0xapproval",
        evm_nonce: 7,
      });
      throw new Error("approval response lost");
    };
    await runNetwork(h.network, h.deps);
    expect(h.rows()[0]).toMatchObject({
      kind: "approval",
      state: "unknown",
      raw_tx: "0xapproval",
      evm_nonce: 7,
      reason: "broadcast: approval response lost",
    });
    expect(await h.deps.store.liveValueSince("base", "2000")).toBe(0n);
    expect(await h.deps.store.latest("base", TOKEN)).toBeNull();
    const { handleFeeConversionsApi } = await import(
      "../../backend/fee-conversions/handler"
    );
    const response = await handleFeeConversionsApi(
      new Request("https://slop.cash/api/v1/admin/fee-conversions"),
      {
        db: h.db,
        adminGithubIds: new Set(["1"]),
        sessionActor: async () => ({ githubId: "1" }),
      },
    );
    const body = (await response?.json()) as {
      recent: unknown[];
      totals: unknown[];
    };
    expect(body.recent).toEqual([]);
    expect(body.totals).toEqual([]);
    let prepared = false;
    h.chain.prepare = async () => {
      prepared = true;
      throw new Error("must not prepare");
    };
    h.chain.statusFor = () => ({ kind: "rebroadcast" });
    const delivered: string[] = [];
    h.chain.broadcast = async (raw) => {
      delivered.push(raw);
    };
    await runNetwork(h.network, h.deps);
    expect(prepared).toBe(false);
    expect(delivered).toEqual(["0xapproval"]);
    expect(h.rows()).toHaveLength(1);
  });

  test("a canonical approval permits a fresh later swap without counting the approval value", async () => {
    const h = harness();
    const prepareSwap = h.chain.prepare;
    h.chain.prepare = async () => ({
      kind: "approval",
      txId: `0x${"a".repeat(64)}`,
      rawTx: "0xapproval",
      evmNonce: 6,
      expiresAt: null,
      approvalTxId: `0x${"a".repeat(64)}`,
      minAmountOut: 0n,
    });
    await runNetwork(h.network, h.deps);
    expect(h.rows()[0].kind).toBe("approval");
    h.chain.statusFor = (row) =>
      row.kind === "approval"
        ? { kind: "finalized", amountOut: 0n }
        : { kind: "pending" };
    h.chain.prepare = prepareSwap;
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    await runNetwork(h.network, h.deps);
    expect(h.chain.sent).toEqual(["0xapproval", "0xraw1"]);
    expect(
      h.rows().map((row) => [row.kind, row.state, row.amount_out]),
    ).toEqual([
      ["approval", "finalized", "0"],
      ["conversion", "submitted", null],
    ]);
    expect(await h.deps.store.liveValueSince("base", "2000")).toBe(20_000_000n);
  });

  test("a legacy failed approval hash stays held without inventing its raw bytes", async () => {
    const h = harness();
    h.sqlite.exec(`INSERT INTO fee_conversions
      (id,run_id,network,mode,fee_wallet,token,target_token,amount_in,approval_tx_id,evm_nonce,state,reason,created_at,updated_at)
      VALUES('old-approval','old-run-0001','base','live','${WALLET}','${TOKEN}','${USDC}','20000000','0x${"a".repeat(64)}',7,'failed','old approval timeout','before','before')`);
    const before = h.rows()[0];
    h.chain.statusFor = (row) => {
      expect(row.kind).toBe("approval");
      expect(row.rawTx).toBeNull();
      expect(row.txId).toBe(`0x${"a".repeat(64)}`);
      return { kind: "pending", mined: true };
    };
    await runNetwork(h.network, h.deps);
    expect(h.chain.prepared).toBe(0);
    expect(h.chain.sent).toEqual([]);
    expect(h.rows()).toEqual([before]);

    // A dropped legacy hash also reserves its nonce against another token.
    h.deps.projectTokens = async () => [OTHER];
    h.chain.balances.set(OTHER, 20_000_000n);
    let floor: number | undefined;
    h.chain.prepare = async (_token, _quote, nonceFloor) => {
      floor = nonceFloor;
      throw new Error("node nonce is below the retained approval");
    };
    await runNetwork(h.network, h.deps);
    expect(floor).toBe(8);
    expect(h.chain.sent).toEqual([]);
    expect(h.rows()[0]).toEqual(before);
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
    h.chain.prepare = async (token, quote, nonceFloor) => {
      leaseAtSign.push(h.locks()[0]?.expires_at ?? "none");
      h.clock.now = new Date(h.clock.now.getTime() + 8 * 60 * 1000);
      return prepare(token, quote, nonceFloor);
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
    h.chain.prepare = async (token, quote, nonceFloor) => {
      // A send waits for receipts; this one outlives the lease and the
      // successor run takes it before the next chunk.
      h.clock.now = new Date(h.clock.now.getTime() + 15 * 60 * 1000);
      await h.deps.store.acquireLock("base", "successor", h.clock.now);
      return prepare(token, quote, nonceFloor);
    };

    const result = await runNetwork(h.network, h.deps);

    // Preparation returned after takeover. Its bytes are not persisted or
    // broadcast, and the loop stops instead of preparing a second chunk.
    expect(h.chain.prepared).toBe(1);
    expect(result.records.submitted).toBe(0);
    expect(result.records.failed).toBe(1);
    expect(h.chain.sent).toEqual([]);
    expect(h.events).toContainEqual(
      expect.objectContaining({ event: "fee_conversion_lock_lost" }),
    );
  });
});

describe("replacement lease and restart recovery", () => {
  async function pending() {
    const h = harness();
    await runNetwork(h.network, h.deps);
    h.chain.sent.length = 0;
    h.clock.now = new Date(h.clock.now.getTime() + 4 * 60 * 1000);
    let replacements = 0;
    h.chain.replace = async (_row, _history, assertLease) => {
      await assertLease?.();
      replacements += 1;
      return {
        txId: `0x${"b".repeat(64)}`,
        rawTx: "0xreplacement",
        maxFeePerGas: 125n,
        maxPriorityFeePerGas: 25n,
      };
    };
    const takeover = async () => {
      h.clock.now = new Date(h.clock.now.getTime() + 15 * 60 * 1000);
      expect(
        await h.deps.store.acquireLock("base", "successor", h.clock.now),
      ).toBe(true);
    };
    return { ...h, takeover, replacements: () => replacements };
  }

  test("a slow reconciliation cannot replace after lease takeover", async () => {
    const h = await pending();
    h.chain.status = async () => {
      await h.takeover();
      return { kind: "pending" };
    };
    let entered = false;
    h.chain.replace = async () => {
      entered = true;
      return {
        txId: `0x${"b".repeat(64)}`,
        rawTx: "0xreplacement",
        maxFeePerGas: 125n,
        maxPriorityFeePerGas: 25n,
      };
    };
    await runNetwork(h.network, h.deps);
    expect(entered).toBe(false);
    expect(
      await h.deps.store.replacements(String(h.rows()[0].id)),
    ).toHaveLength(0);
    expect(h.chain.sent).toEqual([]);
    expect(h.locks()[0].run_id).toBe("successor");
  });

  test("replacement work that outlives its lease keeps the original pending", async () => {
    const h = await pending();
    h.chain.replace = async () => {
      await h.takeover();
      return {
        txId: `0x${"b".repeat(64)}`,
        rawTx: "0xreplacement",
        maxFeePerGas: 125n,
        maxPriorityFeePerGas: 25n,
      };
    };
    await runNetwork(h.network, h.deps);
    expect(
      await h.deps.store.replacements(String(h.rows()[0].id)),
    ).toHaveLength(0);
    expect(h.chain.sent).toEqual([]);
    expect(h.rows()[0].state).toBe("submitted");
  });

  test("the replacement append refuses a successor lease taken during the database wait", async () => {
    const h = await pending();
    const insert = h.deps.store.insertReplacement.bind(h.deps.store);
    h.deps.store.insertReplacement = async (...args) => {
      await h.takeover();
      return insert(...args);
    };
    await runNetwork(h.network, h.deps);
    expect(
      await h.deps.store.replacements(String(h.rows()[0].id)),
    ).toHaveLength(0);
    expect(h.chain.sent).toEqual([]);
  });

  test("an append cannot revive an original settled during the database wait", async () => {
    const h = await pending();
    const insert = h.deps.store.insertReplacement.bind(h.deps.store);
    h.deps.store.insertReplacement = async (...args) => {
      await h.deps.store.update(String(h.rows()[0].id), {
        state: "failed",
        reason: "canonical reverted receipt",
      });
      return insert(...args);
    };
    await runNetwork(h.network, h.deps);
    expect(
      await h.deps.store.replacements(String(h.rows()[0].id)),
    ).toHaveLength(0);
    expect(h.chain.sent).toEqual([]);
    expect(h.rows()[0].state).toBe("failed");
  });

  test("lease loss after journaling preserves bytes without broadcasting", async () => {
    const h = await pending();
    const insert = h.deps.store.insertReplacement.bind(h.deps.store);
    h.deps.store.insertReplacement = async (...args) => {
      const written = await insert(...args);
      await h.takeover();
      return written;
    };
    await runNetwork(h.network, h.deps);
    expect(
      await h.deps.store.replacements(String(h.rows()[0].id)),
    ).toHaveLength(1);
    expect(h.chain.sent).toEqual([]);
    expect(h.rows()[0].state).toBe("submitted");
  });

  test("a delayed restart delivers journaled bytes before another fee step", async () => {
    const h = await pending();
    await runNetwork(h.network, h.deps);
    expect(h.replacements()).toBe(1);
    h.chain.sent.length = 0;
    h.clock.now = new Date(h.clock.now.getTime() + 4 * 60 * 1000);
    h.chain.status = async () => ({
      kind: "rebroadcast",
      rawTx: "0xreplacement",
    });
    await runNetwork(h.network, h.deps);
    expect(h.replacements()).toBe(1);
    expect(h.chain.sent).toEqual(["0xreplacement"]);
    expect(
      await h.deps.store.replacements(String(h.rows()[0].id)),
    ).toHaveLength(1);
  });

  test("an explicit node fee refusal can escalate after trying the journaled bytes", async () => {
    const h = await pending();
    const attempts: string[] = [];
    h.chain.status = async () => ({ kind: "rebroadcast", rawTx: "0xraw1" });
    h.chain.broadcast = async (raw) => {
      attempts.push(raw);
      if (raw === "0xraw1") throw new FeeCapTooLowError();
    };
    await runNetwork(h.network, h.deps);
    expect(attempts).toEqual(["0xraw1", "0xreplacement"]);
    expect(h.replacements()).toBe(1);
    expect(h.rows()[0].state).toBe("submitted");
  });

  test("an uncertain rebroadcast never skips to a new fee step", async () => {
    const h = await pending();
    h.chain.status = async () => ({ kind: "rebroadcast", rawTx: "0xraw1" });
    h.chain.broadcastError = new Error("response lost");
    await runNetwork(h.network, h.deps);
    expect(h.replacements()).toBe(0);
    expect(
      await h.deps.store.replacements(String(h.rows()[0].id)),
    ).toHaveLength(0);
    expect(h.rows()[0].state).toBe("unknown");
  });
});

describe("D1 contract", () => {
  test("native conversion spends finalized fee credits and retains gas, never wallet topups", async () => {
    const native = "0x0000000000000000000000000000000000000000";
    const h = harness({
      env: {
        FEE_CONVERTER_ALLOWLIST: JSON.stringify({ base: [native] }),
        FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({
          base: {
            perTransaction: "1000",
            perDay: "10000",
            additionalFeeReserve: "1",
          },
        }),
      },
    });
    h.chain.balances.set(native, 1_000_000_000n);
    await runNetwork(h.network, h.deps);
    expect(h.chain.prepared).toBe(0);
    expect(h.rows()).toHaveLength(0);
    const stamp = "2026-10-18T11:59:00Z";
    h.sqlite
      .prepare(`INSERT INTO fee_conversions
      (id,run_id,kind,network,mode,fee_wallet,token,target_token,amount_in,amount_out,
       tx_id,raw_tx,state,created_at,updated_at,submitted_at,finalized_at)
      VALUES('native-claim','native-run','claim','base','live',?,?,?,'30000000','30000000',
       'native-claim-hash','native-claim-wire','finalized',?,?,?,?)`)
      .run(WALLET, native, USDC, stamp, stamp, stamp, stamp);
    h.sqlite
      .prepare(`INSERT INTO fee_native_gas
      (id,network,fee_wallet,nonce,intent_hash,run_id,maximum_wei,per_transaction_wei,
       per_day_wei,state,tx_id,created_at,actual_wei,settled_day,receipt_block_hash)
      VALUES('native-claim-gas','base',?,1,'native-intent','native-run','1000','1000',
       '10000','signed','native-claim-hash',?,'100','2026-10-18','native-block')`)
      .run(WALLET, stamp);
    await runNetwork(h.network, h.deps);
    const conversion = h.rows().find((row) => row.kind === "conversion");
    expect(conversion?.amount_in).toBe("29998900");
    expect(h.chain.prepared).toBe(1);
    h.chain.statusFor = () => ({ kind: "finalized", amountOut: 29_998_900n });
    await runNetwork(h.network, h.deps);
    expect(h.chain.prepared).toBe(1);
    expect(await h.deps.store.nativeFeeBalance?.("base", native, WALLET)).toBe(
      1000n,
    );
    expect(h.rows().filter((row) => row.kind === "conversion")).toHaveLength(1);
  });

  test("native credit accounting retains separate Solana transaction fees", async () => {
    const { db, sqlite } = sqliteD1();
    const native = "11111111111111111111111111111111";
    const stamp = "2026-10-18T11:59:00Z";
    sqlite
      .prepare(`INSERT INTO fee_conversions
      (id,run_id,kind,network,mode,fee_wallet,token,target_token,amount_in,amount_out,
       tx_id,raw_tx,state,created_at,updated_at,submitted_at,finalized_at)
      VALUES('native-sol-claim','native-run','claim','solana','live',?,?,?,'1000000','1000000',
       'native-sol-hash','native-sol-wire','finalized',?,?,?,?)`)
      .run(WALLET, native, USDC, stamp, stamp, stamp, stamp);
    for (const [id, nonce, cost] of [
      ["solana-claim-gas", 0, "5000"],
      ["solana-swap-gas", 1, "7000"],
    ] as const)
      sqlite
        .prepare(`INSERT INTO fee_native_gas
        (id,network,fee_wallet,nonce,intent_hash,run_id,maximum_wei,per_transaction_wei,
         per_day_wei,state,tx_id,created_at,actual_wei,settled_day,receipt_block_hash)
        VALUES(?,'solana',?,?,'native-intent','native-run','10000','10000',
         '100000','signed',?, ?,?,'2026-10-18','native-block')`)
        .run(id, WALLET, nonce, `${id}-signature`, stamp, cost);
    expect(
      await new D1ConversionStore(db).nativeFeeBalance(
        "solana",
        native,
        WALLET,
      ),
    ).toBe(988000n);
  });

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
      .prepare("SELECT * FROM fee_conversions ORDER BY id")
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
    sqlite.exec(
      readFileSync(new URL("0087_fee_send_replacements.sql", dir), "utf8"),
    );
    sqlite.exec(
      `INSERT INTO fee_send_replacements VALUES ('replacement-old', 'id-submitted', 'base', 1, 4, '0x${"a".repeat(64)}', '0x0506', '125', '25', 'then')`,
    );
    sqlite.exec(`INSERT INTO fee_conversions
      (id,run_id,network,mode,fee_wallet,token,target_token,amount_in,approval_tx_id,evm_nonce,state,reason,created_at,updated_at)
      VALUES('old-approval','old-run-0001','base','live','${WALLET}','${TOKEN}','${USDC}','7','0x${"b".repeat(64)}',7,'failed','old approval timeout','before','before')`);
    const priorRows = sqlite
      .prepare("SELECT * FROM fee_conversions ORDER BY id")
      .all();
    const priorAttempts = sqlite
      .query("SELECT * FROM fee_send_replacements")
      .all();
    sqlite.exec(
      readFileSync(new URL("0088_fee_approval_journal.sql", dir), "utf8"),
    );
    expect(
      sqlite.prepare("SELECT * FROM fee_conversions ORDER BY id").all(),
    ).toEqual(priorRows);
    expect(sqlite.query("SELECT * FROM fee_send_replacements").all()).toEqual(
      priorAttempts,
    );
    expect(() =>
      sqlite.exec("UPDATE fee_send_replacements SET raw_tx='0x9999'"),
    ).toThrow(/permanent/);
    expect(() =>
      sqlite.exec("DELETE FROM fee_conversions WHERE id='old-approval'"),
    ).toThrow(/permanent/);
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
});

describe("Solana vault fee claims", () => {
  const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
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
  function solanaChain(
    asset = SOLANA_USDC,
    tokenProgram = TOKEN_PROGRAM,
    mintBytes?: Uint8Array,
  ) {
    const budgets = {
      perTransaction: "5000000",
      perDay: "20000000",
      additionalFeeReserve: "0",
    };
    const native = sqliteD1();
    native.sqlite.exec(
      `INSERT INTO fee_converter_locks(network,run_id,expires_at) VALUES('solana','native-fixture','2099-01-01T00:00:00.000Z')`,
    );
    const nativeJournal = new NativeGasJournal(
      native.db,
      "solana",
      wallet,
      "native-fixture",
      budgets,
      () => new Date("2026-10-24T12:00:00Z"),
    );
    const state = {
      expiredMissing: false,
      secondaryFailure: false,
      nativeQuoteOut: null as string | null,
      nativeFee: 5000,
      rent: 1488440,
      rentSizes: [] as number[],
      walletDebit: 1493440,
      finalizedAccrued: 10_000_000n,
      confirmedAccrued: 10_000_000n,
      unfinalized: false,
      /** Fee-wallet credit the claim receipt reports; null means the accrued fee. */
      receipt: null as bigint | null,
      sent: [] as string[],
      verified: [] as SolanaEscrowConfig[],
    };
    const rpcFetch = (async (_url: string, init?: RequestInit) => {
      if (_url.startsWith("https://jupiter.invalid/quote?")) {
        const p = new URL(_url).searchParams;
        const amount = p.get("amount")!;
        const out =
          state.nativeQuoteOut === null
            ? (BigInt(amount) * 100000000n) / 1000000000n
            : BigInt(state.nativeQuoteOut);
        return Response.json({
          inputMint: p.get("inputMint"),
          outputMint: p.get("outputMint"),
          inAmount: amount,
          outAmount: out.toString(),
          otherAmountThreshold: out.toString(),
          swapMode: "ExactIn",
          slippageBps: 100,
          priceImpactPct: "0",
          platformFee: null,
        });
      }
      const { method, params } = JSON.parse(String(init?.body)) as {
        method: string;
        params: unknown[];
      };
      const reply = (result: unknown) =>
        Response.json({ jsonrpc: "2.0", id: 1, result });
      if (state.secondaryFailure && _url.includes("publicnode.com"))
        throw new Error("secondary provider offline");
      switch (method) {
        case "getGenesisHash":
          return reply(MAINNET_GENESIS);
        case "getFirstAvailableBlock":
          return reply(0);
        case "isBlockhashValid":
          return reply({
            context: { slot: 1000 },
            value: !state.expiredMissing,
          });
        case "getBalance":
          return reply({ value: 100000000 });
        case "getFeeForMessage":
          return reply({ context: { slot: 100 }, value: state.nativeFee });
        case "getMinimumBalanceForRentExemption":
          state.rentSizes.push(params[0] as number);
          return reply(state.rent);
        case "getBlocks":
          return reply([100]);
        case "getBlock":
          return reply({
            blockhash: params[0] === 100 ? key(20) : key(21),
            previousBlockhash: params[0] === 100 ? key(19) : key(20),
            parentSlot: params[0] === 100 ? 0 : 100,
            signatures: state.expiredMissing
              ? []
              : state.sent.map((raw) => solanaBase58(unb64(raw).slice(1, 65))),
          });
        case "getAccountInfo":
          if (params[0] === asset) {
            const mint = mintBytes?.slice() ?? new Uint8Array(82);
            mint[44] = 6;
            mint[45] = 1;
            return reply({
              value: {
                owner: tokenProgram,
                data: [b64(mint), "base64"],
              },
            });
          }
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
          if (
            (params[1] as { accounts?: { addresses?: string[] } })?.accounts
              ?.addresses?.[0] === wallet
          )
            return reply({
              value: {
                err: null,
                accounts: [{ lamports: 100000000 - state.walletDebit }],
              },
            });
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
            context: { slot: 1001 },
            value: state.expiredMissing
              ? [null]
              : [{ err: null, confirmationStatus: "confirmed" }],
          });
        case "getTransaction": {
          if (state.expiredMissing) return reply(null);
          if ((params[1] as { encoding?: string })?.encoding === "base64") {
            const raw = state.sent.find(
              (raw) => solanaBase58(unb64(raw).slice(1, 65)) === params[0],
            );
            if (!raw) return reply(null);
            const parsed = parseTransaction(unb64(raw));
            const pre = parsed.staticKeys.map(() => 0);
            pre[0] = 100000000;
            const post = [...pre];
            post[0] -= 1493440;
            const ataIndex = parsed.staticKeys.indexOf(
              ata(asset, wallet, tokenProgram),
            );
            post[ataIndex] = 1488440;
            return reply({
              slot: 100,
              transaction: [raw, "base64"],
              meta: {
                fee: 5000,
                preBalances: pre,
                postBalances: post,
                preTokenBalances: [],
                postTokenBalances: [],
              },
            });
          }
          const event = new Uint8Array(80);
          event.set(
            sha256(new TextEncoder().encode("event:FeesClaimed")).slice(0, 8),
          );
          event.set(decodeBase58Bytes(PROJECT), 8);
          event.set(decodeBase58Bytes(ata(asset, wallet, tokenProgram)), 40);
          new DataView(event.buffer).setBigUint64(
            72,
            state.confirmedAccrued,
            true,
          );
          const credit = state.receipt ?? state.confirmedAccrued;
          const balance = (owner: string, amount: bigint) => ({
            owner,
            mint: asset,
            uiTokenAmount: { amount: amount.toString() },
          });
          return reply({
            slot: 100,
            transaction: {
              signatures: [
                solanaBase58(
                  unb64(state.sent[state.sent.length - 1]).slice(1, 65),
                ),
              ],
            },
            meta: {
              err: null,
              logMessages: [
                `Program ${PROGRAM} invoke [1]`,
                `Program data: ${b64(event)}`,
                `Program ${PROGRAM} success`,
              ],
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
      RPC_URL_SOLANA: "https://solana-mainnet.g.alchemy.com/v2/synthetic-only",
      ...LIMITS,
      FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({ solana: budgets }),
    });
    const client = (signing: boolean, journal = nativeJournal) =>
      createSolanaClient({
        config: network.networks[0],
        limits: network.limits,
        jupiterApiUrl: "https://jupiter.invalid",
        jupiterApiKey: null,
        keypair: signing ? keypair : undefined,
        nativeGas: journal,
        fetch: rpcFetch,
        sleep: async () => {},
        verifyDeployment: async (escrow) => {
          state.verified.push(escrow);
          return projectBytes(state.finalizedAccrued);
        },
      });
    return { state, client, network, nativeJournal };
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
      client: (_network, runId) =>
        chain.client(
          mode === "live",
          new NativeGasJournal(
            db,
            "solana",
            wallet,
            runId,
            chain.network.networks[0].nativeBudget!,
            () => new Date("2026-10-24T12:00:00Z"),
          ),
        ),
      log: (event) => events.push(event),
    };
    return { ...chain, deps, events, config: chain.network.networks[0] };
  }

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

  test("a previously signed claim expires through two-provider proof without retrying on missing evidence", async () => {
    const run = solanaRun("live");
    expect((await runNetwork(run.config, run.deps)).claimed).toBe(1);
    run.state.expiredMissing = true;
    run.state.secondaryFailure = true;
    await expect(runNetwork(run.config, run.deps)).rejects.toThrow(
      "secondary provider offline",
    );
    expect(run.state.sent).toHaveLength(1);
    // Keep the accrued balance below dust so this check isolates retirement.
    run.state.finalizedAccrued = 1n;
    run.state.confirmedAccrued = 1n;
    run.state.secondaryFailure = false;
    const result = await runNetwork(run.config, run.deps);
    expect(result.reconciled).toBe(1);
    expect(run.state.sent).toHaveLength(1);
    expect(await run.deps.store.openRows("solana")).toEqual([]);
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
