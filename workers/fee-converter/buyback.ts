/**
 * SLOP buyback policy (PRD section 6, "SLOP buyback and burn"; owner decision
 * of 10 November 2026). It runs inside a network's existing fee-converter
 * lease, after that network's reconciliation, claims and conversions, and
 * only on a recovery scan.
 *
 * Source networks (Base, Ethereum, Solana): the buyback share of the USDC
 * that verified fees became is bridged, in one open order at a time, to the
 * Robinhood Chain fee wallet.
 *
 * Robinhood Chain: a proven bridge arrival is spent in full on SLOP, and a
 * fee received there at the buyback share. SLOP stays in the fee wallet; the
 * burn share of everything acquired is then sent to the burn address.
 *
 * Every amount is "share of a cumulative verified total, less what the
 * journal already committed" (verified-buyback.ts), so a retry, a restart or
 * a repeated run cannot take a share twice, and the retained SLOP is never
 * halved again. Chain and provider details live behind BuybackChainClient.
 * A failure in one leg is logged and never fails the network's run.
 */

import {
  BUYBACK_NETWORK,
  type BuybackLimits,
  ROBINHOOD_USDG,
  SLOP_TOKEN,
} from "./buyback-config";
import type { Network, NetworkConfig } from "./config";
import {
  type ChainClient,
  type ConversionRow,
  type ConversionState,
  exactQuoteMicro,
  message,
  nonceFloor,
  type PreparedSend,
  type Quote,
  type RunDependencies,
} from "./core";
import {
  acceptableMinimum,
  remainingBudget,
  rescaleInput,
} from "./verified-arithmetic";
import {
  boundedSend,
  bridgeFeeWithin,
  burnDue,
  entitlement,
  shareOf,
} from "./verified-buyback";

/** The exact order a bridge row was signed for; immutable once journaled. */
export interface BridgeTerms {
  provider: "debridge";
  /** `0x` and 64 lowercase hex characters. */
  orderId: string;
  /** The asset and exact amount the order delivers on Robinhood Chain. */
  takeToken: string;
  takeAmount: string;
  takeChainId: string;
  /** The Robinhood Chain fee wallet that receives the fill. */
  receiver: string;
  /** Fixed protocol fee paid in the source network's native asset. */
  nativeFee: string;
  salt: string;
}

export interface BridgeQuote {
  amountIn: bigint;
  takeToken: string;
  takeAmount: bigint;
  nativeFee: bigint;
  /** Spread, fixed protocol fee and network fee, in stablecoin micro-units. */
  costMicro: bigint;
  receiver: string;
  /** Bounded, public quote facts for the record. */
  summary: Record<string, unknown>;
}

/** A signed bridge approval or order. An order always carries its terms. */
export interface PreparedBridge extends PreparedSend {
  terms: BridgeTerms | null;
}

/** A finalized block that proves an order's outcome. */
export interface OutcomeEvidence {
  block: number;
  blockHash: string;
}

export type FillState =
  | { state: "arrived"; evidence: OutcomeEvidence }
  /** A cancellation was sent from Robinhood Chain; the refund is not proven yet. */
  | { state: "cancelling" }
  | { state: "open" };

/** A SLOP purchase quote with the input's value in stablecoin micro-units. */
export interface BuyQuote extends Quote {
  valueMicro: bigint;
}

export interface BurnQuote {
  valueMicro: bigint;
  gasCostMicro: bigint;
}

