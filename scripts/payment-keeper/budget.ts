import { type Hex, keccak256, serializeTransaction } from "viem";
import { PROJECT_SIZE, solanaBase58 } from "../../contracts/solana/adapter";
import type { Signer } from "../../workers/payment-executor/core";
import type { SolanaSigner } from "../../workers/payment-executor/solana";
import type { KeeperStore } from "./store";

export interface GasBudget {
  /** Native base units, selected by the operator. No default economic policy. */
  perTransaction: string;
  perDay: string;
  /** Base L1-data and operator-fee allowance, zero on other supported rails. */
  additionalFeeReserve: string;
}
export async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error || !Object.hasOwn(body, "result"))
    throw new Error(`RPC ${method} unavailable`);
  return body.result;
}
export function validateBudget(value: GasBudget) {
  for (const key of [
    "perTransaction",
    "perDay",
    "additionalFeeReserve",
  ] as const)
    if (!/^(0|[1-9][0-9]*)$/.test(value[key]))
      throw new Error(`Invalid gas budget ${key}`);
  if (
    BigInt(value.perTransaction) === 0n ||
    BigInt(value.perDay) < BigInt(value.perTransaction)
  )
    throw new Error(
      "Daily gas budget must cover one positive transaction budget",
    );
}
function reserve(
  store: KeeperStore,
  budget: GasBudget,
  id: string,
  maximum: bigint,
  transactionId: string,
  now = new Date(),
) {
  const day = now.toISOString().slice(0, 10);
  const rows = store.db
    .query<
      {
        day: string;
        settled_day: string | null;
        maximum: string;
        actual: string | null;
        expiry_evidence: string | null;
      },
      []
    >("SELECT day,settled_day,maximum,actual,expiry_evidence FROM gas")
    .all();
  let committed = 0n;
  for (const row of rows) {
    // Unknown sends keep their whole reserve across UTC day boundaries.
    if (row.actual === null) {
      // Finalized expiry cannot prove a zero fee. Charge the full reservation on
      // its observation day, then release only future-day liability.
      if (row.expiry_evidence === null || row.settled_day === day)
        committed += BigInt(row.maximum);
    } else if (row.settled_day === day) committed += BigInt(row.actual);
    if (row.actual !== null && BigInt(row.actual) > BigInt(row.maximum))
      throw new Error(
        "A native charge exceeded its reserve; review the operator budget before continuing",
      );
  }
  if (
    maximum > BigInt(budget.perTransaction) ||
    committed + maximum > BigInt(budget.perDay)
  )
    throw new Error(
      "Operator gas budget reached; signed unknown transactions remain reserved",
    );
  store.db
    .query("INSERT INTO gas(id,day,maximum,transaction_id) VALUES(?,?,?,?)")
    .run(id, day, maximum.toString(), transactionId);
}

/** Called inside the executor's durable signing transaction: budget and raw bytes commit together. */
export function budgetEvmSigner(
  store: KeeperStore,
  budget: GasBudget,
  signer: Signer,
  options: { now?: () => Date; baseRpc?: string } = {},
): Signer {
  validateBudget(budget);
  return {
    address: signer.address,
    async signTransaction(input) {
      if (options.baseRpc) {
        const size = (serializeTransaction(input).length - 2) / 2;
        const block = await rpc(options.baseRpc, "eth_blockNumber", []);
        if (typeof block !== "string" || !/^0x[0-9a-fA-F]+$/.test(block))
          throw new Error("Base quote block unavailable");
        const l1 = await baseOracleFee(
          options.baseRpc,
          "0xf1c7a58b",
          BigInt(size),
          block,
        );
        const operator = await baseOracleFee(
          options.baseRpc,
          "0x275aedd2",
          input.gas,
          block,
        );
        if (l1 + operator > BigInt(budget.additionalFeeReserve))
          throw new Error("Base additional fees exceed the operator reserve");
      }
      const maximum =
        input.gas * input.maxFeePerGas + BigInt(budget.additionalFeeReserve);
      // Check before asking the signing provider. The durable insert is repeated with its exact hash.
      const id = `${input.chainId}:${signer.address.toLowerCase()}:${input.nonce}`;
      reserve(store, budget, id, maximum, "unsigned", options.now?.());
      const raw = await signer.signTransaction(input);
      store.db
        .query("UPDATE gas SET transaction_id=? WHERE id=?")
        .run(keccak256(raw), id);
      return raw;
    },
  };
}

