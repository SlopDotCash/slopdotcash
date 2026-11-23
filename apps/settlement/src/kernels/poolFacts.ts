// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/settlement/monthPledges.md, "Pool funding serves a vault's open total, or none without pledge support, with its pledges above zero from the previous UTC month on and every one still open"
import type { Amount } from "../../gen/settlement__money.ts";
import { mainnet, mainnetExecution, reviewedActivation } from "../../gen/settlement__signer.ts";
import { toAmount } from "./amounts.ts";
import { FIRST_PERIOD, type Period, cutoffAt, periodContaining, periodStartSeconds, shiftPeriod } from "./calendar.ts";
import { NETWORKS, isNetworkKey } from "./networks.ts";

export type PoolRead = "PoolLoading" | "PoolCurrent" | "PoolStale" | "PoolFailed";

export interface PoolFacts {
  readonly read: PoolRead;
  readonly monthlyPool: boolean;
  readonly period: number;
  readonly amount: Amount;
  readonly priorAmount: Amount;
  readonly priorPending: boolean;
  readonly freeNow: Amount;
  readonly monthStartRead: boolean;
  readonly freeAtStart: Amount;
  readonly withdrawnSince: boolean;
  readonly pledgeSupport: boolean;
  readonly pledged: Amount;
}

export interface FactsMonthStart {
  readonly period: Period;
  readonly freeBalance: bigint;
  readonly totalGrossWithdrawn: bigint;
  readonly blockTime: number;
}

export interface FactsPledge {
  readonly period: Period;
  readonly amount: bigint;
  readonly open: boolean;
}

export interface FactsVault {
  readonly network: string;
  readonly vault: string;
  readonly freeBalance: bigint | null;
  readonly totalGrossWithdrawn?: bigint;
  readonly monthStarts?: ReadonlyArray<FactsMonthStart>;
  readonly openPledgedGross?: bigint | null;
  readonly pledges?: ReadonlyArray<FactsPledge>;
}

export interface FactsPool {
  readonly monthlyPool: boolean;
  readonly deployments: ReadonlyArray<{ readonly network: string; readonly vault: string }>;
  readonly capFor: (period: Period) => bigint;
}

const firstReadWindowSeconds = 60 * 60;

const canonicalVault = (vault: string) => (vault.startsWith("0x") ? vault.toLowerCase() : vault);

const vaultKey = (network: string, vault: string) => `${network}\n${canonicalVault(vault)}`;

const sum = (values: ReadonlyArray<bigint>) => values.reduce((total, value) => total + value, 0n);

const pledgeSupported = (vault: FactsVault) => vault.openPledgedGross !== undefined && vault.openPledgedGross !== null;

/** @throws {never} */
export function networkPays(network: string): boolean {
  if (!isNetworkKey(network)) return false;
  const service = NETWORKS[network].service;
  return !mainnet(service) || mainnetExecution(reviewedActivation, service);
}

/** @throws {RangeError} */
export function poolFacts({ pool, read, vaults, pays, nowSeconds }: {
  pool: FactsPool;
  read: PoolRead;
  vaults: ReadonlyArray<FactsVault>;
  pays: (network: string) => boolean;
  nowSeconds: number;
}): PoolFacts {
  const period = periodContaining(nowSeconds);
  const prior = shiftPeriod(period, -1);
  const recorded = new Set(pool.deployments.filter((deployment) => pays(deployment.network)).map((deployment) => vaultKey(deployment.network, deployment.vault)));
  const paying = vaults.filter((vault) => recorded.has(vaultKey(vault.network, vault.vault)));
  const pledging = paying.filter(pledgeSupported);
  const counted = paying.filter((vault) => vault.freeBalance !== null && !pledgeSupported(vault));
  const firstReads = counted.flatMap((vault) => {
    const first = vault.monthStarts?.find((start) => start.period === period && start.blockTime - periodStartSeconds(period) < firstReadWindowSeconds);
    return first === undefined ? [] : [{ first, withdrawnNow: vault.totalGrossWithdrawn }];
  });
  return {
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
    pledgeSupport: pledging.length > 0,
    pledged: toAmount(sum(pledging.flatMap((vault) => (vault.pledges ?? []).filter((pledge) => pledge.period === period).map((pledge) => pledge.amount)))),
  };
}
