/**
 * Private monthly allocations (PRD sections 6 and 7). A closed UTC month gets
 * one proposed allocation from the complete ledger. The owner may change any
 * amount privately until the month is frozen; the frozen execution snapshot is
 * the only input to award reservation. No public reason or adjustment history
 * exists. Amounts are integer base units of the project asset.
 */
import { isBaseUnits } from "../escrow-policy.mjs";
import { sha256Hex } from "../sha256";
import { sumAmounts } from "../verified-allocation";
import { monthlyCutoffSeconds, monthStartDay } from "../verified-calendar";
import { freezeMonthlyAmounts } from "../verified-money";
import {
  type MonthlyAllocation,
  type MonthlyBaseRow,
  monthlyChangePolicy,
  replaceMonthlyAllocations,
} from "../verified-monthly-replacement";

export type {
  MonthlyAllocation,
  MonthlyBaseRow,
} from "../verified-monthly-replacement";

const PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const ACTOR = /^[1-9][0-9]{0,19}$/;

export interface MonthlySchedule {
  /** The first closed month that the automatic process may distribute. */
  firstPeriod: string;
  /** Seconds after the month closes (00:00 UTC on the next 1st) at which the automatic process freezes it. */
  cutoffSecondsAfterPeriodEnd: number;
}

/**
 * The recorded monthly period model (PRD section 6 and section 11, Monthly
 * period model): calendar UTC months from 2026-11, cut off 72 hours after the
 * month ends. Public pages read it to describe a month's owner-change window;
 * the automatic process still reads only `MONTHLY_PAYMENT_SCHEDULE`, and a
 * unit test keeps the two equal.
 */
export const PRD_MONTHLY_SCHEDULE: Readonly<MonthlySchedule> = Object.freeze({
  firstPeriod: "2026-11",
  cutoffSecondsAfterPeriodEnd: 72 * 60 * 60,
});

/**
 * Reads `MONTHLY_PAYMENT_SCHEDULE`. Owner decision D1 sets it in the Pages
 * `[vars]`; nothing defaults in code: an unset value returns null and the
 * automatic process stays off. A malformed value throws.
 */
export function parseMonthlySchedule(value: unknown): MonthlySchedule | null {
  if (value === undefined || value === null || value === "") return null;
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : undefined;
  } catch {
    parsed = undefined;
  }
  const schedule = parsed as Partial<MonthlySchedule> | undefined;
  if (
    !schedule ||
    typeof schedule !== "object" ||
    Object.keys(schedule).sort().join() !==
      "cutoffSecondsAfterPeriodEnd,firstPeriod" ||
    typeof schedule.firstPeriod !== "string" ||
    !PERIOD.test(schedule.firstPeriod) ||
    !Number.isSafeInteger(schedule.cutoffSecondsAfterPeriodEnd) ||
    (schedule.cutoffSecondsAfterPeriodEnd as number) <= 0
  )
    throw new Error(
      'MONTHLY_PAYMENT_SCHEDULE must be {"firstPeriod":"YYYY-MM","cutoffSecondsAfterPeriodEnd":<positive integer>}',
    );
  return schedule as MonthlySchedule;
}

export function assertPeriod(period: string): string {
  if (!PERIOD.test(period)) throw new Error("Period must be YYYY-MM");
  return period;
}

/** 00:00 UTC on the first day of the following month. */
export function periodEnd(period: string): Date {
  const [year, month] = assertPeriod(period).split("-").map(Number);
  return new Date(monthlyCutoffSeconds(year, month, 0) * 1000);
}

/** The UTC calendar month (YYYY-MM) that contains `date`. */
export function utcPeriodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The UTC calendar month `delta` months from a YYYY-MM period. Callers validate the period. */
export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  return utcPeriodOf(new Date(Date.UTC(year, month - 1 + delta, 1)));
}

/** A YYYY-MM period as [from, to) UTC milliseconds. Callers validate the period. */
export function periodBounds(period: string): { from: number; to: number } {
  const [year, month] = period.split("-").map(Number);
  return {
    from: monthStartDay(year, month) * 86_400_000,
    to: monthlyCutoffSeconds(year, month, 0) * 1000,
  };
}

/** The automatic cutoff of a month, or null when the month is outside the schedule. */
export function monthlyCutoff(
  schedule: MonthlySchedule,
  period: string,
): Date | null {
  if (assertPeriod(period) < schedule.firstPeriod) return null;
  const [year, month] = period.split("-").map(Number);
  return new Date(
    monthlyCutoffSeconds(year, month, schedule.cutoffSecondsAfterPeriodEnd) *
      1000,
  );
}

export interface MonthlyBase {
  projectId: string;
  period: string;
  manifestSha256: string;
  sourceSnapshotSha256: string;
  capBase: string;
  rows: MonthlyBaseRow[];
}

export interface MonthlyAllocationChange {
  sequence: number;
  githubUserId: string;
  grossBase: string;
}

