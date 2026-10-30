import { type Address, encodeFunctionData, erc20Abi } from "viem";

type Account = {
  balance?: string;
  nonce?: number;
  code?: string;
  storage?: Record<string, string>;
};
type State = Record<string, Account>;
export class PaymentProofUnavailable extends Error {}
async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    };
    if (!response.ok || data.error || data.result === undefined)
      throw new Error();
    return data.result;
  } catch {
    throw new PaymentProofUnavailable("Payment balance tracing is unavailable");
  }
}
function state(value: unknown): State {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PaymentProofUnavailable();
  const entries = Object.entries(value);
  if (entries.length > 256) throw new PaymentProofUnavailable();
  return Object.fromEntries(
    entries.map(([address, row]) => {
      if (!/^0x[\da-f]{40}$/iu.test(address) || !row || typeof row !== "object")
        throw new PaymentProofUnavailable();
      const account = row as Account;
      if (
        account.balance !== undefined &&
        !/^0x[\da-f]+$/iu.test(account.balance)
      )
        throw new PaymentProofUnavailable();
      if (
        account.nonce !== undefined &&
        (!Number.isSafeInteger(account.nonce) || account.nonce < 0)
      )
        throw new PaymentProofUnavailable();
      if (
        account.code !== undefined &&
        !/^0x(?:[\da-f]{2})*$/iu.test(account.code)
      )
        throw new PaymentProofUnavailable();
      for (const [key, slot] of Object.entries(account.storage ?? {}))
        if (!/^0x[\da-f]{64}$/iu.test(key) || !/^0x[\da-f]{64}$/iu.test(slot))
          throw new PaymentProofUnavailable();
      return [address.toLowerCase(), account];
    }),
  );
}
function overrides(accounts: State) {
  return Object.fromEntries(
    Object.entries(accounts).map(([address, account]) => [
      address,
      {
        ...(account.balance === undefined ? {} : { balance: account.balance }),
        ...(account.nonce === undefined
          ? {}
          : { nonce: `0x${account.nonce.toString(16)}` }),
        ...(account.code === undefined ? {} : { code: account.code }),
        stateDiff: account.storage ?? {},
      },
    ]),
  );
}
/** Refuse an unsigned token plan before signing when the RPC lacks trace support. */
export async function assertTokenProofAvailable(
  rpcUrl: string,
  token: string,
  payer: string,
) {
  const result = (await rpc(rpcUrl, "debug_traceCall", [
    {
      from: payer,
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [payer as Address],
      }),
    },
    "latest",
    { tracer: "callTracer", timeout: "10s" },
  ])) as { output?: string; error?: string };
  if (result.error || !/^0x[\da-f]{64}$/iu.test(result.output ?? ""))
    throw new PaymentProofUnavailable();
  state(
    await rpc(rpcUrl, "debug_traceCall", [
      {
        from: payer,
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [payer as Address],
        }),
      },
      "latest",
      { tracer: "prestateTracer", timeout: "10s" },
    ]),
  );
}

/** Native receipts also need per-transaction state, including contract or
 * delegated recipients that can return or forward the transferred value. */
export async function assertNativeProofAvailable(
  rpcUrl: string,
  payer: string,
) {
  const call = { from: payer, to: payer, value: "0x0", data: "0x" };
  const [witness, difference] = await Promise.all([
    rpc(rpcUrl, "debug_traceCall", [
      call,
      "latest",
      { tracer: "prestateTracer", timeout: "10s" },
    ]),
    rpc(rpcUrl, "debug_traceCall", [
      call,
      "latest",
      {
        tracer: "prestateTracer",
        tracerConfig: { diffMode: true },
        timeout: "10s",
      },
    ]),
  ]);
  if (state(witness)[payer.toLowerCase()]?.balance === undefined)
    throw new PaymentProofUnavailable();
  const diff = difference as { pre?: unknown; post?: unknown };
  state(diff.pre);
  state(diff.post);
}

/** Compare only the witnessed transaction state, never a whole block's
 * balances: other transfers in that block cannot cancel or supply an award. */
