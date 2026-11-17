import {
  MAINNET_EXECUTION,
  mainnetExecutionEnabled,
} from "../../workers/payment-executor/mainnet-execution.mjs";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import type { ProjectDefinition } from "./projects.mjs";
import { resolveRewardCapMinor } from "./reward-cap.mjs";

/**
 * Only money in a vault is shown (operator decision, 15 November 2026). A
 * monthly pool shows its amount when a recorded vault on a paying network
 * holds at least this month's amount; every other pool shows as points only.
 * The balances come from `GET /api/v1/pool-funding`, cached finalized vault
 * counters (PRD section 9). While they load, or when they cannot be read,
 * no amount is shown.
 *
 * From December 2026 a month is promised only if it was funded on the 1st:
 * the first finalized read of the month must hold this month's amount plus
 * last month's, which is paid out from the 4th. The amount stays shown only
 * while the vault still covers what is owed. If money was withdrawn during
 * the month and the vault no longer covers it, the page says so.
 *
 * A vault whose contract supports month pledges is judged by its pledges
 * instead (operator decision, 15 November 2026): the month is funded when the
 * owner pledged at least this month's amount on chain, summed over the
 * project's paying vaults with pledge support. The contract then keeps that
 * amount in the vault until the month is paid out. A vault without pledge
 * support keeps the rule above unchanged.
 */

export type MonthStart = {
  period: string;
  freeBalance: string;
  totalGrossWithdrawn: string;
  blockTime: string;
};

export type MonthPledge = { period: string; amount: string; open: boolean };

export type VaultFreeBalance = {
  network: string;
  vault: string;
  freeBalance: string | null;
  totalGrossWithdrawn?: string;
  blockTime: string;
  observedAt: string;
  monthStarts?: MonthStart[];
  /** Null or absent: the vault's contract has no month pledges. */
  openPledgedGross?: string | null;
  pledges?: MonthPledge[];
};

/** The first month judged by its funding on the 1st. */
export const FUNDED_ON_FIRST_FROM = "2026-12";
/** The first read of a month must come this soon after 00:00 UTC on the 1st. */
const FIRST_READ_WINDOW_MS = 60 * 60 * 1000;
/** Last month's allocation is reserved after this cutoff (72 hours). */
const PRIOR_MONTH_CUTOFF_MS = 72 * 60 * 60 * 1000;
/** The first month that pays; earlier months owe nothing. */
const FIRST_PAYING_PERIOD = "2026-11";

export type PoolFundingIndex = Map<string, VaultFreeBalance[]>;

const BASE_UNITS = /^(0|[1-9][0-9]*)$/u;

/** EVM addresses compare case-insensitively; Solana addresses exactly. */
function vaultKey(network: string, vault: string): string {
  return `${network}\n${vault.startsWith("0x") ? vault.toLowerCase() : vault}`;
}

function isMonthStart(value: unknown): value is MonthStart {
  const row = value as MonthStart;
  return (
    !!row &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row.period) &&
    BASE_UNITS.test(row.freeBalance) &&
    BASE_UNITS.test(row.totalGrossWithdrawn) &&
    !Number.isNaN(Date.parse(row.blockTime))
  );
}

function isMonthPledge(value: unknown): value is MonthPledge {
  const row = value as MonthPledge;
  return (
    !!row &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row.period) &&
    BASE_UNITS.test(row.amount) &&
    typeof row.open === "boolean"
  );
}

function isVault(value: unknown): value is VaultFreeBalance {
  const row = value as VaultFreeBalance;
  return (
    (row?.openPledgedGross === undefined ||
      row.openPledgedGross === null ||
      BASE_UNITS.test(row.openPledgedGross)) &&
    (row?.pledges === undefined ||
      (Array.isArray(row.pledges) && row.pledges.every(isMonthPledge))) &&
    (row?.totalGrossWithdrawn === undefined ||
      BASE_UNITS.test(row.totalGrossWithdrawn)) &&
    (row?.monthStarts === undefined ||
      (Array.isArray(row.monthStarts) &&
        row.monthStarts.every(isMonthStart))) &&
    !!row &&
    typeof row.network === "string" &&
    typeof row.vault === "string" &&
    (row.freeBalance === null ||
      (typeof row.freeBalance === "string" &&
        BASE_UNITS.test(row.freeBalance))) &&
    !Number.isNaN(Date.parse(row.blockTime)) &&
    !Number.isNaN(Date.parse(row.observedAt))
  );
}

export async function loadPoolFunding(
  signal: AbortSignal,
): Promise<{ index: PoolFundingIndex }> {
  const response = await fetchWithDeadline("/api/v1/pool-funding", {
    signal,
  });
  if (!response.ok) throw new Error("Pool funding unavailable");
  const value = (await readBoundedJson(
    response,
    1_048_576,
    "pool funding",
  )) as {
    schema?: unknown;
    projects?: Array<{ projectId?: unknown; vaults?: unknown }>;
  } | null;
  if (
    value?.schema !== "slop-pool-funding-v1" ||
    !Array.isArray(value.projects)
  )
    throw new Error("Pool funding could not be read");
  const index: PoolFundingIndex = new Map();
  for (const project of value.projects) {
    if (
      typeof project?.projectId !== "string" ||
      !Array.isArray(project.vaults) ||
      !project.vaults.every(isVault)
    )
      throw new Error("Pool funding could not be read");
    index.set(project.projectId, project.vaults);
  }
  return { index };
}

