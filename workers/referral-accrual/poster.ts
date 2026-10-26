/**
 * EVM client for the live poster: reads the ReferralDistributor state,
 * simulates and signs one postRoot transaction from the poster hot key,
 * broadcasts it and reconciles its receipt. The policy of what to post lives
 * in core.ts; this file knows only the chain. The key can post a capped root
 * that the owner can void for seven days; it holds no tokens.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseAbiItem,
  RpcRequestError,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isCanonicalEvmReceipt } from "../../contracts/evm/adapter";
import type { PosterConfig } from "./config";
import type {
  ChainState,
  PosterClient,
  PostRow,
  PostStatus,
  PreparedPost,
} from "./core";

const DISTRIBUTOR_ABI = [
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "poster",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "epochCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "activeTotal",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalClaimed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "nextEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "hasPendingRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "epochAt",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "index" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { type: "bytes32", name: "root" },
          { type: "uint256", name: "total" },
          { type: "uint64", name: "postedAt" },
          { type: "bool", name: "voided" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "postRoot",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "index" },
      { type: "bytes32", name: "root" },
      { type: "uint256", name: "newTotal" },
    ],
    outputs: [],
  },
] as const;

const ROOT_POSTED = parseAbiItem(
  "event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total, uint64 claimableAt)",
);
const ROOT_VOIDED = parseAbiItem(
  "event RootVoided(uint256 indexed epoch, bytes32 root)",
);

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface EvmPosterOptions {
  config: PosterConfig;
  /** Absent in dry_run: the client can read but cannot sign. */
  privateKey?: string;
  fetch?: typeof fetch;
  /** Local Anvil only: replaces the chain id the transaction signs for. */
  chainIdOverride?: number;
}

