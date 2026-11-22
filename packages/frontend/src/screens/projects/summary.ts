// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"; spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
import type { WorkItem, WorkQueue } from "@repo/points/client";
import type { CycleIndex, CycleIndexEntry, DirectTransfer } from "@repo/settlement/client";
import { fromAmount, parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { formatPeriod, type Period } from "@repo/settlement/kernels/calendar";
import type { ListingFacts } from "../../../gen/frontend__poolListing.ts";
import { type PromiseFacts, promiseWarning } from "../../../gen/frontend__projections.ts";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { formatRewardMinor } from "../../kernels/assetText.ts";
import { type PoolFunding, poolFunding, zeroedPoolCap } from "../../kernels/poolFunding.ts";
import type { NetworkPays } from "../public/funding.ts";
import { bootstrapPrompt, siteOrigin } from "../home/agentLinks.ts";
import { listingOf } from "../home/listing.ts";
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

export const workShown = 10;

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

/** The project page's listing facts for this month's pool funding. @throws {never} */
export function projectListing({ project, funding }: { project: ShownProject; funding: PoolFunding }): ListingFacts {
  return listingOf({ status: project.status, securityBounty: project.securityBounty, funding: funding.facts });
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

/** The snapshot's suggested work in the project's repositories that nothing blocks. @throws {never} */
export function suggestedWork(queue: WorkQueue, project: Pick<ShownProject, "repositories">): ReadonlyArray<WorkItem> {
  const repositories = new Set(project.repositories.map(({ id }) => id));
  return [queue.issues, queue.pullRequests].flatMap((items) => items.filter((item) => repositories.has(item.repository) && item.selection.status === "candidate"));
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
