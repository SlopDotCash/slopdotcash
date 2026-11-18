import { assertCycleIndex, type CycleIndex } from "./cycle-index";
import { ESCROW_NETWORKS } from "./escrow-policy.mjs";
import { githubUserIdFromNodeId } from "./github-actor";
import type { ActorRef } from "./leaderboard-types";
import {
  isPublicVaultPayment,
  type PublicVaultPayment,
} from "./payments/contracts";
import { type PointAward, pointKey } from "./points";

import { paidRecipientIndices } from "./verified-global-joins.ts";

const PAYOUT_POINTS = 25;
export interface ActorVaultPayments {
  actor: ActorRef;
  payments: PublicVaultPayment[];
}
/** One award per recipient/project/cycle, independent of amount or transaction count. */
export function payoutPointAwards(
  index: CycleIndex,
  vaults: readonly ActorVaultPayments[] = [],
  existing: readonly PointAward[] = [],
): PointAward[] {
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
  const awards = paidRecipientIndices(
    sources.map((source) => source.candidate),
  ).map((index) => {
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
  });
  for (const { actor, payments } of vaults) {
    if (!githubUserIdFromNodeId(actor.id))
      throw new Error("Payout actor identity is unavailable");
    for (const payment of [...payments].sort(
      (a, b) =>
        a.indexedAt.localeCompare(b.indexedAt) || a.id.localeCompare(b.id),
    )) {
      if (!isPublicVaultPayment(payment))
        throw new Error("Invalid public payout evidence");
      const network =
        ESCROW_NETWORKS[payment.network as keyof typeof ESCROW_NETWORKS];
      if (
        !network ||
        network.testnet ||
        !payment.contributionMonth ||
        BigInt(payment.netBase) <= 0n
      )
        continue;
      const sourceId = `payout:${payment.contributionMonth}:${actor.id}`;
      awards.push({
        key: pointKey(payment.projectId, actor.id, "payout-received", sourceId),
        actor,
        projectId: payment.projectId,
        category: "payout-received",
        amount: PAYOUT_POINTS,
        // This is when finalized evidence was indexed, not a claimed block time.
        occurredAt: payment.indexedAt,
        sourceId,
        sourceUrl: `https://slop.cash/cycles/${payment.projectId}/${payment.contributionMonth}`,
        workUnitId: sourceId,
        provisional: false,
      });
    }
  }
  const scope = (award: PointAward) =>
    `${award.projectId}\0${award.sourceId.split(":")[1]}\0${githubUserIdFromNodeId(award.actor.id) ?? award.actor.id}`;
  // Keep every prior recognition revision, including exclusions and original
  // dates. Different networks or GitHub node-ID spellings cannot reissue it.
  const recognized = new Set(
    existing.filter((a) => a.category === "payout-received").map(scope),
  );
  return awards.filter((award) => {
    const key = scope(award);
    if (recognized.has(key)) return false;
    recognized.add(key);
    return true;
  });
}
