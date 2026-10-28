/**
 * One display projection for points and finalized principal. Points follow
 * the selected period; money received is always the all-time total.
 */

import { githubUserIdFromNodeId } from "./github-actor";
import type { ActorRef } from "./leaderboard-types";
import type { PointsMember } from "./points";
import type { ReceivedContributor } from "./received-totals";
import type { DataState } from "./use-snapshot";

export function contributorStandings(
  state: DataState,
  members: readonly PointsMember[] | null,
  month: string | null,
  projectId: string,
  received: readonly ReceivedContributor[] | null = null,
) {
  // An unavailable source is not an empty history or a complete Paid total.
  const moneyAvailable = state.status === "ready" && received !== null;
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
    // Money received is all-time whatever points period is selected.
    for (const cycle of cycles) {
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
  if (state.status === "ready" && received !== null) {
    // Received totals name numeric GitHub IDs; rows may carry node IDs.
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
    for (const contributor of received) {
      const amount = projectId
        ? BigInt(
            contributor.projects.find((p) => p.projectId === projectId)
              ?.usdMicro ?? "0",
          )
        : BigInt(contributor.usdMicro);
      if (amount === 0n) continue;
      const recipient = row(
        byNumericId.get(contributor.githubUserId) ?? {
          id: contributor.githubUserId,
          login: contributor.login ?? contributor.githubUserId,
        },
      );
      recipient.money = (recipient.money ?? 0n) + amount;
    }
  }
  for (const member of members ?? []) {
    const value = row(member.actor);
    value.points = month ? member.monthly : member.total;
  }
  return { rows: [...rows.values()], moneyAvailable };
}
