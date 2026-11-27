// spec/slopbot/submissionFeeGate.md, "Only a live fee with a published contract asks, and only a new outside pull request of a project with the setting on"; spec/slopbot/submissionFeeGate.md, "An ask that stops applying is taken back and its unpaid item removed"
import { keepFeeLabel } from "../../gen/backend__submissionFeeTerms.ts";

export const standingDepositStrikeWindowDays = 21;
export const standingDepositStrikeGraceHours = 48;
export const standingDepositWithdrawWaitDays = 21;
export const standingDepositOpenCap = 10;
export const standingDepositCoverDays = 340;
export const standingDepositCoveredLabel = "slopbot:deposit-covered";
export const standingCoverBatch = 25;
export const standingDepositBatch = 200;
export const standingCoverReason = "standing-deposit";
export const standingMergedCacheMs = 24 * 60 * 60 * 1000;

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const maxDateMs = 8_640_000_000_000_000;

function isValidDateMs(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= maxDateMs;
}

export type StandingCoverState = "watch" | "pending" | "clear" | "strike";
export type StandingDepositOutcome = "kept_due" | "refund_due";

export interface StandingDepositFacts {
  readonly paidAt: string | null;
  readonly withdrawRequestedAt: string | null;
  readonly outcome: string | null;
  readonly cancelledAt?: string | null;
}

export interface StandingCoverFacts {
  readonly deposit: StandingDepositFacts | null;
  readonly accepted: boolean;
  readonly mergedOnProject: boolean;
  readonly openCovered: number;
  readonly openedAt: string;
}

export interface StandingCoverStatusFacts {
  readonly windowStart: string;
  readonly merged: boolean;
  readonly closed: boolean;
  readonly closedAt: string | null;
  readonly keepMarked: boolean;
  readonly strikeSeenAt: string | null;
}

export interface StandingPullSnapshot {
  readonly state: string;
  readonly merged?: boolean;
  readonly closed_at?: string | null;
  readonly labels?: ReadonlyArray<{ readonly name: string }>;
}

