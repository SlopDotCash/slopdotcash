// spec/settlement/vaultSnapshots.md, "From December 2026 a month is promised only if a first read within an hour of 00:00 UTC holds this and the previous month's amount"; spec/settlement/vaultSnapshots.md, "A promise is shown only while the vault still covers what is owed, and Slop's pages refuse a withdrawal that would break it"
import { fromAmount, toAmount } from "@repo/settlement/kernels/amounts";
import { type Period, periodContaining, shiftPeriod } from "@repo/settlement/kernels/calendar";
import { type MonthStart, type PayingVault, promiseFor, withdrawalKeepsPromise } from "@repo/settlement/kernels/promise";
import type { AssetKind } from "./assetText.ts";

export interface FundingMonthStart {
  readonly period: Period;
  readonly freeBalance: bigint;
  readonly totalGrossWithdrawn: bigint;
  readonly blockTime: number;
}

export interface FundingVault {
  readonly network: string;
  readonly vault: string;
  readonly freeBalance: bigint | null;
  readonly totalGrossWithdrawn?: bigint;
  readonly monthStarts?: ReadonlyArray<FundingMonthStart>;
}

export interface Deployment {
  readonly network: string;
  readonly vault: string;
}

export interface FundedPool {
  readonly monthlyPool: boolean;
  readonly deployments: ReadonlyArray<Deployment>;
  readonly capFor: (period: Period) => bigint;
}

export type PoolFunding =
  | { readonly state: "Promised"; readonly period: Period; readonly owed: bigint }
  | { readonly state: "WithdrawnDuringMonth"; readonly period: Period }
  | { readonly state: "PointsOnly"; readonly period: Period };

export interface PoolCap {
  readonly monthlyPool: boolean;
  readonly monthlyCapMinor: bigint;
  readonly hasCycleCaps: boolean;
  readonly assetKind?: AssetKind;
}

export interface ZeroedPoolCap {
  readonly monthlyCapMinor: 0n;
  readonly monthlyCapDisplay: "0 TOKEN" | "$0";
}

const canonicalVault = (vault: string) => (vault.startsWith("0x") ? vault.toLowerCase() : vault);

const vaultKey = (network: string, vault: string) => `${network}\n${canonicalVault(vault)}`;

/** @throws {RangeError} */
function payingVault(vault: FundingVault, recorded: ReadonlySet<string>): PayingVault {
  const address = canonicalVault(vault.vault);
  return {
    network: vault.network,
    vault: address,
    pays: recorded.has(vaultKey(vault.network, address)),
    free: { present: vault.freeBalance !== null, amount: toAmount(vault.freeBalance ?? 0n) },
    withdrawn: toAmount(vault.totalGrossWithdrawn ?? 0n),
    starts: (vault.monthStarts ?? []).map((start): MonthStart => ({
      network: vault.network,
      vault: address,
      period: start.period,
      free: toAmount(start.freeBalance),
      withdrawn: toAmount(start.totalGrossWithdrawn),
      blockTime: start.blockTime,
    })),
  };
}

/** @throws {RangeError} */
export function poolFunding({ pool, vaults, networkPays, nowMs }: {
  pool: FundedPool;
  vaults: ReadonlyArray<FundingVault> | undefined;
  networkPays: (network: string) => boolean;
  nowMs: number;
}): PoolFunding {
  const nowSeconds = Math.floor(nowMs / 1000);
  const period = periodContaining(nowSeconds);
  if (!pool.monthlyPool || vaults === undefined) return { state: "PointsOnly", period };
  const recorded = new Set(pool.deployments.filter((deployment) => networkPays(deployment.network)).map((deployment) => vaultKey(deployment.network, deployment.vault)));
  const promise = promiseFor(
    vaults.map((vault) => payingVault(vault, recorded)),
    nowSeconds,
    toAmount(pool.capFor(period)),
    toAmount(pool.capFor(shiftPeriod(period, -1))),
  );
  switch (promise.state) {
    case "Promised":
      return { state: "Promised", period, owed: fromAmount(promise.owed) };
    case "WithdrawnDuringMonth":
      return { state: "WithdrawnDuringMonth", period };
    case "PointsOnly":
      return { state: "PointsOnly", period };
    default: {
      const _exhaustive: never = promise.state;
      return _exhaustive;
    }
  }
}

/** @throws {never} */
export function zeroedPoolCap({ monthlyPool, monthlyCapMinor, hasCycleCaps, assetKind }: PoolCap, funding: PoolFunding): ZeroedPoolCap | undefined {
  if (!monthlyPool || funding.state === "Promised" || (monthlyCapMinor === 0n && !hasCycleCaps)) return undefined;
  return { monthlyCapMinor: 0n, monthlyCapDisplay: assetKind !== undefined && assetKind !== "stablecoin" ? "0 TOKEN" : "$0" };
}

/** @throws {RangeError} */
export function withdrawalKeepsFunding({ funding, freeBalance, gross }: { funding: PoolFunding; freeBalance: bigint; gross: bigint }): boolean {
  const owed = funding.state === "Promised" ? funding.owed : 0n;
  return withdrawalKeepsPromise({ state: funding.state, period: funding.period, owed: toAmount(owed) }, toAmount(freeBalance), toAmount(gross));
}
