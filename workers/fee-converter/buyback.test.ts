import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import orders from "../../tests/fixtures/dln-orders.json";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  type BridgeQuote,
  type BridgeTerms,
  type BurnQuote,
  type BuyQuote,
  createBuyback,
  type FillState,
  type OutcomeEvidence,
} from "./buyback";
import {
  type BuybackLimits,
  parseBuybackConfig,
  ROBINHOOD_USDG,
  SLOP_TOKEN,
} from "./buyback-config";
import { D1BuybackStore } from "./buyback-store";
import { parseConfig } from "./config";
import { checkedDlnOrder, DLN_SOURCE_ABI } from "./debridge";
import { checkedSolanaDlnOrder, dlnGiveOrderWallet } from "./debridge-solana";
import { parseTransaction } from "./solana-transaction";
import {
  type ChainClient,
  type ConversionRow,
  type FeeVault,
  type PreparedSend,
  type RunDependencies,
  type RunTrigger,
  runNetwork,
  type SendStatus,
} from "./core";
import { runOnce } from "./index";
import { D1ConversionStore } from "./store";
import {
  boundedSend,
  bridgeFeeWithin,
  burnDue,
  entitlement,
  shareOf,
} from "./verified-buyback";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";
const TOKEN = "0x1111111111111111111111111111111111111111";
const START = "2026-11-10T00:00:00.000Z";
const NOW = "2026-11-12T12:00:00.000Z";
const SLOP_PER_MICRO = 40_000_000_000_000n;

/** Test limits only; production limits come from the reviewed wrangler.toml. */
const BUYBACK_ENV = {
  BUYBACK_MODE: "live",
  BUYBACK_START_AT: START,
  BUYBACK_SHARE_BPS: "5000",
  BUYBACK_BURN_BPS: "5000",
  BUYBACK_MIN_BRIDGE_MICRO: "100000000",
  BUYBACK_MAX_BRIDGE_COST_BPS: "200",
  BUYBACK_MAX_BRIDGE_NATIVE_FEE: JSON.stringify({
    base: "1000000000000000",
  }),
  BUYBACK_MIN_BUY_MICRO: "10000000",
  BUYBACK_MIN_BURN_MICRO: "1000000",
  BUYBACK_MAX_SLIPPAGE_BPS: "100",
  BUYBACK_MAX_PRICE_IMPACT_BPS: "300",
  BUYBACK_RUN_CAP_MICRO: "1000000000",
  BUYBACK_DAILY_CAP_MICRO: "5000000000",
  BUYBACK_UNFILLED_ALERT_SECONDS: "3600",
};
const CONVERTER_ENV = {
  FEE_CONVERTER_MODE: "live",
  FEE_CONVERTER_NETWORKS: "base,robinhood",
  FEE_WALLET_BASE: WALLET,
  FEE_WALLET_ROBINHOOD: WALLET,
  FEE_CONVERTER_ALLOWLIST: JSON.stringify({ robinhood: [TOKEN] }),
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
    robinhood: {
      perTransaction: "10000000000000000",
      perDay: "100000000000000000",
      additionalFeeReserve: "0",
    },
  }),
};

interface FakeChain extends ChainClient {
  balances: Map<string, bigint>;
  sent: string[];
  signed: { kind: string; amount: bigint }[];
  statusFor: (row: ConversionRow) => SendStatus;
  bridgeQuote: (amount: bigint) => BridgeQuote | { noRoute: string };
  /** True makes the next bridge prepare an approval instead of an order. */
  needsApproval: boolean;
  refunds: Map<string, OutcomeEvidence>;
  fills: Map<string, FillState>;
  buyQuote: (token: string, amount: bigint) => BuyQuote | { noRoute: string };
  burnQuote: (amount: bigint) => BurnQuote | { blocked: string };
  accruedFees: Map<string, { asset: string; amount: bigint }>;
  claims: string[];
}

