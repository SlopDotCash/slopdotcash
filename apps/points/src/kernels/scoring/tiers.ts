//@ backend dafny
// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"; spec/points/allocation.md, "Source eligibility and fixed financial history are checked before any allocation is written"
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced in Dafny //@ ensures contract
import { sizePoints } from "../../../gen/points__allocation.ts";

export type ScoreTier = "micro" | "small" | "medium" | "large" | "xl" | "exceptional";
export type ValueTier = "none" | ScoreTier;
export type ReviewTier = "none" | "triage" | "standard" | "deep" | "specialist";

export const scoreTiers: ScoreTier[] = ["micro", "small", "medium", "large", "xl", "exceptional"];
/** @throws {never} */
//@ pure
export function scoreTierThirds(tier: ScoreTier): number {
  return tier === "micro" ? 1 : tier === "small" ? 3 : tier === "medium" ? 9 : tier === "large" ? 24 : tier === "xl" ? 45 : 75;
}

/** @throws {never} */
//@ pure
export function valueTierThirds(tier: ValueTier): number {
  return tier === "none" ? 0 : scoreTierThirds(tier);
}

/** @throws {never} */
//@ pure
export function reviewTierThirds(tier: ReviewTier): number {
  return tier === "none" ? 0 : tier === "triage" ? 1 : tier === "standard" ? 3 : tier === "deep" ? 9 : 24;
}

/** @throws {never} */
export function scoreTierBand(tier: ScoreTier): number {
  //@ ensures \result >= 0 && \result <= 5
  //@ ensures sizePoints(\result) === 10 * scoreTierThirds(tier)
  switch (tier) {
    case "micro":
      return 0;
    case "small":
      return 1;
    case "medium":
      return 2;
    case "large":
      return 3;
    case "xl":
      return 4;
    case "exceptional":
      return 5;
  }
}

/** @throws {never} */
export function valueTierBand(tier: ValueTier): number {
  //@ ensures \result >= 0 && \result <= 5
  //@ ensures sizePoints(\result) >= 10
  //@ ensures tier !== "none" ==> sizePoints(\result) === 10 * valueTierThirds(tier)
  if (tier === "none") return 0;
  return scoreTierBand(tier);
}

/** @throws {never} */
export function reviewTierPoints(tier: ReviewTier): number {
  //@ ensures \result === 10 * reviewTierThirds(tier)
  //@ ensures tier !== "none" ==> (\result === 10 || \result === 30 || \result === 90 || \result === 240)
  return 10 * reviewTierThirds(tier);
}
