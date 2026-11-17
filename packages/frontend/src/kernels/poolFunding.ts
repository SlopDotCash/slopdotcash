// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "Slop's pages refuse a withdrawal below the promised amount"; spec/settlement/vaultSnapshots.md, "The first finalized read of each UTC month is recorded once per vault and never changes"
import { fromAmount, toAmount } from "@repo/settlement/kernels/amounts";
import { cutoffAt, FIRST_PERIOD, type Period, periodContaining, periodStartSeconds, shiftPeriod } from "@repo/settlement/kernels/calendar";
import { owedNow, type PoolDisplay, type PoolFacts, type PoolRead, poolDisplay, withdrawalAllowedOnSlopPages } from "../../gen/frontend__projections.ts";
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

export interface PoolFunding {
  readonly period: Period;
  readonly facts: PoolFacts;
  readonly display: PoolDisplay;
}

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

const firstReadWindowSeconds = 60 * 60;

const canonicalVault = (vault: string) => (vault.startsWith("0x") ? vault.toLowerCase() : vault);

const vaultKey = (network: string, vault: string) => `${network}\n${canonicalVault(vault)}`;

const sum = (values: ReadonlyArray<bigint>) => values.reduce((total, value) => total + value, 0n);

/** @throws {RangeError} */
export function poolFunding({ pool, read, vaults, networkPays, nowMs }: {
  pool: FundedPool;
  read: PoolRead;
  vaults: ReadonlyArray<FundingVault>;
  networkPays: (network: string) => boolean;
  nowMs: number;
}): PoolFunding {
  const nowSeconds = Math.floor(nowMs / 1000);
  const period = periodContaining(nowSeconds);
  const prior = shiftPeriod(period, -1);
  const recorded = new Set(pool.deployments.filter((deployment) => networkPays(deployment.network)).map((deployment) => vaultKey(deployment.network, deployment.vault)));
  const counted = vaults.filter((vault) => vault.freeBalance !== null && recorded.has(vaultKey(vault.network, vault.vault)));
  const firstReads = counted.flatMap((vault) => {
    const first = vault.monthStarts?.find((start) => start.period === period && start.blockTime - periodStartSeconds(period) < firstReadWindowSeconds);
    return first === undefined ? [] : [{ first, withdrawnNow: vault.totalGrossWithdrawn }];
  });
  const facts: PoolFacts = {
    read,
    monthlyPool: pool.monthlyPool,
    period,
    amount: toAmount(pool.capFor(period)),
    priorAmount: toAmount(prior >= FIRST_PERIOD ? pool.capFor(prior) : 0n),
    priorPending: nowSeconds < cutoffAt(prior),
    freeNow: toAmount(sum(counted.map((vault) => vault.freeBalance ?? 0n))),
    monthStartRead: firstReads.length > 0,
    freeAtStart: toAmount(sum(firstReads.map(({ first }) => first.freeBalance))),
    withdrawnSince: firstReads.some(({ first, withdrawnNow }) => withdrawnNow !== undefined && withdrawnNow > first.totalGrossWithdrawn),
  };
  return { period, facts, display: poolDisplay(facts) };
}

/** @throws {never} */
export function promisedOwed(funding: PoolFunding): bigint | undefined {
  return funding.display === "PoolFunded" ? fromAmount(owedNow(funding.facts)) : undefined;
}

/** @throws {never} */
export function zeroedPoolCap({ monthlyPool, monthlyCapMinor, hasCycleCaps, assetKind }: PoolCap, funding: PoolFunding): ZeroedPoolCap | undefined {
  if (!monthlyPool || funding.display === "PoolFunded" || (monthlyCapMinor === 0n && !hasCycleCaps)) return undefined;
  return { monthlyCapMinor: 0n, monthlyCapDisplay: assetKind !== undefined && assetKind !== "stablecoin" ? "0 TOKEN" : "$0" };
}

/** @throws {RangeError} */
export function withdrawalKeepsFunding({ funding, gross }: { funding: PoolFunding; gross: bigint }): boolean {
  return withdrawalAllowedOnSlopPages(funding.facts, toAmount(gross));
}
