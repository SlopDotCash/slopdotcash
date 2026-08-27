/**
 * Derives one project's cycle leaderboard, diagnostic compute evidence, and
 * reward simulation from the canonical GitHub snapshot. A finalized private
 * trace can earn a fixed evidence bonus; token usage never changes scoring.
 */

import type {
  CapUsageStatus,
  GitHubActor,
  LeaderboardSnapshot,
  ModelAttribution,
  ScoreCategory,
  ScoreEvent,
  ScoreOpportunity,
  WorkItem,
} from "./leaderboard";
import { SCORE_CAPS } from "./leaderboard";
import {
  findProject,
  type ProjectDefinition,
  type ProjectId,
} from "./projects.mjs";
import type { ProjectRunReceipt } from "./run-receipts";

export const MAX_CREDITED_TOKENS_PER_OUTCOME = 1_000_000;
const SHARE_PARTS_PER_MILLION = 1_000_000;

export interface ProjectUsageSummary {
  reportedTokens: number;
  relevantTokens: number;
  creditedTokens: number;
  ambiguousTokens: number;
  estimatedCostMicroUsd: string;
  runCount: number;
  relevantRunCount: number;
  confidence: "none" | "partial" | "verified-device";
}

export interface ProjectContributor {
  rank: number;
  actor: GitHubActor;
  score: number;
  adjustedWeight: number;
  computeBonusBasisPoints: number;
  points: Record<ScoreCategory, number>;
  acceptedOutcomeCount: number;
  evidenceEventIds: string[];
  reportedModels: string[];
  usage: ProjectUsageSummary;
  capUsage: CapUsageStatus;
  projectedMinor: string | null;
  projectedDisplayMinor: string | null;
  projectedSharePartsPerMillion: number | null;
}

export interface ReceiptConflict {
  runId: string;
  reason:
    | "conflicting-receipt-bytes"
    | "device-key-shared-between-actors"
    | "marker-copied-between-actors"
    | "outside-snapshot-window";
}

export type ProjectRewardProjection =
  | {
      kind: "monthly-pool";
      currency: "USDC";
      chain: "solana";
      capMinor: string;
      projectedPrincipalMinor: string;
      platformFeeMinor: string;
      status: "simulation";
    }
  | {
      kind: "external-prize-share";
      opportunityName: string;
      advertisedAmountDisplay: string;
      totalSharePartsPerMillion: number;
      platformSharePartsPerMillion: number;
      status: "provisional-share-only";
    };

export interface ProjectView {
  project: ProjectDefinition;
  generatedAt: string;
  cycle: {
    id: string;
    from: string;
    to: string;
    endsAt: string;
    status: "closed" | "live";
  };
  leaders: ProjectContributor[];
  ledger: ScoreEvent[];
  opportunities: ScoreOpportunity[];
  workQueue: {
    issues: WorkItem[];
    pullRequests: WorkItem[];
  };
  usage: ProjectUsageSummary;
  receiptConflicts: ReceiptConflict[];
  reward: ProjectRewardProjection;
}

interface UniqueRun {
  attribution: ModelAttribution;
  receipt: ProjectRunReceipt;
}

