/**
 * EVM client of the submission-fee Worker: reads the SubmissionDeposits
 * contract's events and records, and signs, broadcasts and reconciles the
 * resolver's `resolveMany` transaction. What to send is decided in core.ts;
 * this file knows only the chain. The resolver key can mark an open deposit
 * "refund" (to its payer) or "kept" (to the destination fixed at deposit
 * time). It can send a deposit nowhere else and holds no tokens.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  type Log,
  type PublicClient,
  parseAbi,
  RpcRequestError,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isCanonicalEvmReceipt } from "../../contracts/evm/adapter";
import type { NetworkConfig } from "./config";
import {
  type ChainEvent,
  type FeeChain,
  GasBudgetError,
  type SendEntry,
  type SendRow,
  type SendStatus,
} from "./core";

export const SUBMISSION_DEPOSITS_ABI = parseAbi([
  "event Deposited(uint256 indexed id, bytes32 indexed item, address indexed payer, address token, uint128 amount, address keptTo)",
  "event Resolved(uint256 indexed id, bool refunded)",
  "event Reclaimed(uint256 indexed id)",
  "function deposits(uint256 id) view returns ((address payer,address token,uint128 amount,address keptTo,bytes32 item,uint64 depositedAt,uint8 state))",
  "function resolveMany(uint256[] ids, bool[] refunds)",
]);

const MAX_ID = BigInt(Number.MAX_SAFE_INTEGER);

interface EvmFeeChainOptions {
  network: NetworkConfig;
  /** Absent in dry_run: the client can read but cannot sign. */
  privateKey?: string;
  fetch?: typeof fetch;
}

function safeId(value: bigint): number {
  if (value <= 0n || value > MAX_ID) throw new Error("Deposit id out of range");
  return Number(value);
}

