/**
 * SLOP buyback configuration (PRD section 6, "SLOP buyback and burn"; owner
 * decision of 10 November 2026). Addresses are pinned here and reviewed by
 * pull request; every economic limit comes from Worker vars and has no
 * fallback in code. `BUYBACK_MODE` defaults to `off`, which reads nothing.
 */

import type { FeeConverterEnv, Mode, Network } from "./config";

/** The only token the buyback acquires: Slop Cash on Robinhood Chain (4663). */
export const SLOP_TOKEN = "0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae";
/** The only network on which SLOP is bought and burned. */
export const BUYBACK_NETWORK: Network = "robinhood";
/**
 * SLOP has no holder burn: `burn(address,uint256)` is owner-only and a
 * transfer to the zero address reverts. A burn is a transfer to this
 * conventional dead address; `totalSupply` does not fall.
 */
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";
/**
 * Paxos USDG on Robinhood Chain (https://docs.paxos.com/guides/stablecoin/usdg/mainnet):
 * the asset a bridge delivers and the reference that prices value and gas
 * there. It is never a conversion target. A second token named "Paxos USDG"
 * exists on the chain; only this address is accepted.
 */
export const ROBINHOOD_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const ROBINHOOD_CHAIN_ID = 4663n;

/**
 * deBridge DLN. The order names its receiver, asset, amount and destination
 * chain in calldata, so each is checked before signing. `allowedTakers` are
 * the only solver addresses an order may reserve its fill for.
 */
export const DLN = Object.freeze({
  api: "https://dln.debridge.finance/v1.0",
  /** DlnSource on Base and Ethereum: the only bridge call and approval target. */
  source: "0xef4fb24ad0916217251f553c0596f8edc630eb66",
  /** DlnDestination on Robinhood Chain: read-only fill status. */
  destination: "0xe7351fd770a37282b91d153ee690b63579d6dd7f",
  /** DLN source program on Solana. */
  solanaProgram: "src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4",
  /** deBridge's chain id for Solana in API requests. */
  solanaChainId: "7565164",
  allowedTakers: ["0x555ce236c0220695b68341bc48c68d52210cc35b"],
});

export interface BuybackLimits {
  /** Fee income finalized before this instant never enters the buyback. */
  startAt: string;
  /** Share of fee income that funds the buyback, in basis points. */
  shareBps: bigint;
  /** Share of acquired SLOP sent to the burn address, in basis points. */
  burnBps: bigint;
  /** Minimum USDC, in micro-units, worth one bridge order. */
  minBridgeMicro: bigint;
  /** Bridge spread, fixed protocol fee and gas, as a share of the input. */
  maxBridgeCostBps: bigint;
  /** Highest fixed protocol fee an order may pay, in native base units. */
  maxBridgeNativeFee: Partial<Record<Network, bigint>>;
  /** Minimum value, in stablecoin micro-units, worth one SLOP purchase. */
  minBuyMicro: bigint;
  /** Minimum value, in stablecoin micro-units, worth one burn transfer. */
  minBurnMicro: bigint;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  /** Value caps per run and rolling 24 hours, per network and leg. */
  runCapMicro: bigint;
  dailyCapMicro: bigint;
  /** A deposited order not filled after this long is reported for the owner. */
  unfilledAlertSeconds: bigint;
}

export interface BuybackConfig {
  mode: Mode;
  /** Null only when the mode is off. */
  limits: BuybackLimits | null;
}

export interface BuybackEnv extends FeeConverterEnv {
  BUYBACK_MODE?: string;
  BUYBACK_START_AT?: string;
  BUYBACK_SHARE_BPS?: string;
  BUYBACK_BURN_BPS?: string;
  BUYBACK_MIN_BRIDGE_MICRO?: string;
  BUYBACK_MAX_BRIDGE_COST_BPS?: string;
  BUYBACK_MAX_BRIDGE_NATIVE_FEE?: string;
  BUYBACK_MIN_BUY_MICRO?: string;
  BUYBACK_MIN_BURN_MICRO?: string;
  BUYBACK_MAX_SLIPPAGE_BPS?: string;
  BUYBACK_MAX_PRICE_IMPACT_BPS?: string;
  BUYBACK_RUN_CAP_MICRO?: string;
  BUYBACK_DAILY_CAP_MICRO?: string;
  BUYBACK_UNFILLED_ALERT_SECONDS?: string;
}

function required(value: string | undefined, name: string): bigint {
  const text = value?.trim() ?? "";
  if (!/^(0|[1-9][0-9]{0,30})$/u.test(text))
    throw new TypeError(`${name} is required and must be an exact integer`);
  return BigInt(text);
}

