// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/points/penalties.md, "Standing is the month's accepted-work credits minus active debits, never below zero, whatever the order"; spec/settlement/allocation.md, "The largest remainders receive the remaining units exactly once"; spec/settlement/money.md, "Ordinary fees round upward and private splits require exact division"
import { githubUserIdFromNodeId } from "@repo/backend/nodeId";
import { eventThirds, type GitHubActor, type LeaderboardSnapshot, type ModelAttribution, penaltyDeductions, pointsOf, type RepositoryRegistry, registryOf, type RunReceipt, type ScoreEvent, type ScoreOpportunity, scoreCaps, type WorkItem } from "@repo/points/client";
import { allocate } from "@repo/settlement/kernels/allocate";
import { parsePeriod, periodEndSeconds, periodStartSeconds } from "@repo/settlement/kernels/calendar";
import { ordinaryFeeBase } from "@repo/settlement/kernels/fees";
import { rankAt } from "../../gen/frontend__projections.ts";

export type ScoreCategory = "merged-pull-request" | "resolved-issue" | "material-test-change" | "evidence" | "substantive-review" | "evaluated-contribution";
export type ExclusionRelationship = "owner" | "funded-employee" | "related-party";
export type UsageConfidence = "none" | "partial" | "verified-device";
export type ReceiptConflictReason = "conflicting-receipt-bytes" | "device-key-shared-between-actors" | "marker-copied-between-actors" | "outside-snapshot-window";

export interface PayoutExclusion {
  readonly actorId: string;
  readonly relationship: ExclusionRelationship;
  readonly fromCycle: string;
  readonly untilCycle: string | null;
}

export interface CycleCap {
  readonly cycleId: string;
  readonly monthlyCapMinor: bigint;
}

export interface MonthlyPoolTerms {
  readonly kind: "monthly-pool";
  readonly currency: string;
  readonly chain: string;
  readonly feeBasisPoints: number;
  readonly monthlyCapMinor: bigint;
  readonly cycleCaps: ReadonlyArray<CycleCap>;
  readonly fundingState: "committed" | "pledged";
  readonly escrow?: { readonly effectiveCycle: string; readonly chain: string };
}

export interface ExternalPrizeTerms {
  readonly kind: "external-prize-share";
  readonly feeBasisPoints: number;
  readonly opportunityName?: string;
  readonly advertisedAmountDisplay?: string;
}

export interface ProjectRepository {
  readonly id: string;
  readonly countsFrom?: string;
}

export interface ProjectTerms {
  readonly id: string;
  readonly rewardStartAt: string;
  readonly repositories: ReadonlyArray<ProjectRepository>;
  readonly payoutExclusions: ReadonlyArray<PayoutExclusion>;
  readonly reward: MonthlyPoolTerms | ExternalPrizeTerms;
}

export interface FundingBasis {
  readonly fundingState: "committed" | "pledged";
  readonly committedMinor: bigint;
  readonly monthlyCapMinor: bigint;
}

export interface UsageSummary {
  readonly reportedTokens: number;
  readonly relevantTokens: number;
  readonly creditedTokens: number;
  readonly ambiguousTokens: number;
  readonly estimatedCostMicroUsd: bigint;
  readonly runCount: number;
  readonly relevantRunCount: number;
  readonly confidence: UsageConfidence;
}

export interface CapCount {
  readonly used: number;
  readonly cap: number | null;
}

export interface CapUsage {
  readonly month: string;
  readonly mergedPullRequests: CapCount;
  readonly resolvedIssues: CapCount;
  readonly materialTestChanges: CapCount;
  readonly evidencePoints: CapCount;
  readonly substantiveReviews: CapCount;
  readonly evaluatedContributions: CapCount;
}

export interface ProjectContributor {
  readonly rank: number;
  readonly actor: GitHubActor;
  readonly points: number;
  readonly penaltyPoints: number;
  readonly weight: bigint;
  readonly computeBonusBasisPoints: number;
  readonly categoryPoints: Readonly<Record<ScoreCategory, number>>;
  readonly acceptedOutcomeCount: number;
  readonly evidenceEventIds: ReadonlyArray<string>;
  readonly reportedModels: ReadonlyArray<string>;
  readonly usage: UsageSummary;
  readonly capUsage: CapUsage;
  readonly payoutExclusion: ExclusionRelationship | null;
}

