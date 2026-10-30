import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  parseEventLogs,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { isCanonicalEvmReceipt } from "../../contracts/evm/adapter";
import { evmReceiptNativeCost } from "../../contracts/evm/native-cost";
import { EVM_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
import {
  verifyNativeBalanceChanges,
  verifyTokenBalanceChanges,
} from "./direct-evm-balances";

export type DirectTransfer = { recipient: string; amountBase: string };
export interface EvmDirectInput {
  rpcUrl: string;
  chainId: string;
  payer: string;
  asset: { address: string; decimals: number };
  transfers: DirectTransfer[];
  /** Decimal nonces reserved by this versioned payment, in transfer order. */
  nonces?: string[];
}
async function directEvmClient(
  input: Pick<EvmDirectInput, "rpcUrl" | "chainId">,
) {
  const client = createPublicClient({
    transport: http(input.rpcUrl, { retryCount: 0, timeout: 15000 }),
  });
  if (BigInt(await client.getChainId()) !== BigInt(input.chainId))
    throw new Error("Payment RPC reports a different chain");
  return client;
}
export async function evmPendingNonce(
  input: Pick<EvmDirectInput, "rpcUrl" | "chainId" | "payer">,
) {
  return (await directEvmClient(input)).getTransactionCount({
    address: input.payer as Address,
    blockTag: "pending",
  });
}
export async function evmFinalizedNonce(
  input: Pick<EvmDirectInput, "rpcUrl" | "chainId" | "payer">,
) {
  return (await directEvmClient(input)).getTransactionCount({
    address: input.payer as Address,
    blockTag: "finalized",
  });
}
export async function evmPayerCode(
  input: Pick<EvmDirectInput, "rpcUrl" | "chainId" | "payer">,
) {
  return (await directEvmClient(input)).getCode({
    address: input.payer as Address,
    blockTag: "latest",
  });
}
export async function evmDirectHead(
  input: Pick<EvmDirectInput, "rpcUrl" | "chainId">,
) {
  const client = createPublicClient({
    transport: http(input.rpcUrl, { retryCount: 0, timeout: 15000 }),
  });
  if (BigInt(await client.getChainId()) !== BigInt(input.chainId))
    throw new Error("Payment RPC reports a different chain");
  return (await client.getBlockNumber({ cacheTime: 0 })).toString();
}
export function evmDirectTransactions(input: EvmDirectInput) {
  if (
    input.nonces !== undefined &&
    (input.nonces.length !== input.transfers.length ||
      input.nonces.some(
        (nonce) => !/^(?:0x[\da-f]+|0|[1-9]\d*)$/iu.test(nonce),
      ))
  )
    throw new Error("Every transfer needs its exact reserved nonce");
  return input.transfers.map((transfer, index) => ({
    chainId: `0x${BigInt(input.chainId).toString(16)}`,
    from: input.payer,
    ...(input.nonces
      ? { nonce: `0x${BigInt(input.nonces[index]).toString(16)}` }
      : {}),
    to:
      input.asset.address.toLowerCase() === EVM_NATIVE_ASSET
        ? transfer.recipient
        : input.asset.address,
    value:
      input.asset.address.toLowerCase() === EVM_NATIVE_ASSET
        ? `0x${BigInt(transfer.amountBase).toString(16)}`
        : "0x0",
    data:
      input.asset.address.toLowerCase() === EVM_NATIVE_ASSET
        ? "0x"
        : encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [transfer.recipient as Address, BigInt(transfer.amountBase)],
          }),
  }));
}