function fakeChain(): FakeChain {
  let counter = 0;
  const next = (kind: PreparedSend["kind"], amount: bigint): PreparedSend => {
    counter += 1;
    chain.signed.push({ kind: kind ?? "conversion", amount });
    return {
      kind,
      txId: `0x${counter.toString(16).padStart(64, "0")}`,
      rawTx: `0xraw${counter}`,
      evmNonce: counter,
      expiresAt: kind === "buyback" ? 2_000_000_000 : null,
      approvalTxId:
        kind === "approval"
          ? `0x${counter.toString(16).padStart(64, "0")}`
          : null,
      minAmountOut: 0n,
    };
  };
  const terms = (quote: BridgeQuote): BridgeTerms => ({
    provider: "debridge",
    orderId: `0x${(counter + 1).toString(16).padStart(64, "0")}`,
    takeToken: quote.takeToken,
    takeAmount: quote.takeAmount.toString(),
    takeChainId: "4663",
    receiver: quote.receiver,
    nativeFee: quote.nativeFee.toString(),
    salt: "7",
  });
  const chain: FakeChain = {
    balances: new Map(),
    sent: [],
    signed: [],
    needsApproval: false,
    refunds: new Map(),
    fills: new Map(),
    accruedFees: new Map(),
    claims: [],
    statusFor: () => ({ kind: "pending" }),
    // 20 bps spread plus a 3 USDC fixed fee and 0.1 USDC of gas.
    bridgeQuote: (amount) => ({
      amountIn: amount,
      takeToken: ROBINHOOD_USDG,
      takeAmount: (amount * 9_980n) / 10_000n,
      nativeFee: 1_000_000_000_000_000n,
      costMicro: amount - (amount * 9_980n) / 10_000n + 3_100_000n,
      receiver: WALLET,
      summary: { provider: "debridge" },
    }),
    buyQuote: (_token, amount) => ({
      route: "kyberswap",
      amountIn: amount,
      amountOut: amount * SLOP_PER_MICRO,
      minAmountOut: (amount * SLOP_PER_MICRO * 9_950n) / 10_000n,
      priceImpactBps: 110,
      gasCostMicro: 40_000n,
      summary: { aggregator: "test" },
      valueMicro: amount,
    }),
    burnQuote: (amount) => ({
      valueMicro: amount / SLOP_PER_MICRO,
      gasCostMicro: 10_000n,
    }),
    async balance(token) {
      return chain.balances.get(token) ?? 0n;
    },
    async quote(_token, amount) {
      return {
        route: "kyberswap",
        amountIn: amount,
        amountOut: amount,
        minAmountOut: amount,
        priceImpactBps: 0,
        gasCostMicro: 10_000n,
        summary: {},
      };
    },
    async prepare() {
      throw new Error("no conversion is expected in these tests");
    },
    async broadcast(raw) {
      chain.sent.push(raw);
    },
    async status(row) {
      return chain.statusFor(row);
    },
    vaultFees: {
      async accrued(vault) {
        return chain.accruedFees.get(vault.vault) ?? null;
      },
      async claimCostMicro() {
        return 10_000n;
      },
      async claim(vault, record) {
        const accrued = chain.accruedFees.get(vault.vault);
        if (!accrued) throw new Error("nothing accrued");
        const send = next(undefined, accrued.amount);
        await record?.({
          txId: send.txId,
          rawTx: send.rawTx,
          evmNonce: send.evmNonce,
          expiresAt: null,
          amount: accrued.amount,
        });
        chain.claims.push(vault.vault);
        return { txId: send.txId };
      },
    },
    buyback: {
      bridge: {
        async quote(amount) {
          return chain.bridgeQuote(amount);
        },
        async prepare(quote) {
          if (chain.needsApproval)
            return { ...next("approval", quote.amountIn), terms: null };
          const order = terms(quote);
          return { ...next("bridge", quote.amountIn), terms: order };
        },
        async refund(order) {
          return chain.refunds.get(order.orderId) ?? null;
        },
      },
      market: {
        async fill(order) {
          return chain.fills.get(order.orderId) ?? { state: "open" };
        },
        async quoteBuy(token, amount) {
          return chain.buyQuote(token, amount);
        },
        async prepareBuy(_token, quote) {
          return {
            ...next("buyback", quote.amountIn),
            minAmountOut: quote.minAmountOut,
          };
        },
        async quoteBurn(amount) {
          return chain.burnQuote(amount);
        },
        async prepareBurn(amount) {
          return next("burn", amount);
        },
      },
    },
  };
  return chain;
}

function limits(extra: Record<string, string> = {}): BuybackLimits {
  return parseBuybackConfig({ ...BUYBACK_ENV, ...extra }, "live")
    .limits as BuybackLimits;
}

function harness(
  options: {
    mode?: "dry_run" | "live";
    env?: Record<string, string>;
    vaults?: FeeVault[];
  } = {},
) {
  const { db, sqlite } = sqliteD1();
  const chain = fakeChain();
  const clock = { now: new Date(NOW) };
  const parsed = parseConfig(CONVERTER_ENV);
  const events: Record<string, unknown>[] = [];
  let id = 0;
  const deps: RunDependencies = {
    mode: "live",
    limits: parsed.limits,
    store: new D1ConversionStore(db),
    now: () => clock.now,
    randomId: () => `id-${String(++id).padStart(6, "0")}`,
    projectTokens: async () => [],
    projectVaults: async () => options.vaults ?? [],
    client: () => chain,
    log: (event) => events.push(event),
    buyback: createBuyback({
      mode: options.mode ?? "live",
      limits: limits(options.env),
      store: new D1BuybackStore(db),
      receiver: WALLET,
    }),
  };
  const [base, robinhood] = parsed.networks;
  const rows = (where = "1=1") =>
    sqlite
      .query(`SELECT * FROM fee_conversions WHERE ${where} ORDER BY rowid`)
      .all() as Record<string, string | number | null>[];
  let seeded = 0;
  /** A finalized live journal row: fee income that already happened. */
  const earn = (fields: {
    network?: string;
    kind: "conversion" | "claim";
    token: string;
    target: string;
    amountOut: bigint;
    finalizedAt?: string;
  }) => {
    seeded += 1;
    const at = fields.finalizedAt ?? "2026-11-11T00:00:00.000Z";
    sqlite
      .query(
        `INSERT INTO fee_conversions (kind, id, run_id, network, mode, fee_wallet, token,
           target_token, amount_in, min_amount_out, tx_id, raw_tx, expires_at, amount_out,
           state, created_at, updated_at, submitted_at, finalized_at)
         VALUES (?, ?, 'seed-run-1', ?, 'live', ?, ?, ?, ?, '1', ?, '0xseed', 1, ?,
           'finalized', ?, ?, ?, ?)`,
      )
      .run(
        fields.kind,
        `seed-${String(seeded).padStart(6, "0")}`,
        fields.network ?? "base",
        WALLET,
        fields.token,
        fields.target,
        fields.amountOut.toString(),
        `0xseed${seeded}`,
        fields.amountOut.toString(),
        at,
        at,
        at,
        at,
      );
  };
  const run = (
    network: "base" | "robinhood" = "base",
    trigger: RunTrigger = "recovery",
  ) => runNetwork(network === "base" ? base : robinhood, { ...deps, trigger });
  /** Settles every open send as finalized with the given output. */
  const finalize = (amountOut: (row: ConversionRow) => bigint) => {
    chain.statusFor = (row) => ({
      kind: "finalized",
      amountOut: amountOut(row),
    });
  };
  return { db, sqlite, chain, deps, clock, events, rows, earn, run, finalize };
}

const usdcFees = (h: ReturnType<typeof harness>, amount: bigint) =>
  h.earn({ kind: "conversion", token: TOKEN, target: USDC, amountOut: amount });