export interface PoolContributor extends ProjectContributor {
  readonly simulatedMinor: bigint;
  readonly projectedMinor: bigint;
}

export interface PrizeContributor extends ProjectContributor {
  readonly projectedSharePartsPerMillion: bigint;
}

export interface ReceiptConflict {
  readonly runId: string;
  readonly reason: ReceiptConflictReason;
}

export interface MonthlyPoolProjection {
  readonly kind: "monthly-pool";
  readonly currency: string;
  readonly chain: string;
  readonly capMinor: bigint;
  readonly projectedPrincipalMinor: bigint;
  readonly platformFeeMinor: bigint;
  readonly status: "simulation";
}

export interface ExternalPrizeProjection {
  readonly kind: "external-prize-share";
  readonly opportunityName: string;
  readonly advertisedAmountDisplay: string;
  readonly totalSharePartsPerMillion: bigint;
  readonly platformSharePartsPerMillion: number;
  readonly status: "provisional-share-only";
}

export type RewardProjection = MonthlyPoolProjection | ExternalPrizeProjection;

export type RewardedLeaders =
  | { readonly kind: "monthly-pool"; readonly reward: MonthlyPoolProjection; readonly leaders: ReadonlyArray<PoolContributor> }
  | { readonly kind: "external-prize-share"; readonly reward: ExternalPrizeProjection; readonly leaders: ReadonlyArray<PrizeContributor> };

export interface CycleWindow {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly endsAt: string;
  readonly status: "closed" | "live";
}

export type ProjectCycleView = RewardedLeaders & {
  readonly project: ProjectTerms;
  readonly generatedAt: string;
  readonly cycle: CycleWindow;
  readonly ledger: ReadonlyArray<ScoreEvent>;
  readonly opportunities: ReadonlyArray<ScoreOpportunity>;
  readonly workQueue: { readonly issues: ReadonlyArray<WorkItem>; readonly pullRequests: ReadonlyArray<WorkItem> };
  readonly usage: UsageSummary;
  readonly receiptConflicts: ReadonlyArray<ReceiptConflict>;
};

export interface ProjectCycleRequest {
  readonly snapshot: LeaderboardSnapshot;
  readonly payment?: LeaderboardSnapshot;
  readonly registry: RepositoryRegistry;
  readonly project: ProjectTerms;
  readonly cycleId?: string;
  readonly funding?: FundingBasis;
}

interface UniqueRun {
  readonly attribution: ModelAttribution;
  readonly receipt: RunReceipt;
}

interface Bounds {
  readonly calendarFrom: number;
  readonly calendarTo: number;
  readonly cycleId: string;
  readonly from: number;
  readonly to: number;
}

const maxCreditedTokensPerOutcome = 1_000_000;
const sharePartsPerMillion = 1_000_000;
const paymentBasisFromCycle = "2026-10";
const pointsWeightFromCycle = "2026-11";

const categoryCap: Readonly<Record<ScoreCategory, keyof Omit<CapUsage, "month">>> = {
  "merged-pull-request": "mergedPullRequests",
  "resolved-issue": "resolvedIssues",
  "material-test-change": "materialTestChanges",
  evidence: "evidencePoints",
  "substantive-review": "substantiveReviews",
  "evaluated-contribution": "evaluatedContributions",
};

const iso = (millis: number) => new Date(millis).toISOString();

/** @throws {never} */
export function compareActors(left: Pick<GitHubActor, "id" | "login">, right: Pick<GitHubActor, "id" | "login">): number {
  return left.login.toLocaleLowerCase("en").localeCompare(right.login.toLocaleLowerCase("en"), "en") || left.login.localeCompare(right.login, "en") || left.id.localeCompare(right.id, "en");
}

