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
  defineChain,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
      try {
        await client.request({
          method: "eth_sendRawTransaction",
          params: [rawTx as Hex],
        });
      } catch (error) {
        if (/already known/iu.test(String((error as Error).message))) return;
        throw error;
      }
    },

    async status(row: PostRow): Promise<PostStatus> {
      const hash = row.txId as Hex;
      const receipt = await client
        .getTransactionReceipt({ hash })
        .catch((error: unknown) => {
          if (error instanceof TransactionReceiptNotFoundError) return null;
          throw error;
        });
      if (receipt) {
        // Finality by block header only: the public Robinhood RPCs serve the
        // `finalized` header but not state at that tag, and the root is read
        // from the latest state below.
        const finalized = await client.getBlock({ blockTag: "finalized" });
        if (receipt.blockNumber > finalized.number) return { kind: "pending" };
        if (receipt.status !== "success")
          return { kind: "failed", reason: "postRoot transaction reverted" };
        const epoch = await this.epochAt(row.epoch);
        if (epoch.root !== row.merkleRoot.toLowerCase())
          throw new Error(
            `Finalized post at epoch ${row.epoch} carries another root`,
          );
        return {
          kind: "finalized",
          blockNumber: receipt.blockNumber.toString(),
          voided: epoch.voided,
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
      if (finalizedNonce > row.evmNonce)
        return { kind: "failed", reason: "nonce used by another transaction" };
      return { kind: "rebroadcast" };
    },
  };
}
