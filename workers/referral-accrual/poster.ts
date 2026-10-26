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
  erc20Abi,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  parseAbiItem,
  parseTransaction,
  RpcRequestError,
  recoverTransactionAddress,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isCanonicalEvmReceipt } from "../../contracts/evm/adapter";
import { scanReferralLogs } from "./chain-logs";
import type { PosterConfig } from "./config";
import type {
  ChainState,
  PosterClient,
  PostRow,
  PostStatus,
  PreparedPost,
} from "./core";
import {
  gasInteger,
  ReferralGasBudgetError,
  validateGasCost,
  validateGasLimits,
} from "./gas";

const DISTRIBUTOR_ABI = parseAbi([
  "function token() view returns (address)",
  "function poster() view returns (address)",
  "function paused() view returns (bool)",
  "function epochCap() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function nextEpoch() view returns (uint256)",
  "function hasPendingRoot() view returns (bool)",
  "function epochAt(uint256 index) view returns ((bytes32 root,uint256 total,uint64 postedAt,bool voided))",
  "function postRoot(uint256 index,bytes32 root,uint256 newTotal)",
]);

const ROOT_POSTED = parseAbiItem(
  "event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total, uint64 claimableAt)",
);
const ROOT_VOIDED = parseAbiItem(
  "event RootVoided(uint256 indexed epoch, bytes32 root)",
);

export interface EvmPosterOptions {
  config: PosterConfig;
  /** Absent in dry_run: the client can read but cannot sign. */
  privateKey?: string;
  fetch?: typeof fetch;
}

export function createEvmPoster(options: EvmPosterOptions): PosterClient {
  const { config } = options;
  validateGasLimits(config.gas);
  const chain: Chain = defineChain({
    id: config.chainId,
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
      throw new Error("Referral receipt identity differs");
    return receipt;
  };

  const epochAt = async (index: number) => {
    const epoch = await read<{
      root: Hex;
      total: bigint;
      postedAt: bigint;
      voided: boolean;
    }>("epochAt", [BigInt(index)]);
    return {
      root: epoch.root.toLowerCase(),
      total: epoch.total,
      voided: epoch.voided,
    };
  };

  return {
    address: () => account?.address.toLowerCase() ?? null,

    async state(): Promise<ChainState> {
      const chainId = await client.getChainId();
      const [
        token,
        poster,
        paused,
        epochCap,
        totalClaimed,
        nextEpoch,
        hasPendingRoot,
      ] = await Promise.all([
        read<Address>("token"),
        read<Address>("poster"),
        read<boolean>("paused"),
        read<bigint>("epochCap"),
        read<bigint>("totalClaimed"),
        read<bigint>("nextEpoch"),
        read<boolean>("hasPendingRoot"),
      ]);
      const balance = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [distributor],
      });
      return {
        chainId,
        token: token.toLowerCase(),
        poster: poster.toLowerCase(),
        paused,
        epochCap,
        totalClaimed,
        balance,
        nextEpoch: Number(nextEpoch),
        hasPendingRoot,
      };
    },

    async prepare(epoch, root, total, authorize): Promise<PreparedPost> {
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
      // Nitro includes the Ethereum data fee in gas units; adding a Base-style
      // L1 allowance would double-count it. The signed gas and fee caps bound both.
      const gasLimit = (gas * 13n + 9n) / 10n;
      const maximumNativeWei = (gasLimit * fees.maxFeePerGas).toString();
      gasInteger(maximumNativeWei);
      if (
        gasLimit <= 0n ||
        fees.maxFeePerGas <= 0n ||
        BigInt(maximumNativeWei) > BigInt(config.gas.perTransactionWei)
      )
        throw new ReferralGasBudgetError(
          "Referral transaction exceeds the native fee limit",
        );
      await authorize?.(maximumNativeWei);
      const raw = await account.signTransaction({
        chainId: chain.id,
        type: "eip1559",
        to: distributor,
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
        maximumNativeWei,
      };
    },

    async nativeCost(row) {
      if (
        row.network !== config.network ||
        (await client.getChainId()) !== chain.id
      )
        throw new Error("Referral native fee network differs");
      const raw = row.rawTx as Hex;
      const signed = parseTransaction(raw);
      if (
        keccak256(raw) !== row.txId ||
        signed.type !== "eip1559" ||
        signed.chainId !== chain.id ||
        signed.nonce !== row.evmNonce ||
        signed.to?.toLowerCase() !== row.distributor ||
        (signed.value ?? 0n) !== 0n ||
        signed.gas === undefined ||
        signed.gas <= 0n ||
        signed.maxFeePerGas === undefined ||
        signed.maxFeePerGas <= 0n ||
        (
          await recoverTransactionAddress({
            serializedTransaction: raw as `0x02${string}`,
          })
        ).toLowerCase() !== row.poster ||
        signed.data !==
          encodeFunctionData({
            abi: DISTRIBUTOR_ABI,
            functionName: "postRoot",
            args: [
              BigInt(row.epoch),
              row.merkleRoot as Hex,
              BigInt(row.totalBase),
            ],
          })
      )
        throw new Error("Referral signed native fee evidence differs");
      const maximumWei = (signed.gas * signed.maxFeePerGas).toString();
      const pending = { maximumWei, actualWei: null, settledDay: null };
      validateGasCost(pending);
      const receipt = await canonicalReceipt(row.txId as Hex);
      if (!receipt) return pending;
      const finalized = await client.getBlock({ blockTag: "finalized" });
      if (typeof finalized.number !== "bigint" || finalized.number < 0n)
        throw new Error("Referral native fee finality unavailable");
      if (receipt.blockNumber > finalized.number) return pending;
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (
        !isCanonicalEvmReceipt(row.txId, receipt, block) ||
        receipt.from.toLowerCase() !== row.poster ||
        receipt.to?.toLowerCase() !== row.distributor ||
        typeof receipt.gasUsed !== "bigint" ||
        typeof receipt.effectiveGasPrice !== "bigint" ||
        receipt.gasUsed < 0n ||
        receipt.gasUsed > signed.gas ||
        receipt.effectiveGasPrice < 0n ||
        receipt.effectiveGasPrice > signed.maxFeePerGas ||
        typeof block.timestamp !== "bigint"
      )
        throw new Error("Referral finalized native fee evidence differs");
      const timestamp = Number(block.timestamp);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0)
        throw new Error("Referral receipt time unavailable");
      const result = {
        maximumWei,
        actualWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
        settledDay: new Date(timestamp * 1000).toISOString().slice(0, 10),
      };
      validateGasCost(result);
      return result;
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
        const epoch = await epochAt(row.epoch);
        if (
          epoch.root !== row.merkleRoot ||
          epoch.total !== BigInt(row.totalBase)
        )
          throw new Error("Referral epoch differs");
        let voided = false;
        if (epoch.voided) {
          const logs = await scanReferralLogs(
            config.network,
            receipt.blockNumber,
            finalized.number,
            (fromBlock, toBlock) =>
              client.getLogs({
                address: distributor,
                event: ROOT_VOIDED,
                args: { epoch: BigInt(row.epoch) },
                fromBlock,
                toBlock,
                strict: true,
              }),
          );
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