/** @throws {RangeError} */
export function cycleBounds(cycleId: string): { readonly from: number; readonly to: number } {
  const period = parsePeriod(cycleId);
  if (period === undefined) throw new RangeError(`Invalid reward cycle id: ${cycleId}`);
  return { from: periodStartSeconds(period) * 1000, to: periodEndSeconds(period) * 1000 };
}

function windowOf(snapshot: LeaderboardSnapshot, project: ProjectTerms, requested: string | undefined): Bounds {
  const cycleId = requested ?? snapshot.window.to.slice(0, 7);
  const calendar = cycleBounds(cycleId);
  return {
    calendarFrom: calendar.from,
    calendarTo: calendar.to,
    cycleId,
    from: Math.max(calendar.from, Date.parse(project.rewardStartAt), Date.parse(snapshot.window.from)),
    to: Math.min(calendar.to, Date.parse(snapshot.window.to)),
  };
}

/** @throws {RangeError} */
export function countedRepositories(snapshot: LeaderboardSnapshot, project: ProjectTerms, cycleId?: string): ReadonlyArray<ProjectRepository> {
  const monthStart = windowOf(snapshot, project, cycleId).calendarFrom;
  return project.repositories.filter((repository) => repository.countsFrom === undefined || Date.parse(repository.countsFrom) <= monthStart);
}

/** @throws {RangeError} */
export function projectCycleHasOpened(snapshot: LeaderboardSnapshot, project: ProjectTerms, cycleId?: string): boolean {
  const bounds = windowOf(snapshot, project, cycleId);
  return bounds.to >= bounds.from;
}

/** @throws {RangeError} */
export function projectActivityCollected(snapshot: LeaderboardSnapshot, project: ProjectTerms, cycleId?: string): boolean {
  return countedRepositories(snapshot, project, cycleId).every((repository) => snapshot.repositories.some((collected) => collected.id === repository.id));
}

/** @throws {never} */
export function payoutExclusionFor(project: ProjectTerms, cycleId: string, actorNodeId: string): ExclusionRelationship | null {
  const actorId = githubUserIdFromNodeId(actorNodeId).toString();
  return project.payoutExclusions.find((entry) => entry.actorId === actorId && entry.fromCycle <= cycleId && (entry.untilCycle === null || cycleId < entry.untilCycle))?.relationship ?? null;
}

/** @throws {never} */
export function fundedMinor(basis: FundingBasis): bigint {
  if (basis.fundingState !== "committed") return 0n;
  return basis.committedMinor < basis.monthlyCapMinor ? basis.committedMinor : basis.monthlyCapMinor;
}

/** @throws {never} */
export function capFor(terms: MonthlyPoolTerms, cycleId: string): bigint {
  return terms.cycleCaps.find((cap) => cap.cycleId === cycleId)?.monthlyCapMinor ?? terms.monthlyCapMinor;
}

/** @throws {RangeError} */
export function allocateByWeight(total: bigint, leaders: ReadonlyArray<Pick<ProjectContributor, "actor" | "weight">>): ReadonlyArray<bigint> {
  const amounts = leaders.map(() => 0n);
  const weighted = leaders.flatMap((leader, index) => (leader.weight > 0n ? [{ index, leader }] : [])).sort((left, right) => compareActors(left.leader.actor, right.leader.actor));
  if (total <= 0n || weighted.length === 0) return amounts;
  const allocation = allocate(total, weighted.map(({ leader }, position) => ({ actor: position + 1, weight: leader.weight })));
  if (allocation.kind === "Refused") throw new RangeError("The contributor weights cannot be allocated");
  for (const share of allocation.shares) amounts[weighted[share.actor - 1].index] = share.amount;
  return amounts;
}

function emptyUsage(): UsageSummary {
  return { reportedTokens: 0, relevantTokens: 0, creditedTokens: 0, ambiguousTokens: 0, estimatedCostMicroUsd: 0n, runCount: 0, relevantRunCount: 0, confidence: "none" };
}

