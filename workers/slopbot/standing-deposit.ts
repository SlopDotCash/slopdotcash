// The standing deposit's scheduled check (operator decision, 23 November
// 2026; PRD section 5, "Standing deposit"). The gate in `submission-fee.ts`
// covers pull requests; this pass watches each cover and then decides what is
// due on each paid deposit, from the rules in `src/lib/standing-deposit.mjs`:
//   covers    each watched cover's pull request is read again: merged, closed,
//             closed_at and the `slop-keep-fee` label. A close and the label
//             inside the cover's window, still standing 48 hours after Slopbot
//             first saw both, is a strike. A strike is final and never read
//             again; a cover past its window without one is clear.
//   deposits  a strike makes the deposit `kept_due` (the first strike is
//             recorded); after a withdrawal request, or 340 days after
//             payment, and 21 days more, with every cover clear, it is
//             `refund_due`. The submission-fee Worker sends what is due.
// A read that fails decides nothing: the cover keeps its state and is read
// again on the next run. An outcome is written once.

import {
  STANDING_DEPOSIT_COVER_DAYS,
  STANDING_DEPOSIT_STRIKE_GRACE_HOURS,
  STANDING_DEPOSIT_STRIKE_WINDOW_DAYS,
  STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS,
  standingCoverState,
  standingDepositDue,
} from "../../src/lib/standing-deposit.mjs";
import { SUBMISSION_FEE_KEEP_LABEL } from "../../src/lib/submission-fee.mjs";
import { GitHubClient } from "./github";
import * as store from "./persistence";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
/** Covers read in one run; the rest wait for the next run. */
export const STANDING_COVER_BATCH = 25;
/** Deposits decided in one run. */
export const STANDING_DEPOSIT_BATCH = 200;

export type StandingEnv = {
  SLOPBOT_DB: store.D1Database<store.D1QueryStatement>;
  SLOPBOT_APP_ID: string;
  SLOPBOT_APP_PRIVATE_KEY: string;
};

type CoverRow = {
  repository_id: number;
  pull_number: number;
  installation_id: number;
  owner: string;
  repo: string;
  window_start: string;
  state: "watch" | "pending" | "clear" | "strike";
  strike_seen_at: string | null;
};

type Pull = {
  number?: number;
  state?: string;
  merged?: boolean;
  closed_at?: string | null;
  labels?: { name: string }[];
};

/**
 * What one successful read of a cover's pull request means: its state, the
 * time Slopbot first saw it closed and labelled, whether it is open, and when
 * to read it again. Pure.
 */
export function coverReading(
  cover: Pick<CoverRow, "window_start" | "state" | "strike_seen_at">,
  pull: Pull,
  now: Date,
): {
  state: CoverRow["state"];
  prOpen: 0 | 1;
  strikeSeenAt: string | null;
  nextCheckAt: string | null;
} {
  const time = now.getTime();
  const merged = pull.merged === true;
  const open = pull.state === "open" && !merged;
  const closed = !open && !merged;
  const keepMarked = (pull.labels ?? []).some(
    (label) => label.name === SUBMISSION_FEE_KEEP_LABEL,
  );
  const windowEnds =
    Date.parse(cover.window_start) +
    STANDING_DEPOSIT_STRIKE_WINDOW_DAYS * DAY_MS;
  const closedAt = Date.parse(pull.closed_at ?? "");
  const marked =
    closed &&
    keepMarked &&
    Number.isFinite(closedAt) &&
    Number.isFinite(windowEnds) &&
    closedAt <= windowEnds;
  // Kept while the close and the label stand; set when first seen; cleared
  // when either goes away, so a later mark starts the grace period again.
  const strikeSeenAt = marked
    ? (cover.strike_seen_at ?? now.toISOString())
    : null;
  const prOpen = open ? 1 : 0;
  // A clear cover stays clear; only whether it is open is read again, so a
  // closed one stops counting toward the open-cover cap.
  if (cover.state === "clear")
    return {
      state: "clear",
      prOpen,
      strikeSeenAt: cover.strike_seen_at,
      nextCheckAt: open ? new Date(time + DAY_MS).toISOString() : null,
    };
  const state = standingCoverState(
    {
      windowStart: cover.window_start,
      merged,
      closed,
      closedAt: pull.closed_at ?? null,
      keepMarked,
      strikeSeenAt,
    },
    now,
  ) as CoverRow["state"];
  let nextCheckAt: string | null = null;
  if (state === "pending" && strikeSeenAt !== null)
    nextCheckAt = new Date(
      Date.parse(strikeSeenAt) + STANDING_DEPOSIT_STRIKE_GRACE_HOURS * HOUR_MS,
    ).toISOString();
  else if (state === "watch")
    // Daily, and once just after the window ends, so a cover that passed its
    // window is read to clear without waiting another day.
    nextCheckAt = new Date(
      Math.max(time + 60_000, Math.min(time + DAY_MS, windowEnds + 60_000)),
    ).toISOString();
  else if (state === "clear" && open)
    nextCheckAt = new Date(time + DAY_MS).toISOString();
  return { state, prOpen, strikeSeenAt, nextCheckAt };
}

