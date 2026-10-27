import {
  decodeFunctionData,
  type Hex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
} from "viem";
import { evmRpc, isCanonicalEvmReceipt } from "../../contracts/evm/adapter";
import {
  type Attempt,
  assertEvmNativeCost,
  type ExecutorEnvironment,
  PENDING_BINDINGS,
  preflightEvmDeployment,
  STORED_BINDING,
  storedBindingAbi,
} from "./core";

export interface BindingRecoveryInput {
  network: string;
  vault: string;
  originalTransactionId: string;
  winnerTransactionId: string;
}

export function isBindingRecoveryInput(
  value: unknown,
): value is BindingRecoveryInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).sort().join(",") ===
      "network,originalTransactionId,vault,winnerTransactionId" &&
    typeof item.network === "string" &&
    /^[a-z][a-z0-9-]{1,63}$/.test(item.network) &&
    typeof item.vault === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(item.vault) &&
    [item.originalTransactionId, item.winnerTransactionId].every(
      (hash) => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash),
    )
  );
}

type Environment = Pick<
  ExecutorEnvironment,
  | "PAYMENT_DEPLOYMENTS"
  | "PAYMENT_RPC_URLS"
  | "ALLOW_LOCAL_TEST_CHAIN"
  | "JOURNAL"
>;
type Outcome = "original_finalized" | "original_reverted" | "superseded";
type Proof = {
  transactionId: string;
  blockHash: string;
  blockNumber: string;
  outcome: Outcome;
};
type Observation = {
  key: string;
  attempt: Attempt;
  proof: Proof;
  requestedWinnerTransactionId: string;
};
const same = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const quantity = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))
    throw new Error("Binding reconciliation quantity unavailable");
  return BigInt(value);
};
// RPCs may return signature scalars without their leading zero nibble. Padding
// changes no scalar; the reconstructed signed hash and recovered sender still bind it.
const signatureScalar = (value: unknown): Hex => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value))
    throw new Error("Winner signature unavailable");
  return `0x${value.slice(2).padStart(64, "0")}`;
};