describe("exact shares", () => {
  test("the share is a floor of cumulative income and never exceeds it", () => {
    expect(shareOf(1_999n, 5_000n)).toBe(999n);
    expect(shareOf(1n, 5_000n)).toBe(0n);
    expect(shareOf(7n, 10_000n)).toBe(7n);
    // Two receipts of 1 owe the same as one receipt of 2: the share is taken
    // of the cumulative total, so splitting income never loses or gains.
    expect(entitlement(0n, 2n, 5_000n, 0n)).toBe(1n);
    expect(entitlement(0n, 1n, 5_000n, 0n)).toBe(0n);
  });

  test("a committed send lowers the entitlement, and an over-commitment owes nothing", () => {
    expect(entitlement(0n, 1_000n, 5_000n, 200n)).toBe(300n);
    expect(entitlement(0n, 1_000n, 5_000n, 500n)).toBe(0n);
    expect(entitlement(0n, 1_000n, 5_000n, 900n)).toBe(0n);
    // A bridged arrival is credited in full on top of the fee share.
    expect(entitlement(400n, 1_000n, 5_000n, 100n)).toBe(800n);
  });

  test("the burn takes half of everything acquired once, never half of the remainder", () => {
    expect(burnDue(1_000n, 5_000n, 0n)).toBe(500n);
    // After that burn the wallet holds 500; nothing more is owed.
    expect(burnDue(1_000n, 5_000n, 500n)).toBe(0n);
    // A later purchase of 301 owes only its own half, rounded down overall.
    expect(burnDue(1_301n, 5_000n, 500n)).toBe(150n);
  });

  test("a send is bounded by entitlement, balance and cap, and a bridge by its total cost", () => {
    expect(boundedSend(500n, 300n, 1_000n)).toBe(300n);
    expect(boundedSend(500n, 900n, 200n)).toBe(200n);
    expect(bridgeFeeWithin(10_000n, 9_800n, 200n)).toBe(true);
    expect(bridgeFeeWithin(10_000n, 9_799n, 200n)).toBe(false);
    // An arrival above the input means a wrong asset or decimal scale.
    expect(bridgeFeeWithin(10_000n, 10_001n, 200n)).toBe(false);
    expect(bridgeFeeWithin(10_000n, 0n, 10_000n)).toBe(false);
  });
});