export async function verifyNativeBalanceChanges(input: {
  rpcUrl: string;
  payer: string;
  recipient: string;
  amount: bigint;
  transactionId: string;
  gasCost: bigint;
}) {
  const [witness, difference] = await Promise.all([
    rpc(input.rpcUrl, "debug_traceTransaction", [
      input.transactionId,
      { tracer: "prestateTracer", timeout: "10s" },
    ]),
    rpc(input.rpcUrl, "debug_traceTransaction", [
      input.transactionId,
      {
        tracer: "prestateTracer",
        tracerConfig: { diffMode: true },
        timeout: "10s",
      },
    ]),
  ]);
  const before = state(witness);
  const diff = difference as { pre?: unknown; post?: unknown };
  const changedBefore = state(diff.pre);
  const changedAfter = state(diff.post);
  const delta = (rawAddress: string) => {
    const address = rawAddress.toLowerCase();
    const prior = before[address]?.balance;
    if (prior === undefined) throw new PaymentProofUnavailable();
    // A field present only in the pre-state was removed (its value is zero).
    const next =
      changedAfter[address]?.balance ??
      (changedBefore[address]?.balance !== undefined ? "0x0" : prior);
    return BigInt(next) - BigInt(prior);
  };
  if (
    delta(input.recipient) !== input.amount ||
    delta(input.payer) !== -input.amount - input.gasCost
  )
    throw new Error("The native balances do not match the exact payment");
}
/** Read balances in the transaction's witnessed pre/post state, never whole-block deltas.
 * The second trace proves each balance read used only storage witnessed by that transaction.
 * Missing debug/archive capability fails closed; a Transfer event alone is insufficient.
 */
export async function verifyTokenBalanceChanges(input: {
  rpcUrl: string;
  token: string;
  payer: string;
  recipient: string;
  amount: bigint;
  transactionId: string;
  blockHash: string;
}) {
  const [witnessValue, difference] = await Promise.all([
    rpc(input.rpcUrl, "debug_traceTransaction", [
      input.transactionId,
      { tracer: "prestateTracer", timeout: "10s" },
    ]),
    rpc(input.rpcUrl, "debug_traceTransaction", [
      input.transactionId,
      {
        tracer: "prestateTracer",
        tracerConfig: { diffMode: true },
        timeout: "10s",
      },
    ]),
  ]);
  const before = state(witnessValue),
    diff = difference as { pre?: unknown; post?: unknown };
  const changedBefore = state(diff.pre),
    changedAfter = state(diff.post);
  const after = structuredClone(before);
  for (const address of new Set([
    ...Object.keys(changedBefore),
    ...Object.keys(changedAfter),
  ])) {
    const old = changedBefore[address],
      next = changedAfter[address];
    if (!next) throw new Error("Token payment deletes a witnessed account");
    const slots = { ...(after[address]?.storage ?? {}) };
    for (const key of Object.keys(old?.storage ?? {}))
      slots[key] = `0x${"0".repeat(64)}`;
    Object.assign(slots, next.storage ?? {});
    after[address] = { ...after[address], ...next, storage: slots };
  }
  async function balance(accounts: State, owner: string) {
    const call = {
      from: input.payer,
      to: input.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner as Address],
      }),
    };
    const config = { stateOverrides: overrides(accounts), timeout: "10s" };
    const [readValue, output] = await Promise.all([
      rpc(input.rpcUrl, "debug_traceCall", [
        call,
        input.blockHash,
        { ...config, tracer: "prestateTracer" },
      ]),
      rpc(input.rpcUrl, "debug_traceCall", [
        call,
        input.blockHash,
        { ...config, tracer: "callTracer" },
      ]),
    ]);
    const read = state(readValue);
    for (const [address, accessed] of Object.entries(read)) {
      const known = accounts[address];
      if (
        !known ||
        (accessed.code !== undefined && accessed.code !== known.code) ||
        (accessed.balance !== undefined &&
          accessed.balance !== known.balance) ||
        (accessed.nonce !== undefined && accessed.nonce !== known.nonce)
      )
        throw new PaymentProofUnavailable();
      for (const [key, value] of Object.entries(accessed.storage ?? {}))
        if (known.storage?.[key] !== value) throw new PaymentProofUnavailable();
    }
    const result = output as { output?: string; error?: string };
    if (result.error || !/^0x[\da-f]{64}$/iu.test(result.output ?? ""))
      throw new PaymentProofUnavailable();
    return BigInt(result.output as string);
  }
  const [payerBefore, payerAfter, recipientBefore, recipientAfter] =
    await Promise.all([
      balance(before, input.payer),
      balance(after, input.payer),
      balance(before, input.recipient),
      balance(after, input.recipient),
    ]);
  if (
    payerBefore - payerAfter !== input.amount ||
    recipientAfter - recipientBefore !== input.amount
  )
    throw new Error("The token balances do not match the exact payment");
}
