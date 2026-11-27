// spec/points/rewardWeights.md, "A month's net weight is its accepted-work credit less its applied debits"; spec/settlement/octoberImport.md, "An apply run writes only under the reviewed digest, current main and the production lock"
import { githubUserIdFromNodeId } from "@repo/backend/nodeId";
import type { Award, Journal } from "../kernels/records/canonical.ts";

interface ReviewedWeight {
  readonly githubNodeId: string;
  readonly acceptedWorkPoints: number;
}

interface AcceptedWork {
  readonly weights: ReadonlyMap<string, ReviewedWeight>;
  readonly identities: ReadonlyMap<string, string>;
}

const octoberThrough = "2026-11-01T00:00:00.000Z";

export function octoberAcceptedWork(
  journal: Journal,
  projectId: string,
  from: string,
  reviewIdentity: (url: string) => string | undefined,
): AcceptedWork {
  const latest = new Map(journal.revisions.map((row) => [row.award.key, row]));
  const evaluated = new Set<string>();
  for (const { award } of latest.values()) {
    if (award.amount <= 0 || award.category !== "evaluated-contribution") continue;
    const identity = reviewIdentity(award.sourceUrl);
    if (identity !== undefined) evaluated.add(`${award.actor.id}:${identity}`);
  }

  const members = new Set<string>();
  const groups = new Map<string, Award>();
  const penalties: Award[] = [];
  for (const { award, decision } of latest.values()) {
    if (award.projectId !== projectId) continue;
    if (award.category === "slopbot-penalty") {
      if (award.amount !== 0) penalties.push(award);
      continue;
    }
    const assessed = decision?.sourceId.startsWith("value:") === true;
    if (award.amount === 0) {
      if (assessed) members.add(award.actor.id);
      continue;
    }
    const review = award.category === "substantive-review";
    const identity = review ? reviewIdentity(award.sourceUrl) : undefined;
    if (identity !== undefined && evaluated.has(`${award.actor.id}:${identity}`)) continue;
    members.add(award.actor.id);
    const key = JSON.stringify([
      award.actor.id,
      award.category,
      assessed ? award.occurredAt.slice(0, 7) : null,
      review && !award.provisional ? identity ?? award.sourceUrl.split("#")[0] : award.workUnitId,
    ]);
    const prior = groups.get(key);
    if (prior === undefined || award.amount > prior.amount || (award.amount === prior.amount &&
      (award.occurredAt < prior.occurredAt || (award.occurredAt === prior.occurredAt && award.sourceId < prior.sourceId)))) {
      groups.set(key, award);
    }
  }

  const totals = new Map<string, bigint>();
  function count(award: Award): void {
    if (award.category === "payout-received" || award.occurredAt < from || award.occurredAt >= octoberThrough) return;
    totals.set(award.actor.id, (totals.get(award.actor.id) ?? 0n) + BigInt(award.amount));
  }
  for (const award of groups.values()) count(award);
  for (const award of penalties) {
    if (members.has(award.actor.id)) count(award);
  }

  const identities = new Map<string, string>();
  const weights = new Map<string, ReviewedWeight>();
  for (const githubNodeId of members) {
    const actor = githubUserIdFromNodeId(githubNodeId);
    const points = totals.get(githubNodeId);
    if (actor === 0n) {
      if (points !== undefined) throw new Error("October accepted-work identity has no numeric GitHub account.");
      continue;
    }
    const githubUserId = actor.toString();
    if (identities.has(githubUserId)) throw new Error("October accepted-work identity has multiple node IDs.");
    identities.set(githubUserId, githubNodeId);
    if (points === undefined) continue;
    const acceptedWorkPoints = Number(points < 0n ? 0n : points);
    if (!Number.isSafeInteger(acceptedWorkPoints)) throw new Error("October accepted-work Points overflow.");
    weights.set(githubUserId, { githubNodeId, acceptedWorkPoints });
  }
  return { weights, identities };
}
