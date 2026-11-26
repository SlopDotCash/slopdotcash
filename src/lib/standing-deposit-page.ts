/**
 * The standing deposit page, `/deposit` (operator decision, 23 November
 * 2026; PRD section 5, "Standing deposit"). This file holds the page's pure
 * rules: the API paths and whether the record the API returned may be shown
 * and paid.
 *
 * The page offers a way to pay only when the record's contract is the
 * recorded standing deposit contract, its item is the hash of the signed-in
 * account and the record's round, the token is SLOP from the published table
 * and a kept deposit goes to the burn address. A record that does not match
 * is refused whole; the page never repairs it.
 */

import {
  STANDING_DEPOSIT_NETWORK,
  STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS,
  type StandingCoverState,
  standingCoverEndsAt,
  standingDepositItem,
} from "./standing-deposit.mjs";
import { SUBMISSION_FEE_SLOP_DECIMALS } from "./submission-fee.mjs";
import {
  type FeeItem,
  FeeRecordError,
  type FeeTables,
  type FeeWay,
  readFeeSettlement,
  savedFeeWay,
} from "./submission-fee-page";

export const STANDING_DEPOSIT_API = "/api/v1/standing-deposit";
export const STANDING_DEPOSIT_WITHDRAW_API =
  "/api/v1/standing-deposit/withdraw";
export const STANDING_DEPOSIT_PAGE = "/deposit";
/** The most covered pull requests the API lists, newest first. */
export const STANDING_DEPOSIT_COVER_LIMIT = 50;

export type StandingCover = {
  repository: string;
  pullNumber: number;
  state: StandingCoverState;
  open: boolean;
};

export type StandingDepositRow = Pick<
  FeeItem,
  "askedAt" | "paid" | "outcome" | "outcomeAt" | "resolveTransaction"
> & {
  round: number;
  item: string;
  /** SLOP base units asked. */
  amount: string;
  /** The one way to pay, or nothing once a deposit is recorded or the row is settled. */
  due: FeeWay[];
  withdrawRequestedAt: string | null;
  outcomeReason: "withdrawn" | "expired" | "strike" | null;
};

export type StandingDepositRecord = {
  /** False while the API reports no recorded contract: nothing can be paid. */
  deployed: boolean;
  /** SLOP base units a new deposit would be now, or null without a rate. */
  quote: string | null;
  deposit: StandingDepositRow | null;
  covers: StandingCover[];
};

/** The record did not match the published tables; nothing from it is used. */
export class StandingDepositRecordError extends FeeRecordError {
  constructor() {
    super(
      "The standing deposit record could not be checked against Slop's published addresses. Do not pay from this page.",
    );
  }
}

const AMOUNT = /^[1-9][0-9]{0,38}$/u;
const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u;
const WHOLE_SLOP = 10n ** BigInt(SUBMISSION_FEE_SLOP_DECIMALS);
const COVER_STATES: readonly string[] = ["watch", "pending", "clear", "strike"];
const REASONS: readonly string[] = ["withdrawn", "expired", "strike"];
const DAY_MS = 24 * 60 * 60 * 1000;

function instantOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw new FeeRecordError();
  return value;
}

function cover(value: unknown): StandingCover {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new FeeRecordError();
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.repository !== "string" ||
    !REPOSITORY.test(entry.repository) ||
    !Number.isSafeInteger(entry.pullNumber) ||
    (entry.pullNumber as number) < 1 ||
    typeof entry.state !== "string" ||
    !COVER_STATES.includes(entry.state) ||
    typeof entry.open !== "boolean"
  )
    throw new FeeRecordError();
  return {
    repository: entry.repository,
    pullNumber: entry.pullNumber as number,
    state: entry.state as StandingCoverState,
    open: entry.open,
  };
}

/**
 * Reads `GET /api/v1/standing-deposit` for the signed-in account
 * (`githubId`). `contract` is the recorded standing deposit contract and
 * `tables` name it on Robinhood Chain (`standingDepositSetup`). The item must
 * be the hash computed here for this account and the record's round, and the
 * one way to pay must be a whole number of SLOP into that contract, kept to
 * the burn address. Anything else throws; nothing is offered from it.
 */
