/**
 * Fee-converter configuration. Every value comes from Worker vars or secrets;
 * a missing or malformed value refuses the run instead of guessing.
 */

import type { EscrowChain } from "../../src/lib/escrow-policy.mjs";
import { type NativeGasLimits, validateNativeLimits } from "./native-gas";

export type Network = EscrowChain;
/** A signing job's run mode; `off` and `dry_run` never load a key. */
export type Mode = "off" | "dry_run" | "live";

export const NETWORKS: readonly Network[] = [
  "base",
  "ethereum",
  "robinhood",
  "solana",
];

export interface NetworkDefinition {
  family: "evm" | "solana";
  /** EVM chain id, or null for Solana. */
  chainId: number | null;
  /** Escrow deployment network keys whose assets count as this network's reward assets. */
  escrowNetworks: readonly string[];
  /**
   * Circle USDC on this network: the only conversion target (PRD section 6).
   * Null when the network retains received assets without conversion.
   * Robinhood has this policy (PRD sections 6 and 11, 25 October 2026).
   * Never substitute another stablecoin or a token named "USDC".
   */
  usdc: string | null;
  defaultRpcUrl: string;
  /** KyberSwap Aggregator chain slug; null for Solana. */
  kyberChain: string | null;
  /** The only contract an EVM swap may call and the only approval spender. */
  router: string | null;
}

/**
 * USDC targets: Base and Solana USDC match src/lib/escrow-policy.mjs.
 * Ethereum USDC is Circle's published mainnet contract (AGENTS.md: verify it
 * from Circle's primary source before activation). Robinhood Chain has no
 * verified Circle USDC. The owner chose to retain each received asset there
 * without conversion or bridging (PRD sections 6 and 11, 25 October 2026).
 */
export const NETWORK_DEFINITIONS: Readonly<Record<Network, NetworkDefinition>> =
  Object.freeze({
    base: {
      family: "evm",
      chainId: 8453,
      escrowNetworks: ["base-mainnet"],
      usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      defaultRpcUrl: "https://mainnet.base.org",
      kyberChain: "base",
      router: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
    },
    ethereum: {
      family: "evm",
      chainId: 1,
      escrowNetworks: ["ethereum"],
      usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      defaultRpcUrl: "https://ethereum-rpc.publicnode.com",
      kyberChain: "ethereum",
      router: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
    },
    robinhood: {
      family: "evm",
      chainId: 4663,
      escrowNetworks: ["robinhood-mainnet"],
      // Owner decision: retain received assets without conversion on chain 4663.
      usdc: null,
      defaultRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
      kyberChain: "robinhood",
      router: "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
    },
    solana: {
      family: "solana",
      chainId: null,
      escrowNetworks: ["solana-mainnet"],
      usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      defaultRpcUrl: "https://api.mainnet-beta.solana.com",
      kyberChain: null,
      router: null,
    },
  });

export interface FeeConverterEnv {
  FEE_CONVERTER_MODE?: string;
  FEE_CONVERTER_NETWORKS?: string;
  FEE_CONVERTER_ALLOWLIST?: string;
  FEE_CONVERTER_MIN_VALUE_MICRO?: string;
  FEE_CONVERTER_GAS_MULTIPLE?: string;
  FEE_CONVERTER_MAX_SLIPPAGE_BPS?: string;
  FEE_CONVERTER_MAX_PRICE_IMPACT_BPS?: string;
  FEE_CONVERTER_RUN_CAP_MICRO?: string;
  FEE_CONVERTER_DAILY_CAP_MICRO?: string;
  FEE_CONVERTER_SOLANA_FEE_MICRO?: string;
  /** Exact native base units: wei on EVM, lamports on Solana. No inherited caps. */
  FEE_CONVERTER_NATIVE_BUDGETS?: string;
  FEE_WALLET_BASE?: string;
  FEE_WALLET_ETHEREUM?: string;
  FEE_WALLET_ROBINHOOD?: string;
  FEE_WALLET_SOLANA?: string;
  RPC_URL_BASE?: string;
  RPC_URL_ETHEREUM?: string;
  RPC_URL_ROBINHOOD?: string;
  RPC_URL_SOLANA?: string;
  SOLANA_RECOVERY_RPC_URL?: string;
  KYBERSWAP_CLIENT_ID?: string;
  JUPITER_API_URL?: string;
  JUPITER_API_KEY?: string;
  /** Secrets. Never logged, never stored in D1, never set in CI. */
  FEE_WALLET_KEY_BASE?: string;
  FEE_WALLET_KEY_ETHEREUM?: string;
  FEE_WALLET_KEY_ROBINHOOD?: string;
  FEE_WALLET_KEY_SOLANA?: string;
}