/** The reused Solana builders create only project/award/ATA accounts, all <= PROJECT_SIZE. */
export function budgetSolanaSigner(
  store: KeeperStore,
  budget: GasBudget,
  signer: SolanaSigner,
  rpcUrl: string,
  now?: () => Date,
): SolanaSigner {
  validateBudget(budget);
  return {
    address: signer.address,
    async signMessage(bytes) {
      // The existing encoder permits <=32 accounts and one-byte account counts.
      const count = bytes[3];
      if (
        bytes.length < 4 + count * 32 + 32 ||
        count < 1 ||
        count > 32 ||
        bytes[0] !== 1 ||
        bytes[1] !== 0 ||
        bytes[2] >= count
      )
        throw new Error("Unexpected keeper message format");
      const keys = Array.from({ length: count }, (_, index) =>
        solanaBase58(bytes.slice(4 + index * 32, 4 + (index + 1) * 32)),
      );
      if (keys[0] !== signer.address)
        throw new Error("Keeper message has another fee payer or cosigner");
      const fee = (await rpc(rpcUrl, "getFeeForMessage", [
        Buffer.from(bytes).toString("base64"),
        { commitment: "confirmed" },
      ])) as { value: number | null };
      if (
        fee.value === null ||
        !Number.isSafeInteger(fee.value) ||
        fee.value < 0
      )
        throw new Error("Solana fee quote unavailable");
      const writable = keys.slice(1, count - bytes[2]);
      const state = (await rpc(rpcUrl, "getMultipleAccounts", [
        writable,
        { commitment: "confirmed", encoding: "base64" },
      ])) as { value: unknown[] };
      if (!Array.isArray(state.value) || state.value.length !== writable.length)
        throw new Error("Solana account quote unavailable");
      const rent = await rpc(rpcUrl, "getMinimumBalanceForRentExemption", [
        PROJECT_SIZE,
        { commitment: "confirmed" },
      ]);
      if (typeof rent !== "number" || !Number.isSafeInteger(rent) || rent < 0)
        throw new Error("Solana rent quote unavailable");
      const maximum =
        BigInt(fee.value) +
        BigInt(state.value.filter((entry) => entry === null).length) *
          BigInt(rent);
      const id = `solana:${Buffer.from(bytes).toString("base64")}`;
      reserve(store, budget, id, maximum, "unsigned", now?.());
      const signature = await signer.signMessage(bytes);
      store.db
        .query("UPDATE gas SET transaction_id=? WHERE id=?")
        .run(solanaBase58(signature), id);
      return signature;
    },
  };
}

/** Receipt evidence releases only the gas reserve; it never labels an award paid. */
export async function reconcileGas(
  store: KeeperStore,
  family: "evm" | "solana",
  rpcUrl: string,
  signer: string,
  requireL1Fee: boolean,
) {
  const rows = store.db
    .query<
      { id: string; transaction_id: string; expiry_evidence: string | null },
      []
    >("SELECT id,transaction_id,expiry_evidence FROM gas WHERE actual IS NULL")
    .all();
  for (const row of rows) {
    if (row.transaction_id === "unsigned")
      throw new Error("Incomplete signing transaction in gas journal");
    let actual: bigint;
    let settledAt: number;
    if (family === "evm") {
      const receipt = (await rpc(rpcUrl, "eth_getTransactionReceipt", [
        row.transaction_id,
      ])) as {
        transactionHash: string;
        blockNumber: Hex;
        blockHash: Hex;
        gasUsed: Hex;
        effectiveGasPrice: Hex;
        l1Fee?: Hex;
      } | null;
      if (!receipt) continue;
      const finalized = (await rpc(rpcUrl, "eth_getBlockByNumber", [
        "finalized",
        false,
      ])) as { number: Hex };
      if (BigInt(receipt.blockNumber) > BigInt(finalized.number)) continue;
      const block = (await rpc(rpcUrl, "eth_getBlockByNumber", [
        receipt.blockNumber,
        false,
      ])) as { hash: Hex; timestamp: Hex };
      if (
        receipt.transactionHash.toLowerCase() !==
          row.transaction_id.toLowerCase() ||
        block.hash !== receipt.blockHash
      )
        throw new Error("Gas receipt identity mismatch");
      if (requireL1Fee && receipt.l1Fee === undefined)
        throw new Error("Finalized L2 data fee unavailable");
      settledAt = Number(BigInt(block.timestamp));
      actual =
        BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) +
        BigInt(receipt.l1Fee ?? "0x0") +
        (requireL1Fee
          ? await baseOracleFee(
              rpcUrl,
              "0x275aedd2",
              BigInt(receipt.gasUsed),
              receipt.blockNumber,
            )
          : 0n);
    } else {
      const tx = (await rpc(rpcUrl, "getTransaction", [
        row.transaction_id,
        {
          commitment: "finalized",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        },
      ])) as {
        blockTime: number | null;
        transaction: {
          signatures: string[];
          message: { accountKeys: string[] };
        };
        meta: { preBalances: number[]; postBalances: number[] };
      } | null;
      if (!tx) {
        if (row.expiry_evidence === null)
          await accountExpiredSolanaReserve(store, rpcUrl, row);
        continue;
      }
      if (
        tx.transaction.signatures[0] !== row.transaction_id ||
        tx.transaction.message.accountKeys[0] !== signer
      )
        throw new Error("Gas receipt identity mismatch");
      const [before, after] = [tx.meta.preBalances[0], tx.meta.postBalances[0]];
      if (![before, after].every(Number.isSafeInteger) || before < after)
        throw new Error("Unreconciled native balance change");
      if (tx.blockTime === null)
        throw new Error("Finalized gas receipt time unavailable");
      settledAt = tx.blockTime;
      actual = BigInt(before) - BigInt(after);
    }
    if (!Number.isSafeInteger(settledAt) || settledAt < 0)
      throw new Error("Invalid finalized receipt time");
    store.db
      .query(
        "UPDATE gas SET actual=?,settled_day=? WHERE id=? AND actual IS NULL",
      )
      .run(
        actual.toString(),
        new Date(settledAt * 1000).toISOString().slice(0, 10),
        row.id,
      );
  }
}

