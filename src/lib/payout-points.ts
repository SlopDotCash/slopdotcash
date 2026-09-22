import { assertCycleIndex, type CycleIndex } from "./cycle-index";
import { type PointAward, pointKey } from "./points";

export const PAYOUT_POINTS = 25;
/** One award per recipient/project/cycle, independent of amount or transaction count. */
export function payoutPointAwards(index: CycleIndex): PointAward[] {
  assertCycleIndex(index);
  return index.cycles.flatMap((cycle) => {
    if (
      cycle.kind !== "monthly-pool" ||
      cycle.state !== "paid" ||
      !cycle.settledAt ||
      !cycle.files.settlement
    )
      return [];
    return cycle.contributors
      .filter((c) => c.state === "paid" && BigInt(c.paidMinor) > 0n)
      .map((c) => {
        const sourceId = `payout:${cycle.cycleId}:${c.actor.id}`;
        return {
          key: pointKey(
            cycle.projectId,
            c.actor.id,
            "payout-received",
            sourceId,
          ),
          actor: c.actor,
          projectId: cycle.projectId,
          category: "payout-received" as const,
          amount: PAYOUT_POINTS,
          occurredAt: cycle.settledAt!,
          sourceId,
          sourceUrl: `https://slop.cash/cycles/${cycle.projectId}/${cycle.cycleId}`,
          workUnitId: sourceId,
          provisional: false,
        };
      });
  });
}