export interface Limits {
  minValueMicro: bigint;
  gasMultiple: bigint;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  runCapMicro: bigint;
  dailyCapMicro: bigint;
  solanaFeeMicro: bigint;
}

export interface NetworkConfig {
  network: Network;
  definition: NetworkDefinition;
  feeWallet: string;
  rpcUrl: string;
  allowlist: string[];
  nativeBudget?: NativeGasLimits;
}

export interface FeeConverterConfig {
  mode: Mode;
  networks: NetworkConfig[];
  limits: Limits;
  kyberClientId: string;
  jupiterApiUrl: string;
  jupiterApiKey: string | null;
}

/** Typical Solana swap fee in USDC micro-units, used only for the gas multiple. */
const SOLANA_FEE_ESTIMATE_MICRO = 2_000n;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

export function isTokenAddress(network: Network, value: unknown): boolean {
  if (typeof value !== "string") return false;
  return NETWORK_DEFINITIONS[network].family === "evm"
    ? EVM_ADDRESS.test(value)
    : SOLANA_ADDRESS.test(value);
}

/**
 * Conversion limits are economic and security policy (PRD section 9, "Fee
 * conversion": routes, limits and custody remain approvals). The code holds
 * no fallback: a converter that runs needs every limit set in the reviewed
 * wrangler.toml, and a missing one refuses the whole run. `off` reads none.
 */
const DUST_DECISION =
  "awaits the owner's decision on whether tiny fee balances may accumulate";

function integer(
  value: string | undefined,
  name: string,
  required: boolean,
  missing = "is required",
): bigint {
  if (value === undefined || value.trim() === "") {
    if (required) throw new TypeError(`${name} ${missing}`);
    return 0n;
  }
  if (!/^(0|[1-9][0-9]{0,30})$/u.test(value.trim()))
    throw new TypeError(`${name} must be a non-negative integer`);
  return BigInt(value.trim());
}

function bps(value: string | undefined, name: string, required: boolean) {
  const parsed = integer(value, name, required);
  if (parsed > 10_000n) throw new TypeError(`${name} must be at most 10000`);
  return Number(parsed);
}

const upper = (network: Network) => network.toUpperCase() as Uppercase<Network>;

