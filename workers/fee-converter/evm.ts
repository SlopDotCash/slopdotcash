/**
 * EVM fee-wallet client for Base, Ethereum and Robinhood Chain. Routes come
 * from the KyberSwap Aggregator API. Every built swap is decoded and checked
 * before signing: the pinned router, the exact input token and amount, the
 * network stablecoin as output, the fee wallet as receiver, no extra fee
 * receivers, and a signed minimum no lower than the recorded quote minimum.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  decodeFunctionData,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseEventLogs,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Limits, NetworkConfig } from "./config";
import type {
  ChainClient,
  ConversionRow,
  PreparedSend,
  Quote,
  QuoteResult,
  SendStatus,
} from "./core";

const KYBER_API = "https://aggregator-api.kyberswap.com";
const DEADLINE_SECONDS = 20 * 60;
const RECEIPT_WAIT_MS = 60_000;

const DESCRIPTION = {
  type: "tuple",
  name: "desc",
  components: [
    { type: "address", name: "srcToken" },
    { type: "address", name: "dstToken" },
    { type: "address[]", name: "srcReceivers" },
    { type: "uint256[]", name: "srcAmounts" },
    { type: "address[]", name: "feeReceivers" },
    { type: "uint256[]", name: "feeAmounts" },
    { type: "address", name: "dstReceiver" },
    { type: "uint256", name: "amount" },
    { type: "uint256", name: "minReturnAmount" },
    { type: "uint256", name: "flags" },
    { type: "bytes", name: "permit" },
  ],
} as const;
const OUTPUTS = [
  { type: "uint256", name: "returnAmount" },
  { type: "uint256", name: "gasUsed" },
] as const;
/** KyberSwap MetaAggregationRouterV2 entry points. */
export const KYBER_ROUTER_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "execution",
        components: [
          { type: "address", name: "callTarget" },
          { type: "address", name: "approveTarget" },
          { type: "bytes", name: "targetData" },
          DESCRIPTION,
          { type: "bytes", name: "clientData" },
        ],
      },
    ],
    outputs: OUTPUTS,
  },
  {
    type: "function",
    name: "swapSimpleMode",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "caller" },
      DESCRIPTION,
      { type: "bytes", name: "executorData" },
      { type: "bytes", name: "clientData" },
    ],
    outputs: OUTPUTS,
  },
] as const;

type Fetch = typeof fetch;

export interface EvmClientOptions {
  config: NetworkConfig;
  limits: Limits;
  kyberClientId: string;
  /** Absent in dry_run: the client can quote but cannot sign. */
  privateKey?: string;
  fetch?: Fetch;
  now?: () => Date;
  /** Local fork tests only: replaces the chain id the transaction signs for. */
  chainIdOverride?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Parses a non-negative decimal dollar string into integer micro-units. */
export function usdMicro(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e-(\d+))?$/u.exec(text);
  if (!match) return null;
  if (match[3]) return 0n; // exponent form only appears for tiny values
  return (
    BigInt(match[1]) * 1_000_000n +
    BigInt((match[2] ?? "").padEnd(6, "0").slice(0, 6))
  );
}

interface KyberRoute {
  routeSummary: Record<string, unknown> & {
    amountIn: string;
    amountOut: string;
    tokenIn: string;
    tokenOut: string;
  };
  routerAddress: string;
}