describe("bridge on a source network", () => {
  test("half of the USDC fees became bridges once, to the Robinhood fee wallet", async () => {
    const h = harness();
    usdcFees(h, 600_000_000n);
    usdcFees(h, 401_000_001n);
    h.chain.balances.set(USDC, 1_001_000_001n);
    const result = await h.run();
    expect(result.buyback?.records).toEqual({ "bridge:submitted": 1 });
    const [order] = h.rows("kind = 'bridge'");
    // floor(1,001.000001 / 2)
    expect(order.amount_in).toBe("500500000");
    expect(order.route).toBe("debridge");
    expect(order.target_token).toBe(ROBINHOOD_USDG);
    expect(JSON.parse(order.quote as string)).toMatchObject({
      receiver: WALLET,
      takeChainId: "4663",
      takeAmount: "499499000",
    });
    expect(h.chain.sent).toHaveLength(1);

    // The open order blocks a second one, and so does its finalized deposit.
    await h.run();
    h.finalize((row) => BigInt(row.amountIn));
    await h.run();
    await h.run();
    expect(h.rows("kind = 'bridge'")).toHaveLength(1);
    expect(h.chain.signed).toEqual([{ kind: "bridge", amount: 500_500_000n }]);

    // New fees owe only their own half.
    usdcFees(h, 400_000_000n);
    await h.run();
    expect(h.rows("kind = 'bridge'").map((row) => row.amount_in)).toEqual([
      "500500000",
      "200000000",
    ]);
  });

  test("USDC claims count, other tokens count only through their conversion, and earlier fees never count", async () => {
    const h = harness();
    h.earn({
      kind: "claim",
      token: USDC,
      target: USDC,
      amountOut: 300_000_000n,
    });
    // A claimed project token is income only once it became USDC.
    h.earn({
      kind: "claim",
      token: TOKEN,
      target: TOKEN,
      amountOut: 9n ** 18n,
    });
    usdcFees(h, 100_000_000n);
    // Finalized before the buyback started.
    h.earn({
      kind: "conversion",
      token: TOKEN,
      target: USDC,
      amountOut: 5_000_000_000n,
      finalizedAt: "2026-11-09T23:59:59.999Z",
    });
    h.chain.balances.set(USDC, 10_000_000_000n);
    await h.run();
    expect(h.rows("kind = 'bridge'")[0].amount_in).toBe("200000000");
  });

  test("a share below the minimum waits, recorded once, until fees lift it over", async () => {
    const h = harness();
    usdcFees(h, 150_000_000n);
    h.chain.balances.set(USDC, 150_000_000n);
    await h.run();
    await h.run();
    const waiting = h.rows("kind = 'bridge'");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      state: "pending",
      reason: "below the minimum bridge value",
      amount_in: "75000000",
    });
    expect(h.chain.signed).toHaveLength(0);
    usdcFees(h, 250_000_000n);
    h.chain.balances.set(USDC, 400_000_000n);
    await h.run();
    expect(h.rows("kind = 'bridge' AND state = 'submitted'")[0].amount_in).toBe(
      "200000000",
    );
  });

  test("an owner sweep and the value cap only lower the order", async () => {
    const swept = harness();
    usdcFees(swept, 2_000_000_000n);
    // The owner swept most of the wallet; only what is left can move.
    swept.chain.balances.set(USDC, 130_000_000n);
    await swept.run();
    expect(swept.rows("kind = 'bridge'")[0].amount_in).toBe("130000000");

    const capped = harness({ env: { BUYBACK_RUN_CAP_MICRO: "250000000" } });
    usdcFees(capped, 2_000_000_000n);
    capped.chain.balances.set(USDC, 2_000_000_000n);
    await capped.run();
    expect(capped.rows("kind = 'bridge'")[0].amount_in).toBe("250000000");
  });

  test("an expensive, unapproved or misdirected order is never signed", async () => {
    const costly = harness();
    usdcFees(costly, 1_000_000_000n);
    costly.chain.balances.set(USDC, 1_000_000_000n);
    costly.chain.bridgeQuote = (amount) => ({
      amountIn: amount,
      takeToken: ROBINHOOD_USDG,
      takeAmount: (amount * 97n) / 100n,
      nativeFee: 1_000_000_000_000_000n,
      costMicro: (amount * 3n) / 100n,
      receiver: WALLET,
      summary: {},
    });
    await costly.run();
    expect(costly.rows("kind = 'bridge'")[0]).toMatchObject({
      state: "skipped",
      reason: "bridge cost above the cap",
    });

    const fee = harness();
    usdcFees(fee, 1_000_000_000n);
    fee.chain.balances.set(USDC, 1_000_000_000n);
    const normal = fee.chain.bridgeQuote;
    fee.chain.bridgeQuote = (amount) => ({
      ...(normal(amount) as BridgeQuote),
      nativeFee: 1_000_000_000_000_001n,
    });
    await fee.run();
    expect(fee.rows("kind = 'bridge'")[0].reason).toBe(
      "fixed bridge fee above the approved maximum",
    );

    const stolen = harness();
    usdcFees(stolen, 1_000_000_000n);
    stolen.chain.balances.set(USDC, 1_000_000_000n);
    const honest = stolen.chain.bridgeQuote;
    stolen.chain.bridgeQuote = (amount) => ({
      ...(honest(amount) as BridgeQuote),
      receiver: "0x00000000000000000000000000000000000000aa",
    });
    const result = await stolen.run();
    expect(result.buyback?.errors).toBe(1);
    expect(stolen.events.at(-1)).toMatchObject({
      event: "fee_buyback_error",
      error: "Bridge quote differs from the requested order",
    });
    for (const h of [costly, fee, stolen])
      expect(h.chain.signed).toHaveLength(0);
  });

  test("the exact approval is its own send and never counts as bridged", async () => {
    const h = harness();
    usdcFees(h, 1_000_000_000n);
    h.chain.balances.set(USDC, 1_000_000_000n);
    h.chain.needsApproval = true;
    await h.run();
    const [approval] = h.rows("kind = 'approval'");
    expect(approval).toMatchObject({
      kind: "approval",
      route: "debridge",
      amount_in: "500000000",
      state: "submitted",
    });
    // While the approval is open the token is blocked.
    await h.run();
    expect(h.chain.signed).toHaveLength(1);
    h.finalize(() => 0n);
    h.chain.needsApproval = false;
    await h.run();
    h.chain.statusFor = () => ({ kind: "pending" });
    await h.run();
    expect(h.rows("kind = 'bridge' AND state = 'submitted'")).toHaveLength(1);
    expect(h.chain.signed.map((send) => send.kind)).toEqual([
      "approval",
      "bridge",
    ]);
  });

  test("a reverted deposit releases its share; a refunded deposit does too, exactly once", async () => {
    const h = harness();
    usdcFees(h, 1_000_000_000n);
    h.chain.balances.set(USDC, 1_000_000_000n);
    await h.run();
    h.chain.statusFor = () => ({
      kind: "failed",
      reason: "bridge order reverted",
    });
    // The failure is reconciled first; the same run then signs the retry.
    await h.run();
    expect(
      h.rows("kind = 'bridge'").map((row) => [row.state, row.amount_in]),
    ).toEqual([
      ["failed", "500000000"],
      ["submitted", "500000000"],
    ]);

    h.finalize((row) => BigInt(row.amountIn));
    await h.run();
    const deposit = h.rows("kind = 'bridge' AND state = 'finalized'")[0];
    const orderId = JSON.parse(deposit.quote as string).orderId as string;
    await h.run();
    expect(h.chain.signed).toHaveLength(2);
    h.chain.refunds.set(orderId, {
      block: 77,
      blockHash: `0x${"ab".repeat(32)}`,
    });
    const refunded = await h.run();
    expect(refunded.buyback?.refunded).toBe(1);
    expect(
      h.sqlite.query("SELECT outcome, amount FROM fee_bridge_outcomes").all(),
    ).toEqual([{ outcome: "refunded", amount: "500000000" }]);
    // The released share is bridged again by the same run.
    expect(h.rows("kind = 'bridge' AND state = 'submitted'")).toHaveLength(1);
    await h.run();
    expect(
      h.sqlite.query("SELECT COUNT(*) AS n FROM fee_bridge_outcomes").get(),
    ).toEqual({ n: 1 });
  });

  test("dry run records the decision and signs nothing; a receipt run does not bridge", async () => {
    const dry = harness({ mode: "dry_run" });
    usdcFees(dry, 1_000_000_000n);
    dry.chain.balances.set(USDC, 1_000_000_000n);
    await dry.run();
    await dry.run();
    expect(dry.rows("kind = 'bridge'")).toHaveLength(1);
    expect(dry.rows("kind = 'bridge'")[0]).toMatchObject({
      mode: "dry_run",
      state: "quoted",
      amount_in: "500000000",
    });
    expect(dry.chain.signed).toHaveLength(0);

    const live = harness();
    usdcFees(live, 1_000_000_000n);
    live.chain.balances.set(USDC, 1_000_000_000n);
    const result = await live.run("base", "receipts");
    expect(result.buyback).toBeUndefined();
    expect(live.rows("kind = 'bridge'")).toHaveLength(0);
  });
});

/** A finalized deposit of `amount` USDC on Base, awaiting its outcome. */
async function deposited(h: ReturnType<typeof harness>, fees: bigint) {
  usdcFees(h, fees);
  h.chain.balances.set(USDC, fees);
  await h.run();
  h.finalize((row) => BigInt(row.amountIn));
  await h.run();
  h.chain.statusFor = () => ({ kind: "pending" });
  const deposit = h.rows("kind = 'bridge' AND state = 'finalized'")[0];
  return JSON.parse(deposit.quote as string) as BridgeTerms;
}

