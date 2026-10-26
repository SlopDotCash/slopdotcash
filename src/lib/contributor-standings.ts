/** One display projection for points and finalized principal. */

import { githubUserIdFromNodeId } from "./github-actor";
import type { ActorRef } from "./leaderboard-types";
import type { DirectTransfer } from "./payments/contracts";
import type { PointsMember } from "./points";
import type { DataState } from "./use-snapshot";

export function contributorStandings(
  state: DataState,
  members: readonly PointsMember[] | null,
  month: string | null,
  projectId: string,
  directTransfers: readonly DirectTransfer[] | null = null,
) {
  // An unavailable source is not an empty history or a complete Paid total.
  const moneyAvailable = state.status === "ready" && directTransfers !== null;
  const currentActors = new Map(
    (members ?? []).map((member) => [member.actor.id, member.actor]),
  );
  if (state.status === "ready") {
    for (const leader of state.snapshot.leaders) {
      currentActors.set(leader.actor.id, leader.actor);
    }
  }
  const rows = new Map<
    string,
    {
      actor: ActorRef;
      points: number | null;
      money: bigint | null;
    }
  >();
  const row = (actor: ActorRef) => {
    let value = rows.get(actor.id);
    if (!value) {
      value = {
        actor: currentActors.get(actor.id) ?? actor,
        points: members ? 0 : null,
        money: moneyAvailable ? 0n : null,
      };
      rows.set(actor.id, value);
    }
    return value;
  };
  if (state.status === "ready") {
    const cycles = state.cycleIndex.cycles.filter(
      (c) => !projectId || c.projectId === projectId,
    );
    // Payment occurrence follows finalized settlement time, not the work month.
    for (const cycle of cycles) {
      if (month && !cycle.settledAt?.startsWith(month)) continue;
      for (const contributor of cycle.contributors) {
        if (BigInt(contributor.paidMinor) > 0n) {
          const recipient = row(contributor.actor);
          if (!moneyAvailable) continue;
          recipient.money =
            (recipient.money ?? 0n) + BigInt(contributor.paidMinor);
        }
      }
    }
  }
  if (state.status === "ready" && directTransfers !== null) {
    // Direct transfers name numeric GitHub IDs; rows may carry node IDs.
    const byNumericId = new Map<string, ActorRef>();
    for (const actor of [
      ...currentActors.values(),
      ...[...rows.values()].map((value) => value.actor),
    ]) {
      const numeric = /^[1-9]\d*$/u.test(actor.id)
        ? actor.id
        : githubUserIdFromNodeId(actor.id);
      if (numeric) byNumericId.set(numeric, actor);
    }
    for (const transfer of directTransfers) {
      if (projectId && transfer.projectId !== projectId) continue;
      if (month && !transfer.blockTime.startsWith(month)) continue;
      const recipient = row(
        byNumericId.get(transfer.githubUserId) ?? {
          id: transfer.githubUserId,
          login: transfer.login,
        },
      );
      recipient.money = (recipient.money ?? 0n) + BigInt(transfer.amountMicro);
    }
  }
  for (const member of members ?? []) {
    const value = row(member.actor);
    value.points = month ? member.monthly : member.total;
  }
  return { rows: [...rows.values()], moneyAvailable };
}
