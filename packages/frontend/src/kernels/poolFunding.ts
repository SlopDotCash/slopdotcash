// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "Slop's pages refuse a withdrawal below the promised amount"; spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"; spec/settlement/monthPledges.md, "Pool funding serves a vault's open total, or none without pledge support, with its pledges above zero from the previous UTC month on and every one still open"; spec/settlement/vaultSnapshots.md, "The first finalized read of each UTC month is recorded once per vault and never changes"
import { fromAmount, toAmount } from "@repo/settlement/kernels/amounts";
import { formatPeriod, type Period, periodContaining } from "@repo/settlement/kernels/calendar";
import { type FactsMonthStart, type FactsPledge, type FactsVault, poolFacts } from "@repo/settlement/kernels/poolFacts";
import { lockedByPledges, owedNow, type PoolDisplay, type PoolFacts, type PoolRead, poolDisplay } from "../../gen/frontend__projections.ts";
import type { VaultLocks } from "../../gen/frontend__vaultLocks.ts";
import { type AssetKind, monthlyPoolUnfunded } from "./assetText.ts";

export type FundingMonthStart = FactsMonthStart;

export type FundingPledge = FactsPledge;

export type FundingVault = FactsVault;

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

/** @throws {RangeError} */
export function poolFunding({ pool, read, vaults, networkPays, nowMs }: {
  pool: FundedPool;
  read: PoolRead;
  vaults: ReadonlyArray<FundingVault>;
  networkPays: (network: string) => boolean;
  nowMs: number;
}): PoolFunding {
  const nowSeconds = Math.floor(nowMs / 1000);
  const facts: PoolFacts = poolFacts({ pool, read, vaults, pays: networkPays, nowSeconds });
  return { period: periodContaining(nowSeconds), facts, display: poolDisplay(facts) };
}

/** @throws {never} */
export function promisedOwed(funding: PoolFunding): bigint | undefined {
  return funding.display === "PoolFunded" && !lockedByPledges(funding.facts) ? fromAmount(owedNow(funding.facts)) : undefined;
}

/** @throws {never} */
export function zeroedPoolCap({ monthlyPool, monthlyCapMinor, hasCycleCaps, assetKind }: PoolCap, funding: PoolFunding): ZeroedPoolCap | undefined {
  if (!monthlyPool || funding.display === "PoolFunded" || (monthlyCapMinor === 0n && !hasCycleCaps)) return undefined;
  return { monthlyCapMinor: 0n, monthlyCapDisplay: assetKind !== undefined && assetKind !== "stablecoin" ? "0 TOKEN" : "$0" };
}

const canonicalVault = (vault: string) => (vault.startsWith("0x") ? vault.toLowerCase() : vault);
const vaultKey = (network: string, vault: string) => `${network}\n${canonicalVault(vault)}`;

/** @throws {never} */
export function payingVaultFreeMinor(
  deployments: ReadonlyArray<Deployment>,
  vaults: ReadonlyArray<FundingVault> | undefined,
  networkPays: (network: string) => boolean,
): bigint | undefined {
  if (vaults === undefined) return undefined;
  const recorded = new Set(deployments.filter((deployment) => networkPays(deployment.network)).map((deployment) => vaultKey(deployment.network, deployment.vault)));
  const read = vaults.filter((vault) => vault.freeBalance !== null && recorded.has(vaultKey(vault.network, vault.vault)));
  if (read.length === 0) return undefined;
  return read.reduce((sum, vault) => sum + (vault.freeBalance ?? 0n), 0n);
}

/** @throws {never} */
export function cyclePoolFunding({
  cycleId,
  fundingState,
  committedMinor,
  funding,
  deployments,
  vaults,
  networkPays,
}: {
  readonly cycleId: string;
  readonly fundingState: "committed" | "pledged";
  readonly committedMinor?: bigint;
  readonly funding?: PoolFunding;
  readonly deployments: ReadonlyArray<Deployment>;
  readonly vaults?: ReadonlyArray<FundingVault>;
  readonly networkPays?: (network: string) => boolean;
}): { readonly funded: boolean; readonly fundedMinor: bigint } {
  const committed = committedMinor ?? 0n;
  if (funding === undefined || cycleId !== formatPeriod(funding.period)) {
    return { funded: !monthlyPoolUnfunded({ fundingState, committedMinor: committed }), fundedMinor: committed };
  }
  const funded = funding.display === "PoolFunded";
  if (funded && lockedByPledges(funding.facts)) {
    return { funded: true, fundedMinor: fromAmount(owedNow(funding.facts)) };
  }
  const free = networkPays === undefined ? undefined : payingVaultFreeMinor(deployments, vaults, networkPays);
  return { funded, fundedMinor: free ?? committed };
}

export const unreadLocks: VaultLocks = { cachedSupport: false, walletRead: false, freeKnown: false, free: toAmount(0n), locked: toAmount(0n) };