export interface BuybackChainClient {
  /** Source networks only. */
  bridge?: {
    quote(amount: bigint): Promise<BridgeQuote | { noRoute: string }>;
    /** Signs the exact approval, or the order once the allowance is final. */
    prepare(
      quote: BridgeQuote,
      nonceFloor: number,
      assertLease: () => Promise<void>,
    ): Promise<PreparedBridge>;
    /** The finalized block proving the deposit was claimed back, or null. */
    refund(terms: BridgeTerms): Promise<OutcomeEvidence | null>;
  };
  /** Robinhood Chain only. */
  market?: {
    fill(terms: BridgeTerms): Promise<FillState>;
    quoteBuy(
      token: string,
      amount: bigint,
    ): Promise<BuyQuote | { noRoute: string }>;
    prepareBuy(
      token: string,
      quote: BuyQuote,
      nonceFloor: number,
      assertLease: () => Promise<void>,
    ): Promise<PreparedSend>;
    /** `blocked`: the transfer cannot be made now, for example a paused token. */
    quoteBurn(amount: bigint): Promise<BurnQuote | { blocked: string }>;
    prepareBurn(
      amount: bigint,
      quote: BurnQuote,
      nonceFloor: number,
      assertLease: () => Promise<void>,
    ): Promise<PreparedSend>;
  };
}

export interface BridgeOutcome {
  bridgeId: string;
  sourceNetwork: Network;
  orderId: string;
  outcome: "arrived" | "refunded";
  token: string;
  amount: string;
  evidenceNetwork: Network;
  evidenceBlock: number;
  evidenceBlockHash: string;
  runId: string;
  observedAt: string;
}

export interface BuybackStore {
  feeIncome(
    network: Network,
    token: string,
    feeWallet: string,
    since: string,
  ): Promise<bigint>;
  committed(
    network: Network,
    kind: "bridge" | "buyback" | "burn",
    token: string,
    feeWallet: string,
  ): Promise<bigint>;
  arrivedCredit(token: string, feeWallet: string): Promise<bigint>;
  bought(network: Network, token: string, feeWallet: string): Promise<bigint>;
  inTransit(network?: Network): Promise<ConversionRow[]>;
  recordOutcome(outcome: BridgeOutcome): Promise<void>;
  valueSince(
    network: Network,
    kind: "bridge" | "buyback",
    since: string,
  ): Promise<bigint>;
  latestOf(
    network: Network,
    kind: "bridge" | "buyback" | "burn",
    token: string,
  ): Promise<ConversionRow | null>;
}

export interface BuybackContext {
  config: NetworkConfig;
  client: ChainClient;
  deps: RunDependencies;
  runId: string;
  /** Tokens with an unresolved journaled send on this network. */
  blocked: Set<string>;
  leased: () => Promise<boolean>;
  assertLease: () => Promise<void>;
}

export interface BuybackSummary {
  /** Outcomes of this run, keyed `<leg>:<state>`, for example `bridge:submitted`. */
  records: Record<string, number>;
  arrived: number;
  refunded: number;
  /** Deposits still without a proven outcome after this run. */
  inTransit: number;
  errors: number;
}

export interface BuybackHook {
  /** The mode buyback sends are signed in; never `off`. */
  mode: "dry_run" | "live";
  active(config: NetworkConfig): boolean;
  run(context: BuybackContext): Promise<BuybackSummary>;
}

export interface BuybackOptions {
  mode: "dry_run" | "live";
  limits: BuybackLimits;
  store: BuybackStore;
  /** The Robinhood Chain fee wallet every bridge order must deliver to. */
  receiver: string;
}

type Leg = "bridge" | "buyback" | "burn";

/** The recorded terms of a journaled bridge row; a malformed record stops its leg. */
export function bridgeTerms(row: ConversionRow): BridgeTerms {
  const terms = JSON.parse(row.quote ?? "null") as Partial<BridgeTerms> | null;
  if (
    terms?.provider !== "debridge" ||
    typeof terms.orderId !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(terms.orderId) ||
    typeof terms.takeToken !== "string" ||
    typeof terms.takeAmount !== "string" ||
    !/^[1-9][0-9]*$/u.test(terms.takeAmount) ||
    typeof terms.takeChainId !== "string" ||
    typeof terms.receiver !== "string" ||
    typeof terms.nativeFee !== "string" ||
    !/^(0|[1-9][0-9]*)$/u.test(terms.nativeFee) ||
    typeof terms.salt !== "string"
  )
    throw new Error("Bridge row lacks its recorded order terms");
  return terms as BridgeTerms;
}