function capUsageOf(month: string, events: ReadonlyArray<ScoreEvent>): CapUsage {
  const used: Record<keyof Omit<CapUsage, "month">, number> = { mergedPullRequests: 0, resolvedIssues: 0, materialTestChanges: 0, evidencePoints: 0, substantiveReviews: 0, evaluatedContributions: 0 };
  for (const event of events) {
    if (event.occurredAt.slice(0, 7) !== month) continue;
    const bucket = categoryCap[event.category as ScoreCategory] ?? "evaluatedContributions";
    used[bucket] += bucket === "evidencePoints" ? event.points : 1;
  }
  return {
    month,
    mergedPullRequests: { used: used.mergedPullRequests, cap: null },
    resolvedIssues: { used: used.resolvedIssues, cap: scoreCaps.resolvedIssues },
    materialTestChanges: { used: used.materialTestChanges, cap: scoreCaps.materialTestChanges },
    evidencePoints: { used: used.evidencePoints, cap: scoreCaps.evidencePoints },
    substantiveReviews: { used: used.substantiveReviews, cap: scoreCaps.substantiveReviews },
    evaluatedContributions: { used: used.evaluatedContributions, cap: scoreCaps.evaluatedContributions },
  };
}

function pointsWithinCap(opportunity: ScoreOpportunity, usage: CapUsage): number | null {
  if (opportunity.category === "evidence" || opportunity.potentialPoints === null) return null;
  if (opportunity.category === "material-test-change" && usage.materialTestChanges.used >= scoreCaps.materialTestChanges) return 0;
  if (opportunity.category === "substantive-review" && usage.substantiveReviews.used >= scoreCaps.substantiveReviews) return 0;
  return opportunity.potentialPoints;
}

function uniqueRuns(snapshot: LeaderboardSnapshot, project: ProjectTerms): { readonly conflicts: ReadonlyArray<ReceiptConflict>; readonly runs: ReadonlyArray<UniqueRun> } {
  const byRunId = new Map<string, UniqueRun>();
  const rejected = new Set<string>();
  const conflicts: ReceiptConflict[] = [];
  const from = Date.parse(snapshot.window.from);
  const to = Date.parse(snapshot.window.to);
  const reject = (runId: string, reason: ReceiptConflictReason) => {
    rejected.add(runId);
    byRunId.delete(runId);
    conflicts.push({ runId, reason });
  };
  for (const attribution of snapshot.attributions) {
    const receipt = attribution.run;
    if (receipt === null || receipt.projectId !== project.id || rejected.has(receipt.runId)) continue;
    const completedAt = Date.parse(receipt.completedAt);
    if (completedAt < from || completedAt >= to) {
      reject(receipt.runId, "outside-snapshot-window");
      continue;
    }
    const existing = byRunId.get(receipt.runId);
    if (existing === undefined) {
      byRunId.set(receipt.runId, { attribution, receipt });
      continue;
    }
    const copied = existing.attribution.actor?.id !== attribution.actor?.id;
    if (copied || JSON.stringify(existing.receipt) !== JSON.stringify(receipt)) reject(receipt.runId, copied ? "marker-copied-between-actors" : "conflicting-receipt-bytes");
  }
  const actorsByKey = new Map<string, Set<string>>();
  for (const attribution of snapshot.attributions) {
    if (attribution.actor === null || attribution.run === null) continue;
    const actors = actorsByKey.get(attribution.run.deviceKeyId) ?? new Set<string>();
    actors.add(attribution.actor.id);
    actorsByKey.set(attribution.run.deviceKeyId, actors);
  }
  for (const [runId, run] of [...byRunId]) {
    if ((actorsByKey.get(run.receipt.deviceKeyId)?.size ?? 0) <= 1) continue;
    byRunId.delete(runId);
    conflicts.push({ runId, reason: "device-key-shared-between-actors" });
  }
  return {
    conflicts: conflicts.sort((left, right) => left.runId.localeCompare(right.runId)),
    runs: [...byRunId.values()].sort((left, right) => left.receipt.runId.localeCompare(right.receipt.runId)),
  };
}