const arrived = (block = 9): FillState => ({
  state: "arrived",
  evidence: { block, blockHash: `0x${"cd".repeat(32)}` },
});

describe("purchase and burn on Robinhood Chain", () => {
  test("an arrival is credited once and spent in full on SLOP", async () => {
    const h = harness();
    const terms = await deposited(h, 1_000_000_000n);
    h.chain.balances.set(ROBINHOOD_USDG, 5_000_000_000n);
    // Unfilled: nothing is credited and nothing is bought.
    const waiting = await h.run("robinhood");
    expect(waiting.buyback).toMatchObject({ arrived: 0, inTransit: 1 });
    expect(h.rows("kind = 'buyback'")).toHaveLength(0);

    h.chain.fills.set(terms.orderId, arrived());
    const result = await h.run("robinhood");
    expect(result.status).toBe("not_converted");
    expect(result.buyback).toMatchObject({ arrived: 1, inTransit: 0 });
    const [purchase] = h.rows("kind = 'buyback'");
    // Exactly the order's take amount, not the wallet's larger USDG balance.
    expect(purchase).toMatchObject({
      amount_in: terms.takeAmount,
      target_token: SLOP_TOKEN,
      state: "submitted",
      quote_value_micro: Number(terms.takeAmount),
    });
    await h.run("robinhood");
    expect(
      h.sqlite.query("SELECT COUNT(*) AS n FROM fee_bridge_outcomes").get(),
    ).toEqual({ n: 1 });
    expect(
      h.chain.signed.filter((send) => send.kind === "buyback"),
    ).toHaveLength(1);
  });

  test("a fee received on Robinhood buys at the share, and the rest stays unconverted", async () => {
    const h = harness();
    h.earn({
      network: "robinhood",
      kind: "claim",
      token: ROBINHOOD_USDG,
      target: ROBINHOOD_USDG,
      amountOut: 300_000_001n,
    });
    h.earn({
      network: "robinhood",
      kind: "claim",
      token: TOKEN,
      target: TOKEN,
      amountOut: 80_000_000n,
    });
    h.chain.balances.set(ROBINHOOD_USDG, 300_000_001n);
    h.chain.balances.set(TOKEN, 80_000_000n);
    await h.run("robinhood");
    expect(
      h.rows("kind = 'buyback'").map((row) => [row.token, row.amount_in]),
    ).toEqual([
      [ROBINHOOD_USDG, "150000000"],
      [TOKEN, "40000000"],
    ]);
    h.finalize((row) => BigInt(row.amountIn) * SLOP_PER_MICRO);
    await h.run("robinhood");
    h.chain.statusFor = () => ({ kind: "pending" });
    await h.run("robinhood");
    // The other half of each fee is never bought, converted or bridged.
    expect(
      h.chain.signed.filter((send) => send.kind === "buyback"),
    ).toHaveLength(2);
    expect(h.rows("kind = 'conversion'")).toHaveLength(0);
  });

  test("half of the SLOP acquired is burned once; the retained half is never halved again", async () => {
    const h = harness();
    h.earn({
      network: "robinhood",
      kind: "claim",
      token: ROBINHOOD_USDG,
      target: ROBINHOOD_USDG,
      amountOut: 400_000_000n,
    });
    h.chain.balances.set(ROBINHOOD_USDG, 400_000_000n);
    await h.run("robinhood");
    const bought = 200_000_000n * SLOP_PER_MICRO;
    h.finalize((row) => (row.kind === "burn" ? BigInt(row.amountIn) : bought));
    h.chain.balances.set(SLOP_TOKEN, bought);
    await h.run("robinhood");
    const [burn] = h.rows("kind = 'burn'");
    expect(burn).toMatchObject({
      amount_in: (bought / 2n).toString(),
      token: SLOP_TOKEN,
      target_token: SLOP_TOKEN,
      state: "submitted",
    });
    h.chain.balances.set(SLOP_TOKEN, bought / 2n);
    await h.run("robinhood");
    await h.run("robinhood");
    await h.run("robinhood");
    expect(h.rows("kind = 'burn'")).toHaveLength(1);
    expect(h.rows("kind = 'burn'")[0]).toMatchObject({
      state: "finalized",
      amount_out: (bought / 2n).toString(),
    });
  });

  test("SLOP received as a fee needs no purchase: its share is acquired and half of that burns", async () => {
    const h = harness();
    const fee = 1_000n * 10n ** 18n;
    h.earn({
      network: "robinhood",
      kind: "claim",
      token: SLOP_TOKEN,
      target: SLOP_TOKEN,
      amountOut: fee,
    });
    h.chain.balances.set(SLOP_TOKEN, fee);
    await h.run("robinhood");
    expect(h.rows("kind = 'buyback'")).toHaveLength(0);
    expect(h.rows("kind = 'burn'")[0].amount_in).toBe((fee / 4n).toString());
  });

  test("a paused token, a small burn and SLOP the owner swept all wait without signing", async () => {
    const paused = harness();
    const fee = 1_000n * 10n ** 18n;
    const slopFee = (h: ReturnType<typeof harness>) =>
      h.earn({
        network: "robinhood",
        kind: "claim",
        token: SLOP_TOKEN,
        target: SLOP_TOKEN,
        amountOut: fee,
      });
    slopFee(paused);
    paused.chain.balances.set(SLOP_TOKEN, fee);
    paused.chain.burnQuote = () => ({ blocked: "SLOP transfers are paused" });
    await paused.run("robinhood");
    await paused.run("robinhood");
    expect(paused.rows("kind = 'burn'")).toHaveLength(1);
    expect(paused.rows("kind = 'burn'")[0]).toMatchObject({
      state: "pending",
      reason: "SLOP transfers are paused",
    });

    const small = harness({ env: { BUYBACK_MIN_BURN_MICRO: "100000000" } });
    slopFee(small);
    small.chain.balances.set(SLOP_TOKEN, fee);
    await small.run("robinhood");
    expect(small.rows("kind = 'burn'")[0].reason).toBe(
      "below the minimum burn value",
    );

    const swept = harness();
    slopFee(swept);
    await swept.run("robinhood");
    expect(swept.rows("kind = 'burn'")).toHaveLength(0);
    for (const h of [paused, small, swept])
      expect(h.chain.signed).toHaveLength(0);
  });

  test("a purchase respects its minimum, impact, slippage and value caps", async () => {
    const fees = (h: ReturnType<typeof harness>, amount: bigint) => {
      h.earn({
        network: "robinhood",
        kind: "claim",
        token: ROBINHOOD_USDG,
        target: ROBINHOOD_USDG,
        amountOut: amount,
      });
      h.chain.balances.set(ROBINHOOD_USDG, amount);
    };
    const small = harness();
    fees(small, 19_999_998n);
    await small.run("robinhood");
    expect(small.rows("kind = 'buyback'")[0]).toMatchObject({
      state: "pending",
      reason: "below the minimum purchase value",
    });

    const thin = harness();
    fees(thin, 400_000_000n);
    const quote = thin.chain.buyQuote;
    thin.chain.buyQuote = (token, amount) => ({
      ...(quote(token, amount) as BuyQuote),
      priceImpactBps: 301,
    });
    await thin.run("robinhood");
    expect(thin.rows("kind = 'buyback'")[0].reason).toBe(
      "price impact above the cap",
    );

    const unpriced = harness();
    fees(unpriced, 400_000_000n);
    unpriced.chain.buyQuote = (token, amount) => ({
      ...(quote(token, amount) as BuyQuote),
      priceImpactBps: null,
    });
    await unpriced.run("robinhood");
    expect(unpriced.rows("kind = 'buyback'")[0].reason).toBe(
      "price impact unknown",
    );

    const loose = harness();
    fees(loose, 400_000_000n);
    loose.chain.buyQuote = (token, amount) => ({
      ...(quote(token, amount) as BuyQuote),
      minAmountOut: (amount * SLOP_PER_MICRO * 98n) / 100n,
    });
    await loose.run("robinhood");
    expect(loose.rows("kind = 'buyback'")[0].reason).toBe(
      "minimum output outside the slippage limit",
    );

    const capped = harness({ env: { BUYBACK_RUN_CAP_MICRO: "100000000" } });
    fees(capped, 4_000_000_000n);
    await capped.run("robinhood");
    const [scaled] = capped.rows("kind = 'buyback'");
    expect(scaled.state).toBe("submitted");
    // Scaled toward 98% of the remaining cap, never above it.
    expect(BigInt(scaled.amount_in as string)).toBe(98_000_000n);
    for (const h of [small, thin, unpriced, loose])
      expect(h.chain.signed).toHaveLength(0);
  });

  test("an unfilled or cancelling order is reported and never credited", async () => {
    const h = harness();
    const terms = await deposited(h, 1_000_000_000n);
    h.clock.now = new Date(Date.parse(NOW) + 2 * 60 * 60 * 1000);
    await h.run("robinhood");
    expect(
      h.events.find((e) => e.event === "fee_bridge_unfilled"),
    ).toMatchObject({ orderId: terms.orderId, network: "base" });
    h.chain.fills.set(terms.orderId, { state: "cancelling" });
    await h.run("robinhood");
    expect(
      h.events.find((e) => e.event === "fee_bridge_cancelling"),
    ).toBeDefined();
    expect(
      h.sqlite.query("SELECT COUNT(*) AS n FROM fee_bridge_outcomes").get(),
    ).toEqual({ n: 0 });
    expect(h.rows("kind = 'buyback'")).toHaveLength(0);
  });

  test("Robinhood vault fees are claimed only for the buyback, in its own mode", async () => {
    const vault: FeeVault = {
      vault: "0x00000000000000000000000000000000000000c1",
      projectId: "p",
      payoutPolicy: "ordinary",
      deployment: {},
    };
    const live = harness({ vaults: [vault] });
    live.chain.accruedFees.set(vault.vault, {
      asset: ROBINHOOD_USDG,
      amount: 50_000_000n,
    });
    const result = await live.run("robinhood");
    expect(result.claimed).toBe(1);
    expect(live.rows("kind = 'claim'")[0]).toMatchObject({
      network: "robinhood",
      token: ROBINHOOD_USDG,
      amount_in: "50000000",
    });

    const dry = harness({ mode: "dry_run", vaults: [vault] });
    dry.chain.accruedFees.set(vault.vault, {
      asset: ROBINHOOD_USDG,
      amount: 50_000_000n,
    });
    await dry.run("robinhood");
    expect(dry.chain.claims).toHaveLength(0);
    expect(dry.rows("kind = 'claim'")).toHaveLength(0);

    // Without the buyback, Robinhood stays exactly as before: no claim.
    const off = harness({ vaults: [vault] });
    off.chain.accruedFees.set(vault.vault, {
      asset: ROBINHOOD_USDG,
      amount: 50_000_000n,
    });
    const untouched = await runNetwork(parseConfig(CONVERTER_ENV).networks[1], {
      ...off.deps,
      buyback: undefined,
    });
    expect(untouched).toMatchObject({ status: "not_converted", claimed: 0 });
    expect(untouched.buyback).toBeUndefined();
    expect(off.chain.claims).toHaveLength(0);
  });
});