async function readCovers(env: StandingEnv, now: Date) {
  const db = env.SLOPBOT_DB;
  const at = now.toISOString();
  // A strike is final and never read again. A clear cover is read only while
  // its pull request is open. Covers of a decided deposit no longer matter.
  // Least recently read first, so a cover whose read keeps failing does not
  // hold the others back.
  const due = await db
    .prepare(
      `SELECT c.repository_id, c.pull_number, c.installation_id, c.owner, c.repo,
              c.window_start, c.state, c.strike_seen_at
       FROM standing_deposit_covers c
       JOIN standing_deposits d ON d.id = c.deposit_id
       WHERE d.outcome IS NULL
         AND (c.state IN ('watch', 'pending') OR (c.state = 'clear' AND c.pr_open = 1))
         AND (c.next_check_at IS NULL OR c.next_check_at <= ?1)
       ORDER BY c.updated_at LIMIT ?2`,
    )
    .bind(at, STANDING_COVER_BATCH)
    .all<CoverRow>();
  const clients = new Map<number, GitHubClient | null>();
  let read = 0;
  for (const cover of due.results) {
    let client = clients.get(cover.installation_id);
    if (client === undefined) {
      client = null;
      try {
        if (await store.installationActive(db, cover.installation_id))
          client = await GitHubClient.forInstallation(
            env.SLOPBOT_APP_ID,
            env.SLOPBOT_APP_PRIVATE_KEY,
            cover.installation_id,
          );
      } catch {
        client = null;
      }
      clients.set(cover.installation_id, client);
    }
    let pull: Pull | null = null;
    if (client !== null)
      try {
        const answer = await client.request<Pull>(
          "GET",
          `/repos/${cover.owner}/${cover.repo}/pulls/${cover.pull_number}`,
        );
        pull =
          answer.status === 200 &&
          answer.data !== null &&
          answer.data.number === cover.pull_number &&
          typeof answer.data.state === "string"
            ? answer.data
            : null;
      } catch {
        pull = null;
      }
    if (pull === null) {
      // Decide nothing: keep the state and the due time, and move to the back
      // of the queue so the other covers are read.
      await db
        .prepare(
          "UPDATE standing_deposit_covers SET updated_at = ? WHERE repository_id = ? AND pull_number = ?",
        )
        .bind(at, cover.repository_id, cover.pull_number)
        .run();
      continue;
    }
    const reading = coverReading(cover, pull, now);
    await db
      .prepare(
        `UPDATE standing_deposit_covers
         SET state = ?, pr_open = ?, strike_seen_at = ?, next_check_at = ?, updated_at = ?
         WHERE repository_id = ? AND pull_number = ? AND state = ?`,
      )
      .bind(
        reading.state,
        reading.prOpen,
        reading.strikeSeenAt,
        reading.nextCheckAt,
        at,
        cover.repository_id,
        cover.pull_number,
        cover.state,
      )
      .run();
    read += 1;
  }
  return read;
}

type DepositRow = {
  id: string;
  paid_at: string;
  withdraw_requested_at: string | null;
  outcome: string | null;
};