function compareActors(left: GitHubActor, right: GitHubActor): number {
  const leftLogin = left.login.toLowerCase();
  const rightLogin = right.login.toLowerCase();
  return (
    leftLogin.localeCompare(rightLogin) ||
    left.login.localeCompare(right.login) ||
    left.id.localeCompare(right.id)
  );
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function monthIdFor(timestamp: string): string {
  return timestamp.slice(0, 7);
}

function capUsageForEvents(
  month: string,
  events: ScoreEvent[],
): CapUsageStatus {
  const usage: CapUsageStatus = {
    month,
    mergedPullRequests: { used: 0, cap: SCORE_CAPS.mergedPullRequests },
    resolvedIssues: { used: 0, cap: SCORE_CAPS.resolvedIssues },
    materialTestChanges: { used: 0, cap: SCORE_CAPS.materialTestChanges },
    evidencePoints: { used: 0, cap: SCORE_CAPS.evidencePoints },
    substantiveReviews: { used: 0, cap: SCORE_CAPS.substantiveReviews },
    evaluatedContributions: {
      used: 0,
      cap: SCORE_CAPS.evaluatedContributions,
    },
  };
  for (const event of events) {
    if (event.occurredAt.slice(0, 7) !== month) {
      continue;
    }
    if (event.category === "merged-pull-request") {
      usage.mergedPullRequests.used += 1;
    } else if (event.category === "resolved-issue") {
      usage.resolvedIssues.used += 1;
    } else if (event.category === "material-test-change") {
      usage.materialTestChanges.used += 1;
    } else if (event.category === "evidence") {
      usage.evidencePoints.used += event.points;
    } else if (event.category === "substantive-review") {
      usage.substantiveReviews.used += 1;
    } else {
      usage.evaluatedContributions.used += 1;
    }
  }
  return usage;
}

function opportunityPointsWithinCap(
  opportunity: ScoreOpportunity,
  usage: CapUsageStatus,
): number | null {
  if (opportunity.category === "evidence") {
    return null;
  }
  if (opportunity.potentialPoints === null) {
    return 0;
  }
  if (
    opportunity.category === "material-test-change" &&
    usage.materialTestChanges.used >= SCORE_CAPS.materialTestChanges
  ) {
    return 0;
  }
  if (
    opportunity.category === "substantive-review" &&
    usage.substantiveReviews.used >= SCORE_CAPS.substantiveReviews
  ) {
    return 0;
  }
  return opportunity.potentialPoints;
}

export function formatCapUsageLine(capUsage: CapUsageStatus): string | null {
  const parts: string[] = [];
  if (capUsage.mergedPullRequests.used > 0) {
    parts.push(
      capUsage.mergedPullRequests.cap === null
        ? `merges ${capUsage.mergedPullRequests.used} uncapped`
        : `merges ${capUsage.mergedPullRequests.used}/${capUsage.mergedPullRequests.cap}`,
    );
  }
  if (capUsage.resolvedIssues.used > 0) {
    parts.push(
      `issues ${capUsage.resolvedIssues.used}/${capUsage.resolvedIssues.cap}`,
    );
  }
  if (capUsage.materialTestChanges.used > 0) {
    parts.push(
      `tests ${capUsage.materialTestChanges.used}/${capUsage.materialTestChanges.cap}`,
    );
  }
  if (capUsage.evidencePoints.used > 0) {
    parts.push(
      `evidence ${capUsage.evidencePoints.used}/${capUsage.evidencePoints.cap}`,
    );
  }
  if (capUsage.substantiveReviews.used > 0) {
    parts.push(
      `reviews ${capUsage.substantiveReviews.used}/${capUsage.substantiveReviews.cap}`,
    );
  }
  if (capUsage.evaluatedContributions.used > 0) {
    parts.push(
      `evaluated ${capUsage.evaluatedContributions.used}/${capUsage.evaluatedContributions.cap}`,
    );
  }
  if (parts.length === 0) {
    return null;
  }
  return `${capUsage.month} scoring · ${parts.join(" · ")}`;
}

function cycleBounds(cycleId: string): { from: number; to: number } {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError(`Invalid reward cycle id: ${cycleId}`);
  }
  const [yearText, monthText] = cycleId.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return {
    from: Date.UTC(year, monthIndex, 1),
    to: Date.UTC(year, monthIndex + 1, 1),
  };
}

function emptyUsage(): ProjectUsageSummary {
  return {
    reportedTokens: 0,
    relevantTokens: 0,
    creditedTokens: 0,
    ambiguousTokens: 0,
    estimatedCostMicroUsd: "0",
    runCount: 0,
    relevantRunCount: 0,
    confidence: "none",
  };
}

