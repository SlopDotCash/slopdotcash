// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { pointsOf } from "@repo/points/client";
import type { CycleContributorState, CycleIndexEntry, CycleState } from "@repo/settlement/client";
import { cycleLabel } from "../projects/index.ts";

const contributorStates: Readonly<Record<CycleContributorState, string>> = {
  proposed: "Under review",
  approved: "Approved",
  excluded: "Excluded",
  "external-share": "External prize share",
  unclaimed: "Awaiting wallet",
  held: "Held",
  "held-below-minimum": "Held below the payment minimum",
  paid: "Paid",
};

/** A contributor's recorded cycle row in award and payment words. @throws {never} */
export function contributorStateLabel(state: CycleContributorState): string {
  return contributorStates[state];
}

/** A recorded cycle state in award and payment words. @throws {never} */
export function cycleStateLabel(state: CycleState): string {
  return cycleLabel({ state, approvedAt: null, reviewEndsAt: null }, 0);
}

/** A closed review window waits on owner approval; the record keeps its `review` state. @throws {never} */
export function awaitingApproval(cycle: Pick<CycleIndexEntry, "approvedAt" | "reviewEndsAt" | "state">, nowMs: number): boolean {
  return cycle.state === "review" && cycle.approvedAt === null && cycle.reviewEndsAt !== null && Date.parse(cycle.reviewEndsAt) <= nowMs;
}

/** The cycle's state, or "Under review, awaiting approval" once its review window has closed. @throws {never} */
export function cycleLifecycleLabel(cycle: Pick<CycleIndexEntry, "approvedAt" | "reviewEndsAt" | "state">, nowMs: number): string {
  return cycleLabel(cycle, nowMs);
}

/** Recorded score thirds as whole displayed Points. @throws {never} */
export function pointsText(thirds: number): string {
  return pointsOf(thirds).toLocaleString("en-US");
}

/** Parts per million as a percentage with two decimals. @throws {never} */
export function percentText(partsPerMillion: number | bigint): string {
  return `${(Number(partsPerMillion) / 10_000).toFixed(2)}%`;
}