export function createBuyback(options: BuybackOptions): BuybackHook {
  const { limits, store } = options;

  /** The value still allowed for one leg on this network in this run and day. */
  async function remainingValue(
    context: BuybackContext,
    kind: "bridge" | "buyback",
    runValue: bigint,
  ) {
    const since = new Date(
      context.deps.now().getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    return remainingBudget(
      limits.runCapMicro,
      runValue,
      limits.dailyCapMicro,
      await store.valueSince(context.config.network, kind, since),
    );
  }

  function baseRow(
    context: BuybackContext,
    kind: Leg,
    token: string,
    targetToken: string,
    amount: bigint,
    balance: bigint,
  ): ConversionRow {
    const at = context.deps.now().toISOString();
    return {
      id: context.deps.randomId(),
      kind,
      runId: context.runId,
      network: context.config.network,
      mode: options.mode,
      feeWallet: context.config.feeWallet,
      token,
      targetToken,
      amountIn: amount.toString(),
      route: null,
      quoteAmountOut: null,
      minAmountOut: null,
      quoteValueMicro: null,
      priceImpactBps: null,
      quote: null,
      approvalTxId: null,
      txId: null,
      rawTx: null,
      evmNonce: null,
      expiresAt: null,
      amountOut: null,
      tokenBalanceBefore: balance.toString(),
      targetBalanceBefore: null,
      targetBalanceAfter: null,
      state: "quoted",
      reason: null,
      createdAt: at,
      updatedAt: at,
      submittedAt: null,
      finalizedAt: null,
    };
  }

  /**
   * Records a decision that signs nothing. The same decision for the same
   * amount is recorded once, not on every scan.
   */
  async function note(
    context: BuybackContext,
    row: ConversionRow,
    state: Extract<
      ConversionState,
      "quoted" | "pending" | "skipped" | "no_route"
    >,
    reason: string | null,
  ): Promise<ConversionState> {
    const last = await store.latestOf(row.network, row.kind as Leg, row.token);
    if (
      last &&
      last.state === state &&
      last.reason === reason &&
      last.amountIn === row.amountIn &&
      last.mode === row.mode
    )
      return state;
    await context.deps.store.insert({ ...row, state, reason });
    return state;
  }

  /**
   * Signs, journals and then broadcasts one send, in that order. The journal
   * insert commits the amount; only a later verified failure releases it.
   */
  async function send(
    context: BuybackContext,
    row: ConversionRow,
    prepare: (floor: number) => Promise<PreparedSend & { terms?: unknown }>,
    describe: (prepared: PreparedSend & { terms?: unknown }) => {
      quote: string | null;
      minAmountOut: string | null;
    },
  ): Promise<ConversionState> {
    const { deps, assertLease } = context;
    const at = () => deps.now().toISOString();
    let prepared: PreparedSend & { terms?: unknown };
    let described: { quote: string | null; minAmountOut: string | null };
    try {
      const floor = await nonceFloor(row.network, deps.store);
      await assertLease();
      prepared = await prepare(floor);
      // Match migration 0078: at most 128 KiB encoded as hex plus its prefix.
      if (prepared.rawTx.length > 262146)
        throw new Error("signed transaction exceeds the storage limit");
      // Signed terms that differ from the decision are never journaled or sent.
      described = describe(prepared);
      await assertLease();
    } catch (error) {
      await deps.store.insert({
        ...row,
        state: "failed",
        reason: `prepare: ${message(error)}`,
        updatedAt: at(),
      });
      return "failed";
    }
    const approval = prepared.kind === "approval";
    await deps.store.insert(
      {
        ...row,
        kind: approval ? "approval" : row.kind,
        state: "submitted",
        txId: prepared.txId,
        nativeGasId: prepared.nativeGasId,
        rawTx: prepared.rawTx,
        evmNonce: prepared.evmNonce,
        expiresAt: prepared.expiresAt,
        approvalTxId: prepared.approvalTxId,
        quote: approval ? row.quote : described.quote,
        minAmountOut: approval ? null : described.minAmountOut,
        submittedAt: at(),
        updatedAt: at(),
      },
      { runId: context.runId, now: deps.now() },
    );
    context.blocked.add(row.token);
    await assertLease();
    try {
      await context.client.broadcast(prepared.rawTx);
    } catch (error) {
      await deps.store.update(row.id, {
        state: "unknown",
        reason: `broadcast: ${message(error)}`,
        updatedAt: at(),
      });
      return "unknown";
    }
    deps.log({
      event: approval ? "fee_approval_submitted" : `fee_${row.kind}_submitted`,
      network: row.network,
      token: row.token,
      txId: prepared.txId,
      amountIn: row.amountIn,
    });
    return "submitted";
  }

  /** Source network: release proven refunds, then open at most one order. */
  async function bridgeLeg(
    context: BuybackContext,
    summary: BuybackSummary,
    count: (leg: Leg, state: ConversionState) => void,
  ) {
    const { config, client, deps } = context;
    const bridge = client.buyback?.bridge;
    const usdc = config.definition.usdc;
    if (!bridge || usdc === null) return;
    for (const row of await store.inTransit(config.network)) {
      if (!(await context.leased())) return;
      try {
        const terms = bridgeTerms(row);
        const evidence = await bridge.refund(terms);
        if (!evidence) continue;
        await context.assertLease();
        await store.recordOutcome({
          bridgeId: row.id,
          sourceNetwork: config.network,
          orderId: terms.orderId,
          outcome: "refunded",
          token: row.token,
          amount: row.amountOut as string,
          evidenceNetwork: config.network,
          evidenceBlock: evidence.block,
          evidenceBlockHash: evidence.blockHash,
          runId: context.runId,
          observedAt: deps.now().toISOString(),
        });
        summary.refunded += 1;
        deps.log({
          event: "fee_bridge_refunded",
          network: config.network,
          orderId: terms.orderId,
          amount: row.amountOut,
        });
      } catch (error) {
        summary.errors += 1;
        deps.log({
          event: "fee_buyback_error",
          network: config.network,
          leg: "refund",
          bridgeId: row.id,
          error: message(error),
        });
      }
    }
    if (context.blocked.has(usdc) || !(await context.leased())) return;
    const income = await store.feeIncome(
      config.network,
      usdc,
      config.feeWallet,
      limits.startAt,
    );
    const due = entitlement(
      0n,
      income,
      limits.shareBps,
      await store.committed(config.network, "bridge", usdc, config.feeWallet),
    );
    if (due === 0n) return;
    const balance = await client.balance(usdc);
    const remaining = await remainingValue(context, "bridge", 0n);
    const amount = boundedSend(due, balance, remaining > 0n ? remaining : 0n);
    // The asset every bridge order delivers on Robinhood Chain.
    const target = ROBINHOOD_USDG;
    const row = baseRow(context, "bridge", usdc, target, amount, balance);
    row.route = "debridge";
    row.quoteValueMicro = exactQuoteMicro(amount);
    if (remaining <= 0n)
      return count(
        "bridge",
        await note(context, row, "skipped", "daily value cap reached"),
      );
    if (amount < limits.minBridgeMicro || amount === 0n)
      return count(
        "bridge",
        await note(context, row, "pending", "below the minimum bridge value"),
      );
    if (row.quoteValueMicro === null)
      return count(
        "bridge",
        await note(
          context,
          row,
          "skipped",
          "bridge value exceeds safe integer accounting",
        ),
      );
    const quote = await bridge.quote(amount);
    if ("noRoute" in quote)
      return count(
        "bridge",
        await note(context, row, "no_route", quote.noRoute),
      );
    const quoted: ConversionRow = {
      ...row,
      quoteAmountOut: quote.takeAmount.toString(),
      minAmountOut: quote.takeAmount.toString(),
      quote: JSON.stringify(quote.summary).slice(0, 8192),
    };
    // The order must deliver the pinned asset to the configured Robinhood
    // fee wallet for exactly the amount this run decided.
    if (
      quote.amountIn !== amount ||
      quote.takeToken.toLowerCase() !== target ||
      quote.receiver.toLowerCase() !== options.receiver.toLowerCase()
    )
      throw new Error("Bridge quote differs from the requested order");
    const maximumFee = limits.maxBridgeNativeFee[config.network];
    if (maximumFee === undefined || quote.nativeFee > maximumFee)
      return count(
        "bridge",
        await note(
          context,
          quoted,
          "skipped",
          "fixed bridge fee above the approved maximum",
        ),
      );
    // Both stablecoins have six decimals, so the input and the arrival share
    // one scale. An arrival above the input means a wrong asset or scale.
    if (
      quote.takeAmount > amount ||
      !bridgeFeeWithin(
        amount,
        amount - quote.costMicro,
        limits.maxBridgeCostBps,
      )
    )
      return count(
        "bridge",
        await note(context, quoted, "skipped", "bridge cost above the cap"),
      );
    if (options.mode === "dry_run")
      return count("bridge", await note(context, quoted, "quoted", null));
    count(
      "bridge",
      await send(
        context,
        quoted,
        (floor) => bridge.prepare(quote, floor, context.assertLease),
        (prepared) => {
          // The exact approval comes first; the order is a later send.
          if (prepared.kind === "approval")
            return { quote: quoted.quote, minAmountOut: null };
          const terms = (prepared as PreparedBridge).terms;
          if (
            !terms ||
            terms.takeAmount !== quote.takeAmount.toString() ||
            terms.takeToken.toLowerCase() !== target ||
            terms.receiver.toLowerCase() !== options.receiver.toLowerCase()
          )
            throw new Error("Signed bridge order differs from its quote");
          return {
            quote: JSON.stringify(terms),
            minAmountOut: terms.takeAmount,
          };
        },
      ),
    );
  }

  /** Robinhood Chain: credit proven arrivals exactly once. */
  async function arrivals(context: BuybackContext, summary: BuybackSummary) {
    const { client, deps } = context;
    const market = client.buyback?.market;
    if (!market) return;
    for (const row of await store.inTransit()) {
      if (!(await context.leased())) return;
      try {
        const terms = bridgeTerms(row);
        const fill = await market.fill(terms);
        if (fill.state === "arrived") {
          await context.assertLease();
          await store.recordOutcome({
            bridgeId: row.id,
            sourceNetwork: row.network,
            orderId: terms.orderId,
            outcome: "arrived",
            token: terms.takeToken,
            amount: terms.takeAmount,
            evidenceNetwork: BUYBACK_NETWORK,
            evidenceBlock: fill.evidence.block,
            evidenceBlockHash: fill.evidence.blockHash,
            runId: context.runId,
            observedAt: deps.now().toISOString(),
          });
          summary.arrived += 1;
          deps.log({
            event: "fee_bridge_arrived",
            network: row.network,
            orderId: terms.orderId,
            amount: terms.takeAmount,
          });
          continue;
        }
        const waited =
          deps.now().getTime() - Date.parse(row.finalizedAt as string);
        // An order nobody fills stays in transit. Cancelling it is an owner
        // action outside this Worker; the alert makes the wait visible.
        if (
          fill.state === "cancelling" ||
          waited > Number(limits.unfilledAlertSeconds) * 1000
        )
          deps.log({
            event:
              fill.state === "cancelling"
                ? "fee_bridge_cancelling"
                : "fee_bridge_unfilled",
            network: row.network,
            orderId: terms.orderId,
            amount: row.amountIn,
            waitedSeconds: Math.floor(waited / 1000),
          });
      } catch (error) {
        summary.errors += 1;
        deps.log({
          event: "fee_buyback_error",
          network: row.network,
          leg: "arrival",
          bridgeId: row.id,
          error: message(error),
        });
      }
    }
  }

  /** Robinhood Chain: spend one asset's buyback entitlement on SLOP. */
  async function buy(
    context: BuybackContext,
    token: string,
    runValue: { total: bigint },
  ): Promise<ConversionState | null> {
    const { config, client } = context;
    const market = client.buyback?.market;
    if (!market) return null;
    const due = entitlement(
      await store.arrivedCredit(token, config.feeWallet),
      await store.feeIncome(
        config.network,
        token,
        config.feeWallet,
        limits.startAt,
      ),
      limits.shareBps,
      await store.committed(config.network, "buyback", token, config.feeWallet),
    );
    if (due === 0n) return null;
    const balance = await client.balance(token);
    let amount = due < balance ? due : balance;
    if (amount === 0n) return null;
    const row = baseRow(context, "buyback", token, SLOP_TOKEN, amount, balance);
    const remaining = await remainingValue(context, "buyback", runValue.total);
    if (remaining <= 0n)
      return note(
        context,
        row,
        "skipped",
        limits.runCapMicro - runValue.total <= 0n
          ? "per-run value cap reached"
          : "daily value cap reached",
      );
    let quoted = await market.quoteBuy(token, amount);
    if ("noRoute" in quoted)
      return note(context, row, "no_route", quoted.noRoute);
    // Fit the purchase inside the remaining caps by scaling the input and
    // quoting again, a bounded number of times; never exceed either cap.
    for (
      let attempt = 0;
      attempt < 3 && quoted.valueMicro > remaining;
      attempt++
    ) {
      const scaled = rescaleInput(amount, remaining, quoted.valueMicro);
      if (scaled <= 0n) break;
      amount = scaled;
      const requoted = await market.quoteBuy(token, amount);
      if ("noRoute" in requoted)
        return note(
          context,
          { ...row, amountIn: amount.toString() },
          "no_route",
          requoted.noRoute,
        );
      quoted = requoted;
    }
    const quote = quoted;
    const priced: ConversionRow = {
      ...row,
      amountIn: amount.toString(),
      route: quote.route,
      quoteAmountOut: quote.amountOut.toString(),
      minAmountOut: quote.minAmountOut.toString(),
      quoteValueMicro: exactQuoteMicro(quote.valueMicro),
      priceImpactBps: quote.priceImpactBps,
      quote: JSON.stringify(quote.summary).slice(0, 8192),
    };
    if (quote.amountIn !== amount)
      throw new Error("Purchase quote differs from the requested amount");
    if (quote.valueMicro > remaining)
      return note(
        context,
        priced,
        "skipped",
        "quote exceeds the remaining value cap",
      );
    if (priced.quoteValueMicro === null)
      return note(
        context,
        priced,
        "skipped",
        "quote value exceeds safe integer accounting",
      );
    if (quote.valueMicro < limits.minBuyMicro)
      return note(
        context,
        priced,
        "pending",
        "below the minimum purchase value",
      );
    if (quote.valueMicro < quote.gasCostMicro * context.deps.limits.gasMultiple)
      return note(context, priced, "pending", "below the gas-cost multiple");
    if (
      quote.priceImpactBps === null ||
      quote.priceImpactBps > limits.maxPriceImpactBps
    )
      return note(
        context,
        priced,
        "skipped",
        quote.priceImpactBps === null
          ? "price impact unknown"
          : "price impact above the cap",
      );
    if (
      !acceptableMinimum(
        quote.amountOut,
        quote.minAmountOut,
        BigInt(limits.maxSlippageBps),
      )
    )
      return note(
        context,
        priced,
        "skipped",
        "minimum output outside the slippage limit",
      );
    if (options.mode === "dry_run") {
      runValue.total += quote.valueMicro;
      return note(context, priced, "quoted", null);
    }
    const state = await send(
      context,
      priced,
      (floor) => market.prepareBuy(token, quote, floor, context.assertLease),
      (prepared) => ({
        quote: priced.quote,
        minAmountOut: prepared.minAmountOut.toString(),
      }),
    );
    if (state === "submitted" || state === "unknown")
      runValue.total += quote.valueMicro;
    return state;
  }

  /** Robinhood Chain: burn the burn share of all SLOP acquired, once. */
  async function burn(
    context: BuybackContext,
  ): Promise<ConversionState | null> {
    const { config, client } = context;
    const market = client.buyback?.market;
    if (!market || context.blocked.has(SLOP_TOKEN)) return null;
    // SLOP received as a fee needs no purchase: its buyback share is acquired.
    const acquired =
      (await store.bought(config.network, SLOP_TOKEN, config.feeWallet)) +
      shareOf(
        await store.feeIncome(
          config.network,
          SLOP_TOKEN,
          config.feeWallet,
          limits.startAt,
        ),
        limits.shareBps,
      );
    const due = burnDue(
      acquired,
      limits.burnBps,
      await store.committed(
        config.network,
        "burn",
        SLOP_TOKEN,
        config.feeWallet,
      ),
    );
    if (due === 0n) return null;
    const balance = await client.balance(SLOP_TOKEN);
    const amount = due < balance ? due : balance;
    if (amount === 0n) return null;
    const row = baseRow(
      context,
      "burn",
      SLOP_TOKEN,
      SLOP_TOKEN,
      amount,
      balance,
    );
    const quote = await market.quoteBurn(amount);
    if ("blocked" in quote) return note(context, row, "pending", quote.blocked);
    const valued: ConversionRow = {
      ...row,
      quoteValueMicro: exactQuoteMicro(quote.valueMicro),
    };
    if (quote.valueMicro < limits.minBurnMicro)
      return note(context, valued, "pending", "below the minimum burn value");
    if (quote.valueMicro < quote.gasCostMicro * context.deps.limits.gasMultiple)
      return note(context, valued, "pending", "below the gas-cost multiple");
    if (valued.quoteValueMicro === null)
      return note(
        context,
        valued,
        "skipped",
        "burn value exceeds safe integer accounting",
      );
    if (options.mode === "dry_run")
      return note(context, valued, "quoted", null);
    const terms = JSON.stringify({ burn: amount.toString() });
    return send(
      context,
      { ...valued, quote: terms },
      (floor) => market.prepareBurn(amount, quote, floor, context.assertLease),
      () => ({ quote: terms, minAmountOut: null }),
    );
  }

  return {
    mode: options.mode,
    active(config) {
      return (
        config.network === BUYBACK_NETWORK || config.definition.usdc !== null
      );
    },
    async run(context) {
      const { config, deps } = context;
      const summary: BuybackSummary = {
        records: {},
        arrived: 0,
        refunded: 0,
        inTransit: 0,
        errors: 0,
      };
      const count = (leg: Leg, state: ConversionState | null) => {
        if (state === null) return;
        const key = `${leg}:${state}`;
        summary.records[key] = (summary.records[key] ?? 0) + 1;
      };
      const attempt = async (leg: string, action: () => Promise<void>) => {
        try {
          if (await context.leased()) await action();
        } catch (error) {
          summary.errors += 1;
          deps.log({
            event: "fee_buyback_error",
            network: config.network,
            leg,
            error: message(error),
          });
        }
      };
      if (config.network !== BUYBACK_NETWORK) {
        await attempt("bridge", () => bridgeLeg(context, summary, count));
        summary.inTransit = (await store.inTransit(config.network)).length;
        return summary;
      }
      await attempt("arrival", () => arrivals(context, summary));
      const reference = config.definition.stable;
      const tokens = [
        ...new Set(
          [
            ...(reference === null ? [] : [reference]),
            ...(await deps.projectTokens(config)),
            ...config.allowlist,
          ].map((token) => token.toLowerCase()),
        ),
      ].filter((token) => token !== SLOP_TOKEN);
      const runValue = { total: 0n };
      for (const token of tokens) {
        if (context.blocked.has(token)) continue;
        await attempt(`buyback ${token}`, async () =>
          count("buyback", await buy(context, token, runValue)),
        );
      }
      await attempt("burn", async () => count("burn", await burn(context)));
      summary.inTransit = (await store.inTransit()).length;
      return summary;
    },
  };
}
