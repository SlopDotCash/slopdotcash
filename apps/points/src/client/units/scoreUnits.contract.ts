// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { MAX_POINTS, POINTS_PER_THIRD, pointsOfThirdsText, thirdsText } from "./scoreUnits.ts";

const Points = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_POINTS }));

export const thirdsTextCarriesItsPoints = contract({ input: Points, run: thirdsText, deterministic: true, inverse: (text: string) => pointsOfThirdsText(text) ?? -1 });

const ExactlyRepresentedPoints = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1407374883553280 }));

export const legacyThirdsNumbersConvertExactly = contract({
  input: ExactlyRepresentedPoints,
  run: (points: number) => pointsOfThirdsText(String(points / POINTS_PER_THIRD)),
  invariant: (points, converted) => converted === points,
});

export const onlyCanonicalThirdsTextIsAccepted = contract({
  input: Schema.String,
  run: pointsOfThirdsText,
  invariant: (text, points) => points === null || thirdsText(points) === text,
});