/** Verify the exact externally signed transfer, never a typed success claim. */
export async function verifyEvmDirect(
  input: EvmDirectInput & {
    transactionIds: string[];
    afterBlock: string;
    afterBlocks?: string[];
  },
) {
  if (!/^(0|[1-9]\d{0,19})$/u.test(input.afterBlock))
    throw new Error("Missing direct-payment intent block");
  if (
    input.transactionIds.length < 1 ||
    input.transactionIds.length > input.transfers.length ||
    new Set(input.transactionIds.map((x) => x.toLowerCase())).size !==
      input.transactionIds.length
  )
    throw new Error("Provide one distinct transaction for each exact transfer");
  const client = createPublicClient({
    transport: http(input.rpcUrl, { retryCount: 0, timeout: 15000 }),
  });
  if (BigInt(await client.getChainId()) !== BigInt(input.chainId))
    throw new Error("Payment RPC reports a different chain");
  const final = await client.getBlock({ blockTag: "finalized" });
  const plans = evmDirectTransactions(input);
  const used = new Set<number>();
  return Promise.all(
    input.transactionIds.map(async (transactionId) => {
      if (!/^0x[0-9a-fA-F]{64}$/u.test(transactionId))
        throw new Error("Invalid transaction id");
      const hash = transactionId as Hex;
      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);
      const canonical = await client.getBlock({
        blockNumber: receipt.blockNumber,
      });
      const index = plans.findIndex(
        (candidate) =>
          tx.to?.toLowerCase() === candidate.to.toLowerCase() &&
          tx.value === BigInt(candidate.value) &&
          tx.input.toLowerCase() === candidate.data.toLowerCase(),
      );
      if (index < 0 || used.has(index))
        throw new Error("Transfer is not an unpaid distinct award leg");
      used.add(index);
      const plan = plans[index];
      if (
        !isCanonicalEvmReceipt(hash, receipt, canonical) ||
        receipt.status !== "success" ||
        receipt.blockNumber <=
          BigInt(input.afterBlocks?.[index] ?? input.afterBlock) ||
        final.number === null ||
        receipt.blockNumber > final.number ||
        canonical.hash !== receipt.blockHash ||
        tx.blockHash !== receipt.blockHash ||
        tx.blockNumber !== receipt.blockNumber ||
        tx.hash.toLowerCase() !== hash.toLowerCase() ||
        receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
        tx.from.toLowerCase() !== input.payer.toLowerCase() ||
        (input.nonces !== undefined &&
          BigInt(tx.nonce) !== BigInt(input.nonces[index])) ||
        tx.to?.toLowerCase() !== plan.to.toLowerCase() ||
        tx.value !== BigInt(plan.value) ||
        tx.input.toLowerCase() !== plan.data.toLowerCase()
      )
        throw new Error(
          "Payment is not the exact successful finalized transfer",
        );
      if (input.asset.address.toLowerCase() === EVM_NATIVE_ASSET) {
        await verifyNativeBalanceChanges({
          rpcUrl: input.rpcUrl,
          payer: input.payer,
          recipient: input.transfers[index].recipient,
          amount: BigInt(input.transfers[index].amountBase),
          transactionId: hash,
          gasCost: await evmReceiptNativeCost(
            client,
            receipt,
            BigInt(input.chainId) === 8453n || BigInt(input.chainId) === 84532n,
          ),
        });
      } else {
        const transfers = parseEventLogs({
          abi: erc20Abi,
          eventName: "Transfer",
          logs: receipt.logs.filter(
            (log) =>
              log.address.toLowerCase() === input.asset.address.toLowerCase(),
          ),
        }).filter(
          (log) => log.args.from.toLowerCase() === input.payer.toLowerCase(),
        );
        if (
          transfers.length !== 1 ||
          transfers[0].args.to.toLowerCase() !==
            input.transfers[index].recipient.toLowerCase() ||
          transfers[0].args.value !== BigInt(input.transfers[index].amountBase)
        )
          throw new Error(
            "Token receipt does not deliver the exact approved amount",
          );
        await verifyTokenBalanceChanges({
          rpcUrl: input.rpcUrl,
          token: input.asset.address,
          payer: input.payer,
          recipient: input.transfers[index].recipient,
          amount: BigInt(input.transfers[index].amountBase),
          transactionId: hash,
          blockHash: receipt.blockHash,
        });
      }
      return {
        legIndex: index,
        transactionId: hash.toLowerCase(),
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber.toString(),
      };
    }),
  );
}

/** A finalized nonce consumption is the proof: a missing transaction is never cancellation. */
export async function verifyEvmDirectCancellation(input: {
  rpcUrl: string;
  chainId: string;
  payer: string;
  nonce: string;
  transactionId: string;
  afterBlock: string;
}) {
  if (!/^0x[\da-f]{64}$/iu.test(input.transactionId))
    throw new Error("Invalid cancellation transaction");
  const client = await directEvmClient(input);
  const hash = input.transactionId as Hex;
  const [transaction, receipt, finalized] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
    client.getBlock({ blockTag: "finalized" }),
  ]);
  const block = await client.getBlock({
    blockNumber: receipt.blockNumber,
    includeTransactions: true,
  });
  if (
    !isCanonicalEvmReceipt(hash, receipt, {
      ...block,
      transactions: block.transactions.map((entry) => entry.hash),
    }) ||
    finalized.number === null ||
    receipt.blockNumber > finalized.number ||
    receipt.blockNumber <= BigInt(input.afterBlock) ||
    transaction.blockHash !== receipt.blockHash ||
    transaction.blockNumber !== receipt.blockNumber ||
    transaction.transactionIndex !== receipt.transactionIndex ||
    transaction.hash.toLowerCase() !== hash.toLowerCase() ||
    transaction.from.toLowerCase() !== input.payer.toLowerCase() ||
    BigInt(transaction.nonce) !== BigInt(input.nonce) ||
    (receipt.status !== "reverted" &&
      (receipt.status !== "success" ||
        transaction.to?.toLowerCase() !== input.payer.toLowerCase() ||
        transaction.value !== 0n ||
        transaction.input !== "0x"))
  )
    throw new Error(
      "The reserved nonce has not been retired by a finalized cancellation",
    );
  if (receipt.status === "success") {
    if (
      transaction.type === "eip7702" ||
      (transaction as { authorizationList?: unknown[] }).authorizationList
        ?.length
    )
      throw new Error(
        "A delegated transaction cannot prove a plain self-cancellation",
      );
    const codes = await Promise.all([
      client.getCode({
        address: input.payer as Address,
        blockNumber: receipt.blockNumber,
      }),
      client.getCode({
        address: input.payer as Address,
        blockNumber: receipt.blockNumber - 1n,
      }),
    ]);
    if (codes.some((code) => code && code !== "0x"))
      throw new Error("A coded payer cannot prove a plain self-cancellation");
    for (const sibling of block.transactions)
      for (const authorization of sibling.authorizationList ?? [])
        if (
          (
            await recoverAuthorizationAddress({ authorization })
          ).toLowerCase() === input.payer.toLowerCase()
        )
          throw new Error(
            "The payer's code changed within the cancellation block",
          );
  }
  return {
    kind: "evm-nonce-retired" as const,
    transactionId: hash.toLowerCase(),
    nonce: input.nonce,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber.toString(),
    reverted: receipt.status === "reverted",
  };
}