async function decideDeposits(env: StandingEnv, now: Date) {
  const db = env.SLOPBOT_DB;
  const at = now.toISOString();
  // Select only deposits that can actually be decided now so healthy active
  // deposits (which stay open up to 340+21 days) never fill the batch and
  // starve newer withdrawals, expiries or strikes. A 1-second margin keeps
  // SQLite's julianday() rounding from ever excluding an exact boundary;
  // `standingDepositDue` below remains the exact millisecond authority.
  const withdrawCutoff = new Date(
    now.getTime() - STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS * DAY_MS + 1_000,
  ).toISOString();
  const expiredCutoff = new Date(
    now.getTime() -
      (STANDING_DEPOSIT_COVER_DAYS + STANDING_DEPOSIT_WITHDRAW_WAIT_DAYS) *
        DAY_MS +
      1_000,
  ).toISOString();
  const deposits = await db
    .prepare(
      `SELECT d.id, d.paid_at, d.withdraw_requested_at, d.outcome
       FROM standing_deposits d
       WHERE d.paid_at IS NOT NULL AND d.outcome IS NULL AND d.cancelled_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM standing_deposit_covers c
             WHERE c.deposit_id = d.id AND c.state = 'strike'
           )
           OR (
             (
               (d.withdraw_requested_at IS NOT NULL AND julianday(d.withdraw_requested_at) <= julianday(?1))
               OR julianday(d.paid_at) <= julianday(?2)
             )
             AND NOT EXISTS (
               SELECT 1 FROM standing_deposit_covers c
               WHERE c.deposit_id = d.id AND c.state <> 'clear'
             )
           )
         )
       ORDER BY d.paid_at, d.id LIMIT ?3`,
    )
    .bind(withdrawCutoff, expiredCutoff, STANDING_DEPOSIT_BATCH)
    .all<DepositRow>();
  let decided = 0;
  for (const deposit of deposits.results) {
    const covers = await db
      .prepare(
        `SELECT repository_id, pull_number, state, strike_seen_at FROM standing_deposit_covers
         WHERE deposit_id = ? ORDER BY strike_seen_at IS NULL, strike_seen_at, covered_at`,
      )
      .bind(deposit.id)
      .all<{
        repository_id: number;
        pull_number: number;
        state: CoverRow["state"];
        strike_seen_at: string | null;
      }>();
    const due = standingDepositDue(
      {
        paidAt: deposit.paid_at,
        withdrawRequestedAt: deposit.withdraw_requested_at,
        outcome: deposit.outcome,
      },
      covers.results.map((cover) => cover.state),
      now,
    );
    if (due === null) continue;
    let reason: "strike" | "withdrawn" | "expired";
    let strike: { repository_id: number; pull_number: number } | null = null;
    if (due === "kept_due") {
      reason = "strike";
      strike = covers.results.find((cover) => cover.state === "strike") ?? null;
      if (strike === null) continue;
    } else {
      const asked = Date.parse(deposit.withdraw_requested_at ?? "");
      const limit =
        Date.parse(deposit.paid_at) + STANDING_DEPOSIT_COVER_DAYS * DAY_MS;
      reason =
        Number.isFinite(asked) && asked <= limit ? "withdrawn" : "expired";
    }
    const written = await db
      .prepare(
        `UPDATE standing_deposits
         SET outcome = ?, outcome_reason = ?, outcome_at = ?, strike_repository_id = ?, strike_pull_number = ?
         WHERE id = ? AND paid_at IS NOT NULL AND outcome IS NULL AND cancelled_at IS NULL`,
      )
      .bind(
        due,
        reason,
        at,
        strike?.repository_id ?? null,
        strike?.pull_number ?? null,
        deposit.id,
      )
      .run();
    if ((written.meta?.changes ?? 0) === 1) decided += 1;
  }
  return decided;
}

/**
 * Scheduled: read the covers that are due, then decide every paid deposit
 * with no outcome. Covers are read first, so a deposit is decided on this
 * run's readings. Runs whatever `SUBMISSION_FEE_MODE` is: a deposit already
 * paid is still sent back or kept by its rules.
 */
export async function checkStandingDeposits(
  env: StandingEnv,
  now: Date = new Date(),
): Promise<{ read: number; decided: number }> {
  const read = await readCovers(env, now);
  const decided = await decideDeposits(env, now);
  return { read, decided };
}