describe("journal constraints", () => {
  const insert = (
    h: ReturnType<typeof harness>,
    fields: Record<string, string | number | null>,
  ) => {
    const row: Record<string, string | number | null> = {
      kind: "burn",
      id: "manual-row-1",
      run_id: "manual-run-1",
      network: "robinhood",
      mode: "live",
      fee_wallet: WALLET,
      token: SLOP_TOKEN,
      target_token: SLOP_TOKEN,
      amount_in: "10",
      state: "failed",
      reason: "test",
      created_at: NOW,
      updated_at: NOW,
      ...fields,
    };
    const keys = Object.keys(row);
    h.sqlite
      .query(
        `INSERT INTO fee_conversions (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      )
      .run(...keys.map((key) => row[key]));
  };

  test("SLOP is bought and burned only on Robinhood, and a bridge only leaves another network", () => {
    const h = harness();
    expect(() => insert(h, { network: "base" })).toThrow(/CHECK/u);
    expect(() =>
      insert(h, { kind: "buyback", network: "ethereum", token: USDC }),
    ).toThrow(/CHECK/u);
    expect(() =>
      insert(h, {
        kind: "bridge",
        token: ROBINHOOD_USDG,
        target_token: ROBINHOOD_USDG,
        route: "debridge",
      }),
    ).toThrow(/CHECK/u);
    // A burn sends its own token and exactly its recorded amount.
    expect(() => insert(h, { target_token: ROBINHOOD_USDG })).toThrow(/CHECK/u);
    expect(() => insert(h, {})).not.toThrow();
  });

  test("an outcome needs its finalized deposit, recorded order, amount and network lease", async () => {
    const h = harness();
    const terms = await deposited(h, 1_000_000_000n);
    const deposit = h.rows("kind = 'bridge'")[0];
    const outcome = (fields: Record<string, string | number> = {}) => {
      const row: Record<string, string | number> = {
        bridge_id: deposit.id as string,
        source_network: "base",
        order_id: terms.orderId,
        outcome: "arrived",
        token: ROBINHOOD_USDG,
        amount: terms.takeAmount,
        evidence_network: "robinhood",
        evidence_block: 5,
        evidence_block_hash: `0x${"ef".repeat(32)}`,
        run_id: "lease-run-1",
        observed_at: NOW,
        ...fields,
      };
      const keys = Object.keys(row);
      h.sqlite
        .query(
          `INSERT INTO fee_bridge_outcomes (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
        )
        .run(...keys.map((key) => row[key]));
    };
    // No lease on the proving network.
    expect(() => outcome()).toThrow(/lost its network lease/u);
    h.sqlite
      .query(
        "INSERT INTO fee_converter_locks (network, run_id, expires_at) VALUES ('robinhood', 'lease-run-1', '2026-11-12T12:10:00.000Z')",
      )
      .run();
    expect(() => outcome({ amount: "1" })).toThrow(
      /differs from its finalized deposit/u,
    );
    expect(() => outcome({ order_id: `0x${"00".repeat(32)}` })).toThrow(
      /differs from its finalized deposit/u,
    );
    // An arrival is proven on Robinhood, never on the source network, even
    // when that network's lease is held.
    h.sqlite
      .query(
        "INSERT INTO fee_converter_locks (network, run_id, expires_at) VALUES ('base', 'lease-run-1', '2026-11-12T12:10:00.000Z')",
      )
      .run();
    expect(() => outcome({ evidence_network: "base" })).toThrow(/CHECK/u);
    expect(() => outcome()).not.toThrow();
    // One outcome per deposit: it can never also be refunded or credited twice.
    expect(() => outcome()).toThrow(/UNIQUE|PRIMARY/u);
    expect(() =>
      h.sqlite.query("DELETE FROM fee_bridge_outcomes").run(),
    ).toThrow(/permanent/u);
    expect(() =>
      h.sqlite.query("UPDATE fee_bridge_outcomes SET amount = '2'").run(),
    ).toThrow(/immutable/u);
  });
});