export function readStandingDeposit(
  value: unknown,
  githubId: string,
  contract: string | null,
  tables: FeeTables,
): StandingDepositRecord {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new FeeRecordError();
    const body = value as Record<string, unknown>;
    if (
      body.schema !== "slop-standing-deposit-v1" ||
      typeof body.deployed !== "boolean" ||
      !Array.isArray(body.covers) ||
      body.covers.length > STANDING_DEPOSIT_COVER_LIMIT
    )
      throw new FeeRecordError();
    // This bundle and the API must name the same contract, or none.
    if (body.deployed) {
      if (
        contract === null ||
        typeof body.contract !== "string" ||
        body.contract.toLowerCase() !== contract.toLowerCase()
      )
        throw new FeeRecordError();
    } else if (body.contract !== null) throw new FeeRecordError();
    const quote = body.quote ?? null;
    if (quote !== null && (typeof quote !== "string" || !AMOUNT.test(quote)))
      throw new FeeRecordError();
    let deposit: StandingDepositRow | null = null;
    if (body.deposit !== null && body.deposit !== undefined) {
      if (typeof body.deposit !== "object" || Array.isArray(body.deposit))
        throw new FeeRecordError();
      const row = body.deposit as Record<string, unknown>;
      if (
        !Number.isSafeInteger(row.round) ||
        (row.round as number) < 1 ||
        typeof row.item !== "string" ||
        row.item.toLowerCase() !==
          standingDepositItem(githubId, row.round as number) ||
        typeof row.amount !== "string" ||
        !AMOUNT.test(row.amount) ||
        BigInt(row.amount) % WHOLE_SLOP !== 0n
      )
        throw new FeeRecordError();
      const unpaid =
        (row.paid === null || row.paid === undefined) && !row.outcome;
      // The record lists one amount; a deposit of less does not count. Every
      // address comes from the record and must equal the published tables.
      const due =
        unpaid && body.deployed
          ? [
              savedFeeWay(
                {
                  network: body.network,
                  chainId: body.chainId,
                  contract: body.contract,
                  token: body.token,
                  symbol: body.symbol,
                  decimals: body.decimals,
                  amount: row.amount,
                  minimumAccepted: row.amount,
                  keptTo: body.keptTo,
                },
                tables,
              ),
            ]
          : [];
      if (
        due.some(
          (way) =>
            way.network !== STANDING_DEPOSIT_NETWORK || way.kind !== "slop",
        )
      )
        throw new FeeRecordError();
      const settled = readFeeSettlement(row, due.length, tables);
      if (
        settled.paid &&
        (settled.paid.network !== STANDING_DEPOSIT_NETWORK ||
          settled.paid.kind !== "slop")
      )
        throw new FeeRecordError();
      const reason = row.outcomeReason ?? null;
      if (reason !== null && !REASONS.includes(reason as string))
        throw new FeeRecordError();
      const withdrawRequestedAt = instantOrNull(row.withdrawRequestedAt);
      if (withdrawRequestedAt !== null && !settled.paid)
        throw new FeeRecordError();
      deposit = {
        round: row.round as number,
        item: row.item.toLowerCase(),
        amount: row.amount,
        due,
        withdrawRequestedAt,
        outcomeReason: reason as StandingDepositRow["outcomeReason"],
        ...settled,
      };
    }
    return {
      deployed: body.deployed,
      quote,
      deposit,
      covers: body.covers.map(cover),
    };
  } catch (error) {
    if (error instanceof FeeRecordError) throw new StandingDepositRecordError();
    throw error;
  }
}

/**
 * Where a paid deposit with no outcome stands: covering new pull requests
 * until `coverEndsAt`, or no longer covering them (asked back, or past the
 * coverage period) and due back on `dueBackAt` unless a strike is pending.
 */
export function standingDepositPhase(
  row: StandingDepositRow,
  now: Date,
):
  | { phase: "covering"; coverEndsAt: Date }
  | { phase: "ending"; coverEndedAt: Date; dueBackAt: Date; asked: boolean }
  | null {
  if (!row.paid || row.outcome !== null) return null;
  const ends = standingCoverEndsAt({
    paidAt: row.paid.at,
    withdrawRequestedAt: row.withdrawRequestedAt,
    outcome: null,
  });
  if (ends === null) return null;
  if (row.withdrawRequestedAt === null && now.getTime() < ends.getTime())
    return { phase: "covering", coverEndsAt: ends };
  return {
    phase: "ending",
    coverEndedAt: ends,
    dueBackAt: new Date(
      ends.getTime() + STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS * DAY_MS,
    ),
    asked: row.withdrawRequestedAt !== null,
  };
}

/** One covered pull request's state, in plain words. */
export const STANDING_COVER_TEXT: Record<StandingCoverState, string> = {
  watch: "Covered",
  pending:
    "Closed with slop-keep-fee: the deposit is kept if both still stand 48 hours later",
  clear: "Can no longer cost the deposit",
  strike: "Cost the deposit",
};