/** Unknown receipt costs stay unknown. Finalized expiry bounds when they could occur. */
async function accountExpiredSolanaReserve(
  store: KeeperStore,
  rpcUrl: string,
  row: { id: string; transaction_id: string },
) {
  const attempts = store.db
    .query<{ value: string }, [string]>(
      "SELECT value FROM journal WHERE json_extract(value,'$.transactionId')=?",
    )
    .all(row.transaction_id);
  if (attempts.length === 0) return;
  let lastValidBlockHeight: number | undefined;
  for (const entry of attempts) {
    const attempt = JSON.parse(entry.value) as {
      raw?: string;
      lastValidBlockHeight?: number;
    };
    if (
      typeof attempt.raw !== "string" ||
      !Number.isSafeInteger(attempt.lastValidBlockHeight) ||
      (attempt.lastValidBlockHeight as number) < 0
    )
      return;
    const raw = Buffer.from(attempt.raw, "base64");
    if (
      raw[0] !== 1 ||
      raw.length < 100 ||
      solanaBase58(raw.subarray(1, 65)) !== row.transaction_id ||
      `solana:${raw.subarray(65).toString("base64")}` !== row.id ||
      (lastValidBlockHeight !== undefined &&
        lastValidBlockHeight !== attempt.lastValidBlockHeight)
    )
      throw new Error(
        "Gas expiry evidence does not match the signed transaction",
      );
    lastValidBlockHeight = attempt.lastValidBlockHeight;
  }
  if (lastValidBlockHeight === undefined) return;
  const height = await rpc(rpcUrl, "getBlockHeight", [
    { commitment: "finalized" },
  ]);
  if (typeof height !== "number" || !Number.isSafeInteger(height))
    throw new Error("Finalized expiry height unavailable");
  if (height <= lastValidBlockHeight) return;
  const status = (await rpc(rpcUrl, "getSignatureStatuses", [
    [row.transaction_id],
    { searchTransactionHistory: true },
  ])) as { value?: unknown[] };
  if (!Array.isArray(status.value) || status.value.length !== 1)
    throw new Error("Gas expiry signature status unavailable");
  if (status.value[0] !== null) return;
  const slot = await rpc(rpcUrl, "getSlot", [{ commitment: "finalized" }]);
  if (typeof slot !== "number" || !Number.isSafeInteger(slot))
    throw new Error("Finalized expiry slot unavailable");
  const timestamp = await rpc(rpcUrl, "getBlockTime", [slot]);
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  )
    throw new Error("Finalized expiry time unavailable");
  const evidence = JSON.stringify({
    kind: "expired-upper-bound",
    transactionId: row.transaction_id,
    lastValidBlockHeight,
    finalizedBlockHeight: height,
    finalizedSlot: slot,
    blockTime: timestamp,
    receipt: "unavailable",
    signatureStatus: null,
  });
  store.db
    .query(
      "UPDATE gas SET settled_day=?,expiry_evidence=? WHERE id=? AND actual IS NULL AND expiry_evidence IS NULL",
    )
    .run(
      new Date(timestamp * 1000).toISOString().slice(0, 10),
      evidence,
      row.id,
    );
}

/** Canonical Base oracle implements the active fork's data/operator fee formula. */
async function baseOracleFee(
  url: string,
  selector: "0xf1c7a58b" | "0x275aedd2",
  amount: bigint,
  block: string,
): Promise<bigint> {
  const value = await rpc(url, "eth_call", [
    {
      to: "0x420000000000000000000000000000000000000f",
      data: `${selector}${amount.toString(16).padStart(64, "0")}`,
    },
    block,
  ]);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Base fee oracle unavailable");
  return BigInt(value);
}
