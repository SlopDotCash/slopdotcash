// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"
import { decodeFunctionData, decodeFunctionResult, type Hex } from "viem";
import { kyberRouterAbi } from "@repo/platform/chain/kyberswap";
import { priceImpactCeiling, roundedDivision } from "../kernels/arithmetic.ts";

export type SwapEntry = "swap" | "swapSimpleMode";

export interface SwapDescription {
  readonly entry: SwapEntry;
  readonly srcToken: string;
  readonly dstToken: string;
  readonly dstReceiver: string;
  readonly amount: bigint;
  readonly minReturnAmount: bigint;
  readonly feeReceivers: number;
  readonly feeAmounts: number;
}

const lower = (value: string) => value.toLowerCase();

/** @throws {never} */
export function decodedSwap(data: Hex): SwapDescription | undefined {
  try {
    const decoded = decodeFunctionData({ abi: kyberRouterAbi, data });
    const desc = decoded.functionName === "swap" ? decoded.args[0].desc : decoded.args[1];
    return {
      entry: decoded.functionName,
      srcToken: lower(desc.srcToken),
      dstToken: lower(desc.dstToken),
      dstReceiver: lower(desc.dstReceiver),
      amount: desc.amount,
      minReturnAmount: desc.minReturnAmount,
      feeReceivers: desc.feeReceivers.length,
      feeAmounts: desc.feeAmounts.length,
    };
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function returnAmountOf(entry: SwapEntry, data: Hex): bigint | undefined {
  try {
    const [returnAmount] = decodeFunctionResult({ abi: kyberRouterAbi, functionName: entry, data }) as readonly [bigint, bigint];
    return returnAmount;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function usdMicro(value: unknown, direction: "up" | "down" = "up"): bigint | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const match = /^(\d+)(?:\.(\d+))?(?:e-(\d+))?$/u.exec(String(value));
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  const digits = (match[1] ?? "") + fraction;
  const exponent = match[3] === undefined ? 0 : Number(match[3]);
  const discarded = fraction.length + exponent - 6;
  if (discarded >= digits.length) return direction === "up" && /[1-9]/u.test(digits) ? 1n : 0n;
  if (discarded <= 0) return BigInt(digits) * 10n ** BigInt(-discarded);
  return roundedDivision(BigInt(digits), 10n ** BigInt(discarded), direction === "up");
}

/** @throws {never} */
export function impactBps(amountInUsd: unknown, amountOutUsd: unknown): number {
  const input = usdMicro(amountInUsd);
  const output = usdMicro(amountOutUsd, "down");
  if (input === undefined || output === undefined || input <= 0n) return -1;
  const ceiling = priceImpactCeiling(input, output);
  return ceiling <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(ceiling) : -1;
}

/** @throws {never} */
export function hopsOf(route: unknown): number | null {
  return Array.isArray(route) ? (route as unknown[][]).flat().length : null;
}

/** @throws {never} */
export function buildSlippage(slippageBps: number): number {
  return Math.max(1, Math.floor(slippageBps / 2));
}