describe("configuration", () => {
  test("off is the default and reads nothing; a running buyback needs every limit", () => {
    expect(parseBuybackConfig({}, "live")).toEqual({
      mode: "off",
      limits: null,
    });
    // A converter that is off keeps the buyback off whatever it is set to.
    expect(parseBuybackConfig({ BUYBACK_MODE: "live" }, "off").mode).toBe(
      "off",
    );
    for (const name of Object.keys(BUYBACK_ENV).filter(
      (key) => key !== "BUYBACK_MODE",
    ))
      expect(() =>
        parseBuybackConfig({ ...BUYBACK_ENV, [name]: undefined }, "live"),
      ).toThrow();
    expect(() => parseBuybackConfig(BUYBACK_ENV, "dry_run")).toThrow(
      /needs FEE_CONVERTER_MODE live/u,
    );
    expect(() =>
      parseBuybackConfig(
        { ...BUYBACK_ENV, BUYBACK_SHARE_BPS: "10001" },
        "live",
      ),
    ).toThrow(/at most 10000/u);
    expect(() =>
      parseBuybackConfig(
        {
          ...BUYBACK_ENV,
          BUYBACK_MAX_BRIDGE_NATIVE_FEE: JSON.stringify({ robinhood: "1" }),
        },
        "live",
      ),
    ).toThrow(/not a buyback source network/u);
    expect(limits().shareBps).toBe(5_000n);
  });

  test("a buyback that is not off refuses to run without Robinhood enabled", async () => {
    const { db } = sqliteD1();
    await expect(
      runOnce({
        FEE_DB: db,
        ...CONVERTER_ENV,
        FEE_CONVERTER_MODE: "dry_run",
        FEE_CONVERTER_NETWORKS: "base",
        ...BUYBACK_ENV,
        BUYBACK_MODE: "dry_run",
      } as never),
    ).rejects.toThrow(/needs robinhood in FEE_CONVERTER_NETWORKS/u);
  });
});

