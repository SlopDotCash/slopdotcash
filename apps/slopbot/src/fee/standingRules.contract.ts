// spec/fees/submissionFeeStandingDeposits.md, "Coverage respects the cap, prior merge, withdrawal wait, and irreversible strikes"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { keepFeeLabel } from "../../gen/backend__submissionFeeTerms.ts";
import { coverReading, standingDepositStrikeGraceHours, type StandingPullSnapshot } from "./standingRules.ts";

const now = Date.parse("2026-11-27T00:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;

const unreadable = Arbitrary.schema(Schema.String).pipe(Arbitrary.map((text) => `~${text}~`));

export const aCoverWithAnUnreadableWindowStartIsRecheckedDaily = contract({
  input: unreadable,
  run: (windowStart: string) =>
    coverReading({ window_start: windowStart, state: "pending", strike_seen_at: null }, { state: "open", merged: false, closed_at: null, labels: [] }, now),
  invariant: (_windowStart: string, reading) => reading.state === "watch" && reading.nextCheckAt === new Date(now + dayMs).toISOString(),
});

export const aCoverWithReadableTimesKeepsItsScheduledNextCheck = contract({
  input: Arbitrary.Constant([
    {
      windowStart: "2026-11-20T00:00:00.000Z",
      strikeSeenAt: "2026-11-26T23:00:00.000Z",
      pull: { state: "closed", merged: false, closed_at: "2026-11-25T00:00:00.000Z", labels: [{ name: keepFeeLabel }] },
      expectedState: "pending",
      expectedNextCheckAt: "2026-11-28T23:00:00.000Z",
    },
    {
      windowStart: "2026-11-20T00:00:00.000Z",
      strikeSeenAt: "2026-11-25T00:00:01.000Z",
      pull: { state: "closed", merged: false, closed_at: "2026-11-25T00:00:00.000Z", labels: [{ name: keepFeeLabel }] },
      expectedState: "pending",
      expectedNextCheckAt: "2026-11-27T00:00:01.000Z",
    },
    {
      windowStart: "2026-11-20T00:00:00.000Z",
      strikeSeenAt: null,
      pull: { state: "open", merged: false, closed_at: null, labels: [] },
      expectedState: "watch",
      expectedNextCheckAt: "2026-11-28T00:00:00.000Z",
    },
    {
      windowStart: "2026-11-06T00:00:30.000Z",
      strikeSeenAt: null,
      pull: { state: "open", merged: false, closed_at: null, labels: [] },
      expectedState: "watch",
      expectedNextCheckAt: "2026-11-27T00:01:30.000Z",
    },
  ] as ReadonlyArray<{
    readonly windowStart: string;
    readonly strikeSeenAt: string | null;
    readonly pull: StandingPullSnapshot;
    readonly expectedState: "pending" | "watch";
    readonly expectedNextCheckAt: string;
  }>),
  run: (cases) => cases.map((entry) =>
    coverReading({ window_start: entry.windowStart, state: "pending", strike_seen_at: entry.strikeSeenAt }, entry.pull, now)),
  invariant: (cases, readings) =>
    cases.every((entry, index) => readings[index].state === entry.expectedState && readings[index].nextCheckAt === entry.expectedNextCheckAt),
});

export const aCoverWithAnUnreadableStrikeTimeIsRecheckedAfterTheGrace = contract({
  input: unreadable,
  run: (strikeSeenAt: string) =>
    coverReading(
      { window_start: "2026-11-20T00:00:00.000Z", state: "pending", strike_seen_at: strikeSeenAt },
      { state: "closed", merged: false, closed_at: "2026-11-25T00:00:00.000Z", labels: [{ name: keepFeeLabel }] },
      now,
    ),
  invariant: (_strikeSeenAt: string, reading) =>
    reading.state === "pending" &&
    reading.strikeSeenAt === new Date(now).toISOString() &&
    reading.nextCheckAt === new Date(now + standingDepositStrikeGraceHours * hourMs).toISOString(),
});