function allocateIntegerTotal(
  total: bigint,
  contributors: readonly ProjectContributor[],
): Map<string, bigint> {
  const result = new Map(contributors.map((entry) => [entry.actor.id, 0n]));
  const totalWeight = contributors.reduce(
    (sum, entry) => sum + BigInt(entry.adjustedWeight),
    0n,
  );
  if (total <= 0n || totalWeight <= 0n) return result;

  const remainders: Array<{
    actor: GitHubActor;
    remainder: bigint;
  }> = [];
  let allocated = 0n;
  for (const contributor of contributors) {
    const numerator = total * BigInt(contributor.adjustedWeight);
    const amount = numerator / totalWeight;
    allocated += amount;
    result.set(contributor.actor.id, amount);
    remainders.push({
      actor: contributor.actor,
      remainder: numerator % totalWeight,
    });
  }
  remainders.sort(
    (left, right) =>
      (left.remainder === right.remainder
        ? 0
        : left.remainder > right.remainder
          ? -1
          : 1) || compareActors(left.actor, right.actor),
  );
  let remaining = total - allocated;
  for (let index = 0; remaining > 0n; index += 1) {
    const actor = remainders[index % remainders.length].actor;
    result.set(actor.id, (result.get(actor.id) ?? 0n) + 1n);
    remaining -= 1n;
  }
  return result;
}

function canonicalReceipt(receipt: ProjectRunReceipt): string {
  return JSON.stringify(receipt);
}

function selectUniqueRuns(
  snapshot: LeaderboardSnapshot,
  project: ProjectDefinition,
): { conflicts: ReceiptConflict[]; runs: UniqueRun[] } {
  const byRunId = new Map<string, UniqueRun>();
  const rejected = new Set<string>();
  const conflicts: ReceiptConflict[] = [];
  const from = Date.parse(snapshot.window.from);
  const to = Date.parse(snapshot.window.to);

  for (const attribution of snapshot.attributions) {
    const receipt = attribution.run;
    if (
      !receipt ||
      receipt.projectId !== project.id ||
      rejected.has(receipt.runId)
    ) {
      continue;
    }
    const completedAt = Date.parse(receipt.completedAt);
    if (completedAt < from || completedAt >= to) {
      rejected.add(receipt.runId);
      byRunId.delete(receipt.runId);
      conflicts.push({
        runId: receipt.runId,
        reason: "outside-snapshot-window",
      });
      continue;
    }
    const existing = byRunId.get(receipt.runId);
    if (!existing) {
      byRunId.set(receipt.runId, { attribution, receipt });
      continue;
    }
    const copied = existing.attribution.actor?.id !== attribution.actor?.id;
    const changed =
      canonicalReceipt(existing.receipt) !== canonicalReceipt(receipt);
    if (copied || changed) {
      rejected.add(receipt.runId);
      byRunId.delete(receipt.runId);
      conflicts.push({
        runId: receipt.runId,
        reason: copied
          ? "marker-copied-between-actors"
          : "conflicting-receipt-bytes",
      });
    }
  }

  const actorsByDeviceKey = new Map<string, Set<string>>();
  for (const attribution of snapshot.attributions) {
    const actorId = attribution.actor?.id;
    const receipt = attribution.run;
    if (!actorId || !receipt) continue;
    const actors = actorsByDeviceKey.get(receipt.deviceKeyId) ?? new Set();
    actors.add(actorId);
    actorsByDeviceKey.set(receipt.deviceKeyId, actors);
  }
  const sharedDeviceKeys = new Set(
    [...actorsByDeviceKey.entries()]
      .filter(([, actors]) => actors.size > 1)
      .map(([key]) => key),
  );
  for (const [runId, run] of byRunId) {
    if (!sharedDeviceKeys.has(run.receipt.deviceKeyId)) continue;
    byRunId.delete(runId);
    conflicts.push({
      runId,
      reason: "device-key-shared-between-actors",
    });
  }

  return {
    conflicts: conflicts.sort((left, right) =>
      left.runId.localeCompare(right.runId),
    ),
    runs: [...byRunId.values()].sort((left, right) =>
      left.receipt.runId.localeCompare(right.receipt.runId),
    ),
  };
}

