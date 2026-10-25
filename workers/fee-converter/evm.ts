/**
 * EVM fee-wallet client for Base, Ethereum and Robinhood Chain. Routes come
 * from the KyberSwap Aggregator API. Every built swap is decoded and checked
 * before signing: the pinned router, the exact input token and amount, the
 * network's Circle USDC as output, the fee wallet as receiver, no extra fee
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
import {
  type EvmEscrowConfig,
  type EvmUpgrade,
  verifyEvmDeployment,
} from "../../contracts/evm/adapter";
import type { Limits, NetworkConfig } from "./config";
import type {
  ChainClient,
  ConversionRow,
  FeeVault,
  PreparedApproval,
  PreparedSend,
  Quote,
  QuoteResult,
  SendStatus,
} from "./core";

const KYBER_API = "https://aggregator-api.kyberswap.com";
/** KyberSwap's address for the chain's native currency, used to price gas. */
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
/** The permissionless ProjectEscrow fee claim (contracts/evm/adapter.ts). */
const VAULT_FEE_ABI = [
  {
    type: "function",
    name: "accruedFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "feeRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "claimFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;
const CLAIM_FEES = encodeFunctionData({
  abi: VAULT_FEE_ABI,
  functionName: "claimFees",
});
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
  /** The USDC target; a network without a verified one never quotes or signs. */
  const usdc = (): string => {
    if (definition.usdc === null)
      throw new Error(`no verified USDC target on ${config.network}`);
    return definition.usdc;
  };
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

  async function verifiedVault(entry: FeeVault) {
    const record = entry.deployment;
    const text = (name: string): string => {
      const value = record[name];
      if (typeof value !== "string" || value.length === 0)
        throw new Error(`reviewed EVM deployment lacks ${name}`);
      return value;
    };
    if (
      !definition.escrowNetworks.includes(text("network")) ||
      text("vault").toLowerCase() !== entry.vault.toLowerCase()
    )
      throw new Error("Vault differs from its reviewed network or deployment");
    const escrow: EvmEscrowConfig = {
      request: (method, params) => client.request({ method, params } as never),
      chainId: BigInt(chain.id),
      payoutPolicy: entry.payoutPolicy,
      vault: text("vault"),
      asset: text("asset"),
      owner: text("owner"),
      identityAuthority: text("identityAuthority"),
      feeRecipient: text("feeRecipient"),
      factory: text("factory"),
      registrar: text("registrar"),
      codeSha256: text("codeSha256"),
      factoryCodeSha256: text("factoryCodeSha256"),
      bindingDelaySeconds: text("bindingDelaySeconds"),
      ...(record.evmUpgrade === undefined
        ? {}
        : { evmUpgrade: record.evmUpgrade as EvmUpgrade }),
    };
    // Pin every read to one current block. A recent unreviewed upgrade must not
    // remain claimable merely because the prior implementation is finalized.
    const block = await client.getBlockNumber({ cacheTime: 0 });
    await verifyEvmDeployment(escrow, `0x${block.toString(16)}`);
    if (escrow.feeRecipient.toLowerCase() !== wallet) return null;
    const amount = await client.readContract({
      address: escrow.vault as Address,
      abi: VAULT_FEE_ABI,
      functionName: "accruedFees",
      blockNumber: block,
    });
    return { escrow, amount };
  }

  const self: ChainClient & { address(): string | null } = {
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
            tokenOut: usdc(),
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
        summary.tokenOut.toLowerCase() !== usdc() ||
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

    async prepare(
      token,
      quote: Quote,
      recordApproval: (approval: PreparedApproval) => Promise<void>,
    ): Promise<PreparedSend> {
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
        await recordApproval({
          txId: approval.hash,
          evmNonce: nonce,
        });
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
          tokenOut: usdc(),
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
        desc.dstToken.toLowerCase() !== usdc() ||
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
      // Only the node's "not found" answer means absence. Any other lookup
      // error throws, so the row stays open for the next run.
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
            // The row's own target, so a send reconciles against the asset
            // it was signed for.
            (log) => log.address.toLowerCase() === row.targetToken,
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

    vaultFees: {
      async accrued(entry) {
        const verified = await verifiedVault(entry);
        return verified === null || verified.amount === 0n
          ? null
          : {
              asset: verified.escrow.asset.toLowerCase(),
              amount: verified.amount,
            };
      },

      async claimCostMicro({ vault }) {
        const [gas, fees] = await Promise.all([
          client.estimateGas({
            account: wallet,
            to: vault as Address,
            data: CLAIM_FEES,
            value: 0n,
          }),
          client.estimateFeesPerGas(),
        ]);
        const priced = await self.quote(
          NATIVE,
          ((gas * 13n) / 10n) * fees.maxFeePerGas,
        );
        return "noRoute" in priced ? null : priced.amountOut;
      },

      async claim(entry) {
        const verified = await verifiedVault(entry);
        if (!verified) throw new Error("Vault pays another fee recipient");
        if (verified.amount === 0n) throw new Error("No accrued fees to claim");
        const { escrow, amount } = verified;
        const vault = escrow.vault;
        // One send at a time: a claim waits until no earlier fee-wallet
        // transaction is pending, so a resend can never race the first.
        const [latest, pending] = await Promise.all([
          client.getTransactionCount({ address: wallet, blockTag: "latest" }),
          client.getTransactionCount({ address: wallet, blockTag: "pending" }),
        ]);
        if (pending !== latest)
          throw new Error("an earlier fee-wallet transaction is still pending");
        const sent = await signAndSend(vault as Address, CLAIM_FEES, latest);
        await sendRaw(sent.raw);
        const receipt = await waitForReceipt(sent.hash);
        if (!receipt) throw new Error(`claim ${sent.hash} not mined in time`);
        if (receipt.status !== "success")
          throw new Error(`claim ${sent.hash} reverted`);
        await verifyEvmDeployment(
          escrow,
          `0x${receipt.blockNumber.toString(16)}`,
        );
        const transfers = parseEventLogs({
          abi: erc20Abi,
          eventName: "Transfer",
          logs: receipt.logs.filter(
            (log) => log.address.toLowerCase() === escrow.asset.toLowerCase(),
          ),
        });
        let received = 0n,
          paid = 0n;
        for (const { args } of transfers) {
          if (args.to.toLowerCase() === wallet) received += args.value;
          if (args.from.toLowerCase() === wallet) received -= args.value;
          if (args.from.toLowerCase() === vault.toLowerCase())
            paid += args.value;
          if (args.to.toLowerCase() === vault.toLowerCase()) paid -= args.value;
        }
        if (received < amount || received !== paid)
          throw new Error(
            `claim ${sent.hash} receipt does not match the vault fee`,
          );
        return { txId: sent.hash };
      },
    },
  };
  return self;
}