/** Observe one already-finalized winner. This environment has no signer or key. */
export async function reconcileBindingWinner(
  env: Environment,
  input: BindingRecoveryInput,
  /** Internal scheduled reconciliation may observe absence without claiming a winner. */
  allowMissingReceipt = false,
) {
  if (!isBindingRecoveryInput(input))
    throw new Error("Invalid binding reconciliation");
  const observationKey = `binding-observed:${input.originalTransactionId.toLowerCase()}`;
  const recorded = await env.JOURNAL.get<Observation>(observationKey);
  if (
    recorded &&
    !same(recorded.requestedWinnerTransactionId, input.winnerTransactionId)
  )
    throw new Error("Recorded winner request differs");
  let key = recorded?.key;
  let attempt = recorded?.attempt;
  if (!recorded) {
    for (const candidate of (await env.JOURNAL.get<string[]>(
      PENDING_BINDINGS,
    )) ?? []) {
      const value = await env.JOURNAL.get<Attempt | null>(candidate);
      if (value && same(value.transactionId, input.originalTransactionId)) {
        if (attempt) throw new Error("Ambiguous pending binding");
        key = candidate;
        attempt = value;
      }
    }
  }
  if (
    !key ||
    !attempt ||
    !same(attempt.transactionId, input.originalTransactionId) ||
    attempt.network !== input.network ||
    !same(attempt.vault, input.vault) ||
    !/^0x[0-9a-f]{64}$/.test(attempt.fingerprint) ||
    key !== `${STORED_BINDING}${attempt.fingerprint.slice(2)}`
  )
    throw new Error("Pending binding unavailable");
  const deployment = await preflightEvmDeployment(env, input);
  const raw = attempt.rawTransaction;
  const original = parseTransaction(raw);
  if (
    !raw.startsWith("0x02") ||
    !same(keccak256(raw), attempt.transactionId) ||
    original.chainId !== Number(deployment.chainId) ||
    !same(original.to ?? "", deployment.vault) ||
    (original.value ?? 0n) !== 0n ||
    !original.data ||
    typeof original.nonce !== "number" ||
    !Number.isSafeInteger(original.nonce) ||
    !same(
      await recoverTransactionAddress({
        serializedTransaction: raw as `0x02${string}`,
      }),
      deployment.identityAuthority,
    )
  )
    throw new Error("Stored binding identity differs");
  decodeFunctionData({ abi: storedBindingAbi, data: original.data });
  if (original.gas === undefined || original.maxFeePerGas === undefined)
    throw new Error("Stored binding gas envelope unavailable");
  // Current configuration cannot invalidate finalized history. Only a limit
  // retained with the original attempt applies to historical signed bytes.
  assertEvmNativeCost(
    {},
    {
      gas: original.gas,
      maxFeePerGas: original.maxFeePerGas,
      value: original.value,
    },
    attempt,
  );
  const rpc = (method: string, params: unknown[]) =>
    evmRpc(deployment, method, params);
  const finalized = (await rpc("eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number: string };
  const finalizedNumber = quantity(finalized?.number);
  const canonicalReceipt = async (hash: string) => {
    const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as null | {
      transactionHash: string;
      blockHash: string;
      blockNumber: string;
      transactionIndex: string;
      status: string;
      gasUsed: string;
    };
    if (!receipt) return null;
    const number = quantity(receipt.blockNumber);
    const block = (await rpc("eth_getBlockByNumber", [
      receipt.blockNumber,
      false,
    ])) as {
      hash: string;
      number: string;
      transactions: string[];
    } | null;
    const index = Number(quantity(receipt.transactionIndex));
    if (
      !isCanonicalEvmReceipt(
        hash,
        { ...receipt, blockNumber: number, transactionIndex: index },
        block ? { ...block, number: quantity(block.number) } : null,
      ) ||
      !["0x0", "0x1"].includes(receipt.status)
    )
      throw new Error("Binding receipt identity differs");
    if (number > finalizedNumber)
      throw new Error("Binding receipt awaits finality");
    return receipt;
  };
  // The original canonical winner is authoritative even after D1 wallet succession.
  const originalReceipt = await canonicalReceipt(attempt.transactionId);
  let proof: Proof;
  if (originalReceipt) {
    proof = {
      transactionId: attempt.transactionId,
      blockHash: originalReceipt.blockHash,
      blockNumber: originalReceipt.blockNumber,
      outcome:
        originalReceipt.status === "0x1"
          ? "original_finalized"
          : "original_reverted",
    };
  } else {
    if (same(input.winnerTransactionId, attempt.transactionId)) {
      if (allowMissingReceipt) return { state: "pending" as const };
      throw new Error("Original binding receipt unavailable");
    }
    const receipt = await canonicalReceipt(input.winnerTransactionId);
    if (!receipt && allowMissingReceipt) return { state: "pending" as const };
    if (receipt?.status !== "0x1")
      throw new Error("Finalized self-transaction unavailable");
    const tx = (await rpc("eth_getTransactionByHash", [
      input.winnerTransactionId,
    ])) as {
      hash: string;
      blockHash: string;
      blockNumber: string;
      from: string;
      to: string;
      nonce: string;
      type: string;
      value: string;
      input: string;
      gas: string;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
      accessList: unknown[];
      r: Hex;
      s: Hex;
      v?: string;
      yParity?: string;
    } | null;
    if (
      tx?.type !== "0x2" ||
      !same(tx.hash, input.winnerTransactionId) ||
      !same(tx.blockHash, receipt.blockHash) ||
      quantity(tx.blockNumber) !== quantity(receipt.blockNumber) ||
      !same(tx.from, deployment.identityAuthority) ||
      !same(tx.to, tx.from) ||
      quantity(tx.nonce) !== BigInt(original.nonce) ||
      quantity(tx.value) !== 0n ||
      tx.input !== "0x" ||
      quantity(tx.gas) !== 21_000n ||
      quantity(receipt.gasUsed) !== 21_000n ||
      !Array.isArray(tx.accessList) ||
      tx.accessList.length !== 0
    )
      throw new Error("Winner is not the supported inert self-transaction");
    const parity = quantity(tx.yParity ?? tx.v);
    if (parity !== 0n && parity !== 1n)
      throw new Error("Winner signature unavailable");
    const serialized = serializeTransaction(
      {
        type: "eip1559",
        chainId: Number(deployment.chainId),
        nonce: original.nonce,
        gas: 21_000n,
        maxFeePerGas: quantity(tx.maxFeePerGas),
        maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas),
        to: tx.to as Hex,
        value: 0n,
        data: "0x",
        accessList: [],
      },
      {
        r: signatureScalar(tx.r),
        s: signatureScalar(tx.s),
        yParity: Number(parity),
      },
    );
    assertEvmNativeCost(
      {},
      { gas: 21_000n, maxFeePerGas: quantity(tx.maxFeePerGas) },
      attempt,
    );
    if (
      !same(keccak256(serialized), input.winnerTransactionId) ||
      !same(
        await recoverTransactionAddress({ serializedTransaction: serialized }),
        deployment.identityAuthority,
      ) ||
      (await rpc("eth_getCode", [tx.from, receipt.blockNumber])) !== "0x"
    )
      throw new Error("Winner signed identity or plain account differs");
    proof = {
      transactionId: input.winnerTransactionId.toLowerCase(),
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      outcome: "superseded",
    };
  }
  const observation: Observation = {
    key,
    attempt,
    proof,
    requestedWinnerTransactionId: input.winnerTransactionId.toLowerCase(),
  };
  await env.JOURNAL.transaction(async (store) => {
    const prior = await store.get<Observation>(observationKey);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(observation))
        throw new Error("Binding observation changed");
      return;
    }
    const current = await store.get<Attempt | null>(key);
    const pending = (await store.get<string[]>(PENDING_BINDINGS)) ?? [];
    if (
      !current ||
      JSON.stringify(current) !== JSON.stringify(attempt) ||
      !pending.includes(key)
    )
      throw new Error("Pending binding changed during reconciliation");
    // Retain the exact original bytes and proof before changing its active pointer.
    await store.put(observationKey, observation);
    if (proof.outcome !== "original_finalized") await store.put(key, null);
    await store.put(
      PENDING_BINDINGS,
      pending.filter((item) => item !== key),
    );
    // The shared nonce high-water mark and all D1 money/consent state are untouched.
  });
  return {
    state: proof.outcome,
    originalTransactionId: attempt.transactionId,
    winnerTransactionId: proof.transactionId,
    blockHash: proof.blockHash,
    blockNumber: proof.blockNumber,
  };
}