function bps(value: string | undefined, name: string): bigint {
  const parsed = required(value, name);
  if (parsed > 10_000n) throw new TypeError(`${name} must be at most 10000`);
  return parsed;
}

const SOURCE_NETWORKS: readonly Network[] = ["base", "ethereum", "solana"];

/**
 * `off` is inert and reads no other value. `dry_run` and `live` need every
 * limit. A live buyback also needs a live converter: the buyback signs with
 * the same fee-wallet key, lease and journal.
 */
export function parseBuybackConfig(
  env: BuybackEnv,
  converterMode: Mode,
): BuybackConfig {
  const mode = (env.BUYBACK_MODE ?? "off").trim();
  if (mode !== "off" && mode !== "dry_run" && mode !== "live")
    throw new TypeError("BUYBACK_MODE must be off, dry_run or live");
  if (mode === "off" || converterMode === "off")
    return { mode: "off", limits: null };
  if (mode === "live" && converterMode !== "live")
    throw new TypeError("A live buyback needs FEE_CONVERTER_MODE live");
  const startAt = env.BUYBACK_START_AT?.trim() ?? "";
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u.test(startAt) ||
    Number.isNaN(Date.parse(startAt))
  )
    throw new TypeError("BUYBACK_START_AT must be a UTC ISO-8601 instant");
  let nativeFees: unknown = {};
  try {
    nativeFees = JSON.parse(env.BUYBACK_MAX_BRIDGE_NATIVE_FEE ?? "");
  } catch {
    throw new TypeError("BUYBACK_MAX_BRIDGE_NATIVE_FEE must be a JSON object");
  }
  if (
    !nativeFees ||
    typeof nativeFees !== "object" ||
    Array.isArray(nativeFees)
  )
    throw new TypeError("BUYBACK_MAX_BRIDGE_NATIVE_FEE must be a JSON object");
  const maxBridgeNativeFee: Partial<Record<Network, bigint>> = {};
  for (const [name, value] of Object.entries(nativeFees)) {
    if (!SOURCE_NETWORKS.includes(name as Network))
      throw new TypeError(`${name} is not a buyback source network`);
    if (typeof value !== "string")
      throw new TypeError("A bridge native fee must be a decimal string");
    maxBridgeNativeFee[name as Network] = required(
      value,
      `BUYBACK_MAX_BRIDGE_NATIVE_FEE.${name}`,
    );
  }
  const limits: BuybackLimits = {
    // Normalized so it compares with the journal's millisecond timestamps.
    startAt: new Date(startAt).toISOString(),
    shareBps: bps(env.BUYBACK_SHARE_BPS, "BUYBACK_SHARE_BPS"),
    burnBps: bps(env.BUYBACK_BURN_BPS, "BUYBACK_BURN_BPS"),
    minBridgeMicro: required(
      env.BUYBACK_MIN_BRIDGE_MICRO,
      "BUYBACK_MIN_BRIDGE_MICRO",
    ),
    maxBridgeCostBps: bps(
      env.BUYBACK_MAX_BRIDGE_COST_BPS,
      "BUYBACK_MAX_BRIDGE_COST_BPS",
    ),
    maxBridgeNativeFee,
    minBuyMicro: required(env.BUYBACK_MIN_BUY_MICRO, "BUYBACK_MIN_BUY_MICRO"),
    minBurnMicro: required(
      env.BUYBACK_MIN_BURN_MICRO,
      "BUYBACK_MIN_BURN_MICRO",
    ),
    maxSlippageBps: Number(
      bps(env.BUYBACK_MAX_SLIPPAGE_BPS, "BUYBACK_MAX_SLIPPAGE_BPS"),
    ),
    maxPriceImpactBps: Number(
      bps(env.BUYBACK_MAX_PRICE_IMPACT_BPS, "BUYBACK_MAX_PRICE_IMPACT_BPS"),
    ),
    runCapMicro: required(env.BUYBACK_RUN_CAP_MICRO, "BUYBACK_RUN_CAP_MICRO"),
    dailyCapMicro: required(
      env.BUYBACK_DAILY_CAP_MICRO,
      "BUYBACK_DAILY_CAP_MICRO",
    ),
    unfilledAlertSeconds: required(
      env.BUYBACK_UNFILLED_ALERT_SECONDS,
      "BUYBACK_UNFILLED_ALERT_SECONDS",
    ),
  };
  return { mode, limits };
}
