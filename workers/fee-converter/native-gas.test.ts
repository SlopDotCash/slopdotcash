import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  type Hex,
  keccak256,
  parseTransaction,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { solanaBase58 } from "../../contracts/solana/adapter";
import {
  concat,
  message as solanaMessage,
} from "../../contracts/solana/transactions";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { parseConfig } from "./config";
import type { ConversionRow } from "./core";
import { createEvmClient } from "./evm";
import { runOnce } from "./index";
import { NativeGasJournal, type NativeGasLimits } from "./native-gas";
import { parseTransaction as parseSolanaWire } from "./solana";
import { LOOKUP_TABLE_PROGRAM, resolveSolanaAccounts } from "./solana-accounts";
import { proveSolanaExpiry, type RecoveryRpc } from "./solana-expiry";
import { D1ConversionStore, LOCK_MS } from "./store";

const token = `0x${"2".repeat(40)}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const envLimits = {
  FEE_CONVERTER_MIN_VALUE_MICRO: "5000000",
  FEE_CONVERTER_GAS_MULTIPLE: "10",
  FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
  FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
  FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
  FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
};
async function fixture(
  limits: NativeGasLimits = {
    perTransaction: "5000000",
    perDay: "10000000",
    additionalFeeReserve: "0",
  },
  network: "ethereum" | "base" = "ethereum",
) {
  const { db, sqlite } = sqliteD1();
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const wallet = account.address.toLowerCase();
  const clock = { now: new Date("2026-10-26T23:59:00Z") };
  const now = () => clock.now;
  const store = new D1ConversionStore(db);
  const run = "native-run-original";
  await store.acquireLock(network, run, now());
  const journal = new NativeGasJournal(db, network, wallet, run, limits, now);
  const env = {
    ...envLimits,
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: network,
    [`FEE_WALLET_${network.toUpperCase()}`]: wallet,
    FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({ [network]: limits }),
  };
  const config = parseConfig(env);
  const tx = (nonce = 0, fee = 100n): TransactionSerializableEIP1559 => ({
    type: "eip1559",
    chainId: network === "base" ? 8453 : 1,
    to: token as Hex,
    data: "0x",
    value: 0n,
    nonce,
    gas: 21000n,
    maxFeePerGas: fee,
    maxPriorityFeePerGas: 1n,
  });
  const reserve = (input = tx(), j = journal, replaces?: string) =>
    j.reserve({
      nonce: input.nonce!,
      intentHash: keccak256(serializeTransaction(input)),
      maximumWei: (
        input.gas! * input.maxFeePerGas! +
        BigInt(limits.additionalFeeReserve)
      ).toString(),
      replaces,
    });
  const row = (id: string, raw: Hex, nativeGasId?: string): ConversionRow => ({
    id,
    kind: "conversion",
    runId: run,
    network,
    mode: "live",
    feeWallet: wallet,
    token,
    targetToken: config.networks[0].definition.usdc!,
    amountIn: "10000000",
    route: "kyberswap",
    quoteAmountOut: "10000000",
    minAmountOut: "9900000",
    quoteValueMicro: 10000000,
    priceImpactBps: 0,
    quote: "{}",
    approvalTxId: null,
    txId: keccak256(raw),
    rawTx: raw,
    evmNonce: parseTransaction(raw).nonce!,
    expiresAt: 1,
    amountOut: null,
    tokenBalanceBefore: "10000000",
    targetBalanceBefore: "0",
    targetBalanceAfter: null,
    state: "submitted",
    reason: null,
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    submittedAt: now().toISOString(),
    finalizedAt: null,
    nativeGasId,
  });
  const commit = async (input = tx(), id = "native-test-send") => {
    const reservation = await reserve(input);
    const raw = await account.signTransaction(input);
    const r = row(id, raw, reservation);
    await store.insert(r, { runId: run, now: now() });
    return r;
  };
  return {
    db,
    sqlite,
    key,
    account,
    wallet,
    clock,
    now,
    store,
    run,
    journal,
    config,
    env,
    tx,
    reserve,
    row,
    commit,
  };
}

test("exact-wei reservations serialize competing attempts and preserve liability across midnight", async () => {
  const h = await fixture({
    perTransaction: "9007199254740993",
    perDay: "9007199254740993",
    additionalFeeReserve: "0",
  });
  const request = (nonce: number) =>
    h.journal.reserve({
      nonce,
      intentHash: hash(nonce),
      maximumWei: "9007199254740993",
    });
  const result = await Promise.allSettled([request(0), request(1)]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await h.journal.rows()).filter((r) => r.state === "reserved"),
  ).toHaveLength(1);
  h.clock.now = new Date("2026-10-27T00:01:00Z");
  await expect(request(2)).rejects.toThrow("Native daily budget");
});

test("a successor retires only uncommitted reservations; stale signed commits roll back", async () => {
  const h = await fixture();
  const id = await h.reserve();
  const raw = await h.account.signTransaction(h.tx());
  h.clock.now = new Date(h.clock.now.getTime() + LOCK_MS + 1);
  expect(await h.store.acquireLock("ethereum", "successor", h.now())).toBe(
    true,
  );
  const successor = new NativeGasJournal(
    h.db,
    "ethereum",
    h.wallet,
    "successor",
    h.config.networks[0].nativeBudget!,
    h.now,
  );
  await successor.recoverUnsigned();
  await expect(
    h.store.insert(h.row("stale-signed-attempt", raw, id)),
  ).rejects.toThrow("reservation lost");
  expect(
    h.sqlite.query("SELECT count(*) n FROM fee_conversions").get(),
  ).toEqual({ n: 0 });
  expect((await h.journal.rows())[0].state).toBe("abandoned");
  const current = await h.reserve(h.tx(), successor);
  const row = {
    ...h.row("successor-signed-attempt", raw, current),
    runId: "successor",
  };
  await h.store.insert(row, { runId: "successor", now: h.now() });
  expect((await successor.rows()).find((r) => r.id === current)?.state).toBe(
    "signed",
  );
  await successor.recoverUnsigned();
  expect((await successor.rows()).find((r) => r.id === current)?.state).toBe(
    "signed",
  );
});

test("a wrong signature or duplicate reservation cannot create a durable send", async () => {
  const h = await fixture();
  const id = await h.reserve();
  const other = await h.account.signTransaction({ ...h.tx(), value: 1n });
  await expect(
    h.store.insert(h.row("different-intent", other, id)),
  ).rejects.toThrow("reserved intent");
  const raw = await h.account.signTransaction(h.tx());
  await h.store.insert(h.row("correct-intent", raw, id));
  await expect(
    h.store.insert(h.row("duplicate-intent", raw, id)),
  ).rejects.toThrow();
  expect(
    h.sqlite.query("SELECT count(*) n FROM fee_conversions").get(),
  ).toEqual({ n: 1 });
});

test("same-nonce replacements reserve their maximum once and settle exactly one winner", async () => {
  const h = await fixture({
    perTransaction: "3000000",
    perDay: "3000000",
    additionalFeeReserve: "0",
  });
  const original = await h.commit();
  const replaced = h.tx(0, 125n);
  const id = await h.reserve(replaced, h.journal, original.txId!);
  const raw = await h.account.signTransaction(replaced);
  expect(
    await h.store.insertReplacement(
      {
        id: "replacement-one",
        conversionId: original.id,
        network: "ethereum",
        attempt: 1,
        evmNonce: 0,
        txId: keccak256(raw),
        rawTx: raw,
        maxFeePerGas: "125",
        maxPriorityFeePerGas: "1",
        createdAt: h.now().toISOString(),
        nativeGasId: id,
      },
      h.run,
      h.now(),
    ),
  ).toBe(true);
  await expect(h.reserve(h.tx(1))).rejects.toThrow("Native daily budget");
  h.clock.now = new Date("2026-10-27T00:01:00Z");
  await h.journal.settle(
    {
      txId: original.txId!,
      rawTx: original.rawTx,
      conversionId: original.id,
      feeWallet: h.wallet,
      nonce: 0,
    },
    { txId: original.txId!, actualWei: "900000", blockHash: hash(7) },
  );
  const rows = await h.journal.rows();
  expect(rows.map((r) => r.actual_wei).sort()).toEqual(["0", "900000"]);
  expect(rows.every((r) => r.settled_day === "2026-10-27")).toBe(true);
  await h.reserve(h.tx(1));
  expect(
    (await h.journal.rows()).filter((r) => r.state === "reserved"),
  ).toHaveLength(1);
});

test("unavailable receipts retain gas until the canonical cost is recovered", async () => {
  const h = await fixture({
    perTransaction: "3000000",
    perDay: "3000000",
    additionalFeeReserve: "0",
  });
  const sent = await h.commit();
  const signed = parseTransaction(sent.rawTx as Hex);
  let receiptAvailable = false;
  const rpcFetch = (async (_url: unknown, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body));
    let result: unknown;
    if (q.method === "eth_getTransactionReceipt")
      result = receiptAvailable
        ? {
            transactionHash: sent.txId,
            blockHash: hash(16),
            blockNumber: "0x10",
            transactionIndex: "0x0",
            from: h.wallet,
            to: token,
            status: "0x1",
            gasUsed: "0x5208",
            effectiveGasPrice: "0x64",
            cumulativeGasUsed: "0x5208",
            logs: [],
            logsBloom: `0x${"0".repeat(512)}`,
            type: "0x2",
          }
        : null;
    else if (q.method === "eth_getBlockByNumber")
      // The journaled send itself consumed the finalized nonce. Receipt
      // availability can lag block/count reads; null does not prove a loser.
      result = {
        number: "0x10",
        hash: hash(16),
        transactions: [sent.txId],
      };
    else if (q.method === "eth_getTransactionCount") result = "0x1";
    else if (q.method === "eth_getTransactionByHash")
      result = {
        hash: sent.txId,
        from: h.wallet,
        to: token,
        nonce: "0x0",
        input: "0x",
        value: "0x0",
        gas: "0x5208",
        chainId: "0x1",
        maxFeePerGas: "0x64",
        maxPriorityFeePerGas: "0x1",
        type: "0x2",
        blockHash: hash(16),
        blockNumber: "0x10",
        transactionIndex: "0x0",
        accessList: [],
        r: signed.r,
        s: signed.s,
        v: `0x${signed.yParity?.toString(16)}`,
        yParity: `0x${signed.yParity?.toString(16)}`,
      };
    else throw new Error(`Unapproved test request ${q.method}`);
    return Response.json({ jsonrpc: "2.0", id: q.id, result });
  }) as typeof fetch;
  const client = createEvmClient({
    config: h.config.networks[0],
    limits: h.config.limits,
    kyberClientId: "test",
    nativeGas: h.journal,
    fetch: rpcFetch,
    now: h.now,
  });
  await client.reconcileNativeGas?.();
  expect((await h.journal.rows())[0].actual_wei).toBeNull();
  await expect(h.reserve(h.tx(1))).rejects.toThrow("Native daily budget");

  receiptAvailable = true;
  await client.reconcileNativeGas?.();
  const [settled] = await h.journal.rows();
  expect(settled.actual_wei).toBe("2100000");
  expect(settled.receipt_block_hash).toBe(hash(16));
  expect(settled.settled_day).toBe("2026-10-26");
  // Only 900,000 wei remain: 840,000 fits, another 63,000 does not.
  await h.reserve(h.tx(1, 40n));
  await expect(h.reserve(h.tx(2, 3n))).rejects.toThrow("Native daily budget");
  await client.reconcileNativeGas?.();
  expect((await h.journal.rows())[0]).toEqual(settled);
});

test("business failure and router expiry do not release signed gas; overruns hold future signing", async () => {
  const h = await fixture({
    perTransaction: "3000000",
    perDay: "3000000",
    additionalFeeReserve: "0",
  });
  const row = await h.commit();
  await h.store.update(row.id, {
    state: "failed",
    reason: "router deadline passed before inclusion",
  });
  expect(await h.journal.unsettled()).toHaveLength(1);
  await expect(h.reserve(h.tx(1))).rejects.toThrow("Native daily budget");
  await h.journal.settle(
    {
      txId: row.txId!,
      rawTx: row.rawTx,
      conversionId: row.id,
      feeWallet: h.wallet,
      nonce: 0,
    },
    { txId: row.txId!, actualWei: "2100001", blockHash: hash(7) },
  );
  h.clock.now = new Date("2026-10-28T00:00:00Z");
  await h.store.renewLock("ethereum", h.run, h.now());
  await expect(h.reserve(h.tx(1))).rejects.toThrow(
    "exceeded its reserved maximum",
  );
});

test("a later run signs at the nonce of a swap dropped after its router deadline and keeps its gas", async () => {
  const h = await fixture();
  // The swap at nonce 0 never reached a block. The fee wallet ran out of gas
  // or the node dropped it, and its 20-minute router deadline has passed.
  const expired = await h.commit();
  // While that send is open, its nonce stays held.
  await expect(h.reserve(h.tx(0, 200n))).rejects.toThrow("already reserved");
  await h.store.releaseLock("ethereum", h.run, h.now());
  const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
  const sent: string[] = [];
  const rpcFetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).startsWith("https://aggregator-api.kyberswap.com/")) {
      const u = new URL(String(url));
      const native = u.searchParams.get("tokenIn")?.startsWith("0xeeee");
      return Response.json({
        code: 0,
        data: {
          routerAddress: h.config.networks[0].definition.router,
          routeSummary: {
            tokenIn: u.searchParams.get("tokenIn"),
            tokenOut: h.config.networks[0].definition.usdc,
            amountIn: u.searchParams.get("amountIn"),
            amountOut: native ? "1000" : "10000000",
            amountInUsd: "10",
            amountOutUsd: "10",
            gasUsd: "0",
            route: [],
          },
        },
      });
    }
    const q = JSON.parse(String(init?.body));
    let result: unknown;
    // The node knows neither the swap nor a receipt; nonce 0 is still unused.
    if (
      q.method === "eth_getTransactionReceipt" ||
      q.method === "eth_getTransactionByHash"
    )
      result = null;
    else if (q.method === "eth_getTransactionCount") result = "0x0";
    else if (q.method === "eth_call")
      result = q.params[0].data.startsWith("0x70a08231")
        ? word(q.params[0].to === token ? 10_000_000n : 0n)
        : word(0n); // allowance
    else if (q.method === "eth_estimateGas") result = "0x5208";
    else if (q.method === "eth_getBlockByNumber")
      result = {
        number: "0x10",
        hash: hash(1),
        baseFeePerGas: "0x64",
        timestamp: "0x1",
        transactions: [],
      };
    else if (q.method === "eth_maxPriorityFeePerGas") result = "0x1";
    else if (q.method === "eth_sendRawTransaction") {
      sent.push(q.params[0]);
      result = keccak256(q.params[0]);
    } else throw new Error(`Unapproved test request ${q.method}`);
    return Response.json({ jsonrpc: "2.0", id: q.id, result });
  }) as typeof fetch;
  await runOnce(
    {
      ...h.env,
      FEE_DB: h.db,
      FEE_WALLET_KEY_ETHEREUM: h.key,
      FEE_CONVERTER_ALLOWLIST: JSON.stringify({ ethereum: [token] }),
    },
    h.now,
    { fetch: rpcFetch },
  );
  // The expired swap closes as failed, and the same run signs the next send
  // for the token at the nonce that is still free.
  expect(
    h.sqlite
      .query(
        "SELECT kind, state, reason, evm_nonce FROM fee_conversions ORDER BY rowid",
      )
      .all(),
  ).toEqual([
    {
      kind: "conversion",
      state: "failed",
      reason: "router deadline passed before inclusion",
      evm_nonce: 0,
    },
    { kind: "approval", state: "submitted", reason: null, evm_nonce: 0 },
  ]);
  expect(sent).toHaveLength(1);
  expect(parseTransaction(sent[0] as Hex).nonce).toBe(0);
  // The expired swap keeps its signed gas until a receipt settles nonce 0.
  const attempts = await h.journal.rows();
  expect(
    attempts.map((r) => [r.tx_id, r.nonce, r.state, r.actual_wei]),
  ).toEqual([
    [expired.txId, 0, "signed", null],
    [keccak256(sent[0] as Hex), 0, "signed", null],
  ]);
});

test("legacy approval and swap hashes both enter accounting with independently proved nonces", async () => {
  const h = await fixture();
  const raw = await h.account.signTransaction(h.tx(1));
  await h.store.insert({
    ...h.row("legacy-approval-and-swap", raw),
    approvalTxId: hash(19),
  });
  const sends = await h.journal.unaccounted();
  expect(sends).toHaveLength(2);
  expect(sends.find((s) => s.txId === hash(19))?.nonce).toBeNull();
  expect(sends.find((s) => s.txId === keccak256(raw))?.nonce).toBe(1);
});

test.each(["complete", "changed-fee", "missing-signature"])(
  "legacy hash-only liability requires the original signed transaction: %s",
  async (evidence) => {
    const h = await fixture({
      perTransaction: "3000000",
      perDay: "3000000",
      additionalFeeReserve: "0",
    });
    const tx = h.tx();
    const raw = await h.account.signTransaction(tx);
    const signed = parseTransaction(raw);
    const row = h.row("legacy-hash-only", raw);
    await h.store.insert({
      ...row,
      txId: null,
      approvalTxId: row.txId,
      rawTx: null,
      evmNonce: null,
      state: "pending",
      reason: "legacy approval pending",
    });
    const rpcFetch = (async (_url: unknown, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body));
      let result: unknown;
      if (q.method === "eth_getTransactionByHash")
        result = {
          hash: row.txId,
          from: h.wallet,
          to: token,
          nonce: "0x0",
          input: "0x",
          value: "0x0",
          gas: "0x5208",
          chainId: "0x1",
          maxFeePerGas: evidence === "changed-fee" ? "0x1" : "0x64",
          maxPriorityFeePerGas: "0x1",
          type: "0x2",
          blockHash: null,
          blockNumber: null,
          transactionIndex: null,
          accessList: [],
          ...(evidence === "missing-signature"
            ? {}
            : {
                r: signed.r,
                s: signed.s,
                v: `0x${signed.yParity?.toString(16)}`,
                yParity: `0x${signed.yParity?.toString(16)}`,
              }),
        };
      else if (q.method === "eth_getTransactionReceipt") result = null;
      // The finalized nonce is still open, so the unlanded send stays a liability.
      else if (
        q.method === "eth_getBlockByNumber" &&
        q.params[0] === "finalized"
      )
        result = { number: "0x10", hash: hash(16), transactions: [] };
      else if (q.method === "eth_getTransactionCount") result = "0x0";
      else throw new Error(`Unapproved test request ${q.method}`);
      return Response.json({ jsonrpc: "2.0", id: q.id, result });
    }) as typeof fetch;
    const client = createEvmClient({
      config: h.config.networks[0],
      limits: h.config.limits,
      kyberClientId: "test",
      nativeGas: h.journal,
      fetch: rpcFetch,
    });
    if (evidence === "complete") {
      await client.reconcileNativeGas?.();
      const attempts = await h.journal.rows();
      expect(attempts[0].maximum_wei).toBe("2100000");
      expect(attempts[0].actual_wei).toBeNull();
      await expect(h.reserve(h.tx(1))).rejects.toThrow("Native daily budget");
    } else {
      await expect(client.reconcileNativeGas?.()).rejects.toThrow();
      expect(await h.journal.rows()).toHaveLength(0);
      expect(await h.journal.unaccounted()).toHaveLength(1);
    }
  },
);

test.each(["allowed", "transaction", "day", "value", "base-allowance"])(
  "actual signer preparation enforces final fee bounds: %s",
  async (fault) => {
    const base = fault === "base-allowance";
    const h = await fixture(
      {
        perTransaction: fault === "transaction" ? "1000" : "5000000",
        perDay: "5000000",
        additionalFeeReserve: base ? "100" : "0",
      },
      base ? "base" : "ethereum",
    );
    if (fault === "day") await h.commit(h.tx(1));
    const rpcFetch = (async (url: unknown, init?: RequestInit) => {
      if (String(url).startsWith("https://aggregator-api.kyberswap.com/")) {
        const u = new URL(String(url));
        const amount = u.searchParams.get("amountIn");
        return Response.json({
          code: 0,
          data: {
            routerAddress: h.config.networks[0].definition.router,
            routeSummary: {
              tokenIn: u.searchParams.get("tokenIn"),
              tokenOut: h.config.networks[0].definition.usdc,
              amountIn: amount,
              amountOut: fault === "value" ? "2000000" : "1000",
              amountInUsd: "1",
              amountOutUsd: "1",
              gasUsd: "0",
              l1FeeUsd: "0",
              route: [],
            },
          },
        });
      }
      const q = JSON.parse(String(init?.body));
      let result: unknown;
      if (q.method === "eth_call")
        result = q.params[0].data.startsWith("0xf1c7a58b")
          ? hash(101)
          : hash(0);
      else if (q.method === "eth_getTransactionCount") result = "0x0";
      else if (q.method === "eth_estimateGas") result = "0x5208";
      else if (q.method === "eth_getBlockByNumber")
        result = {
          number: "0x10",
          hash: hash(1),
          baseFeePerGas: "0x64",
          timestamp: "0x1",
          transactions: [],
        };
      else if (q.method === "eth_maxPriorityFeePerGas") result = "0x1";
      else if (q.method === "eth_blockNumber") result = "0x10";
      else throw new Error(`Unapproved test request ${q.method}`);
      return Response.json({ jsonrpc: "2.0", id: q.id, result });
    }) as typeof fetch;
    const client = createEvmClient({
      config: h.config.networks[0],
      limits: h.config.limits,
      kyberClientId: "test",
      privateKey: h.key,
      nativeGas: h.journal,
      fetch: rpcFetch,
      now: h.now,
    });
    const prepared = client.prepare(token, {
      route: "kyberswap",
      amountIn: 10000000n,
      amountOut: 10000000n,
      minAmountOut: 9900000n,
      priceImpactBps: 0,
      gasCostMicro: 0n,
      summary: {},
    });
    if (fault === "allowed") {
      const send = await prepared;
      expect((await h.journal.rows())[0].state).toBe("reserved");
      await h.store.insert({
        ...h.row(
          "actual-adapter-approval",
          send.rawTx as Hex,
          send.nativeGasId,
        ),
        kind: "approval",
        minAmountOut: null,
        approvalTxId: send.txId,
      });
      expect((await h.journal.rows())[0].state).toBe("signed");
    } else {
      const reason =
        fault === "transaction"
          ? "transaction budget"
          : fault === "day"
            ? "daily budget"
            : fault === "value"
              ? "gas-cost multiple"
              : "configured allowance";
      await expect(prepared).rejects.toThrow(reason);
      expect(
        (await h.journal.rows()).filter((r) => r.state === "reserved"),
      ).toHaveLength(0);
    }
  },
);

test.each([
  "success",
  "reverted",
  "not-canonical",
  "missing-transaction",
  "base-complete",
  "base-missing-data",
  "base-missing-operator",
])(
  "actual adapter reconciles native cost only with canonical complete evidence: %s",
  async (outcome) => {
    const base = outcome.startsWith("base-");
    const h = base
      ? await fixture(
          {
            perTransaction: "5000000",
            perDay: "10000000",
            additionalFeeReserve: "500",
          },
          "base",
        )
      : await fixture();
    const row = await h.commit();
    const tx = h.tx();
    const blockHash = hash(100);
    const height = "0x10";
    const rpcFetch = (async (_url: unknown, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body));
      let result: unknown;
      if (q.method === "eth_getTransactionReceipt")
        result = {
          transactionHash: row.txId,
          transactionIndex: "0x0",
          blockHash,
          blockNumber: height,
          from: h.wallet,
          to: token,
          gasUsed: "0x5208",
          cumulativeGasUsed: "0x5208",
          effectiveGasPrice: "0x2",
          contractAddress: null,
          logs: [],
          logsBloom: `0x${"00".repeat(256)}`,
          status: outcome === "reverted" ? "0x0" : "0x1",
          type: "0x2",
          ...(base && outcome !== "base-missing-data" ? { l1Fee: "0x64" } : {}),
        };
      else if (q.method === "eth_getBlockByNumber")
        result = {
          number: height,
          hash: blockHash,
          timestamp: "0x1",
          transactions: outcome === "not-canonical" ? [] : [row.txId],
        };
      else if (q.method === "eth_getTransactionByHash")
        result =
          outcome === "missing-transaction"
            ? null
            : {
                hash: row.txId,
                from: h.wallet,
                to: token,
                nonce: "0x0",
                input: "0x",
                value: "0x0",
                gas: "0x5208",
                chainId: `0x${tx.chainId.toString(16)}`,
                maxFeePerGas: "0x64",
                maxPriorityFeePerGas: "0x1",
                type: "0x2",
                blockHash,
                blockNumber: height,
                transactionIndex: "0x0",
                accessList: [],
                r: hash(1),
                s: hash(2),
                v: "0x0",
                yParity: "0x0",
              };
      else if (q.method === "eth_call")
        result = outcome === "base-missing-operator" ? "0x" : hash(300);
      else throw new Error(`Unapproved test request ${q.method}`);
      return Response.json({ jsonrpc: "2.0", id: q.id, result });
    }) as typeof fetch;
    const client = createEvmClient({
      config: h.config.networks[0],
      limits: h.config.limits,
      kyberClientId: "test",
      nativeGas: h.journal,
      fetch: rpcFetch,
    });
    if (
      outcome === "not-canonical" ||
      outcome === "missing-transaction" ||
      outcome === "base-missing-data" ||
      outcome === "base-missing-operator"
    ) {
      await expect(client.reconcileNativeGas?.()).rejects.toThrow();
      expect((await h.journal.rows())[0].actual_wei).toBeNull();
    } else {
      await client.reconcileNativeGas?.();
      expect((await h.journal.rows())[0].actual_wei).toBe(
        (tx.gas! * 2n + (base ? 400n : 0n)).toString(),
      );
    }
  },
);

test("Solana signed costs share the atomic journal while unknown sends retain their whole ceiling", async () => {
  const f = await fixture();
  const seed = new Uint8Array(32).fill(7);
  const wallet = solanaBase58(ed25519.getPublicKey(seed));
  await f.store.acquireLock("solana", f.run, f.now());
  const journal = new NativeGasJournal(
    f.db,
    "solana",
    wallet,
    f.run,
    {
      perTransaction: "5000000",
      perDay: "10000000",
      additionalFeeReserve: "0",
    },
    f.now,
  );
  const dummy = await f.account.signTransaction(f.tx());
  const commit = async (n: number) => {
    const body = solanaMessage(
      wallet,
      solanaBase58(new Uint8Array(32).fill(n)),
      [],
    );
    const id = await journal.reserveSolana(solanaBase58(sha256(body)), 100);
    const signature = ed25519.sign(body, seed);
    const raw = concat(Uint8Array.of(1), signature, body);
    const row = {
      ...f.row(`sol-native-${n}`, dummy, id),
      network: "solana" as const,
      feeWallet: wallet,
      token: wallet,
      targetToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      route: "jupiter" as const,
      rawTx: btoa(String.fromCharCode(...raw)),
      txId: solanaBase58(signature),
      evmNonce: null,
    };
    await f.store.insert(row, { runId: f.run, now: f.now() });
    await f.store.update(row.id, {
      state: "failed",
      reason: "business failure keeps native liability",
      updatedAt: f.now().toISOString(),
    });
    return row;
  };
  const first = await commit(1);
  const second = await commit(2);
  await expect(commit(3)).rejects.toThrow("daily budget");
  const sends = await journal.unsettled();
  expect(sends).toHaveLength(2);
  await journal.settle(sends.find((s) => s.txId === first.txId)!, {
    txId: first.txId!,
    actualWei: "1500000",
    blockHash: "block-1",
  });
  await expect(commit(3)).rejects.toThrow("daily budget");
  await journal.settle(sends.find((s) => s.txId === second.txId)!, {
    txId: second.txId!,
    actualWei: "1500000",
    blockHash: "block-2",
  });
  await commit(3);
  f.clock.now = new Date("2026-10-27T00:01:00Z");
  await commit(4);
  await expect(commit(5)).rejects.toThrow("daily budget");
  const rows = await journal.rows();
  expect(rows.map((r) => r.nonce)).toEqual([0, 1, 2, 3]);
  expect(rows.filter((r) => r.actual_wei === null)).toHaveLength(2);
  const corrupt = { ...second, id: "changed-intent", txId: first.txId };
  await expect(
    f.store.insert(corrupt, { runId: f.run, now: f.now() }),
  ).rejects.toThrow("reserved Solana intent");
});

test("Solana migration preserves existing EVM liabilities and immutable receipt evidence", () => {
  const { sqlite } = sqliteD1([]);
  const dir = new URL("../../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files.filter((f) => f < "0094_"))
    sqlite.exec(readFileSync(new URL(f, dir), "utf8"));
  sqlite.exec(`INSERT INTO fee_converter_locks(network,run_id,expires_at) VALUES('base','migration-held','2099-01-01');
    INSERT INTO fee_native_gas(id,network,fee_wallet,nonce,intent_hash,run_id,maximum_wei,per_transaction_wei,per_day_wei,state,tx_id,conversion_id,created_at,actual_wei,settled_day,receipt_block_hash)
    VALUES('prior-finalized','base','0x1111111111111111111111111111111111111111',0,'prior-intent','migration-held','100','100','200','signed','prior-hash','prior-conversion','2026-10-26','50','2026-10-26','prior-block'),
          ('prior-unknown','base','0x1111111111111111111111111111111111111111',1,'unknown-intent','migration-held','100','100','200','signed','unknown-hash','unknown-conversion','2026-10-26',NULL,NULL,NULL);`);
  const before = sqlite.query("SELECT * FROM fee_native_gas ORDER BY id").all();
  sqlite.exec(
    readFileSync(new URL("0094_fee_solana_native_gas.sql", dir), "utf8"),
  );
  expect(
    sqlite.query("SELECT * FROM fee_native_gas ORDER BY id").all(),
  ).toEqual(before);
  expect(() =>
    sqlite.exec(
      "UPDATE fee_native_gas SET maximum_wei='0' WHERE id='prior-unknown'",
    ),
  ).toThrow("immutable");
  expect(() =>
    sqlite.exec("DELETE FROM fee_native_gas WHERE id='prior-finalized'"),
  ).toThrow("permanent");
});

test("expiry evidence and zero-cost resolution commit atomically under the current Solana lease", async () => {
  const f = await fixture();
  const seed = new Uint8Array(32).fill(7);
  const wallet = solanaBase58(ed25519.getPublicKey(seed));
  await f.store.acquireLock("solana", f.run, f.now());
  const journal = new NativeGasJournal(
    f.db,
    "solana",
    wallet,
    f.run,
    { perTransaction: "5000000", perDay: "5000000", additionalFeeReserve: "0" },
    f.now,
  );
  const body = solanaMessage(
    wallet,
    solanaBase58(new Uint8Array(32).fill(1)),
    [],
  );
  const id = await journal.reserveSolana(solanaBase58(sha256(body)), 100);
  const sig = ed25519.sign(body, seed);
  const raw = concat(Uint8Array.of(1), sig, body);
  const dummy = await f.account.signTransaction(f.tx());
  const row = {
    ...f.row("expiry-signed-send", dummy, id),
    network: "solana" as const,
    feeWallet: wallet,
    token: wallet,
    targetToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    route: "jupiter" as const,
    rawTx: btoa(String.fromCharCode(...raw)),
    txId: solanaBase58(sig),
    evmNonce: null,
  };
  await f.store.insert(row, { runId: f.run, now: f.now() });
  const [send] = await journal.unsettled();
  const blockhash = solanaBase58(new Uint8Array(32).fill(1));
  const tipHash = solanaBase58(new Uint8Array(32).fill(2));
  const rpc: RecoveryRpc = async <T>(method: string, params: unknown[]) => {
    const values: Record<string, unknown> = {
      getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      getFirstAvailableBlock: 0,
      isBlockhashValid: { context: { slot: 300 }, value: false },
      getSignatureStatuses: { context: { slot: 301 }, value: [null] },
      getTransaction: null,
      getBlock:
        params[0] === 100
          ? {
              blockhash,
              previousBlockhash: "earlier",
              parentSlot: 99,
              signatures: [],
            }
          : {
              blockhash: tipHash,
              previousBlockhash: blockhash,
              parentSlot: 100,
              signatures: [],
            },
    };
    return values[method] as T;
  };
  const providers = [
    { operator: "alchemy", rpc },
    { operator: "allnodes-publicnode", rpc },
  ];
  const missingCoverage = await proveSolanaExpiry(
    send.txId,
    blockhash,
    100,
    providers,
  );
  if (!missingCoverage) throw new Error("Expected fixture proof");
  await expect(
    journal.resolveSolanaExpiry(send, missingCoverage),
  ).rejects.toThrow("positive retained");
  const proof = await proveSolanaExpiry(
    send.txId,
    blockhash,
    100,
    providers,
    journal.expiryCoverageStore(),
  );
  if (!proof) throw new Error("Expected retained coverage proof");
  const firstCoverage = proof.providers[0].coverage;
  if (!firstCoverage) throw new Error("Expected coverage");
  await expect(
    journal.expiryCoverageStore().save(null, firstCoverage, []),
  ).rejects.toThrow();
  for (const field of ["tipSlot", "tipHash", "blocks", "digest"] as const) {
    const previous = proof.providers[1].coverage;
    if (!previous) throw new Error("Expected second coverage");
    const changed = { ...previous, revision: previous.revision + 1 };
    if (field === "tipSlot" || field === "blocks") changed[field]++;
    else changed[field] = `different-${changed[field]}`;
    await journal.expiryCoverageStore().save(previous, changed, []);
    proof.providers[1].coverage = changed;
    await expect(journal.resolveSolanaExpiry(send, proof)).rejects.toThrow(
      "histories disagree",
    );
    expect(() =>
      f.sqlite
        .query(
          "INSERT INTO fee_solana_expiry_proofs(tx_id,fee_wallet,run_id,proof_json,proof_sha256,observed_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          send.txId,
          wallet,
          f.run,
          JSON.stringify(proof),
          "d".repeat(64),
          f.now().toISOString(),
        ),
    ).toThrow("block-history coverage");
    expect((await journal.rows())[0].actual_wei).toBeNull();
    expect(await journal.solanaExpiryResolved(send.txId)).toBe(false);
    await expect(
      journal.reserveSolana(`disagreement-${field}`, 101),
    ).rejects.toThrow("daily budget");
    const restored = { ...previous, revision: changed.revision + 1 };
    await journal.expiryCoverageStore().save(changed, restored, []);
    proof.providers[1].coverage = restored;
  }
  await expect(journal.reserveSolana("another-intent", 101)).rejects.toThrow(
    "daily budget",
  );
  await expect(
    journal.resolveSolanaExpiry(send, { ...proof, blockhashSlot: 99 }),
  ).rejects.toThrow("anchor differs");
  const wrongLease = new NativeGasJournal(
    f.db,
    "solana",
    wallet,
    "lost-lease",
    journal.limits,
    f.now,
  );
  await expect(wrongLease.resolveSolanaExpiry(send, proof)).rejects.toThrow(
    "lease",
  );
  expect(await journal.solanaExpiryResolved(send.txId)).toBe(false);
  expect((await journal.rows())[0].actual_wei).toBeNull();
  await journal.resolveSolanaExpiry(send, proof);
  expect((await journal.rows())[0].actual_wei).toBe("0");
  expect(await journal.solanaExpiryResolved(send.txId)).toBe(true);
  await journal.reserveSolana("after-proof", 101);
  expect(() => f.sqlite.exec("DELETE FROM fee_solana_expiry_proofs")).toThrow(
    "permanent",
  );
  expect(() =>
    f.sqlite.exec("UPDATE fee_solana_expiry_proofs SET proof_json='{}'"),
  ).toThrow("immutable");
  expect(() =>
    f.sqlite.exec("UPDATE fee_native_gas SET solana_blockhash_slot=99"),
  ).toThrow("immutable");
});

test("versioned signed sends retain immutable account evidence atomically with the native reservation", async () => {
  const f = await fixture();
  const seed = new Uint8Array(32).fill(8);
  const wallet = solanaBase58(ed25519.getPublicKey(seed));
  await f.store.acquireLock("solana", f.run, f.now());
  const journal = new NativeGasJournal(
    f.db,
    "solana",
    wallet,
    f.run,
    {
      perTransaction: "5000000",
      perDay: "20000000",
      additionalFeeReserve: "0",
    },
    f.now,
  );
  const legacy = solanaMessage(
    wallet,
    solanaBase58(new Uint8Array(32).fill(1)),
    [],
  );
  const tableKey = new Uint8Array(32).fill(50);
  const body = concat(
    Uint8Array.of(128),
    legacy,
    Uint8Array.of(1),
    tableKey,
    Uint8Array.of(1, 0, 0),
  );
  const signature = ed25519.sign(body, seed);
  const raw = concat(Uint8Array.of(1), signature, body);
  const parsed = parseSolanaWire(raw);
  const table = new Uint8Array(88);
  const view = new DataView(table.buffer);
  view.setUint32(0, 1, true);
  view.setBigUint64(4, (1n << 64n) - 1n, true);
  view.setBigUint64(12, 90n, true);
  table.set(new Uint8Array(32).fill(51), 56);
  const proof = await resolveSolanaAccounts(
    raw,
    parsed,
    async <T>() =>
      ({
        context: { slot: 100 },
        value: {
          owner: LOOKUP_TABLE_PROGRAM,
          executable: false,
          data: [Buffer.from(table).toString("base64"), "base64"],
        },
      }) as T,
  );
  const intent = solanaBase58(sha256(body));
  const dummy = await f.account.signTransaction(f.tx());
  const row = (id: string) => ({
    ...f.row(`versioned-${id}`, dummy, id),
    network: "solana" as const,
    feeWallet: wallet,
    token: wallet,
    targetToken: wallet,
    route: "jupiter" as const,
    rawTx: Buffer.from(raw).toString("base64"),
    txId: solanaBase58(signature),
    evmNonce: null,
  });
  const missing = await journal.reserveSolana(intent, 100);
  await expect(
    f.store.insert(row(missing), { runId: f.run, now: f.now() }),
  ).rejects.toThrow("retained account evidence");
  const changed = structuredClone(proof);
  changed.tables[0].writableIndexes = [1];
  const invalid = await journal.reserveSolana(intent, 100, changed);
  await expect(
    f.store.insert(row(invalid), { runId: f.run, now: f.now() }),
  ).rejects.toThrow("lookup evidence");
  expect((await journal.rows()).every((r) => r.state === "reserved")).toBe(
    true,
  );
  const id = await journal.reserveSolana(intent, 100, proof);
  await f.store.insert(row(id), { runId: f.run, now: f.now() });
  const retained = (await journal.rows()).find((r) => r.id === id)!;
  expect(retained.state).toBe("signed");
  expect(JSON.parse(retained.solana_account_proof!)).toEqual(proof);
  expect(() =>
    f.sqlite
      .query("UPDATE fee_native_gas SET solana_account_proof=NULL WHERE id=?")
      .run(id),
  ).toThrow("immutable");
  expect(() =>
    f.sqlite.query("DELETE FROM fee_native_gas WHERE id=?").run(id),
  ).toThrow("permanent");
  await expect(
    journal.reserveSolana("unrelated-intent", 100, proof),
  ).rejects.toThrow("reserved intent");
});