function usageOf(events: ReadonlyArray<ScoreEvent>, runs: ReadonlyArray<UniqueRun>): UsageSummary {
  const credited = new Map<string, number>();
  let reportedTokens = 0;
  let relevantTokens = 0;
  let runCount = 0;
  let relevantRunCount = 0;
  let exact = 0;
  let bounded = 0;
  let cost = 0n;
  for (const run of runs) {
    const tokens = run.receipt.usage.totalTokens;
    const matching = events.filter((event) => run.receipt.repositoryId === event.repository && (run.attribution.artifactId === event.source.id || run.attribution.sourceId === event.source.id));
    reportedTokens += tokens;
    runCount += 1;
    cost += BigInt(run.receipt.usage.costMicroUsd);
    const first = matching[0];
    if (first === undefined) continue;
    relevantTokens += tokens;
    relevantRunCount += 1;
    if (run.receipt.usage.confidence === "exact") exact += 1;
    if (run.receipt.usage.confidence === "bounded") bounded += 1;
    credited.set(first.source.id, Math.min(maxCreditedTokensPerOutcome, (credited.get(first.source.id) ?? 0) + tokens));
  }
  return {
    reportedTokens,
    relevantTokens,
    creditedTokens: [...credited.values()].reduce((total, value) => total + value, 0),
    ambiguousTokens: reportedTokens - relevantTokens,
    estimatedCostMicroUsd: cost,
    runCount,
    relevantRunCount,
    confidence: exact > 0 && bounded === 0 ? "verified-device" : exact + bounded > 0 ? "partial" : "none",
  };
}

function totalUsage(leaders: ReadonlyArray<ProjectContributor>): UsageSummary {
  const sum = (field: "reportedTokens" | "relevantTokens" | "creditedTokens" | "ambiguousTokens" | "runCount" | "relevantRunCount") => leaders.reduce((total, leader) => total + leader.usage[field], 0);
  const verified = leaders.some((leader) => leader.usage.confidence === "verified-device");
  const allVerified = leaders.every((leader) => leader.usage.runCount === 0 || leader.usage.confidence === "verified-device");
  return {
    reportedTokens: sum("reportedTokens"),
    relevantTokens: sum("relevantTokens"),
    creditedTokens: sum("creditedTokens"),
    ambiguousTokens: sum("ambiguousTokens"),
    estimatedCostMicroUsd: leaders.reduce((total, leader) => total + leader.usage.estimatedCostMicroUsd, 0n),
    runCount: sum("runCount"),
    relevantRunCount: sum("relevantRunCount"),
    confidence: verified ? (allVerified ? "verified-device" : "partial") : leaders.some((leader) => leader.usage.confidence === "partial") ? "partial" : "none",
  };
}

function grouped<T>(rows: ReadonlyArray<T>, keyOf: (row: T) => string | undefined): ReadonlyMap<string, ReadonlyArray<T>> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function earnedWeight(cycleId: string, events: ReadonlyArray<ScoreEvent>, earnedPoints: number): bigint {
  if (cycleId >= pointsWeightFromCycle) return BigInt(earnedPoints) * 1_000n;
  return events.reduce((total, event) => total + BigInt(pointsOf(eventThirds(event))) * BigInt(10_000 + (event.evidenceBonusBasisPoints ?? 0)), 0n) / 10n;
}

