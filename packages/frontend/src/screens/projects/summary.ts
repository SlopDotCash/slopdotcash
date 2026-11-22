// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"; spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/frontend/views.md, "Suggested work lists the wanted issues first, unclaimed before taken, at most ten, and a failed wanted read leaves the suggestions as before"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"
import type { MergeRepository, WantedIssue } from "@repo/backend/client";
import type { WorkItem, WorkQueue } from "@repo/points/client";
import type { CycleIndex, CycleIndexEntry, DirectTransfer } from "@repo/settlement/client";
import { fromAmount, parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { formatPeriod, type Period } from "@repo/settlement/kernels/calendar";
import { Result, Schema } from "effect";
import type { StoredCount } from "../../../gen/backend__intakeCap.ts";
import { wantedLabelName } from "../../../gen/backend__mergeActivity.ts";
import { intakeHeld, type ListingFacts } from "../../../gen/frontend__poolListing.ts";
import { type PromiseFacts, promiseWarning } from "../../../gen/frontend__projections.ts";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { type WantedRead, wantedListed } from "../../../gen/frontend__views.ts";
import { formatRewardMinor } from "../../kernels/assetText.ts";
import { type PoolFunding, poolFunding, zeroedPoolCap } from "../../kernels/poolFunding.ts";
import type { NetworkPays } from "../public/funding.ts";
import { bootstrapPrompt, siteOrigin } from "../home/agentLinks.ts";
import type { Shown } from "../home/listing.ts";
import { projectPromise } from "../home/promise.ts";
import { poolReadOf, rowsValid, totalOf } from "./history.ts";
import type { ShownProject } from "./project.schema.ts";

export interface FundingVaults {
  readonly status: ReadStatus;
  readonly vaults: Parameters<typeof poolFunding>[0]["vaults"] | undefined;
}

export interface DirectMonth {
  readonly month: string;
  readonly amountMicro: bigint;
  readonly count: number;
}

export type MergeRows = ReadonlyArray<MergeRepository>;

export type MergeIndex = ReadonlyMap<string, MergeRows>;

export interface ShownWanted extends WantedIssue {
  readonly repository: string;
}

export const workShown = 10;

const hourMs = 3_600_000;

const SlopbotSettings = Schema.Struct({
  slopbot: Schema.optional(Schema.Struct({ intakeCap: Schema.optional(Schema.Number), wantedIssues: Schema.optional(Schema.Boolean) })),
});

const decodeSlopbot = Schema.decodeUnknownResult(SlopbotSettings);

const failedReads: ReadonlySet<ReadStatus> = new Set(["Denied", "Invalid", "Unavailable", "Failed", "Cancelled"]);

export const historyShown = 3;

const dayFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC", year: "numeric" });

/** @throws {RangeError} */
export function formatDate(iso: string): string {
  return dayFormat.format(new Date(iso));
}

/** "December 2026" for "2026-12". @throws {RangeError} */
export function formatMonth(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00.000Z`));
}

/** @throws {never} */
export function capOf(project: ShownProject, period: Period): bigint {
  const month = formatPeriod(period);
  return project.reward.cycleCaps.find((cap) => cap.cycleId === month)?.monthlyCapMinor ?? project.reward.monthlyCapMinor;
}

/** This month's pool funding as the vaults' cached finalized reads show it. @throws {RangeError} */
export function projectFunding({ project, read, networkPays, nowMs }: { project: ShownProject; read: FundingVaults; networkPays: NetworkPays; nowMs: number }): PoolFunding {
  return poolFunding({
    pool: { monthlyPool: project.reward.kind === "monthly-pool", deployments: project.deployments, capFor: (period) => capOf(project, period) },
    read: poolReadOf(read.status),
    vaults: read.vaults ?? [],
    networkPays,
    nowMs,
  });
}

/** The project page's listing facts this month, from the registry alone: the configured amount of the UTC month, never a funding read. @throws {RangeError} */
export function projectListing({ project, networkPays, nowMs }: { project: ShownProject; networkPays: NetworkPays; nowMs: number }): ListingFacts {
  const funding = projectFunding({ project, read: { status: "Idle", vaults: undefined }, networkPays, nowMs });
  return { securityOpen: project.securityBounty?.status === "open", pool: funding.facts };
}

/** The owner's Slopbot settings of an active project: the intake cap, zero while off, and whether the wanted label is on. @throws {never} */
export function slopbotSettings(project: Pick<ShownProject, "status" | "record">): { readonly active: boolean; readonly intakeCap: number; readonly wantedIssues: boolean } {
  const decoded = decodeSlopbot(project.record);
  const record = Result.isSuccess(decoded) ? decoded.success : undefined;
  const cap = record?.slopbot?.intakeCap;
  return { active: project.status === "active", intakeCap: cap !== undefined && Number.isSafeInteger(cap) ? cap : 0, wantedIssues: record?.slopbot?.wantedIssues === true };
}

/** One repository's stored count of open outside pull requests, in whole hours; a row read before the count existed holds nothing. @throws {never} */
function storedCount(row: MergeRepository): StoredCount {
  const observed = Date.parse(row.observedAt);
  return row.openOutside === null || !Number.isFinite(observed) ? { read: false, count: 0, observedAt: 0 } : { read: true, count: row.openOutside, observedAt: Math.floor(observed / hourMs) };
}

/** @throws {never} */
function counted(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** @throws {never} */
function wantedIssueValid(issue: WantedIssue, repository: string): boolean {
  return Number.isSafeInteger(issue.number) && issue.number > 0 && issue.url.toLowerCase() === `https://github.com/${repository}/issues/${issue.number}`.toLowerCase() && counted(issue.openPullRequests);
}

/** Whether every stored merge activity row is one the page may show: dated, counted in whole non-negative numbers, and each wanted issue an issue of its own repository. @throws {never} */
export function mergeIndexValid(index: MergeIndex): boolean {
  return [...index.values()].every((rows) =>
    rows.every(
      (row) =>
        Number.isFinite(Date.parse(row.observedAt)) &&
        (row.lastMergedAt === null || Number.isFinite(Date.parse(row.lastMergedAt))) &&
        counted(row.waitingOutside) &&
        counted(row.mergedOutsideLast30Days) &&
        (row.openOutside === null || counted(row.openOutside)) &&
        (row.medianHoursToMerge === null || row.medianHoursToMerge >= 0) &&
        (row.wantedLabel === undefined) === (row.wantedIssues === undefined) &&
        (row.wantedIssues ?? []).every((issue) => wantedIssueValid(issue, row.repository)),
    ),
  );
}

/** Whether the project is held at its intake cap by the merge activity read; a pending or failed read holds nothing. @throws {never} */
export function projectHeld(project: Pick<ShownProject, "id" | "status" | "record">, merge: Shown<MergeIndex>, nowMs: number): boolean {
  if (merge.status !== "Current" && merge.status !== "Stale") return false;
  const { active, intakeCap } = slopbotSettings(project);
  return intakeHeld(intakeCap, active, (merge.value?.get(project.id) ?? []).map(storedCount), Math.floor(nowMs / hourMs));
}

/** The project's open wanted issues as the merge activity read supplies them, read only with the current label of an active project that turned it on. @throws {never} */
export function wantedReadOf(project: Pick<ShownProject, "id" | "status" | "record">, merge: Shown<MergeIndex>): { readonly read: WantedRead; readonly issues: ReadonlyArray<ShownWanted> } {
  const { active, wantedIssues } = slopbotSettings(project);
  if (!active || !wantedIssues) return { read: { tag: "WantedReady", issues: [] }, issues: [] };
  if (merge.status === "Loading" || merge.status === "Idle") return { read: { tag: "WantedPending" }, issues: [] };
  if (failedReads.has(merge.status)) return { read: { tag: "WantedFailed" }, issues: [] };
  const issues = (merge.value?.get(project.id) ?? []).flatMap((row) => (row.wantedLabel === wantedLabelName && row.wantedIssues ? row.wantedIssues.map((issue) => ({ ...issue, repository: row.repository })) : []));
  const byUrl = new Map(issues.map((issue) => [issue.url, issue] as const));
  const read: WantedRead = { tag: "WantedReady", issues: issues.map(({ url, openPullRequests }) => ({ url, openPulls: openPullRequests })) };
  return { read, issues: wantedListed(read).flatMap(({ url }) => byUrl.get(url) ?? []) };
}

/** The project as its reward summary may show it: an unfunded pool's cap reads as zero. @throws {never} */
function shownReward(project: ShownProject, funding: PoolFunding): ShownProject {
  const zeroed = zeroedPoolCap(
    { monthlyPool: project.reward.kind === "monthly-pool", monthlyCapMinor: project.reward.monthlyCapMinor, hasCycleCaps: project.reward.cycleCaps.length > 0, assetKind: project.rewardAsset?.kind },
    funding,
  );
  return zeroed === undefined ? project : { ...project, reward: { ...project.reward, ...zeroed, cycleCaps: [] } };
}

/** The owner's honor-system facts this month, from the project's recorded paying vaults and the cached vault reads. @throws {never} */
export function projectPromiseOf({ project, funding, read, networkPays }: { project: ShownProject; funding: PoolFunding; read: FundingVaults; networkPays: NetworkPays }): PromiseFacts {
  return projectPromise({ pool: funding.facts, honorSystem: project.reward.honorSystem === true, deployments: project.deployments, vaults: read.vaults ?? [], networkPays });
}

/** The project as its reward line shows it: a promised month keeps this month's amount, an unfunded pool otherwise reads as zero. @throws {RangeError} */
export function shownPool(project: ShownProject, funding: PoolFunding, promise: PromiseFacts): ShownProject {
  if (promiseWarning(promise) === "NoPromise") return shownReward(project, funding);
  const month = fromAmount(funding.facts.amount);
  return { ...project, reward: { ...project.reward, monthlyCapMinor: month, monthlyCapDisplay: formatRewardMinor(month, project.rewardAsset), cycleCaps: [] } };
}

/** The repository the prompt names: its current path after a transfer. @throws {never} */
export function contributionRepository(project: Pick<ShownProject, "repositories">): string | undefined {
  const target = project.repositories[0];
  return target?.aliases?.at(-1) ?? target?.id;
}

/** @throws {never} */
export function projectPrompt(project: Pick<ShownProject, "repositories">, origin: string): string {
  const repository = contributionRepository(project);
  return repository === undefined ? bootstrapPrompt(origin) : `Read ${siteOrigin(origin)}/SKILL.md and follow it to contribute to github.com/${repository}.`;
}

/** The snapshot's suggested work in the project's repositories that nothing blocks, without the wanted issues listed above it. @throws {never} */
export function suggestedWork(queue: WorkQueue, project: Pick<ShownProject, "repositories">, wanted: ReadonlyArray<Pick<WantedIssue, "url">>): ReadonlyArray<WorkItem> {
  const repositories = new Set(project.repositories.map(({ id }) => id));
  const wantedUrls = new Set(wanted.map(({ url }) => url.toLowerCase()));
  return [queue.issues, queue.pullRequests].flatMap((items) => items.filter((item) => repositories.has(item.repository) && item.selection.status === "candidate" && !wantedUrls.has(item.url.toLowerCase())));
}

/** Direct payments by contribution month, newest month first. @throws {never} */
export function directMonths(transfers: ReadonlyArray<DirectTransfer>): ReadonlyArray<DirectMonth> {
  const months = new Map<string, ReadonlyArray<DirectTransfer>>();
  for (const transfer of transfers) months.set(transfer.contributionMonth, [...(months.get(transfer.contributionMonth) ?? []), transfer]);
  return [...months]
    .map(([month, paid]) => ({
      month,
      amountMicro: totalOf(paid.map((transfer) => parseBaseUnits(transfer.amountMicro) ?? 0n)),
      count: paid.length,
    }))
    .sort((left, right) => right.month.localeCompare(left.month));
}

/** Whether the cycle index is canonical: newest cycle first, each project cycle once, base-unit amounts, and no entry generated after the index. @throws {never} */
export function indexValid(index: CycleIndex): boolean {
  const seen = new Set<string>();
  const rows = index.cycles.map((current, position) => {
    const previous = index.cycles[position - 1];
    const key = `${current.projectId}\0${current.cycleId}`;
    const firstSeen = !seen.has(key);
    seen.add(key);
    const generatedMs = Date.parse(current.generatedAt);
    return {
      follows: previous === undefined || previous.cycleId > current.cycleId || (previous.cycleId === current.cycleId && previous.projectId.localeCompare(current.projectId) <= 0),
      firstSeen,
      amounts: [current.reward.approvedMinor, current.reward.feeMinor, current.reward.paidMinor].every((minor) => parseBaseUnits(minor) !== undefined),
      dated: Number.isFinite(generatedMs),
      generatedMs: Number.isFinite(generatedMs) ? generatedMs : 0,
    };
  });
  const generatedMs = Date.parse(index.generatedAt);
  return Number.isFinite(generatedMs) && rowsValid(rows, generatedMs);
}

/** The project's published cycles, newest first. @throws {never} */
export function projectCycles(cycles: ReadonlyArray<CycleIndexEntry>, projectId: string): ReadonlyArray<CycleIndexEntry> {
  return cycles.filter((cycle) => cycle.projectId === projectId).sort((left, right) => right.cycleId.localeCompare(left.cycleId));
}

/** The months whose monthly-pool cycle lists contributors, for the owner's award review. @throws {never} */
export function awardMonths(cycles: ReadonlyArray<CycleIndexEntry>, projectId: string): ReadonlyArray<string> {
  return cycles.filter((cycle) => cycle.projectId === projectId && cycle.kind === "monthly-pool" && cycle.contributors.length > 0).map((cycle) => cycle.cycleId);
}
