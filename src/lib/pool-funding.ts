import {
  MAINNET_EXECUTION,
  mainnetExecutionEnabled,
} from "../../workers/payment-executor/mainnet-execution.mjs";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { monthlyAmountDisplay } from "./project-schema.mjs";
import type { ProjectDefinition } from "./projects.mjs";
import { resolveRewardCapMinor } from "./reward-cap.mjs";

/**
 * A vault-backed amount requires verified funding. A
 * monthly pool shows its amount when a recorded vault on a paying network
 * holds at least this month's amount; every other pool shows as points only.
 * The balances come from `GET /api/v1/pool-funding`, cached finalized vault
 * counters (PRD section 9). While they load, or when they cannot be read,
 * no vault-backed amount is shown. Explicit honor-system promises use a
 * separate presentation and do not change this funding check.
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

function payingVaultKeys(project: ProjectDefinition): Set<string> {
  return new Set(
    (project.escrow?.deployments ?? [])
      .filter((deployment) => networkPays(deployment.network))
      .map((deployment) => vaultKey(deployment.network, deployment.vault)),
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
export function hasPledgeSupport(vault: {
  openPledgedGross?: string | null;
}): boolean {
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
  const recorded = payingVaultKeys(project);
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

/**
 * How many whole months of this month's amount the free funds of the
 * project's recorded vaults on paying networks cover (operator decision,
 * 18 November 2026). Anyone may deposit, but only the owner sets the monthly
 * amount, so extra money covers more months. A vault with pledge support is
 * omitted: only a pledge funds its month, and its free balance does not.
 * Null when the project has no monthly amount this month or no such vault
 * has a free balance on record. It is a reading of today's balance, not a
 * promise: the owner can withdraw free funds.
 */
export function monthsCovered(
  project: ProjectDefinition,
  vaults:
    | readonly Pick<
        VaultFreeBalance,
        "network" | "vault" | "freeBalance" | "openPledgedGross"
      >[]
    | undefined,
  now: Date,
): number | null {
  if (project.reward.kind !== "monthly-pool") return null;
  const cap = BigInt(resolveRewardCapMinor(project, utcMonth(now)));
  if (cap === 0n) return null;
  const recorded = payingVaultKeys(project);
  const read = (vaults ?? []).filter(
    (vault) =>
      vault.freeBalance !== null &&
      BASE_UNITS.test(vault.freeBalance) &&
      recorded.has(vaultKey(vault.network, vault.vault)),
  );
  if (read.length === 0) return null;
  // Pledge-support vaults fund a month only from pledges. Their free balance
  // stays withdrawable and does not extend this runway (PRD section 6).
  const free = read.reduce(
    (sum, vault) =>
      sum +
      (hasPledgeSupport(vault) ? 0n : BigInt(vault.freeBalance as string)),
    0n,
  );
  const months = free / cap;
  return months > 1200n ? 1200 : Number(months);
}

/** "Covers 3 months", "Covers 1 month", or that a month is not covered. */
export function monthsCoveredLabel(months: number): string {
  if (months === 0) return "Covers less than one month";
  return `Covers ${months} ${months === 1 ? "month" : "months"}`;
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
 * The vault-backed amount for this month. An unfunded pool reads as Points
 * only in contexts that show verified funding exclusively.
 */
export function asShown(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): ProjectDefinition {
  if (project.reward.kind !== "monthly-pool") return project;
  const amount = poolFunded(project, index, now)
    ? resolveRewardCapMinor(project, utcMonth(now))
    : "0";
  return withDisplayedCap(project, amount);
}

function withDisplayedCap(
  project: ProjectDefinition,
  amount: string,
): ProjectDefinition {
  if (project.reward.monthlyCapMinor === amount && !project.reward.cycleCaps)
    return project;
  const { cycleCaps: _cycleCaps, ...reward } = project.reward;
  return {
    ...project,
    reward: {
      ...reward,
      monthlyCapMinor: amount,
      monthlyCapDisplay: monthlyAmountDisplay(amount, project.rewardAsset),
    },
  };
}

export function publicPoolReward(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): { project: ProjectDefinition; promise: string | null } {
  const display = displayedPoolReward(project, index, now, false);
  return {
    project: display.project,
    promise: display.warning ? `Promised · ${display.warning}` : null,
  };
}

type PoolRewardDisplay = {
  project: ProjectDefinition;
  fundingTag: "Vaulted" | "Promised" | "Configured" | null;
  warning: "Vault funding unverified" | "Not vaulted" | null;
};

export function listingPoolReward(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): PoolRewardDisplay {
  return displayedPoolReward(project, index, now, true);
}

function displayedPoolReward(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
  showConfigured: boolean,
): PoolRewardDisplay {
  const shown = asShown(project, index, now);
  if (project.reward.kind !== "monthly-pool")
    return { project: shown, fundingTag: null, warning: null };
  if (shown.reward.monthlyCapMinor !== "0")
    return { project: shown, fundingTag: "Vaulted", warning: null };
  const optedIn = project.reward.honorSystem === true;
  const amount =
    showConfigured || optedIn
      ? resolveRewardCapMinor(project, utcMonth(now))
      : "0";
  if (amount === "0")
    return { project: shown, fundingTag: null, warning: null };
  const unread = payingVaultKeys(project);
  for (const vault of index?.get(project.id) ?? []) {
    if (vault.freeBalance !== null || hasPledgeSupport(vault)) {
      unread.delete(vaultKey(vault.network, vault.vault));
    }
  }
  return {
    project: withDisplayedCap(project, amount),
    fundingTag: optedIn ? "Promised" : "Configured",
    warning: unread.size ? "Vault funding unverified" : "Not vaulted",
  };
}

/** The registry determines discovery eligibility. Vault reads only label the amount. */
export function listedThisMonth(
  project: ProjectDefinition,
  now: Date,
): boolean {
  return (
    project.reward.kind !== "monthly-pool" ||
    project.securityBounty?.status === "open" ||
    resolveRewardCapMinor(project, utcMonth(now)) !== "0"
  );
}