function eventMatchesRun(event: ScoreEvent, run: UniqueRun): boolean {
  return (
    run.attribution.actor?.id === event.actor.id &&
    run.receipt.repositoryId === event.repository &&
    (run.attribution.artifactId === event.source.id ||
      run.attribution.sourceId === event.source.id)
  );
}

function usageForActor(
  actorId: string,
  events: readonly ScoreEvent[],
  runs: readonly UniqueRun[],
): ProjectUsageSummary {
  const usage = emptyUsage();
  const creditedByOutcome = new Map<string, number>();
  let exactCount = 0;
  let boundedCount = 0;
  let cost = 0n;

  for (const run of runs) {
    if (run.attribution.actor?.id !== actorId) continue;
    const tokens = run.receipt.usage.totalTokens;
    const matchingEvents = events.filter((event) =>
      eventMatchesRun(event, run),
    );
    usage.reportedTokens += tokens;
    usage.runCount += 1;
    cost += BigInt(run.receipt.usage.costMicroUsd);
    if (matchingEvents.length === 0) continue;
    usage.relevantTokens += tokens;
    usage.relevantRunCount += 1;
    if (run.receipt.usage.confidence === "exact") exactCount += 1;
    if (run.receipt.usage.confidence === "bounded") boundedCount += 1;
    const outcomeId = matchingEvents[0].source.id;
    creditedByOutcome.set(
      outcomeId,
      Math.min(
        MAX_CREDITED_TOKENS_PER_OUTCOME,
        (creditedByOutcome.get(outcomeId) ?? 0) + tokens,
      ),
    );
  }
  usage.creditedTokens = [...creditedByOutcome.values()].reduce(
    (total, value) => total + value,
    0,
  );
  usage.ambiguousTokens = usage.reportedTokens - usage.relevantTokens;
  usage.estimatedCostMicroUsd = cost.toString();
  usage.confidence =
    exactCount > 0 && boundedCount === 0
      ? "verified-device"
      : exactCount + boundedCount > 0
        ? "partial"
        : "none";
  return usage;
}

function aggregateUsage(
  entries: readonly ProjectContributor[],
): ProjectUsageSummary {
  const usage = emptyUsage();
  let cost = 0n;
  for (const entry of entries) {
    usage.reportedTokens += entry.usage.reportedTokens;
    usage.relevantTokens += entry.usage.relevantTokens;
    usage.creditedTokens += entry.usage.creditedTokens;
    usage.ambiguousTokens += entry.usage.ambiguousTokens;
    usage.runCount += entry.usage.runCount;
    usage.relevantRunCount += entry.usage.relevantRunCount;
    cost += BigInt(entry.usage.estimatedCostMicroUsd);
  }
  usage.estimatedCostMicroUsd = cost.toString();
  usage.confidence = entries.some(
    (entry) => entry.usage.confidence === "verified-device",
  )
    ? entries.every(
        (entry) =>
          entry.usage.runCount === 0 ||
          entry.usage.confidence === "verified-device",
      )
      ? "verified-device"
      : "partial"
    : entries.some((entry) => entry.usage.confidence === "partial")
      ? "partial"
      : "none";
  return usage;
}

