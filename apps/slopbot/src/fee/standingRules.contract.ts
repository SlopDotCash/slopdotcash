// spec/fees/submissionFeeStandingDeposits.md, "Coverage respects the cap, prior merge, withdrawal wait, and irreversible strikes"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { keepFeeLabel } from "../../gen/backend__submissionFeeTerms.ts";
import { coverReading, standingDepositStrikeGraceHours } from "./standingRules.ts";

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

export const aCoverWithAnUnreadableStrikeTimeIsRecheckedAfterTheGrace = contract({
  input: unreadable,
  run: (strikeSeenAt: string) =>
    coverReading(
      { window_start: "2026-11-20T00:00:00.000Z", state: "pending", strike_seen_at: strikeSeenAt },
      { state: "closed", merged: false, closed_at: "2026-11-25T00:00:00.000Z", labels: [{ name: keepFeeLabel }] },
      now,
    ),
  invariant: (_strikeSeenAt: string, reading) =>
    reading.state === "pending" && reading.nextCheckAt === new Date(now + standingDepositStrikeGraceHours * hourMs).toISOString(),
});
