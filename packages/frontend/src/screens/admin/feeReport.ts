// spec/fees/feeReport.md, "The report shows the latest 100 rows, finalized live totals per token as decimal strings, 24-hour state counts and each network's target"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"
import type { FeeConversionRoute, FeeConversionsReport, FeeConversionTotal } from "@repo/fees/client";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { rewardNetwork } from "../setup/fields/rewardAsset.ts";
import { chainOf, networkName } from "./projects.ts";

export type FeeReport = FeeConversionsReport;

export interface ConversionTotal {
  readonly token: string;
  readonly tokenPreview: string;
  readonly amountIn: string;
  readonly converted: string;
  readonly conversions: number;
}

export interface NetworkConversions {
  readonly network: string;
  readonly name: string;
  readonly target: "USDC" | "Not converted";
  readonly totals: ReadonlyArray<ConversionTotal>;
  readonly none: boolean;
}

const canonicalUint = /^(0|[1-9][0-9]*)$/u;

/** @throws {never} */
function routeHolds(route: FeeConversionRoute): boolean {
  return route.network !== "" && ((route.status === "usdc" && route.targetToken !== null && route.targetToken !== "") || (route.status === "not_converted" && route.targetToken === null));
}

/** @throws {never} */
function totalHolds(total: FeeConversionTotal): boolean {
  return total.network !== "" && total.token !== "" && total.targetToken !== "" && Number.isSafeInteger(total.conversions) && total.conversions > 0 && canonicalUint.test(total.amountIn) && canonicalUint.test(total.amountOut);
}

/** Whether every route names its target consistently and every total counts finalized conversions in exact base units. @throws {never} */
export function wellFormedReport(report: FeeReport): boolean {
  return report.routes.every(routeHolds) && report.totals.every(totalHolds);
}

/** @throws {never} */
function tokenLabel(address: string): string {
  return `token ${address}`;
}

/** The output in the network's reviewed stablecoin decimals, else exact base units. @throws {never} */
export function convertedAmount(network: string, targetToken: string, amount: string): string {
  const chain = chainOf(network);
  const stablecoin = chain === undefined ? undefined : rewardNetwork(chain)?.stablecoin;
  const reviewed = stablecoin !== undefined && (chain === "solana" ? stablecoin.address === targetToken : stablecoin.address.toLowerCase() === targetToken.toLowerCase());
  return reviewed ? `${formatBaseUnits({ value: BigInt(amount), decimals: stablecoin.decimals })} ${stablecoin.symbol}` : `${amount} base units of ${tokenLabel(targetToken)}`;
}

/** A long address as its first six and last four characters. @throws {never} */
export function shortAddress(address: string): string {
  return address.length > 13 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** @throws {never} */
function totalOf(total: FeeConversionTotal): ConversionTotal {
  return { token: total.token, tokenPreview: shortAddress(total.token), amountIn: total.amountIn, converted: convertedAmount(total.network, total.targetToken, total.amountOut), conversions: total.conversions };
}

/** Each network's target and its finalized live conversion totals; Robinhood Chain keeps what it receives and is never pending. @throws {never} */
export function networkConversions(report: FeeReport): ReadonlyArray<NetworkConversions> {
  return report.routes.map((route) => {
    const totals = report.totals.filter((total) => total.network === route.network).map(totalOf);
    return { network: route.network, name: networkName(route.network), target: route.status === "usdc" ? "USDC" : "Not converted", totals, none: totals.length === 0 && route.status === "usdc" };
  });
}