describe("bridge order checks against captured deBridge proposals", () => {
  const evm = orders.evm;
  const intent = {
    wallet: evm.wallet,
    giveToken: evm.giveToken,
    giveAmount: BigInt(evm.giveAmount),
    takeToken: ROBINHOOD_USDG,
    takeChainId: 4663n,
    receiver: evm.wallet,
  };

  test("an EVM order is accepted only for the exact fee-wallet intent", () => {
    expect(checkedDlnOrder(evm.data as Hex, intent).takeAmount).toBe(
      BigInt(evm.takeAmount),
    );
    for (const changed of [
      { receiver: "0x00000000000000000000000000000000000000aa" },
      { wallet: "0x00000000000000000000000000000000000000aa" },
      { giveAmount: intent.giveAmount + 1n },
      { giveToken: ROBINHOOD_USDG },
      { takeToken: SLOP_TOKEN },
      { takeChainId: 8453n },
    ])
      expect(() =>
        checkedDlnOrder(evm.data as Hex, { ...intent, ...changed }),
      ).toThrow(/differs from the fee-wallet intent/u);
  });

  test("an EVM order with an unknown taker, an external call, an affiliate fee or stray bytes is refused", () => {
    const decoded = decodeFunctionData({
      abi: DLN_SOURCE_ABI,
      data: evm.data as Hex,
    });
    const [order, salt, , referral, permit, metadata] =
      decoded.args as unknown as [
        Record<string, unknown>,
        bigint,
        Hex,
        number,
        Hex,
        Hex,
      ];
    const encode = (
      fields: Record<string, unknown>,
      affiliate: Hex = "0x",
      code = referral,
    ) =>
      encodeFunctionData({
        abi: DLN_SOURCE_ABI,
        functionName: "createSaltedOrder",
        args: [
          { ...order, ...fields } as never,
          salt,
          affiliate,
          code,
          permit,
          metadata,
        ],
      });
    expect(() =>
      checkedDlnOrder(
        encode({
          allowedTakerDst: "0x00000000000000000000000000000000000000bb",
        }),
        intent,
      ),
    ).toThrow(/unknown taker/u);
    // An open order, which any taker may fill, is allowed.
    expect(
      checkedDlnOrder(encode({ allowedTakerDst: "0x" }), intent).takeAmount,
    ).toBe(BigInt(evm.takeAmount));
    for (const data of [
      encode({ externalCall: "0x01" }),
      encode({ allowedCancelBeneficiarySrc: "0x" }),
      encode({}, `0x${"11".repeat(52)}`),
      encode({}, "0x", 7),
    ])
      expect(() => checkedDlnOrder(data, intent)).toThrow(
        /differs from the fee-wallet intent/u,
      );
    expect(() =>
      checkedDlnOrder(`${evm.data}${"00".repeat(32)}` as Hex, intent),
    ).toThrow(/bytes outside the checked order/u);
    expect(() => checkedDlnOrder("0x095ea7b3" as Hex, intent)).toThrow();
  });

  const solana = orders.solana;
  const raw = () =>
    Uint8Array.from(solana.data.slice(2).match(/../gu) ?? [], (byte) =>
      Number.parseInt(byte, 16),
    );
  const solanaIntent = {
    wallet: solana.wallet,
    mint: solana.mint,
    giveAmount: BigInt(solana.giveAmount),
    takeToken: ROBINHOOD_USDG,
    takeChainId: 4663n,
    receiver: solana.receiver,
    orderId: solana.orderId,
  };

  test("a Solana order is accepted only for the exact intent and its derived accounts", () => {
    const order = checkedSolanaDlnOrder(parseTransaction(raw()), solanaIntent);
    expect(order.takeAmount).toBe(BigInt(solana.takeAmount));
    expect(order.giveOrderWallet).toBe(dlnGiveOrderWallet(solana.orderId));
    for (const [changed, reason] of [
      [{ receiver: "0x00000000000000000000000000000000000000aa" }, /intent/u],
      [{ giveAmount: 1n }, /intent/u],
      [{ takeChainId: 1n }, /intent/u],
      [{ takeToken: SLOP_TOKEN }, /intent/u],
      // The order's accounts are program addresses of its order id.
      [{ orderId: `0x${"11".repeat(32)}` }, /accounts differ/u],
      [{ wallet: solana.mint }, /only signer/u],
    ] as const)
      expect(() =>
        checkedSolanaDlnOrder(parseTransaction(raw()), {
          ...solanaIntent,
          ...changed,
        }),
      ).toThrow(reason);
  });

  test("a Solana order with a changed argument, another program or a high priority bid is refused", () => {
    const parsed = parseTransaction(raw());
    const order = parsed.instructions.at(-1);
    if (!order) throw new Error("fixture has no order instruction");
    const mutate = (change: (data: Uint8Array) => void) => {
      const data = order.data.slice();
      change(data);
      return {
        ...parsed,
        instructions: [...parsed.instructions.slice(0, -1), { ...order, data }],
      };
    };
    // One more base unit of USDC than the intent.
    expect(() =>
      checkedSolanaDlnOrder(
        mutate((data) => {
          data[8] += 1;
        }),
        solanaIntent,
      ),
    ).toThrow(/intent/u);
    // A different instruction of the same program.
    expect(() =>
      checkedSolanaDlnOrder(
        mutate((data) => {
          data[0] ^= 0xff;
        }),
        solanaIntent,
      ),
    ).toThrow(/not create_order_with_nonce/u);
    expect(() =>
      checkedSolanaDlnOrder(
        {
          ...parsed,
          instructions: [
            {
              program: "11111111111111111111111111111111",
              accounts: [0, 1],
              data: Uint8Array.of(2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0),
            },
            order,
          ],
        },
        solanaIntent,
      ),
    ).toThrow(/calls 11111111111111111111111111111111/u);
    // 1.4M units at 1,000,000 micro-lamports is 1.4 SOL of priority fee.
    expect(() =>
      checkedSolanaDlnOrder(
        {
          ...parsed,
          instructions: [
            {
              program: "ComputeBudget111111111111111111111111111111",
              accounts: [],
              data: Uint8Array.of(3, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0),
            },
            {
              program: "ComputeBudget111111111111111111111111111111",
              accounts: [],
              data: Uint8Array.of(2, 0xc0, 0x5c, 0x15, 0),
            },
            order,
          ],
        },
        solanaIntent,
      ),
    ).toThrow(/priority-fee limit/u);
    expect(() =>
      checkedSolanaDlnOrder(
        { ...parsed, lookups: [{ address: "x", writable: [0], readonly: [] }] },
        solanaIntent,
      ),
    ).toThrow(/lookup tables/u);
  });
});