export function createEvmFeeChain(options: EvmFeeChainOptions): FeeChain {
  const { network } = options;
  const chain: Chain = defineChain({
    id: network.chainId,
    name: network.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(network.rpcUrl, { fetchFn: options.fetch, retryCount: 1 }),
  }) as PublicClient;
  const contract = network.contract as Address;
  const account = options.privateKey
    ? (() => {
        if (!/^0x[0-9a-fA-F]{64}$/u.test(options.privateKey))
          throw new TypeError("SUBMISSION_FEE_RESOLVER_KEY is malformed");
        return privateKeyToAccount(options.privateKey as Hex);
      })()
    : null;

  const canonicalReceipt = async (hash: Hex) => {
    const receipt = await client
      .getTransactionReceipt({ hash })
      .catch((error: unknown) => {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      });
    if (!receipt) return null;
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (
      !isCanonicalEvmReceipt(hash, receipt, block) ||
      !["success", "reverted"].includes(receipt.status)
    )
      throw new Error("Submission fee receipt identity differs");
    return receipt;
  };
  const finalizedNumber = async () => {
    const block = await client.getBlock({ blockTag: "finalized" });
    if (typeof block.number !== "bigint" || block.number < 0n)
      throw new Error("Submission fee finality unavailable");
    return block.number;
  };
  const ours = (log: Log) =>
    log.address.toLowerCase() === contract &&
    log.removed !== true &&
    typeof log.blockNumber === "bigint" &&
    typeof log.blockHash === "string" &&
    typeof log.transactionHash === "string" &&
    typeof log.logIndex === "number";
  const calldata = (entries: readonly SendEntry[]) =>
    encodeFunctionData({
      abi: SUBMISSION_DEPOSITS_ABI,
      functionName: "resolveMany",
      args: [
        entries.map((entry) => BigInt(entry.id)),
        entries.map((entry) => entry.refund),
      ],
    });

  return {
    chainId: () => client.getChainId(),

    async heads() {
      const [latest, finalized] = await Promise.all([
        client.getBlockNumber(),
        finalizedNumber(),
      ]);
      if (latest > MAX_ID) throw new Error("Block number out of range");
      return { latest: Number(latest), finalized: Number(finalized) };
    },

    async events(fromBlock, toBlock) {
      const logs = await client.getLogs({
        address: contract,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      });
      const events: ChainEvent[] = [];
      for (const log of logs) {
        if (!ours(log)) throw new Error("Unexpected submission fee log");
        // Any other event of the contract (ownership, resolver, pause) is
        // not a deposit record and is skipped; a known event that does not
        // decode exactly is refused.
        let decoded: ReturnType<
          typeof decodeEventLog<typeof SUBMISSION_DEPOSITS_ABI>
        >;
        try {
          decoded = decodeEventLog({
            abi: SUBMISSION_DEPOSITS_ABI,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
        } catch {
          const known = [
            "Deposited(uint256,bytes32,address,address,uint128,address)",
            "Resolved(uint256,bool)",
            "Reclaimed(uint256)",
          ].map((signature) => keccak256(new TextEncoder().encode(signature)));
          if (known.includes(log.topics[0] as Hex))
            throw new Error("Malformed submission fee event");
          continue;
        }
        const base = {
          txHash: (log.transactionHash as string).toLowerCase(),
          blockNumber: Number(log.blockNumber),
          blockHash: (log.blockHash as string).toLowerCase(),
          logIndex: log.logIndex as number,
        };
        if (decoded.eventName === "Deposited") {
          if (decoded.args.amount <= 0n)
            throw new Error("Unexpected deposit amount");
          events.push({
            kind: "deposited",
            depositId: safeId(decoded.args.id),
            item: decoded.args.item.toLowerCase(),
            payer: decoded.args.payer.toLowerCase(),
            token: decoded.args.token.toLowerCase(),
            amount: decoded.args.amount.toString(),
            keptTo: decoded.args.keptTo.toLowerCase(),
            ...base,
          });
        } else if (decoded.eventName === "Resolved")
          events.push({
            kind: "resolved",
            depositId: safeId(decoded.args.id),
            refunded: decoded.args.refunded,
            ...base,
          });
        else
          events.push({
            kind: "reclaimed",
            depositId: safeId(decoded.args.id),
            ...base,
          });
      }
      return events.sort(
        (left, right) =>
          left.blockNumber - right.blockNumber ||
          left.logIndex - right.logIndex,
      );
    },

    async blockTime(blockNumber, blockHash) {
      const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
      // The event must belong to the canonical block whose time it is given.
      if (
        typeof block.hash !== "string" ||
        block.hash.toLowerCase() !== blockHash.toLowerCase() ||
        typeof block.timestamp !== "bigint"
      )
        throw new Error("Submission fee block unavailable");
      const seconds = Number(block.timestamp);
      if (!Number.isSafeInteger(seconds) || seconds <= 0)
        throw new Error("Submission fee block time unavailable");
      return new Date(seconds * 1000).toISOString();
    },

    async assertResolvedTransfer(event, transfer) {
      const hash = event.txHash as Hex;
      const receipt = await canonicalReceipt(hash);
      if (
        receipt?.status !== "success" ||
        receipt.blockNumber > (await finalizedNumber()) ||
        Number(receipt.blockNumber) !== event.blockNumber ||
        receipt.blockHash.toLowerCase() !== event.blockHash
      )
        throw new Error("Resolved receipt is not finalized evidence");
      const resolved = receipt.logs.filter(
        (log) =>
          log.logIndex === event.logIndex &&
          log.address.toLowerCase() === contract,
      );
      // The token's own Transfer log, from the contract, of the exact amount.
      const moved = receipt.logs.filter((log) => {
        if (log.address.toLowerCase() !== transfer.token.toLowerCase())
          return false;
        try {
          const decoded = decodeEventLog({
            abi: erc20Abi,
            eventName: "Transfer",
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          return (
            decoded.args.from.toLowerCase() === contract &&
            decoded.args.to.toLowerCase() ===
              transfer.recipient.toLowerCase() &&
            decoded.args.value === BigInt(transfer.amount)
          );
        } catch {
          return false;
        }
      });
      if (resolved.length !== 1 || moved.length < 1)
        throw new Error("Resolved receipt does not prove the transfer");
    },

    async deposit(depositId) {
      const record = await client.readContract({
        address: contract,
        abi: SUBMISSION_DEPOSITS_ABI,
        functionName: "deposits",
        args: [BigInt(depositId)],
      });
      return {
        payer: record.payer.toLowerCase(),
        token: record.token.toLowerCase(),
        amount: record.amount.toString(),
        keptTo: record.keptTo.toLowerCase(),
        item: record.item.toLowerCase(),
        state: record.state,
      };
    },

    address: () => account?.address.toLowerCase() ?? null,

    async prepare(entries, authorize) {
      if (!account)
        throw new Error(
          "Signing is disabled without SUBMISSION_FEE_RESOLVER_KEY",
        );
      const data = calldata(entries);
      // The simulation runs the contract's own checks (resolver, open state)
      // at the latest block before anything is signed.
      await client.call({ account: account.address, to: contract, data });
      const [nonce, gas, fees] = await Promise.all([
        client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        }),
        client.estimateGas({ account: account.address, to: contract, data }),
        client.estimateFeesPerGas(),
      ]);
      const gasLimit = (gas * 13n + 9n) / 10n;
      const maximum = gasLimit * fees.maxFeePerGas;
      if (
        gasLimit <= 0n ||
        fees.maxFeePerGas <= 0n ||
        maximum > BigInt(network.gas.perTransactionWei)
      )
        throw new GasBudgetError(
          "The transaction exceeds the native fee limit; nothing was signed",
        );
      await authorize(maximum.toString());
      const raw = await account.signTransaction({
        chainId: chain.id,
        type: "eip1559",
        to: contract,
        data,
        value: 0n,
        nonce,
        gas: gasLimit,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      return {
        txId: keccak256(raw),
        rawTx: raw,
        evmNonce: nonce,
        maximumNativeWei: maximum.toString(),
      };
    },

    async broadcast(rawTx) {
      if ((await client.getChainId()) !== chain.id)
        throw new Error("Submission fee chain identity differs");
      try {
        const hash = await client.request({
          method: "eth_sendRawTransaction",
          params: [rawTx as Hex],
        });
        if (hash.toLowerCase() !== keccak256(rawTx as Hex))
          throw new Error("Submission fee broadcast hash differs");
      } catch (error) {
        if (
          error instanceof RpcRequestError &&
          /already known/iu.test(error.details)
        )
          return;
        throw error;
      }
    },

    async status(send: SendRow): Promise<SendStatus> {
      if (
        send.network !== network.network ||
        send.contract !== network.contract ||
        send.txId === null ||
        send.resolver === null ||
        send.evmNonce === null ||
        (await client.getChainId()) !== chain.id
      )
        throw new Error("Submission fee journal deployment differs");
      const finalized = await finalizedNumber();
      const hash = send.txId as Hex;
      const receipt = await canonicalReceipt(hash);
      if (receipt) {
        if (receipt.blockNumber > finalized) return { kind: "pending" };
        if (
          receipt.from.toLowerCase() !== send.resolver ||
          receipt.to?.toLowerCase() !== send.contract
        )
          throw new Error("Submission fee receipt parties differ");
        if (receipt.status !== "success")
          return { kind: "failed", reason: "resolve transaction reverted" };
        return { kind: "finalized", blockNumber: Number(receipt.blockNumber) };
      }
      const pending = await client
        .getTransaction({ hash })
        .catch((error: unknown) => {
          if (error instanceof TransactionNotFoundError) return null;
          throw error;
        });
      if (pending) return { kind: "pending" };
      const finalizedNonce = await client.getTransactionCount({
        address: send.resolver as Address,
        blockTag: "finalized",
      });
      // Another transaction used this nonce in a finalized block, so these
      // bytes can never be included. The deposits stay due, and the next
      // send reads the contract's record before it signs anything.
      if (finalizedNonce > send.evmNonce)
        return {
          kind: "failed",
          reason: "nonce used by another finalized transaction",
        };
      return { kind: "rebroadcast" };
    },
  };
}

const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

/**
 * The official pool's price at the latest block, as whole SLOP per 1.00 USDG
 * times 10^18. USDG (six decimals) is currency0 and SLOP (18 decimals) is
 * currency1, so the pool's price is SLOP base units per USDG base unit:
 * sqrtPriceX96^2 / 2^192. Times 10^6 it is SLOP base units per 1.00 USDG,
 * which is whole SLOP per 1.00 USDG times 10^18.
 */
export async function readPoolRate(options: {
  rpcUrl: string;
  chainId: number;
  stateView: string;
  poolId: string;
  fetch?: typeof fetch;
}): Promise<{ scaled: bigint; blockNumber: number }> {
  const client = createPublicClient({
    transport: http(options.rpcUrl, { fetchFn: options.fetch, retryCount: 1 }),
  });
  if ((await client.getChainId()) !== options.chainId)
    throw new Error("Price source chain differs");
  const blockNumber = await client.getBlockNumber();
  const [sqrtPriceX96] = await client.readContract({
    address: options.stateView as Address,
    abi: STATE_VIEW_ABI,
    functionName: "getSlot0",
    args: [options.poolId as Hex],
    blockNumber,
  });
  if (sqrtPriceX96 <= 0n) throw new Error("The pool has no price");
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * 1_000_000n) >> 192n;
  if (scaled <= 0n || blockNumber > MAX_ID)
    throw new Error("The pool price is out of range");
  return { scaled, blockNumber: Number(blockNumber) };
}