function contributor(request: { readonly project: ProjectTerms; readonly cycleId: string; readonly actor: GitHubActor; readonly events: ReadonlyArray<ScoreEvent>; readonly runs: ReadonlyArray<UniqueRun>; readonly penaltyThirds: number }): ProjectContributor {
  const { project, cycleId, actor, events, runs } = request;
  const earnedPoints = events.reduce((total, event) => total + pointsOf(eventThirds(event)), 0);
  const penaltyPoints = pointsOf(request.penaltyThirds);
  const points = earnedPoints - penaltyPoints;
  const exactWeight = earnedWeight(cycleId, events, earnedPoints);
  const payoutExclusion = payoutExclusionFor(project, cycleId, actor.id);
  const weighted = penaltyPoints === 0 ? exactWeight : (exactWeight * BigInt(points)) / BigInt(earnedPoints);
  const categoryPoints: Record<ScoreCategory, number> = { "merged-pull-request": 0, "resolved-issue": 0, "material-test-change": 0, evidence: 0, "substantive-review": 0, "evaluated-contribution": 0 };
  for (const event of events) categoryPoints[event.category as ScoreCategory] += event.points;
  return {
    rank: 0,
    actor,
    points,
    penaltyPoints,
    weight: payoutExclusion === null ? weighted : 0n,
    computeBonusBasisPoints: earnedPoints === 0 ? 0 : Number((exactWeight * 10n) / BigInt(earnedPoints)) - 10_000,
    categoryPoints,
    acceptedOutcomeCount: events.length,
    evidenceEventIds: events.map((event) => event.id).sort(),
    reportedModels: [...new Set(runs.map((run) => `${run.receipt.provider}/${run.receipt.model}`))].sort(),
    usage: usageOf(events, runs),
    capUsage: capUsageOf(cycleId, events),
    payoutExclusion,
  };
}

function rewardOf(project: ProjectTerms, cycleId: string, funding: FundingBasis | undefined, leaders: ReadonlyArray<ProjectContributor>): RewardedLeaders {
  const terms = project.reward;
  if (terms.kind === "external-prize-share") {
    const platformSharePartsPerMillion = (sharePartsPerMillion * terms.feeBasisPoints) / 10_000;
    const shares = allocateByWeight(BigInt(sharePartsPerMillion - platformSharePartsPerMillion), leaders);
    return {
      kind: "external-prize-share",
      leaders: leaders.map((leader, index) => ({ ...leader, projectedSharePartsPerMillion: shares[index] })),
      reward: {
        kind: "external-prize-share",
        opportunityName: terms.opportunityName ?? "External opportunity",
        advertisedAmountDisplay: terms.advertisedAmountDisplay ?? "Undisclosed",
        totalSharePartsPerMillion: shares.reduce((total, share) => total + share, 0n),
        platformSharePartsPerMillion,
        status: "provisional-share-only",
      },
    };
  }
  const capMinor = funding?.monthlyCapMinor ?? capFor(terms, cycleId);
  const funded = fundedMinor(funding ?? { fundingState: terms.fundingState, committedMinor: 0n, monthlyCapMinor: capMinor });
  const escrow = terms.escrow !== undefined && cycleId >= terms.escrow.effectiveCycle ? terms.escrow : undefined;
  const recipient = (gross: bigint) => (escrow === undefined ? gross : gross - ordinaryFeeBase(gross));
  const projected = allocateByWeight(funded, leaders);
  const simulated = allocateByWeight(capMinor, leaders);
  return {
    kind: "monthly-pool",
    leaders: leaders.map((leader, index) => ({ ...leader, simulatedMinor: recipient(simulated[index]), projectedMinor: recipient(projected[index]) })),
    reward: {
      kind: "monthly-pool",
      currency: terms.currency,
      chain: escrow?.chain ?? terms.chain,
      capMinor,
      projectedPrincipalMinor: projected.reduce((total, amount) => total + recipient(amount), 0n),
      platformFeeMinor: escrow === undefined ? (funded * BigInt(terms.escrow === undefined ? terms.feeBasisPoints : 100)) / 10_000n : projected.reduce((total, amount) => total + ordinaryFeeBase(amount), 0n),
      status: "simulation",
    },
  };
}

function paymentViewOf(request: ProjectCycleRequest): ProjectCycleView {
  if (request.payment === undefined) throw new RangeError("Payment allocation requires the production-release review basis");
  return projectCycleView({ ...request, snapshot: request.payment, payment: undefined });
}

