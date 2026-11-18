// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { pointsOf } from "@repo/points/client";
import type { CycleContributorState, CycleIndexEntry, CycleState } from "@repo/settlement/client";
import type { StatusProps } from "@repo/ui";

type Lifecycle = Pick<CycleIndexEntry, "approvedAt" | "reviewEndsAt" | "state">;

const cycleStates: Readonly<Record<CycleState, string>> = {
  "closed-no-awards": "Closed, no awards",
  "external-provisional": "Provisional",
  review: "Under review",
  "payment-ready": "Approved",
  "settlement-planned": "Payment ready",
  paid: "Paid",
  "wound-up": "Held",
};

const contributorStates: Readonly<Record<CycleContributorState, string>> = {
  proposed: "Under review",
  approved: "Approved",
  excluded: "Excluded",
  "external-share": "External prize share",
  unclaimed: "Awaiting wallet",
  held: "Held",
  "held-below-minimum": "Held · below min",
  paid: "Paid",
};

/** A contributor's recorded cycle row in award and payment words. @throws {never} */
export function contributorStateLabel(state: CycleContributorState): string {
  return contributorStates[state];
}

/** A recorded cycle state in award and payment words. @throws {never} */
export function cycleStateLabel(state: CycleState): string {
  return cycleStates[state];
}

/** A closed review window waits on owner approval; the record keeps its `review` state. @throws {never} */
export function awaitingApproval(cycle: Lifecycle, nowMs: number): boolean {
  return cycle.state === "review" && cycle.approvedAt === null && cycle.reviewEndsAt !== null && Date.parse(cycle.reviewEndsAt) <= nowMs;
}

/** The cycle's state, or "Awaiting approval" once its review window has closed. @throws {never} */
export function cycleLifecycleLabel(cycle: Lifecycle, nowMs: number): string {
  return awaitingApproval(cycle, nowMs) ? "Awaiting approval" : cycleStates[cycle.state];
}

/** The cycle's lifecycle as a chip: paid is positive, held or awaiting approval cautions, closed without awards is neutral. @throws {never} */
export function cycleLifecyclePresentation(cycle: Lifecycle, nowMs: number): StatusProps["presentation"] {
  const label = cycleLifecycleLabel(cycle, nowMs);
  if (cycle.state === "paid") return { tone: "Positive", icon: "Check", label };
  if (cycle.state === "wound-up" || awaitingApproval(cycle, nowMs)) return { tone: "Caution", icon: "Clock", label };
  if (cycle.state === "closed-no-awards") return { tone: "Neutral", icon: "Slash", label };
  return { tone: "Notice", icon: "Dot", label };
}

/** Recorded score thirds as whole displayed Points. @throws {never} */
export function pointsText(thirds: number): string {
  return pointsOf(thirds).toLocaleString("en-US");
}

/** Parts per million as a percentage with two decimals. @throws {never} */
export function percentText(partsPerMillion: number | bigint): string {
  return `${(Number(partsPerMillion) / 10_000).toFixed(2)}%`;
}