export function createEvmClient(options: EvmClientOptions): ChainClient & {
  address(): string | null;
} {
  const { config, limits } = options;
  const definition = config.definition;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const router = definition.router as Address;
  const wallet = config.feeWallet as Address;
  const chain: Chain = defineChain({
    id: options.chainIdOverride ?? (definition.chainId as number),
    name: config.network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, { fetchFn: doFetch, retryCount: 1 }),
  }) as PublicClient;
  const account = options.privateKey
    ? (() => {
        if (!/^0x[0-9a-fA-F]{64}$/u.test(options.privateKey))
          throw new TypeError(
            `Fee-wallet key for ${config.network} is malformed`,
          );
        const value = privateKeyToAccount(options.privateKey as Hex);
        if (value.address.toLowerCase() !== wallet)
          throw new TypeError(
            `Fee-wallet key for ${config.network} does not control the configured fee wallet`,
          );
        return value;
      })()
    : null;

  async function kyber<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(
      `${KYBER_API}/${definition.kyberChain}/api/v1/${path}`,
      {
        ...init,
        headers: {
          "x-client-id": options.kyberClientId,
          "content-type": "application/json",
          accept: "application/json",
        },
      },
    );
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new Error("KyberSwap response too large");
    let body: { code?: number; message?: string; data?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`KyberSwap returned HTTP ${response.status}`);
    }
    if (!response.ok || body.code !== 0 || body.data === undefined) {
      const error = new Error(
        `KyberSwap ${path.split("?")[0]}: ${String(body.message ?? response.status).slice(0, 200)}`,
      );
      (error as Error & { status?: number; code?: number }).status =
        response.status;
      (error as Error & { code?: number }).code = body.code;
      throw error;
    }
    return body.data as T;
  }

  async function sendRaw(raw: Hex): Promise<void> {
    try {
      await client.request({
        method: "eth_sendRawTransaction",
        params: [raw],
      });
    } catch (error) {
      if (/already known/iu.test(String((error as Error).message))) return;
      throw error;
    }
  }

  async function waitForReceipt(hash: Hex) {
    const deadline = Date.now() + RECEIPT_WAIT_MS;
    while (Date.now() < deadline) {
      const receipt = await client
        .getTransactionReceipt({ hash })
        .catch(() => null);
      if (receipt) return receipt;
      await sleep(2_000);
    }
    return null;
  }

  async function signAndSend(
    to: Address,
    data: Hex,
    nonce: number,
  ): Promise<{ raw: Hex; hash: Hex }> {
    if (!account)
      throw new Error("Signing is disabled without a fee-wallet key");
    const gas = await client.estimateGas({
      account: wallet,
      to,
      data,
      value: 0n,
    });
    const fees = await client.estimateFeesPerGas();
    const raw = await account.signTransaction({
      chainId: chain.id,
      type: "eip1559",
      to,
      data,
      value: 0n,
      nonce,
      gas: (gas * 13n) / 10n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    return { raw, hash: keccak256(raw) };
  }

  return {
    address: () => account?.address.toLowerCase() ?? null,

    async balance(token) {
      return client.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      });
    },

    async quote(token, amount): Promise<QuoteResult> {
      let route: KyberRoute;
      try {
        route = await kyber<KyberRoute>(
          `routes?${new URLSearchParams({
            tokenIn: token,
            tokenOut: definition.stablecoin,
            amountIn: amount.toString(),
            gasInclude: "true",
          })}`,
        );
      } catch (error) {
        const status = (error as { status?: number }).status;
        // 4xx: no pool or an unsupported token. Anything else is a fault.
        if (status !== undefined && status >= 400 && status < 500)
          return { noRoute: (error as Error).message };
        throw error;
      }
      const summary = route.routeSummary;
      if (
        route.routerAddress.toLowerCase() !== router ||
        summary.tokenIn.toLowerCase() !== token ||
        summary.tokenOut.toLowerCase() !== definition.stablecoin ||
        summary.amountIn !== amount.toString() ||
        !/^\d+$/u.test(summary.amountOut)
      )
        throw new Error("KyberSwap route does not match the request");
      const amountOut = BigInt(summary.amountOut);
      if (amountOut === 0n) return { noRoute: "KyberSwap quoted zero output" };
      const inUsd = usdMicro(summary.amountInUsd);
      const outUsd = usdMicro(summary.amountOutUsd);
      const priceImpactBps =
        inUsd !== null && outUsd !== null && inUsd > 0n
          ? Number(inUsd > outUsd ? ((inUsd - outUsd) * 10_000n) / inUsd : 0n)
          : null;
      const gasCostMicro =
        (usdMicro(summary.gasUsd) ?? 0n) + (usdMicro(summary.l1FeeUsd) ?? 0n);
      return {
        route: "kyberswap",
        amountIn: amount,
        amountOut,
        minAmountOut:
          (amountOut * BigInt(10_000 - limits.maxSlippageBps)) / 10_000n,
        priceImpactBps,
        gasCostMicro,
        summary: {
          aggregator: "kyberswap",
          chain: definition.kyberChain,
          router: route.routerAddress.toLowerCase(),
          amountInUsd: summary.amountInUsd ?? null,
          amountOutUsd: summary.amountOutUsd ?? null,
          gas: summary.gas ?? null,
          gasUsd: summary.gasUsd ?? null,
          l1FeeUsd: summary.l1FeeUsd ?? null,
          hops: Array.isArray(summary.route)
            ? (summary.route as unknown[][]).flat().length
            : null,
          observedAt: now().toISOString(),
        },
      };
    },

    async prepare(token, quote: Quote): Promise<PreparedSend> {
      if (!account)
        throw new Error("Signing is disabled without a fee-wallet key");
      // Approve exactly the order amount to the pinned router, never more.
      let approvalTxId: string | null = null;
      const allowance = await client.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, router],
      });
      let nonce = await client.getTransactionCount({
        address: wallet,
        blockTag: "pending",
      });
      if (allowance < quote.amountIn) {
        const approval = await signAndSend(
          token as Address,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [router, quote.amountIn],
          }),
          nonce,
        );
        await sendRaw(approval.raw);
        approvalTxId = approval.hash;
        const receipt = await waitForReceipt(approval.hash);
        if (!receipt)
          throw new Error(`approval ${approval.hash} not mined in time`);
        if (receipt.status !== "success")
          throw new Error(`approval ${approval.hash} reverted`);
        nonce += 1;
      }

      // Re-route at the moment of signing with half the slippage budget, so
      // the signed minimum stays at or above the recorded quote minimum.
      const fresh = await kyber<KyberRoute>(
        `routes?${new URLSearchParams({
          tokenIn: token,
          tokenOut: definition.stablecoin,
          amountIn: quote.amountIn.toString(),
          gasInclude: "true",
        })}`,
      );
      const deadline = Math.floor(now().getTime() / 1000) + DEADLINE_SECONDS;
      const built = await kyber<{
        data: Hex;
        routerAddress: string;
        transactionValue: string;
        amountIn: string;
        amountOut: string;
      }>("route/build", {
        method: "POST",
        body: JSON.stringify({
          routeSummary: fresh.routeSummary,
          sender: wallet,
          recipient: wallet,
          slippageTolerance: Math.max(1, Math.floor(limits.maxSlippageBps / 2)),
          deadline,
          source: options.kyberClientId,
        }),
      });
      if (built.routerAddress.toLowerCase() !== router)
        throw new Error("KyberSwap build names an unexpected router");
      if (built.transactionValue !== "0")
        throw new Error("KyberSwap build carries native value");
      const decoded = decodeFunctionData({
        abi: KYBER_ROUTER_ABI,
        data: built.data,
      });
      const desc =
        decoded.functionName === "swap"
          ? decoded.args[0].desc
          : decoded.args[1];
      if (
        desc.srcToken.toLowerCase() !== token ||
        desc.dstToken.toLowerCase() !== definition.stablecoin ||
        desc.dstReceiver.toLowerCase() !== wallet ||
        desc.amount !== quote.amountIn ||
        desc.feeReceivers.length !== 0 ||
        desc.feeAmounts.length !== 0
      )
        throw new Error("KyberSwap calldata does not match the order");
      if (desc.minReturnAmount < quote.minAmountOut)
        throw new Error("price moved below the recorded minimum");

      const simulated = await client.call({
        account: wallet,
        to: router,
        data: built.data,
        value: 0n,
      });
      if (!simulated.data) throw new Error("swap simulation returned no data");
      const [returnAmount] = decodeFunctionResult({
        abi: KYBER_ROUTER_ABI,
        functionName: decoded.functionName,
        data: simulated.data,
      }) as readonly [bigint, bigint];
      if (returnAmount < desc.minReturnAmount)
        throw new Error(
          "swap simulation returned less than the signed minimum",
        );

      const swap = await signAndSend(router, built.data, nonce);
      return {
        txId: swap.hash,
        rawTx: swap.raw,
        evmNonce: nonce,
        expiresAt: deadline,
        approvalTxId,
        minAmountOut: desc.minReturnAmount,
      };
    },

    broadcast: (raw) => sendRaw(raw as Hex),

    async status(row: ConversionRow): Promise<SendStatus> {
      const hash = row.txId as Hex;
      // Only a definite "not found" answer means absence. A failed lookup
      // (rate limit, outage) must not be read as absence: the nonce rule below
      // would then mark this row's own mined swap as failed, and the terminal
      // record can never be corrected.
      const receipt = await client
        .getTransactionReceipt({ hash })
        .catch((error: unknown) => {
          if (error instanceof TransactionReceiptNotFoundError) return null;
          throw error;
        });
      if (receipt) {
        const finalized = await client.getBlock({ blockTag: "finalized" });
        if (receipt.blockNumber > finalized.number) return { kind: "pending" };
        if (receipt.status !== "success")
          return { kind: "failed", reason: "swap transaction reverted" };
        const logs = parseEventLogs({
          abi: erc20Abi,
          eventName: "Transfer",
          logs: receipt.logs.filter(
            (log) => log.address.toLowerCase() === definition.stablecoin,
          ),
        });
        const amountOut = logs
          .filter((log) => log.args.to.toLowerCase() === wallet)
          .reduce((sum, log) => sum + log.args.value, 0n);
        return { kind: "finalized", amountOut };
      }
      const pending = await client
        .getTransaction({ hash })
        .catch((error: unknown) => {
          if (error instanceof TransactionNotFoundError) return null;
          throw error;
        });
      if (pending) return { kind: "pending" };
      // Our nonce consumed in a finalized block by another transaction means
      // this send can never land.
      const finalizedNonce = await client.getTransactionCount({
        address: wallet,
        blockTag: "finalized",
      });
      if (row.evmNonce !== null && finalizedNonce > row.evmNonce)
        return { kind: "failed", reason: "nonce used by another transaction" };
      // Past the router deadline the swap reverts even if it is mined later.
      if (
        row.expiresAt !== null &&
        Math.floor(now().getTime() / 1000) > row.expiresAt + 60
      )
        return {
          kind: "failed",
          reason: "router deadline passed before inclusion",
        };
      return { kind: "rebroadcast" };
    },
  };
}
