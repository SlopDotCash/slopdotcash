// spec/fees/submissionFeeStandingDeposits.md, "Coverage respects the cap, prior merge, withdrawal wait, and irreversible strikes"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { keepFeeLabel } from "../../gen/backend__submissionFeeTerms.ts";
import { coverReading, standingDepositStrikeGraceHours, standingDepositStrikeWindowDays } from "./standingRules.ts";

const now = Date.parse("2026-11-27T00:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const graceMs = standingDepositStrikeGraceHours * hourMs;
const windowMs = standingDepositStrikeWindowDays * dayMs;

const unreadable = Arbitrary.schema(Schema.String).pipe(Arbitrary.map((text) => `~${text}~`));

export const aCoverWithAnUnreadableWindowStartIsRecheckedDaily = contract({
  input: unreadable,
  run: (windowStart: string) =>
    coverReading({ window_start: windowStart, state: "pending", strike_seen_at: null }, { state: "open", merged: false, closed_at: null, labels: [] }, now),
  invariant: (_windowStart: string, reading) => reading.state === "watch" && reading.nextCheckAt === new Date(now + dayMs).toISOString(),
});

export const aCoverWithAnUnreadableStrikeTimeHealsAndStrikesAfterTheGrace = contract({
  input: unreadable,
  run: (strikeSeenAt: string) => {
    const pull = { state: "closed", merged: false, closed_at: "2026-11-25T00:00:00.000Z", labels: [{ name: keepFeeLabel }] };
    const first = coverReading({ window_start: "2026-11-20T00:00:00.000Z", state: "pending", strike_seen_at: strikeSeenAt }, pull, now);
    const afterGrace = coverReading({ window_start: "2026-11-20T00:00:00.000Z", state: first.state, strike_seen_at: first.strikeSeenAt }, pull, now + graceMs);
    return { first, afterGrace };
  },
  invariant: (_strikeSeenAt: string, { first, afterGrace }) =>
    first.state === "pending" &&
    first.strikeSeenAt === new Date(now).toISOString() &&
    first.nextCheckAt === new Date(now + graceMs).toISOString() &&
    afterGrace.state === "strike" &&
    afterGrace.nextCheckAt === null,
});

export const readableTimesSchedulePendingGraceAndClampedWatchWindow = contract({
  input: Schema.Tuple([
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: graceMs - 1 })),
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: windowMs })),
  ]),
  run: ([seenAgoMs, remainingWindowMs]) => {
    const seenMs = now - seenAgoMs;
    const seenIso = new Date(seenMs).toISOString();
    const pending = coverReading(
      { window_start: "2026-11-20T00:00:00.000Z", state: "pending", strike_seen_at: seenIso },
      { state: "closed", merged: false, closed_at: "2026-11-25T00:00:00.000Z", labels: [{ name: keepFeeLabel }] },
      now,
    );
    const windowEnds = now + remainingWindowMs;
    const watch = coverReading(
      { window_start: new Date(windowEnds - windowMs).toISOString(), state: "watch", strike_seen_at: null },
      { state: "open", merged: false, closed_at: null, labels: [] },
      now,
    );
    return { seenMs, seenIso, pending, windowEnds, watch };
  },
  invariant: (_input, { seenMs, seenIso, pending, windowEnds, watch }) =>
    pending.state === "pending" &&
    pending.strikeSeenAt === seenIso &&
    pending.nextCheckAt === new Date(seenMs + graceMs).toISOString() &&
    watch.state === "watch" &&
    watch.nextCheckAt === new Date(Math.max(now + 60_000, Math.min(now + dayMs, windowEnds + 60_000))).toISOString(),
});
