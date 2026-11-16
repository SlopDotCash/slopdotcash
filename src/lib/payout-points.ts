import { assertCycleIndex, type CycleIndex } from "./cycle-index";
import { type PointAward, pointKey } from "./points";

import { paidRecipientIndices } from "./verified-global-joins.ts";

const PAYOUT_POINTS = 25;
/** One award per recipient/project/cycle, independent of amount or transaction count. */
export function payoutPointAwards(index: CycleIndex): PointAward[] {
  assertCycleIndex(index);
  const sources = index.cycles.flatMap((cycle) => {
    const eligibleCycle =
      cycle.kind === "monthly-pool" &&
      cycle.state === "paid" &&
      !!cycle.settledAt &&
      !!cycle.files.settlement;
    return cycle.contributors.map((contributor) => ({
      cycle,
      contributor,
      candidate: {
        kind: cycle.kind,
        state: cycle.state,
        settledAt: cycle.settledAt ?? "",
        settlement: cycle.files.settlement?.url ?? "",
        contributorState: contributor.state,
        amount:
          eligibleCycle && contributor.state === "paid"
            ? BigInt(contributor.paidMinor)
            : 0n,
      },
    }));
  });
  return paidRecipientIndices(sources.map((source) => source.candidate)).map(
    (index) => {
      const { cycle, contributor: c, candidate } = sources[index];
      const sourceId = `payout:${cycle.cycleId}:${c.actor.id}`;
      return {
        key: pointKey(cycle.projectId, c.actor.id, "payout-received", sourceId),
        actor: c.actor,
        projectId: cycle.projectId,
        category: "payout-received" as const,
        amount: PAYOUT_POINTS,
        occurredAt: candidate.settledAt,
        sourceId,
        sourceUrl: `https://slop.cash/cycles/${cycle.projectId}/${cycle.cycleId}`,
        workUnitId: sourceId,
        provisional: false,
      };
    },
  );
}