export interface CoverReadingResult {
  readonly state: StandingCoverState;
  readonly prOpen: 0 | 1;
  readonly strikeSeenAt: string | null;
  readonly nextCheckAt: string | null;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

/** @throws {never} */
export function standingDepositsAccepted(manifest: unknown): boolean {
  const submissionFee = recordOf(recordOf(recordOf(manifest)?.slopbot)?.submissionFee);
  return submissionFee?.standingDeposits !== false;
}

/** @throws {never} */
export function standingCoverEndsAt(deposit: Pick<StandingDepositFacts, "paidAt" | "withdrawRequestedAt"> | null): number | null {
  const paid = Date.parse(deposit?.paidAt ?? "");
  if (!Number.isFinite(paid)) return null;
  const limit = paid + standingDepositCoverDays * dayMs;
  const asked = Date.parse(deposit?.withdrawRequestedAt ?? "");
  return Number.isFinite(asked) ? Math.min(asked, limit) : limit;
}

/** @throws {never} */
export function standingDepositCovers(facts: StandingCoverFacts): boolean {
  const { deposit, accepted, mergedOnProject, openCovered, openedAt } = facts;
  if (!accepted || !mergedOnProject) return false;
  if (deposit === null || deposit.outcome !== null || Boolean(deposit.cancelledAt)) return false;
  const ends = standingCoverEndsAt(deposit);
  const opened = Date.parse(openedAt);
  if (ends === null || !Number.isFinite(opened)) return false;
  if (opened >= ends) return false;
  return Number.isSafeInteger(openCovered) && openCovered < standingDepositOpenCap;
}

/** @throws {never} */
export function standingCoverState(facts: StandingCoverStatusFacts, nowMillis: number): StandingCoverState {
  const start = Date.parse(facts.windowStart);
  if (facts.merged) return "clear";
  if (!Number.isFinite(start)) return "watch";
  const windowEnds = start + standingDepositStrikeWindowDays * dayMs;
  const closedAt = Date.parse(facts.closedAt ?? "");
  const closedInWindow = facts.closed && Number.isFinite(closedAt) && closedAt <= windowEnds;
  if (closedInWindow && facts.keepMarked) {
    const seen = Date.parse(facts.strikeSeenAt ?? "");
    if (Number.isFinite(seen) && nowMillis >= seen + standingDepositStrikeGraceHours * hourMs) return "strike";
    return "pending";
  }
  return nowMillis > windowEnds ? "clear" : "watch";
}

/** @throws {never} */
export function standingDepositDue(
  deposit: StandingDepositFacts | null,
  coverStates: ReadonlyArray<StandingCoverState>,
  nowMillis: number,
): StandingDepositOutcome | null {
  if (deposit === null || deposit.outcome !== null || deposit.paidAt === null) return null;
  if (coverStates.includes("strike")) return "kept_due";
  const ends = standingCoverEndsAt(deposit);
  if (ends === null) return null;
  if (nowMillis < ends + standingDepositWithdrawWaitDays * dayMs) return null;
  if (coverStates.some((state) => state !== "clear")) return null;
  return "refund_due";
}

/** @throws {never} */
export function coverReading(
  cover: { readonly window_start: string; readonly state: StandingCoverState; readonly strike_seen_at: string | null },
  pull: StandingPullSnapshot,
  nowMillis: number,
): CoverReadingResult {
  const merged = pull.merged === true;
  const open = pull.state === "open" && !merged;
  const closed = !open && !merged;
  const keepMarked = (pull.labels ?? []).some((label) => label.name === keepFeeLabel);
  const windowEnds = Date.parse(cover.window_start) + standingDepositStrikeWindowDays * dayMs;
  const closedAt = Date.parse(pull.closed_at ?? "");
  const marked = closed && keepMarked && Number.isFinite(closedAt) && Number.isFinite(windowEnds) && closedAt <= windowEnds;
  const graceMs = standingDepositStrikeGraceHours * hourMs;
  const storedStrikeMs = cover.strike_seen_at === null ? Number.NaN : Date.parse(cover.strike_seen_at);
  const validStoredStrike = isValidDateMs(storedStrikeMs) && isValidDateMs(storedStrikeMs + graceMs);
  const strikeSeenAt = marked ? (validStoredStrike ? cover.strike_seen_at : new Date(nowMillis).toISOString()) : null;
  const strikeSeenMs = marked ? (validStoredStrike ? storedStrikeMs : nowMillis) : Number.NaN;
  const prOpen: 0 | 1 = open ? 1 : 0;
  if (cover.state === "clear") {
    return {
      state: "clear",
      prOpen,
      strikeSeenAt: cover.strike_seen_at,
      nextCheckAt: open ? new Date(nowMillis + dayMs).toISOString() : null,
    };
  }
  const state = standingCoverState(
    {
      windowStart: cover.window_start,
      merged,
      closed,
      closedAt: pull.closed_at ?? null,
      keepMarked,
      strikeSeenAt,
    },
    nowMillis,
  );
  let nextCheckAt: string | null = null;
  if (state === "pending" && strikeSeenAt !== null) {
    nextCheckAt = new Date(strikeSeenMs + graceMs).toISOString();
  } else if (state === "watch") {
    nextCheckAt = new Date(
      Number.isFinite(windowEnds)
        ? Math.max(nowMillis + 60_000, Math.min(nowMillis + dayMs, windowEnds + 60_000))
        : nowMillis + dayMs,
    ).toISOString();
  } else if (state === "clear" && open) {
    nextCheckAt = new Date(nowMillis + dayMs).toISOString();
  }
  return { state, prOpen, strikeSeenAt, nextCheckAt };
}

/** @throws {never} */
export function standingRefundReason(paidAt: string, withdrawRequestedAt: string | null): "withdrawn" | "expired" {
  const asked = Date.parse(withdrawRequestedAt ?? "");
  const limit = Date.parse(paidAt) + standingDepositCoverDays * dayMs;
  return Number.isFinite(asked) && asked <= limit ? "withdrawn" : "expired";
}
