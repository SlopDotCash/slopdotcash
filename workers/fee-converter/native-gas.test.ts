import { expect, test } from "bun:test";
import {
  type Hex,
  keccak256,
  parseTransaction,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseConfig } from "./config";
import type { ConversionRow } from "./core";
import { createEvmClient } from "./evm";
import { runOnce } from "./index";
import { NativeGasJournal, type NativeGasLimits } from "./native-gas";
import { sqliteD1 } from "./sqlite-d1";
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

test("missing native limits refuse before the Worker reads its key", async () => {
  const { db } = sqliteD1();
  let reads = 0;
  await expect(
    runOnce({
      ...envLimits,
      FEE_DB: db,
      FEE_CONVERTER_MODE: "live",
      FEE_CONVERTER_NETWORKS: "ethereum",
      FEE_WALLET_ETHEREUM: token,
      get FEE_WALLET_KEY_ETHEREUM(): string {
        reads++;
        throw new Error("key must not be read");
      },
    }),
  ).rejects.toThrow("Native gas limits");
  expect(reads).toBe(0);
});

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

test.each(["consumed", "open", "landed-late"])(
  "a nonce another transaction consumed in a finalized block releases its unlanded liability: %s",
  async (chain) => {
    const h = await fixture({
      perTransaction: "3000000",
      perDay: "3000000",
      additionalFeeReserve: "0",
    });
    const sent = await h.commit();
    let receipts = 0;
    const rpcFetch = (async (_url: unknown, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body));
      let result: unknown;
      if (q.method === "eth_getTransactionReceipt")
        // The late case lands before the finalized read: only the re-check sees it.
        result =
          chain === "landed-late" && receipts++ > 0
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
      else if (
        q.method === "eth_getBlockByNumber" &&
        q.params[0] === "finalized"
      )
        result = { number: "0x10", hash: hash(16), transactions: [] };
      else if (
        q.method === "eth_getTransactionCount" &&
        q.params[0] === h.wallet &&
        q.params[1] === "0x10"
      )
        result = chain === "open" ? "0x0" : "0x1";
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
    await client.reconcileNativeGas!();
    const [attempt] = await h.journal.rows();
    expect(attempt.tx_id).toBe(sent.txId);
    if (chain === "consumed") {
      expect(attempt.actual_wei).toBe("0");
      expect(attempt.settled_day).toBe("2026-10-26");
      expect(attempt.receipt_block_hash).toBe(hash(16));
      await h.reserve(h.tx(1));
      // Settled evidence is permanent: a later run does not settle it again.
      await client.reconcileNativeGas!();
    } else {
      expect(attempt.actual_wei).toBeNull();
      await expect(h.reserve(h.tx(1))).rejects.toThrow("Native daily budget");
    }
  },
);

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
      await client.reconcileNativeGas!();
      const attempts = await h.journal.rows();
      expect(attempts[0].maximum_wei).toBe("2100000");
      expect(attempts[0].actual_wei).toBeNull();
      await expect(h.reserve(h.tx(1))).rejects.toThrow("Native daily budget");
    } else {
      await expect(client.reconcileNativeGas!()).rejects.toThrow();
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
      await expect(client.reconcileNativeGas!()).rejects.toThrow();
      expect((await h.journal.rows())[0].actual_wei).toBeNull();
    } else {
      await client.reconcileNativeGas!();
      expect((await h.journal.rows())[0].actual_wei).toBe(
        (tx.gas! * 2n + (base ? 400n : 0n)).toString(),
      );
    }
  },
);
