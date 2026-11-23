import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  programAddress,
  solanaBase58,
  solanaBase64,
} from "../../contracts/solana/adapter";
import { CLASSIC_TOKEN_PROGRAM } from "../../contracts/solana/token";
import { ata } from "../../contracts/solana/transactions";
import { sanitizeFeeTail } from "../../scripts/inspect-fee-worker-operations";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { bytesToHex } from "../../src/lib/byte-encoding";
import orders from "../../tests/fixtures/dln-orders.json";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { createBuyback } from "./buyback";
import {
  type BuybackLimits,
  DLN,
  parseBuybackConfig,
  ROBINHOOD_USDG,
} from "./buyback-config";
import { D1BuybackStore } from "./buyback-store";
import { parseConfig } from "./config";
import type { ConversionRow } from "./core";
import { NativeGasJournal } from "./native-gas";
import { createSolanaClient } from "./solana";
import { D1ConversionStore } from "./store";

test("Solana bridge reports the provider and method of a response failure without signing", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    const { wallet, mint, receiver, orderId, data, takeAmount } = orders.solana;
    const { vars } = Bun.TOML.parse(
      await Bun.file(new URL("./wrangler.toml", import.meta.url)).text(),
    ) as { vars: Record<string, string> };
    const config = parseConfig({
      ...vars,
      FEE_CONVERTER_MODE: "dry_run",
      FEE_CONVERTER_NETWORKS: "solana",
      FEE_WALLET_SOLANA: wallet,
      RPC_URL_SOLANA: "https://rpc.invalid",
    });
    const { limits } = parseBuybackConfig(
      { ...vars, BUYBACK_MODE: "dry_run" },
      config.mode,
    );
    if (!limits) throw new Error("Bridge fixture needs buyback limits");
    const buybackStore = new D1BuybackStore(db);
    buybackStore.feeIncome = async () => 1_000_000_000n;
    const buyback = createBuyback({
      mode: "dry_run",
      store: buybackStore,
      receiver,
      limits,
    });
    const tokenData = (bytes: Uint8Array) => ({
      owner: CLASSIC_TOKEN_PROGRAM,
      executable: false,
      data: [solanaBase64(bytes), "base64"],
    });
    const mintData = new Uint8Array(82);
    mintData.set([6, 1], 44);
    const tokenAccount = (amount: bigint) => {
      const bytes = new Uint8Array(165);
      bytes.set(decodeBase58Bytes(mint), 0);
      bytes.set(decodeBase58Bytes(wallet), 32);
      new DataView(bytes.buffer).setBigUint64(64, amount, true);
      bytes[108] = 1;
      return tokenData(bytes);
    };
    const held = tokenAccount(1_000_000_000n);
    const blockhash = solanaBase58(new Uint8Array(32).fill(11));
    const fixtureBody = "fixture-body-must-not-be-retained";
    for (const [failedMethod, provider, httpStatus] of [
      ["getTokenAccountsByOwner", "solana-rpc", 403],
      ["getLatestBlockhash", "solana-rpc", 502],
      ["simulateTransaction", "solana-rpc", 502],
      ["quote", "jupiter", 200],
      ["create-tx", undefined, 503],
    ] as const) {
      const malformed = () => new Response(fixtureBody, { status: httpStatus });
      const fetchFixture = (async (url, init) => {
        const request = new URL(String(url));
        if (request.origin === new URL(DLN.api).origin)
          return failedMethod === "create-tx"
            ? malformed()
            : Response.json({
                orderId,
                tx: { data },
                estimation: { dstChainTokenOut: { amount: takeAmount } },
              });
        if (request.hostname === "jupiter.invalid" && failedMethod === "quote")
          return malformed();
        if (request.hostname !== "rpc.invalid")
          throw new Error("Unexpected bridge provider in fixture");
        const { method, params, id } = JSON.parse(String(init?.body));
        if (method === failedMethod) return malformed();
        const results = {
          getAccountInfo: {
            value: params[0] === mint ? tokenData(mintData) : held,
          },
          getTokenAccountsByOwner: {
            value: [{ pubkey: ata(mint, wallet), account: held }],
          },
          getLatestBlockhash: {
            value: { blockhash, lastValidBlockHeight: 1000 },
          },
          getBalance: { value: 1_000_000_000 },
          getFeeForMessage: { value: 5000 },
          simulateTransaction: {
            value: {
              err: null,
              accounts: [{ lamports: 980_000_000 }, tokenAccount(500_000_000n)],
            },
          },
        };
        if (!Object.hasOwn(results, method))
          throw new Error("Unexpected bridge RPC method in fixture");
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: results[method as keyof typeof results],
        });
      }) as typeof fetch;
      const client = createSolanaClient({
        config: config.networks[0],
        limits: config.limits,
        jupiterApiUrl: "https://jupiter.invalid",
        jupiterApiKey: null,
        fetch: fetchFixture,
        buyback: {
          limits,
          receiver,
          robinhoodRpcUrl: "https://robinhood.invalid",
        },
      });
      const events: Record<string, unknown>[] = [];
      const summary = await buyback.run({
        config: config.networks[0],
        client,
        deps: {
          mode: "dry_run",
          limits: config.limits,
          store: new D1ConversionStore(db),
          now: () => new Date("2026-11-21T00:00:00.000Z"),
          randomId: () => "bridge-diagnostic",
          projectTokens: async () => [],
          client: () => client,
          log: (event) => events.push(event),
        },
        runId: "bridge-diagnostic-run",
        blocked: new Set(),
        leased: async () => true,
        assertLease: async () => {},
      });
      const event = {
        event: "fee_buyback_error",
        network: "solana",
        leg: "bridge",
      };
      const details = provider
        ? {
            providerFailure: {
              provider,
              stage: "response-json",
              method: failedMethod,
              httpStatus,
            },
          }
        : {};
      expect(summary).toMatchObject({ errors: 1, records: {}, inTransit: 0 });
      expect(events).toEqual([
        {
          ...event,
          error: provider ? "unparseable response" : "DLN returned HTTP 503",
          ...details,
        },
      ]);
      const inspected = sanitizeFeeTail({
        scriptName: "slop-fee-converter",
        logs: [{ message: events }],
      });
      expect(inspected?.records).toEqual([
        {
          ...event,
          errorCategory: provider ? "response-json" : "rpc-unavailable",
          ...details,
        },
      ]);
    }
    expect(sqlite.query("SELECT * FROM fee_conversions").all()).toEqual([]);
    expect(sqlite.query("SELECT * FROM fee_native_gas").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("a failed Solana bridge's paid fee remains in the next order's final cost cap", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    const seed = new Uint8Array(32).fill(37);
    const publicKey = ed25519.getPublicKey(seed);
    const wallet = solanaBase58(publicKey);
    const encoder = new TextEncoder();
    const nonceAccount = (owner: string) =>
      programAddress(DLN.solanaProgram, [
        encoder.encode("NONCE"),
        decodeBase58Bytes(owner),
      ]);
    // Use the captured order layout with a synthetic signing wallet. The
    // account/debit responses below are deterministic; chain execution is
    // covered separately by the local-validator integration.
    let data = orders.solana.data;
    for (const [before, after] of [
      [orders.solana.wallet, wallet],
      [
        ata(orders.solana.mint, orders.solana.wallet),
        ata(orders.solana.mint, wallet),
      ],
      [nonceAccount(orders.solana.wallet), nonceAccount(wallet)],
    ])
      data = data.replaceAll(
        bytesToHex(decodeBase58Bytes(before)),
        bytesToHex(decodeBase58Bytes(after)),
      );
    const now = () => new Date("2026-11-11T00:00:00.000Z");
    const runId = "solana-bridge-cost-run";
    const store = new D1ConversionStore(db);
    await store.acquireLock("solana", runId, now());
    const config = parseConfig({
      FEE_CONVERTER_MODE: "live",
      FEE_CONVERTER_NETWORKS: "solana",
      FEE_WALLET_SOLANA: wallet,
      RPC_URL_SOLANA: "https://rpc.invalid",
      FEE_CONVERTER_MIN_VALUE_MICRO: "1",
      FEE_CONVERTER_GAS_MULTIPLE: "1",
      FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
      FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
      FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
      FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
      FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({
        solana: {
          perTransaction: "5000000",
          perDay: "20000000",
          additionalFeeReserve: "0",
        },
      }),
    });
    const nativeLimits = {
      perTransaction: "50000000",
      perDay: "100000000",
      additionalFeeReserve: "0",
    };
    const gas = new NativeGasJournal(
      db,
      "solana",
      wallet,
      runId,
      nativeLimits,
      now,
      "bridge",
    );
    const limits: BuybackLimits = {
      startAt: now().toISOString(),
      shareBps: 5000n,
      burnBps: 5000n,
      minBridgeMicro: 500_000_000n,
      maxBridgeCostBps: 150n,
      maxBridgeNativeFee: { solana: 50_000_000n },
      minBuyMicro: 1n,
      minBurnMicro: 1n,
      maxSlippageBps: 100,
      maxPriceImpactBps: 200,
      runCapMicro: 1_000_000_000n,
      dailyCapMicro: 5_000_000_000n,
      unfilledAlertSeconds: 3600n,
      solanaBridgeNative: nativeLimits,
    };
    const pricedAmounts: bigint[] = [];
    const blockhash = solanaBase58(new Uint8Array(32).fill(11));
    const tokenAccount = (amount: bigint) => {
      const bytes = new Uint8Array(165);
      new DataView(bytes.buffer).setBigUint64(64, amount, true);
      return { data: [solanaBase64(bytes), "base64"] };
    };
    const doFetch = (async (url, init) => {
      if (String(url).startsWith(DLN.api))
        return Response.json({
          orderId: orders.solana.orderId,
          tx: { data },
          estimation: {
            dstChainTokenOut: { amount: orders.solana.takeAmount },
          },
        });
      if (String(url).startsWith("https://jupiter.invalid/")) {
        const query = new URL(String(url)).searchParams;
        const requestedAmount = query.get("amount");
        if (requestedAmount === null) throw new Error("Missing quote amount");
        const amount = BigInt(requestedAmount);
        pricedAmounts.push(amount);
        // At 116 USDC/SOL, the clean 0.05 SOL ceiling plus spread fits 1.5%.
        // Adding a previously paid 0.001 SOL fee moves it above the limit.
        const out = (amount * 116_000_000n) / 1_000_000_000n;
        return Response.json({
          inputMint: query.get("inputMint"),
          outputMint: orders.solana.mint,
          inAmount: amount.toString(),
          outAmount: out.toString(),
          otherAmountThreshold: out.toString(),
          swapMode: "ExactIn",
          slippageBps: Number(query.get("slippageBps")),
          platformFee: null,
        });
      }
      const { method, params, id } = JSON.parse(String(init?.body));
      let result: unknown;
      switch (method) {
        case "getLatestBlockhash":
          result = { value: { blockhash, lastValidBlockHeight: 1000 } };
          break;
        case "getBalance":
          result = { value: 1_000_000_000 };
          break;
        case "getAccountInfo":
          result = { value: tokenAccount(1_000_000_000n) };
          break;
        case "simulateTransaction":
          result = {
            value: {
              err: null,
              accounts: [
                { lamports: 980_000_000 },
                ...(params[1].accounts.addresses.length === 2
                  ? [tokenAccount(500_000_000n)]
                  : []),
              ],
            },
          };
          break;
        case "getFeeForMessage":
          result = { context: { slot: 100 }, value: 5000 };
          break;
        case "getBlocks":
          result = [100];
          break;
        case "getBlock":
          result = { blockhash };
          break;
        default:
          throw new Error(`Unexpected cost-test RPC ${method}`);
      }
      return Response.json({ jsonrpc: "2.0", id, result });
    }) as typeof fetch;
    const client = createSolanaClient({
      config: config.networks[0],
      limits: config.limits,
      jupiterApiUrl: "https://jupiter.invalid",
      jupiterApiKey: null,
      keypair: JSON.stringify([...seed, ...publicKey]),
      nativeGas: gas,
      fetch: doFetch,
      buyback: {
        limits,
        receiver: orders.solana.receiver,
        robinhoodRpcUrl: "https://robinhood.invalid",
        bridgeGas: gas,
      },
    });
    const bridge = client.buyback?.bridge;
    if (!bridge) throw new Error("Missing Solana bridge client");
    const quote = await bridge.quote(500_000_000n);
    if ("noRoute" in quote) throw new Error(quote.noRoute);
    const signed = await bridge.prepare(quote, 0, async () => {});
    expect(signed.kind).toBe("bridge");
    expect(pricedAmounts.at(-1)).toBe(50_000_000n);
    const row: ConversionRow = {
      id: "failed-solana-bridge",
      kind: "bridge",
      runId,
      network: "solana",
      mode: "live",
      feeWallet: wallet,
      token: orders.solana.mint,
      targetToken: ROBINHOOD_USDG,
      amountIn: quote.amountIn.toString(),
      route: "debridge",
      quoteAmountOut: quote.takeAmount.toString(),
      minAmountOut: quote.takeAmount.toString(),
      quoteValueMicro: 500_000_000,
      priceImpactBps: null,
      quote: JSON.stringify(signed.terms),
      approvalTxId: null,
      txId: signed.txId,
      rawTx: signed.rawTx,
      evmNonce: null,
      expiresAt: signed.expiresAt,
      amountOut: null,
      tokenBalanceBefore: null,
      targetBalanceBefore: null,
      targetBalanceAfter: null,
      state: "submitted",
      reason: null,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      submittedAt: now().toISOString(),
      finalizedAt: null,
      nativeGasId: signed.nativeGasId,
    };
    await store.insert(row, { runId, now: now() });
    await store.update(row.id, {
      state: "failed",
      reason: "finalized order reverted",
    });
    await gas.settle(
      {
        txId: signed.txId,
        rawTx: signed.rawTx,
        conversionId: row.id,
        feeWallet: wallet,
        nonce: 0,
      },
      { txId: signed.txId, actualWei: "1000000", blockHash: blockhash },
    );
    const retry = await bridge.quote(500_000_000n);
    if ("noRoute" in retry) throw new Error(retry.noRoute);
    await expect(bridge.prepare(retry, 0, async () => {})).rejects.toThrow(
      "Final prepared bridge cost exceeds the cap",
    );
    expect(pricedAmounts.at(-1)).toBe(51_000_000n);
    expect(
      (await gas.rows()).map((attempt) => ({
        state: attempt.state,
        actual: attempt.actual_wei,
      })),
    ).toEqual([{ state: "signed", actual: "1000000" }]);
    expect(await store.openRows("solana")).toEqual([]);
  } finally {
    sqlite.close();
  }
});