export function createEvmPoster(options: EvmPosterOptions): PosterClient {
  const { config } = options;
  const chain: Chain = defineChain({
    id: options.chainIdOverride ?? config.chainId,
    name: config.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, {
      fetchFn: options.fetch,
      retryCount: 1,
    }),
  }) as PublicClient;
  const distributor = config.distributor as Address;
  const account = options.privateKey
    ? (() => {
        if (!/^0x[0-9a-fA-F]{64}$/u.test(options.privateKey))
          throw new TypeError("REFERRAL_POSTER_KEY is malformed");
        return privateKeyToAccount(options.privateKey as Hex);
      })()
    : null;

  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: distributor,
      abi: DISTRIBUTOR_ABI,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<T>;

  return {
    address: () => account?.address.toLowerCase() ?? null,

    async state(): Promise<ChainState> {
      const chainId = await client.getChainId();
      const [
        token,
        owner,
        poster,
        paused,
        epochCap,
        activeTotal,
        totalClaimed,
        nextEpoch,
        hasPendingRoot,
      ] = await Promise.all([
        read<Address>("token"),
        read<Address>("owner"),
        read<Address>("poster"),
        read<boolean>("paused"),
        read<bigint>("epochCap"),
        read<bigint>("activeTotal"),
        read<bigint>("totalClaimed"),
        read<bigint>("nextEpoch"),
        read<boolean>("hasPendingRoot"),
      ]);
      const balance = (await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [distributor],
      })) as bigint;
      const count = Number(nextEpoch);
      const latest =
        count > 0
          ? await this.epochAt(count - 1).then((epoch) => ({
              index: count - 1,
              ...epoch,
            }))
          : null;
      return {
        chainId,
        token: token.toLowerCase(),
        owner: owner.toLowerCase(),
        poster: poster.toLowerCase(),
        paused,
        epochCap,
        activeTotal,
        totalClaimed,
        balance,
        nextEpoch: count,
        hasPendingRoot,
        latest,
      };
    },

    async epochAt(index: number) {
      const epoch = await read<{
        root: Hex;
        total: bigint;
        postedAt: bigint;
        voided: boolean;
      }>("epochAt", [BigInt(index)]);
      return {
        root: epoch.root.toLowerCase(),
        total: epoch.total,
        postedAt: Number(epoch.postedAt),
        voided: epoch.voided,
      };
    },

    async prepare(epoch, root, total): Promise<PreparedPost> {
      if (!account)
        throw new Error("Signing is disabled without REFERRAL_POSTER_KEY");
      const data = encodeFunctionData({
        abi: DISTRIBUTOR_ABI,
        functionName: "postRoot",
        args: [BigInt(epoch), root as Hex, total],
      });
      // The simulation runs the contract's own checks (order, pending root,
      // cap, funding) at the latest block before anything is signed.
      await client.call({ account: account.address, to: distributor, data });
      const [nonce, gas, fees] = await Promise.all([
        client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        }),
        client.estimateGas({ account: account.address, to: distributor, data }),
        client.estimateFeesPerGas(),
      ]);
      const raw = await account.signTransaction({
        chainId: chain.id,
        type: "eip1559",
        to: distributor,
        data,
        value: 0n,
        nonce,
        gas: (gas * 13n) / 10n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      return { txId: keccak256(raw), rawTx: raw, evmNonce: nonce };
    },

    async broadcast(rawTx) {
      if ((await client.getChainId()) !== chain.id)
        throw new Error("Referral chain identity differs");
      try {
        const hash = await client.request({
          method: "eth_sendRawTransaction",
          params: [rawTx as Hex],
        });
        if (hash.toLowerCase() !== keccak256(rawTx as Hex))
          throw new Error("Referral broadcast hash differs");
      } catch (error) {
        if (
          error instanceof RpcRequestError &&
          /already known/iu.test(error.details)
        )
          return;
        throw error;
      }
    },

    async status(row: PostRow): Promise<PostStatus> {
      if (
        row.network !== config.network ||
        row.distributor !== config.distributor ||
        row.token !== config.token ||
        (await client.getChainId()) !== chain.id
      )
        throw new Error("Referral journal deployment differs");
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (typeof finalized.number !== "bigint" || finalized.number < 0n)
        throw new Error("Referral finality unavailable");
      const canonicalReceipt = async (hash: Hex) => {
        const receipt = await client
          .getTransactionReceipt({ hash })
          .catch((error: unknown) => {
            if (error instanceof TransactionReceiptNotFoundError) return null;
            throw error;
          });
        if (!receipt) return null;
        const block = await client.getBlock({
          blockNumber: receipt.blockNumber,
        });
        if (
          !isCanonicalEvmReceipt(hash, receipt, block) ||
          !["success", "reverted"].includes(receipt.status)
        )
          throw new Error("Referral receipt identity differs");
        return receipt;
      };
      const hash = row.txId as Hex;
      const receipt = await canonicalReceipt(hash);
      if (receipt) {
        if (receipt.blockNumber > finalized.number) return { kind: "pending" };
        if (
          receipt.from.toLowerCase() !== row.poster ||
          receipt.to?.toLowerCase() !== row.distributor
        )
          throw new Error("Referral receipt parties differ");
        if (receipt.status !== "success")
          return { kind: "failed", reason: "postRoot transaction reverted" };
        const posted = receipt.logs.filter((log) => {
          if (
            log.address.toLowerCase() !== row.distributor ||
            log.removed ||
            log.transactionHash?.toLowerCase() !== hash ||
            log.blockHash !== receipt.blockHash ||
            log.blockNumber !== receipt.blockNumber ||
            log.transactionIndex !== receipt.transactionIndex
          )
            return false;
          try {
            const event = decodeEventLog({
              abi: [ROOT_POSTED],
              data: log.data,
              topics: log.topics,
            });
            return (
              event.args.epoch === BigInt(row.epoch) &&
              event.args.root.toLowerCase() === row.merkleRoot &&
              event.args.total === BigInt(row.totalBase)
            );
          } catch {
            return false;
          }
        });
        if (posted.length !== 1)
          throw new Error("Referral posted event differs");
        // Latest state can hold a run; it cannot establish a terminal owner void.
        // Robinhood need not serve historical eth_call for canonical receipt/log proof.
        const epoch = await this.epochAt(row.epoch);
        if (
          epoch.root !== row.merkleRoot ||
          epoch.total !== BigInt(row.totalBase)
        )
          throw new Error("Referral epoch differs");
        let voided = false;
        if (epoch.voided) {
          const logs = await client.getLogs({
            address: distributor,
            event: ROOT_VOIDED,
            args: { epoch: BigInt(row.epoch) },
            fromBlock: receipt.blockNumber,
            toBlock: finalized.number,
            strict: true,
          });
          if (logs.length === 0) return { kind: "pending" };
          if (logs.length !== 1)
            throw new Error("Referral void evidence differs");
          const log = logs[0];
          const removed = await canonicalReceipt(log.transactionHash);
          if (!removed || removed.blockNumber > finalized.number)
            return { kind: "pending" };
          if (
            log.removed ||
            log.args.root?.toLowerCase() !== row.merkleRoot ||
            log.blockHash !== removed.blockHash ||
            log.blockNumber !== removed.blockNumber ||
            removed.status !== "success" ||
            removed.to?.toLowerCase() !== row.distributor ||
            !removed.logs.some(
              (item) =>
                item.logIndex === log.logIndex &&
                item.address.toLowerCase() === row.distributor &&
                item.data === log.data &&
                item.topics.length === log.topics.length &&
                item.topics.every(
                  (topic, index) => topic === log.topics[index],
                ),
            )
          )
            throw new Error("Referral void receipt differs");
          voided = true;
        }
        return {
          kind: "finalized",
          blockNumber: receipt.blockNumber.toString(),
          voided,
        };
      }
      const pending = await client
        .getTransaction({ hash })
        .catch((error: unknown) => {
          if (error instanceof TransactionNotFoundError) return null;
          throw error;
        });
      if (pending) return { kind: "pending" };
      const finalizedNonce = await client.getTransactionCount({
        address: row.poster as Address,
        blockTag: "finalized",
      });
      // Nonce advancement does not identify the winner. Preserve the unknown attempt.
      if (finalizedNonce > row.evmNonce) return { kind: "pending" };
      return { kind: "rebroadcast" };
    },
  };
}