export function parseConfig(env: FeeConverterEnv): FeeConverterConfig {
  const mode = (env.FEE_CONVERTER_MODE ?? "off").trim();
  if (mode !== "off" && mode !== "dry_run" && mode !== "live")
    throw new TypeError("FEE_CONVERTER_MODE must be off, dry_run or live");
  const enabled = (env.FEE_CONVERTER_NETWORKS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const name of enabled)
    if (!NETWORKS.includes(name as Network))
      throw new TypeError(`Unknown fee-converter network: ${name}`);
  let allowlist: Record<string, unknown> = {};
  if (env.FEE_CONVERTER_ALLOWLIST?.trim()) {
    const parsed: unknown = JSON.parse(env.FEE_CONVERTER_ALLOWLIST);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new TypeError("FEE_CONVERTER_ALLOWLIST must be a JSON object");
    allowlist = parsed as Record<string, unknown>;
    for (const key of Object.keys(allowlist))
      if (!NETWORKS.includes(key as Network))
        throw new TypeError(`Unknown allowlist network: ${key}`);
  }
  const networks = [...new Set(enabled as Network[])].map((network) => {
    const definition = NETWORK_DEFINITIONS[network];
    const feeWallet = env[`FEE_WALLET_${upper(network)}`]?.trim() ?? "";
    if (!isTokenAddress(network, feeWallet))
      throw new TypeError(`FEE_WALLET_${upper(network)} is not set or invalid`);
    const list = allowlist[network] ?? [];
    if (!Array.isArray(list) || !list.every((t) => isTokenAddress(network, t)))
      throw new TypeError(`Allowlist for ${network} has an invalid token`);
    const rpcUrl =
      env[`RPC_URL_${upper(network)}`]?.trim() || definition.defaultRpcUrl;
    if (!/^https?:\/\//u.test(rpcUrl))
      throw new TypeError(`RPC_URL_${upper(network)} must be an http(s) URL`);
    return {
      network,
      definition,
      feeWallet,
      rpcUrl,
      allowlist: list as string[],
    };
  });
  if (env.FEE_CONVERTER_NATIVE_BUDGETS?.trim()) {
    const budgets: unknown = JSON.parse(env.FEE_CONVERTER_NATIVE_BUDGETS);
    if (!budgets || typeof budgets !== "object" || Array.isArray(budgets))
      throw new TypeError("FEE_CONVERTER_NATIVE_BUDGETS must be a JSON object");
    for (const [name, value] of Object.entries(budgets)) {
      if (
        !NETWORKS.includes(name as Network) ||
        !value ||
        typeof value !== "object"
      )
        throw new TypeError("Native budget names an invalid network or limit");
      const limits = value as NativeGasLimits;
      validateNativeLimits(limits);
      if (
        name === "base"
          ? BigInt(limits.additionalFeeReserve) === 0n
          : limits.additionalFeeReserve !== "0"
      )
        throw new TypeError(
          "Base needs a positive data/operator allowance; other networks use zero",
        );
      const network = networks.find((n) => n.network === name) as
        | NetworkConfig
        | undefined;
      if (network) network.nativeBudget = limits;
    }
  }
  for (const network of networks as NetworkConfig[])
    if (
      mode === "live" &&
      network.definition.usdc !== null &&
      !network.nativeBudget
    )
      throw new TypeError(
        `Native gas limits are required before live signing on ${network.network}`,
      );
  const jupiterApiKey = env.JUPITER_API_KEY?.trim() || null;
  const running = mode !== "off";
  return {
    mode,
    networks,
    limits: {
      // The dust threshold: a quote below it, or below the gas multiple of
      // its network fee, leaves the token in the fee wallet to accumulate.
      minValueMicro: integer(
        env.FEE_CONVERTER_MIN_VALUE_MICRO,
        "FEE_CONVERTER_MIN_VALUE_MICRO",
        running,
        DUST_DECISION,
      ),
      gasMultiple: integer(
        env.FEE_CONVERTER_GAS_MULTIPLE,
        "FEE_CONVERTER_GAS_MULTIPLE",
        running,
        DUST_DECISION,
      ),
      maxSlippageBps: bps(
        env.FEE_CONVERTER_MAX_SLIPPAGE_BPS,
        "FEE_CONVERTER_MAX_SLIPPAGE_BPS",
        running,
      ),
      maxPriceImpactBps: bps(
        env.FEE_CONVERTER_MAX_PRICE_IMPACT_BPS,
        "FEE_CONVERTER_MAX_PRICE_IMPACT_BPS",
        running,
      ),
      runCapMicro: integer(
        env.FEE_CONVERTER_RUN_CAP_MICRO,
        "FEE_CONVERTER_RUN_CAP_MICRO",
        running,
      ),
      dailyCapMicro: integer(
        env.FEE_CONVERTER_DAILY_CAP_MICRO,
        "FEE_CONVERTER_DAILY_CAP_MICRO",
        running,
      ),
      // A network-fee estimate, not policy: it only prices the gas multiple.
      solanaFeeMicro: env.FEE_CONVERTER_SOLANA_FEE_MICRO?.trim()
        ? integer(
            env.FEE_CONVERTER_SOLANA_FEE_MICRO,
            "FEE_CONVERTER_SOLANA_FEE_MICRO",
            true,
          )
        : SOLANA_FEE_ESTIMATE_MICRO,
    },
    kyberClientId: env.KYBERSWAP_CLIENT_ID?.trim() || "slop-fee-converter",
    jupiterApiUrl: env.JUPITER_API_URL?.trim() || "https://api.jup.ag/swap/v1",
    jupiterApiKey,
  };
}

/** Returns the signing secret for a network; undefined when not configured. */
export function networkKey(
  env: FeeConverterEnv,
  network: Network,
): string | undefined {
  const value = env[`FEE_WALLET_KEY_${upper(network)}`];
  return value?.trim() ? value.trim() : undefined;
}