/** @throws {RangeError} */
export function projectCycleView(request: ProjectCycleRequest): ProjectCycleView {
  const { snapshot, project, registry } = request;
  if (!projectActivityCollected(snapshot, project, request.cycleId)) throw new RangeError(`Snapshot has not collected activity for ${project.id}`);
  const bounds = windowOf(snapshot, project, request.cycleId);
  const { cycleId, from, to } = bounds;
  if (to < from) throw new RangeError(`Cycle ${cycleId} does not overlap the available snapshot for ${project.id}`);
  const repositoryIds = new Set(countedRepositories(snapshot, project, request.cycleId).map((repository) => repository.id));
  const inCycle = (record: { readonly repository: string; readonly occurredAt: string }) => {
    const at = Date.parse(record.occurredAt);
    return repositoryIds.has(record.repository) && at >= from && at < to;
  };
  const ledger = snapshot.ledger.filter(inCycle).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || left.id.localeCompare(right.id));
  const { conflicts, runs } = uniqueRuns(snapshot, project);
  const eventsByActor = grouped(ledger, (event) => event.actor.id);
  const runsByActor = grouped(runs, (run) => run.attribution.actor?.id);
  const paymentView = snapshot.paymentReviewBasis !== undefined && cycleId >= paymentBasisFromCycle && project.reward.kind === "monthly-pool" ? paymentViewOf(request) : undefined;
  const actors = new Map<string, GitHubActor>(ledger.map((event) => [event.actor.id, event.actor]));
  for (const leader of paymentView?.leaders ?? []) actors.set(leader.actor.id, leader.actor);
  const deductions = penaltyDeductions(registryOf(registry), ledger, (snapshot.penalties ?? []).filter(inCycle)).byActor;
  const unranked = [...actors.values()]
    .map((actor) => contributor({ project, cycleId, actor, events: eventsByActor.get(actor.id) ?? [], runs: runsByActor.get(actor.id) ?? [], penaltyThirds: deductions.get(actor.id) ?? 0 }))
    .sort((left, right) => (left.weight === right.weight ? 0 : left.weight < right.weight ? 1 : -1) || Math.floor(right.points / 30) - Math.floor(left.points / 30) || compareActors(left.actor, right.actor));
  const totals = unranked.map((leader) => leader.points);
  const paymentWeights = paymentView === undefined ? undefined : new Map(paymentView.leaders.map((leader) => [leader.actor.id, leader.weight]));
  const ranked = unranked.map((leader) => ({ ...leader, rank: rankAt(totals, leader.points), weight: paymentWeights === undefined ? leader.weight : (paymentWeights.get(leader.actor.id) ?? 0n) }));
  const rewarded = rewardOf(project, cycleId, request.funding, ranked);
  const opportunities = snapshot.opportunities
    .filter((opportunity) => repositoryIds.has(opportunity.repository))
    .flatMap((opportunity) => {
      const potentialPoints = pointsWithinCap(opportunity, capUsageOf(cycleId, eventsByActor.get(opportunity.actor.id) ?? []));
      return potentialPoints === null || potentialPoints > 0 ? [{ ...opportunity, potentialPoints }] : [];
    })
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || left.source.number - right.source.number || left.id.localeCompare(right.id));
  return {
    ...rewarded,
    project,
    generatedAt: snapshot.generatedAt,
    cycle: { id: cycleId, from: iso(from), to: iso(to), endsAt: iso(bounds.calendarTo), status: Date.parse(snapshot.window.to) >= bounds.calendarTo ? "closed" : "live" },
    ledger,
    opportunities,
    workQueue: {
      issues: snapshot.workQueue.issues.filter((item) => repositoryIds.has(item.repository)),
      pullRequests: snapshot.workQueue.pullRequests.filter((item) => repositoryIds.has(item.repository)),
    },
    usage: totalUsage(rewarded.leaders),
    receiptConflicts: conflicts,
  };
}

/** @throws {RangeError} */
export function projectCycleViews(request: Omit<ProjectCycleRequest, "project" | "cycleId" | "funding"> & { readonly projects: ReadonlyArray<ProjectTerms> }): ReadonlyArray<ProjectCycleView> {
  return request.projects
    .filter((project) => projectCycleHasOpened(request.snapshot, project) && projectActivityCollected(request.snapshot, project))
    .map((project) => projectCycleView({ snapshot: request.snapshot, payment: request.payment, registry: request.registry, project }));
}