/** "December 2026" for "2026-12". */
export function monthName(period: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T00:00:00Z`));
}

export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** A test network is not on the mainnet switch; it always executes. */
function networkPays(network: string): boolean {
  return (
    !Object.hasOwn(MAINNET_EXECUTION, network) ||
    mainnetExecutionEnabled(network)
  );
}

function monthStartMs(period: string): number {
  return Date.parse(`${period}-01T00:00:00Z`);
}

function previousPeriod(period: string): string {
  const start = new Date(monthStartMs(period));
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

/** The vault's contract supports month pledges. */
export function hasPledgeSupport(vault: VaultFreeBalance): boolean {
  return typeof vault.openPledgedGross === "string";
}

export type PoolFundingStatus =
  /**
   * The vault holds what this month promises; `owedMinor` must stay in it.
   * `locked`: the owner pledged it on chain and the contract keeps it there.
   */
  | { state: "funded"; period: string; owedMinor: bigint; locked: boolean }
  /** Funded on the 1st, then money was withdrawn and it no longer covers it. */
  | { state: "withdrawn"; period: string }
  /** Not funded (no vault, short vault, not funded on the 1st, not loaded). */
  | { state: "points"; period: string };

/**
 * Whether this month's amount is backed by the project's own recorded vaults
 * on paying networks, in the vault asset's base units.
 */
export function poolFundingStatus(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): PoolFundingStatus {
  const period = utcMonth(now);
  const points = { state: "points", period } as const;
  if (project.reward.kind !== "monthly-pool" || index === null) return points;
  const cap = BigInt(resolveRewardCapMinor(project, period));
  if (cap === 0n) return points;
  const prior = previousPeriod(period);
  const priorCap =
    prior >= FIRST_PAYING_PERIOD
      ? BigInt(resolveRewardCapMinor(project, prior))
      : 0n;
  const recorded = new Set(
    (project.escrow?.deployments ?? [])
      .filter((deployment) => networkPays(deployment.network))
      .map((deployment) => vaultKey(deployment.network, deployment.vault)),
  );
  const paying = (index.get(project.id) ?? []).filter((vault) =>
    recorded.has(vaultKey(vault.network, vault.vault)),
  );
  // A vault with pledge support counts only what its owner pledged on chain.
  const pledging = paying.filter(hasPledgeSupport);
  const pledged = pledging.reduce(
    (sum, vault) =>
      sum +
      (vault.pledges ?? [])
        .filter((pledge) => pledge.period === period)
        .reduce((total, pledge) => total + BigInt(pledge.amount), 0n),
    0n,
  );
  if (pledging.length > 0 && pledged >= cap)
    return { state: "funded", period, owedMinor: pledged, locked: true };
  const vaults = paying.filter(
    (vault) => vault.freeBalance !== null && !hasPledgeSupport(vault),
  );
  // Last month's allocation still sits in free funds until it is reserved.
  const priorPending =
    now.getTime() < monthStartMs(period) + PRIOR_MONTH_CUTOFF_MS;
  const owedNow = cap + (priorPending ? priorCap : 0n);
  const freeNow = vaults.reduce(
    (sum, vault) => sum + BigInt(vault.freeBalance as string),
    0n,
  );
  const coversNow = freeNow >= owedNow;
  if (period < FUNDED_ON_FIRST_FROM)
    return coversNow
      ? { state: "funded", period, owedMinor: owedNow, locked: false }
      : points;
  let freeAtStart = 0n;
  let withdrawnSince = false;
  for (const vault of vaults) {
    const first = vault.monthStarts?.find(
      (start) =>
        start.period === period &&
        Date.parse(start.blockTime) - monthStartMs(period) <
          FIRST_READ_WINDOW_MS,
    );
    if (!first) continue;
    freeAtStart += BigInt(first.freeBalance);
    if (
      vault.totalGrossWithdrawn !== undefined &&
      BigInt(vault.totalGrossWithdrawn) > BigInt(first.totalGrossWithdrawn)
    )
      withdrawnSince = true;
  }
  if (freeAtStart < cap + priorCap) return points;
  if (coversNow)
    return { state: "funded", period, owedMinor: owedNow, locked: false };
  return withdrawnSince ? { state: "withdrawn", period } : points;
}

/** True when this month's amount is backed by the vault. */
export function poolFunded(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): boolean {
  return poolFundingStatus(project, index, now).state === "funded";
}

/**
 * The project as contributors should see it: an unfunded monthly pool reads
 * as points only everywhere the registry amount would otherwise appear.
 */
export function asShown(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): ProjectDefinition {
  if (project.reward.kind !== "monthly-pool") return project;
  if (poolFunded(project, index, now)) return project;
  if (project.reward.monthlyCapMinor === "0" && !project.reward.cycleCaps)
    return project;
  const { cycleCaps: _cycleCaps, ...reward } = project.reward;
  return {
    ...project,
    reward: {
      ...reward,
      monthlyCapMinor: "0",
      // A token pool's label swaps its last word for the token symbol.
      monthlyCapDisplay:
        project.rewardAsset && project.rewardAsset.kind !== "stablecoin"
          ? "0 TOKEN"
          : "$0",
    },
  } as ProjectDefinition;
}

/** The project page line for a pool that is not funded this month. */
export const NOT_LISTED_NOTICE =
  "This project's pool is not funded this month. Accepted work still records points.";

/**
 * Whether a project is listed this month (operator decision, 16 November
 * 2026). An active project whose monthly pool is not funded this month, by
 * `poolFunded`, is left out of /sponsors and agent discovery.
 * A project with an open security program and every other reward kind stay
 * listed, and paused projects keep their existing listing. Its page still
 * opens by direct link and its skills keep serving. A null index means the
 * funding could not be read, and every project is listed as before.
 */
export function listedThisMonth(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): boolean {
  if (index === null) return true;
  if (project.status !== "active") return true;
  if (project.reward.kind !== "monthly-pool") return true;
  if (project.securityBounty?.status === "open") return true;
  return poolFunded(project, index, now);
}
