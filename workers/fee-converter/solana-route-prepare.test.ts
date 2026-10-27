import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
} from "../../contracts/solana/adapter";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../../contracts/solana/token-extensions";
import { ata } from "../../contracts/solana/transactions";
import { parseConfig } from "./config";
import type { ConversionRow } from "./core";
import { NativeGasJournal } from "./native-gas";
import {
  createSolanaClient,
  JUPITER_PROGRAM,
  parseTransaction,
} from "./solana";
import { LOOKUP_TABLE_PROGRAM } from "./solana-accounts";
import type { RouteReceipt } from "./solana-route-receipt";
import { sqliteD1 } from "./sqlite-d1";
import { D1ConversionStore } from "./store";

const key = (n: number) => solanaBase58(new Uint8Array(32).fill(n));
const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
};
const keyBytes = (s: string) => {
  // The production decoder is exercised separately by the client.
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(alphabet.indexOf(c));
  const bytes: number[] = [];
  while (n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  return [...new Uint8Array(32 - bytes.length), ...bytes];
};
type Account = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, string];
};
const account = (
  owner: string,
  data: Uint8Array,
  executable = false,
): Account => ({
  owner,
  executable,
  lamports: 10000000,
  data: [solanaBase64(data), "base64"],
});

async function fixture(
  options: {
    badDebit?: boolean;
    redirect?: boolean;
    wrongTable?: boolean;
  } = {},
) {
  const { db, sqlite } = sqliteD1();
  const seed = new Uint8Array(32).fill(31),
    publicKey = ed25519.getPublicKey(seed),
    wallet = solanaBase58(publicKey);
  const input = key(2),
    output = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tableKey = key(10),
    blockhash = key(11),
    event = key(12);
  const source = ata(input, wallet, TOKEN_2022_PROGRAM),
    destination = ata(output, wallet);
  const inputData = new Uint8Array(82);
  inputData[44] = 6;
  inputData[45] = 1;
  const outputData = inputData.slice();
  const token = (mint: string, program: string, amount: bigint) => {
    const data = new Uint8Array(165);
    data.set(keyBytes(mint));
    data.set(publicKey, 32);
    data.set(u64(amount), 64);
    data[108] = 1;
    return account(program, data);
  };
  const states = new Map<string, Account | null>([
    [wallet, account("11111111111111111111111111111111", new Uint8Array())],
    [input, account(TOKEN_2022_PROGRAM, inputData)],
    [output, account(TOKEN_PROGRAM, outputData)],
    [source, token(input, TOKEN_2022_PROGRAM, 20000000n)],
    [destination, token(output, TOKEN_PROGRAM, 0n)],
    [event, null],
    ...[JUPITER_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map(
      (program): [string, Account] => [
        program,
        account(
          "BPFLoaderUpgradeab1e11111111111111111111111",
          new Uint8Array(),
          true,
        ),
      ],
    ),
  ]);
  // v0 message, seven static keys and the two token accounts loaded writable.
  const keys = [
    wallet,
    JUPITER_PROGRAM,
    TOKEN_2022_PROGRAM,
    TOKEN_PROGRAM,
    input,
    output,
    event,
  ];
  const instruction = [
    187,
    100,
    250,
    204,
    49,
    196,
    175,
    20,
    ...u64(10000000n),
    ...u64(2000001n),
    50,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    3,
    16,
    39,
    0,
    1,
  ];
  const raw = Uint8Array.from([
    1,
    ...new Uint8Array(64),
    128,
    1,
    0,
    6,
    keys.length,
    ...keys.flatMap(keyBytes),
    ...keyBytes(blockhash),
    1,
    1,
    10,
    0,
    7,
    8,
    4,
    5,
    2,
    3,
    1,
    6,
    1,
    instruction.length,
    ...instruction,
    1,
    ...keyBytes(tableKey),
    2,
    0,
    1,
    0,
  ]);
  const table = new Uint8Array(120);
  const tableView = new DataView(table.buffer);
  tableView.setUint32(0, 1, true);
  tableView.setBigUint64(4, (1n << 64n) - 1n, true);
  tableView.setBigUint64(12, 90n, true);
  table.set(keyBytes(source), 56);
  table.set(keyBytes(options.redirect ? ata(output, key(9)) : destination), 88);
  let broadcasts = 0;
  let receipt: RouteReceipt | null = null;
  let signatureMissing = false;
  const rpcFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const uri = new URL(String(url));
    if (uri.hostname === "jupiter.invalid") {
      if (uri.pathname.endsWith("/swap")) {
        expect(JSON.parse(String(init?.body)).asLegacyTransaction).toBe(false);
        return Response.json({
          swapTransaction: solanaBase64(raw),
          lastValidBlockHeight: 1000,
        });
      }
      expect(uri.searchParams.get("asLegacyTransaction")).toBe("false");
      expect(uri.searchParams.get("instructionVersion")).toBe("V2");
      const requestedAmount = uri.searchParams.get("amount");
      if (requestedAmount === null) throw new Error("Missing requested amount");
      const amount = BigInt(requestedAmount);
      const out =
        uri.searchParams.get("inputMint") === input ? 2000001n : 100000n;
      const bps = Number(uri.searchParams.get("slippageBps"));
      return Response.json({
        inputMint: uri.searchParams.get("inputMint"),
        outputMint: output,
        inAmount: String(amount),
        outAmount: String(out),
        otherAmountThreshold: String(
          (out * BigInt(10000 - bps) + 9999n) / 10000n,
        ),
        swapMode: "ExactIn",
        slippageBps: bps,
        priceImpactPct: "0",
        platformFee: null,
        routePlan: [],
      });
    }
    const { method, params } = JSON.parse(String(init?.body));
    let result: unknown;
    switch (method) {
      case "getAccountInfo":
        result = {
          context: { slot: 100 },
          value:
            params[0] === tableKey
              ? account(
                  options.wrongTable ? TOKEN_PROGRAM : LOOKUP_TABLE_PROGRAM,
                  table,
                )
              : states.get(params[0]),
        };
        break;
      case "getMultipleAccounts":
        result = {
          context: { slot: 100 },
          value: params[0].map((address: string) => {
            if (!states.has(address))
              throw new Error(`Missing account fixture ${address}`);
            return states.get(address);
          }),
        };
        break;
      case "simulateTransaction":
        result = {
          context: { slot: 101 },
          value: {
            err: null,
            accounts:
              params[1].accounts.addresses.length === 2
                ? [
                    token(
                      input,
                      TOKEN_2022_PROGRAM,
                      options.badDebit ? 9999999n : 10000000n,
                    ),
                    token(output, TOKEN_PROGRAM, 2000000n),
                  ]
                : [{ lamports: 999995000 }],
          },
        };
        break;
      case "getFeeForMessage":
        result = { context: { slot: 100 }, value: 5000 };
        break;
      case "getBalance":
        result = { value: 1000000000 };
        break;
      case "getBlockHeight":
        result = 1001;
        break;
      case "getBlocks":
        result = [100];
        break;
      case "getBlock":
        result = { blockhash };
        break;
      case "getSignatureStatuses":
        result = {
          value: [
            signatureMissing
              ? null
              : { err: null, confirmationStatus: "finalized" },
          ],
        };
        break;
      case "getTransaction":
        expect(params[1].encoding).toBe("base64");
        result = receipt;
        break;
      case "sendTransaction":
        broadcasts++;
        throw new Error("prepare must never broadcast");
      default:
        throw new Error(`Unexpected RPC ${method}`);
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof fetch;
  const now = () => new Date("2026-10-27T00:00:00.000Z"),
    run = "versioned-route-run";
  const store = new D1ConversionStore(db);
  await store.acquireLock("solana", run, now());
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
  const nativeBudget = config.networks[0].nativeBudget;
  if (!nativeBudget) throw new Error("Missing native budget");
  const journal = new NativeGasJournal(
    db,
    "solana",
    wallet,
    run,
    nativeBudget,
    now,
  );
  const restart = () =>
    createSolanaClient({
      config: config.networks[0],
      limits: config.limits,
      jupiterApiUrl: "https://jupiter.invalid",
      jupiterApiKey: null,
      keypair: JSON.stringify([...seed, ...publicKey]),
      nativeGas: journal,
      fetch: rpcFetch,
    });
  return {
    sqlite,
    client: restart(),
    restart,
    journal,
    store,
    input,
    output,
    wallet,
    publicKey,
    now,
    run,
    broadcasts: () => broadcasts,
    loseSignatureHistory: () => {
      signatureMissing = true;
    },
    setReceipt: (value: RouteReceipt | null) => {
      receipt = value;
    },
  };
}

test("a v0 Token-2022 swap signs only after account review and retains the review with its native liability", async () => {
  const f = await fixture();
  try {
    const quote = await f.client.quote(f.input, 10000000n);
    if ("noRoute" in quote) throw new Error(quote.noRoute);
    const sent = await f.client.prepare(f.input, quote);
    const raw = solanaBase64Bytes(sent.rawTx),
      parsed = parseTransaction(raw);
    expect(parsed.legacy).toBe(false);
    expect(
      ed25519.verify(
        raw.slice(1, 65),
        raw.slice(parsed.messageOffset),
        f.publicKey,
      ),
    ).toBe(true);
    expect(f.broadcasts()).toBe(0);
    const rows = await f.journal.rows();
    expect(rows).toHaveLength(1);
    const encodedProof = rows[0].solana_account_proof;
    if (!encodedProof) throw new Error("Missing retained proof");
    const proof = JSON.parse(encodedProof);
    expect(proof.route.expectation.amountIn).toBe("10000000");
    expect(proof.route.accounts.length).toBeGreaterThanOrEqual(
      proof.keys.length,
    );
    const row = {
      id: "versioned-conversion",
      kind: "conversion",
      runId: f.run,
      network: "solana",
      mode: "live",
      feeWallet: f.wallet,
      token: f.input,
      targetToken: f.output,
      amountIn: "10000000",
      route: "jupiter",
      quoteAmountOut: "2000001",
      minAmountOut: sent.minAmountOut.toString(),
      quoteValueMicro: 2000000,
      priceImpactBps: 0,
      quote: "{}",
      approvalTxId: null,
      txId: sent.txId,
      rawTx: sent.rawTx,
      evmNonce: null,
      expiresAt: sent.expiresAt,
      amountOut: null,
      tokenBalanceBefore: "20000000",
      targetBalanceBefore: "0",
      targetBalanceAfter: null,
      state: "submitted",
      reason: null,
      createdAt: f.now().toISOString(),
      updatedAt: f.now().toISOString(),
      submittedAt: f.now().toISOString(),
      finalizedAt: null,
      nativeGasId: sent.nativeGasId,
    } as ConversionRow;
    await expect(
      f.store.insert(
        { ...row, amountIn: "9999999" },
        { runId: f.run, now: f.now() },
      ),
    ).rejects.toThrow("recorded swap");
    await f.store.insert(row, { runId: f.run, now: f.now() });
    expect((await f.journal.rows())[0].state).toBe("signed");
    // A restarted client reads the immutable D1 proof, not a prepared in-memory route.
    const balance = (
      accountIndex: number,
      mint: string,
      programId: string,
      amount: string,
    ) => ({
      accountIndex,
      owner: f.wallet,
      mint,
      programId,
      uiTokenAmount: { amount },
    });
    const receipt: RouteReceipt = {
      slot: 110,
      transaction: [sent.rawTx, "base64"],
      meta: {
        err: null,
        loadedAddresses: {
          writable: proof.loadedWritable,
          readonly: proof.loadedReadonly,
        },
        preTokenBalances: [
          balance(7, f.input, TOKEN_2022_PROGRAM, "20000000"),
          balance(8, f.output, TOKEN_PROGRAM, "0"),
        ],
        postTokenBalances: [
          balance(7, f.input, TOKEN_2022_PROGRAM, "10000000"),
          balance(8, f.output, TOKEN_PROGRAM, "2000000"),
        ],
      },
    };
    const restarted = f.restart();
    f.setReceipt(receipt);
    expect(await restarted.status(row)).toEqual({
      kind: "finalized",
      amountOut: 2000000n,
    });
    for (const corrupt of [
      (r: RouteReceipt) => {
        r.transaction[0] = r.transaction[0].slice(0, -4);
      },
      (r: RouteReceipt) => {
        r.meta.loadedAddresses = { writable: [], readonly: [] };
      },
      (r: RouteReceipt) => {
        r.meta.postTokenBalances[0].uiTokenAmount.amount = "9999999";
      },
      (r: RouteReceipt) => {
        r.meta.postTokenBalances[1].uiTokenAmount.amount = "1";
      },
      (r: RouteReceipt) => {
        r.meta.postTokenBalances[0].programId = TOKEN_PROGRAM;
      },
      (r: RouteReceipt) => {
        r.meta.postTokenBalances.push(r.meta.postTokenBalances[0]);
      },
    ]) {
      const invalid = structuredClone(receipt);
      corrupt(invalid);
      f.setReceipt(invalid);
      await expect(restarted.status(row)).rejects.toThrow();
    }
    f.setReceipt(null);
    expect(await restarted.status(row)).toEqual({ kind: "pending" });
    f.loseSignatureHistory();
    expect(await restarted.status(row)).toEqual({ kind: "pending" });
  } finally {
    f.sqlite.close();
  }
});

test("a substituted lookup or extra token debit refuses before reserving or signing", async () => {
  for (const options of [
    { wrongTable: true },
    { redirect: true },
    { badDebit: true },
  ]) {
    const f = await fixture(options);
    try {
      const quote = await f.client.quote(f.input, 10000000n);
      if ("noRoute" in quote) throw new Error(quote.noRoute);
      await expect(f.client.prepare(f.input, quote)).rejects.toThrow();
      expect(await f.journal.rows()).toEqual([]);
      expect(f.broadcasts()).toBe(0);
    } finally {
      f.sqlite.close();
    }
  }
});