/** Creates a deterministic project and reward-cycle view from one snapshot. */
function projectCycleWindow(
  snapshot: LeaderboardSnapshot,
  project: ProjectDefinition,
  requestedCycleId?: string,
): {
  calendar: { from: number; to: number };
  cycleId: string;
  from: number;
  to: number;
} {
  const cycleId = requestedCycleId ?? monthIdFor(snapshot.window.to);
  const calendar = cycleBounds(cycleId);
  return {
    calendar,
    cycleId,
    from: Math.max(
      calendar.from,
      Date.parse(project.reward.rewardStartAt),
      Date.parse(snapshot.window.from),
    ),
    to: Math.min(calendar.to, Date.parse(snapshot.window.to)),
  };
}

/**
 * Reports whether a project's reward window has opened inside this snapshot.
 * A project whose pool starts later is a valid registry entry with no cycle to
 * show yet, so callers building every view can skip it instead of failing.
 */
export function projectCycleHasOpened(
  snapshot: LeaderboardSnapshot,
  projectId: ProjectId,
  requestedCycleId?: string,
): boolean {
  const project = findProject(projectId);
  if (!project) return false;
  const window = projectCycleWindow(snapshot, project, requestedCycleId);
  return window.to >= window.from;
}

export function createProjectView(
  snapshot: LeaderboardSnapshot,
  projectId: ProjectId,
  requestedCycleId?: string,
): ProjectView {
  const project = findProject(projectId);
  if (!project) throw new TypeError(`Unknown project: ${projectId}`);
  const snapshotTo = Date.parse(snapshot.window.to);
  const { calendar, cycleId, from, to } = projectCycleWindow(
    snapshot,
    project,
    requestedCycleId,
  );
  if (to < from) {
    throw new RangeError(
      `Cycle ${cycleId} does not overlap the available snapshot for ${projectId}`,
    );
  }

  const repositoryIds = new Set(
    project.repositories.map((repository) => repository.id),
  );
  const ledger = snapshot.ledger
    .filter(
      (event) =>
        repositoryIds.has(event.repository) &&
        Date.parse(event.occurredAt) >= from &&
        Date.parse(event.occurredAt) < to,
    )
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
        left.id.localeCompare(right.id),
    );
  const { conflicts, runs } = selectUniqueRuns(snapshot, project);
  const actors = new Map<string, GitHubActor>();
  for (const event of ledger) actors.set(event.actor.id, event.actor);

  const leaders = [...actors.values()].map<ProjectContributor>((actor) => {
    const events = ledger.filter((event) => event.actor.id === actor.id);
    const usage = usageForActor(actor.id, events, runs);
    const rawThirds = events.reduce(
      (total, event) => total + (event.scoreThirds ?? event.points * 3),
      0,
    );
    const weightedThirdBasisPoints = events.reduce(
      (total, event) =>
        total +
        (event.scoreThirds ?? event.points * 3) *
          (10_000 + (event.evidenceBonusBasisPoints ?? 0)),
      0,
    );
    const computeBonus =
      rawThirds === 0
        ? 0
        : Math.floor(weightedThirdBasisPoints / rawThirds) - 10_000;
    const score = Math.floor(rawThirds / 3);
    const points = {
      "merged-pull-request": 0,
      "resolved-issue": 0,
      "material-test-change": 0,
      evidence: 0,
      "substantive-review": 0,
      "evaluated-contribution": 0,
    } satisfies Record<ScoreCategory, number>;
    for (const event of events) points[event.category] += event.points;
    return {
      rank: 0,
      actor,
      score,
      adjustedWeight: Math.floor(weightedThirdBasisPoints / 3),
      computeBonusBasisPoints: computeBonus,
      points,
      acceptedOutcomeCount: events.length,
      evidenceEventIds: events.map((event) => event.id).sort(),
      reportedModels: [
        ...new Set(
          runs
            .filter((run) => run.attribution.actor?.id === actor.id)
            .map((run) => `${run.receipt.provider}/${run.receipt.model}`),
        ),
      ].sort(),
      usage,
      capUsage: capUsageForEvents(cycleId, events),
      projectedMinor: null,
      projectedDisplayMinor: null,
      projectedSharePartsPerMillion: null,
    };
  });
  leaders.sort(
    (left, right) =>
      right.adjustedWeight - left.adjustedWeight ||
      right.score - left.score ||
      compareActors(left.actor, right.actor),
  );
  leaders.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const opportunities = snapshot.opportunities
    .filter((opportunity) => repositoryIds.has(opportunity.repository))
    .map((opportunity) => {
      const usage = capUsageForEvents(
        cycleId,
        ledger.filter((event) => event.actor.id === opportunity.actor.id),
      );
      const potentialPoints = opportunityPointsWithinCap(opportunity, usage);
      if (potentialPoints === null) {
        return { ...opportunity, potentialPoints: null };
      }
      return potentialPoints > 0 ? { ...opportunity, potentialPoints } : null;
    })
    .filter(
      (opportunity): opportunity is ScoreOpportunity => opportunity !== null,
    )
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
        left.source.number - right.source.number ||
        left.id.localeCompare(right.id),
    );

  let reward: ProjectRewardProjection;
  if (project.reward.kind === "monthly-pool") {
    const monthlyCapMinor = BigInt(project.reward.monthlyCapMinor);
    const projected = allocateIntegerTotal(monthlyCapMinor, leaders);
    const projectedCents = allocateIntegerTotal(
      monthlyCapMinor / 10_000n,
      leaders,
    );
    for (const entry of leaders) {
      entry.projectedMinor = (projected.get(entry.actor.id) ?? 0n).toString();
      entry.projectedDisplayMinor = (
        (projectedCents.get(entry.actor.id) ?? 0n) * 10_000n
      ).toString();
    }
    reward = {
      kind: "monthly-pool",
      currency: "USDC",
      chain: "solana",
      capMinor: project.reward.monthlyCapMinor,
      projectedPrincipalMinor: [...projected.values()]
        .reduce((total, amount) => total + amount, 0n)
        .toString(),
      platformFeeMinor: (
        (BigInt(project.reward.monthlyCapMinor) *
          BigInt(project.reward.feeBasisPoints)) /
        10_000n
      ).toString(),
      status: "simulation",
    };
  } else {
    const platformSharePartsPerMillion =
      (SHARE_PARTS_PER_MILLION * project.reward.feeBasisPoints) / 10_000;
    const contributorSharePartsPerMillion =
      SHARE_PARTS_PER_MILLION - platformSharePartsPerMillion;
    const shares = allocateIntegerTotal(
      BigInt(contributorSharePartsPerMillion),
      leaders,
    );
    for (const entry of leaders) {
      entry.projectedSharePartsPerMillion = Number(
        shares.get(entry.actor.id) ?? 0n,
      );
    }
    reward = {
      kind: "external-prize-share",
      opportunityName:
        project.reward.externalOpportunity?.name ?? "External opportunity",
      advertisedAmountDisplay:
        project.reward.externalOpportunity?.advertisedAmountDisplay ??
        "Undisclosed",
      totalSharePartsPerMillion: [...shares.values()].reduce(
        (total, share) => total + Number(share),
        0,
      ),
      platformSharePartsPerMillion,
      status: "provisional-share-only",
    };
  }

  return {
    project,
    generatedAt: snapshot.generatedAt,
    cycle: {
      id: cycleId,
      from: iso(from),
      to: iso(to),
      endsAt: iso(calendar.to),
      status: snapshotTo >= calendar.to ? "closed" : "live",
    },
    leaders,
    ledger,
    opportunities,
    workQueue: {
      issues: snapshot.workQueue.issues.filter((item) =>
        repositoryIds.has(item.repository),
      ),
      pullRequests: snapshot.workQueue.pullRequests.filter((item) =>
        repositoryIds.has(item.repository),
      ),
    },
    usage: aggregateUsage(leaders),
    receiptConflicts: conflicts,
    reward,
  };
}