/** Applies the private changes in sequence order; the newest change per recipient wins. */
export function currentAllocations(
  rows: readonly MonthlyBaseRow[],
  changes: readonly MonthlyAllocationChange[],
): MonthlyAllocation[] {
  const initial: MonthlyAllocation[] = [];
  const indices = new Map<string, number>();
  for (const row of rows) {
    const index = indices.get(row.githubUserId);
    const allocation = { ...row, proposedGrossBase: row.grossBase };
    if (index === undefined) {
      indices.set(row.githubUserId, initial.length);
      initial.push(allocation);
    } else initial[index] = allocation;
  }
  const result = replaceMonthlyAllocations(
    initial,
    [...changes]
      .sort((a, b) => a.sequence - b.sequence)
      .map((change) => ({
        index: indices.get(change.githubUserId) ?? -1,
        grossBase: change.grossBase,
      })),
  );
  if (result.unknownAt >= 0)
    throw new Error("Allocation change names an unknown recipient");
  return result.rows.sort((a, b) =>
    a.githubUserId.localeCompare(b.githubUserId),
  );
}

export class MonthlyAllocationError extends Error {}

/**
 * Checks one private change. The month's total may never exceed its cap, so
 * an unallocated amount never rolls over into a larger later month. A person
 * cannot change their own allocation, and a person with an explicit payout
 * exclusion for the month cannot receive an amount (PRD section 7).
 */
export function assertAllocationChange(
  allocations: readonly MonthlyAllocation[],
  capBase: string,
  change: { githubUserId: string; grossBase: string; actorId: string },
  excludedGithubUserIds: ReadonlySet<string> = new Set(),
): void {
  if (!ACTOR.test(change.githubUserId) || !isBaseUnits(change.grossBase))
    throw new MonthlyAllocationError(
      "Enter a whole number of token base units.",
    );
  const amount = BigInt(change.grossBase);
  const policy = monthlyChangePolicy(
    change.githubUserId,
    change.actorId,
    amount,
    change.githubUserId !== change.actorId &&
      amount > 0n &&
      excludedGithubUserIds.has(change.githubUserId),
  );
  if (policy === 1)
    throw new MonthlyAllocationError("You cannot change your own allocation.");
  if (policy === 2)
    throw new MonthlyAllocationError(
      "This person has a payout exclusion for this month.",
    );
  const replacements = allocations.flatMap((row, index) =>
    row.githubUserId === change.githubUserId
      ? [{ index, grossBase: change.grossBase }]
      : [],
  );
  if (replacements.length === 0)
    throw new MonthlyAllocationError(
      "This person has no allocation this month.",
    );
  const total = sumAmounts(
    replaceMonthlyAllocations(allocations, replacements).rows.map((row) =>
      BigInt(row.grossBase),
    ),
  );
  if (total > BigInt(capBase))
    throw new MonthlyAllocationError(
      "The month's allocations would exceed its monthly amount.",
    );
}

export interface MonthlyExecutionAward {
  githubUserId: string;
  login: string;
  grossBase: string;
  feeBase: string;
  netBase: string;
  sourceDigest: string;
}
export interface MonthlyExecutionSnapshot {
  schemaVersion: "1";
  kind: "monthly-execution-snapshot";
  projectId: string;
  period: string;
  trigger: "owner" | "automatic";
  baseManifestSha256: string;
  manifestSha256: string;
  sourceSnapshotSha256: string;
  allocationSequence: number;
  network: string;
  vault: string;
  asset: string;
  capBase: string;
  totalGrossBase: string;
  frozenAt: string;
  awards: MonthlyExecutionAward[];
}

/** The frozen allocation. Zero rows are left out; the 2% fee is ceil(gross / 50). */
export function buildExecutionSnapshot(input: {
  base: Omit<MonthlyBase, "rows">;
  allocations: readonly MonthlyAllocation[];
  allocationSequence: number;
  trigger: "owner" | "automatic";
  manifestSha256: string;
  network: string;
  vault: string;
  asset: string;
  frozenAt: string;
  /** Rebuild a month frozen before fees rounded up, whose rows hold floor(gross / 50). */
  legacyFloorFee?: boolean;
}): { snapshot: MonthlyExecutionSnapshot; text: string; sha256: string } {
  if (input.allocations.some((row) => !isBaseUnits(row.grossBase)))
    throw new MonthlyAllocationError(
      "Each allocation must be integer base units.",
    );
  const frozen = freezeMonthlyAmounts(
    input.allocations.map((row) => ({
      githubUserId: row.githubUserId,
      login: row.login,
      gross: BigInt(row.grossBase),
      sourceDigest: row.sourceDigest,
    })),
    input.legacyFloorFee ?? false,
  );
  const awards: MonthlyExecutionAward[] = frozen.awards.map((row) => ({
    githubUserId: row.githubUserId,
    login: row.login,
    grossBase: row.gross.toString(),
    feeBase: row.fee.toString(),
    netBase: row.net.toString(),
    sourceDigest: row.sourceDigest,
  }));
  const total = frozen.total;
  if (total > BigInt(input.base.capBase))
    throw new MonthlyAllocationError(
      "The month's allocations exceed its monthly amount.",
    );
  const snapshot: MonthlyExecutionSnapshot = {
    schemaVersion: "1",
    kind: "monthly-execution-snapshot",
    projectId: input.base.projectId,
    period: input.base.period,
    trigger: input.trigger,
    baseManifestSha256: input.base.manifestSha256,
    manifestSha256: input.manifestSha256,
    sourceSnapshotSha256: input.base.sourceSnapshotSha256,
    allocationSequence: input.allocationSequence,
    network: input.network,
    vault: input.vault,
    asset: input.asset,
    capBase: input.base.capBase,
    totalGrossBase: total.toString(),
    frozenAt: input.frozenAt,
    awards,
  };
  const text = JSON.stringify(snapshot);
  return { snapshot, text, sha256: sha256Hex(text) };
}
