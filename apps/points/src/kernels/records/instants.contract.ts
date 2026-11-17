// spec/points/periods.md, "An instant is a UTC month and day, and a period is the month of occurrence"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { dayStartOf, instantOf } from "./instants.ts";

const Millis = Schema.Int.check(Schema.isBetween({ minimum: -62167219200000, maximum: 253402300799999 }));

const isoAt = (millis: number) => new Date(millis).toISOString();
const utcInstant = (millis: number) => {
  const at = new Date(millis);
  return (at.getUTCFullYear() * 12 + at.getUTCMonth()) * 100 + at.getUTCDate() - 1;
};
const dayMillis = 86400000;
const utcDayStart = (millis: number) => isoAt(Math.floor(millis / dayMillis) * dayMillis);

export const aTimestampIsItsUtcDay = contract({ input: Millis, run: (millis: number) => instantOf(isoAt(millis)), invariant: (millis, instant) => instant === utcInstant(millis) });

export const aDayStartReadsBackAsItsDay = contract({
  input: Millis,
  run: (millis: number) => dayStartOf(utcInstant(millis)),
  invariant: (millis, text) => instantOf(text) === utcInstant(millis) && text === utcDayStart(millis),
});

export const instantsKeepTimestampOrder = contract({
  input: Schema.Tuple([Millis, Millis]),
  run: ([first, second]: readonly [number, number]) => [instantOf(isoAt(first)), instantOf(isoAt(second))] as const,
  invariant: ([first, second], [early, late]) => first > second || (early !== null && late !== null && early <= late),
});

export const onlyCanonicalTimestampsAreInstants = contract({ input: Schema.String, run: instantOf, invariant: (text, instant) => instant === null || new Date(text).toISOString() === text });
