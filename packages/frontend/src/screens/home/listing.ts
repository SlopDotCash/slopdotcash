// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/poolListing.md, "Home shows one grid of the open Featured and Community projects that are listed this month, leaving bounty cards to the security bounties section"; spec/frontend/poolListing.md, "The home grid orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"
import { toAmount } from "@repo/settlement/kernels/amounts";
import { type HomeCard, homeBefore, homeGroup } from "../../../gen/frontend__poolListing.ts";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { projectImage } from "../../../gen/frontend__presentation.ts";
import type { PoolDisplay } from "../../../gen/frontend__projections.ts";
import { listedForDiscovery } from "../../../gen/frontend__views.ts";
import { formatRewardMinor, type PoolCommitment } from "../../kernels/assetText.ts";
import { type CardProject, cardPolicy, hasBountyOverview, hasProjectCardBounty, projectRewardSummaries, type RewardSummary, type SecurityBounty } from "../../kernels/rewardSummary.ts";

export interface Shown<T> {
  readonly status: ReadStatus;
  readonly value: T | undefined;
  readonly onRetry?: () => void;
}

export interface ListedRepository {
  readonly id: string;
  readonly aliases?: ReadonlyArray<string>;
}

export interface ListedProject extends CardProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly repositories: ReadonlyArray<ListedRepository>;
  readonly pool: PoolDisplay;
  readonly reward: CardProject["reward"] & {
    readonly monthlyCapDisplay: string;
    readonly chain?: string;
    readonly reviewBudget?: PoolCommitment;
    readonly externalOpportunity?: { readonly name?: string; readonly advertisedAmountDisplay?: string };
  };
  readonly securityBounty?: SecurityBounty & { readonly funding: { readonly state: string } };
  readonly escrow?: { readonly deployments: ReadonlyArray<{ readonly network: string }> };
}

export interface CardLine {
  readonly amount: string;
  readonly state?: string;
}

const prizeCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

/** @throws {never} */
export function projectHref(project: Pick<ListedProject, "slug">): string {
  return `/projects/${project.slug}`;
}

/** @throws {never} */
export function offerHref(project: ListedProject): string {
  return hasBountyOverview(project) ? projectHref(project) : `${projectHref(project)}/security`;
}

/** @throws {URIError} */
export function imageOf(project: ListedProject): string {
  const repository = project.repositories[0];
  const owner = (repository?.aliases?.at(-1) ?? repository?.id ?? "").split("/")[0] ?? "";
  return projectImage(project.image ?? "", owner ? `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?size=96` : "");
}

/** @throws {never} */
export function eligibilityWord(bounty: Pick<SecurityBounty, "eligibility">): string {
  return bounty.eligibility === "critical-loss-of-funds" ? "Critical" : "Finding";
}

/** @throws {never} */
export function bountyFundingLabel(bounty: NonNullable<ListedProject["securityBounty"]>): string {
  return bounty.funding.state === "pledged" ? "Pledged" : "Funding verified";
}

/** @throws {never} */
export function compactPrizeLabel(label: string): string {
  return label.replace(/\$([\d,]+)(?![\d,.])/gu, (_amount, digits: string) => prizeCompact.format(BigInt(digits.replaceAll(",", ""))).toLowerCase());
}

/** @throws {RangeError} */
export function reviewBudgetLabel(budget: PoolCommitment): string {
  return budget.fundingState === "committed" ? `${formatRewardMinor(budget.committedMinor)} of ${budget.monthlyCapDisplay} review budget funded` : `${budget.monthlyCapDisplay} review budget · not funded`;
}

function lineOf(summary: RewardSummary | undefined, project: ListedProject): CardLine {
  switch (summary?.kind) {
    case "security-bounty":
      return { amount: `${summary.amount} / ${eligibilityWord(summary)}`, state: project.securityBounty ? bountyFundingLabel(project.securityBounty) : undefined };
    case "monthly-pool":
      return project.pool === "PoolFunded" ? { amount: `${summary.amount}${summary.token ? ` ${summary.token.symbol}` : ""}/mo` } : { amount: "Points only" };
    case "external-prize":
      return { amount: `${compactPrizeLabel(summary.amount ?? "External")} + points`, state: "External prize" };
    case "points-only":
    case undefined:
      return { amount: "Points only" };
    default: {
      const _exhaustive: never = summary;
      return _exhaustive;
    }
  }
}

/** @throws {RangeError} */
export function cardLine(project: ListedProject): CardLine {
  const bounty = hasProjectCardBounty(project);
  const summaries = projectRewardSummaries(project);
  return lineOf(summaries.find((summary) => (summary.kind === "security-bounty") === bounty), project);
}

/** @throws {RangeError} */
export function cardNotes(project: ListedProject, merge: string | null): string[] {
  const { state } = cardLine(project);
  return [state, project.reward.reviewBudget ? `+ ${reviewBudgetLabel(project.reward.reviewBudget)}` : undefined, merge ?? undefined].filter((note) => note !== undefined);
}

/** @throws {never} */
export function openOffers(projects: ReadonlyArray<ListedProject>): ListedProject[] {
  return projects.filter((project) => project.status === "active" && project.securityBounty?.status === "open");
}

/** Every open Featured or Community project whose card does not advertise a security bounty, in registry order. @throws {never} */
export function homeProjects<P extends ListedProject>(projects: ReadonlyArray<P>): P[] {
  return projects.filter((project) => project.listingTier !== "retired" && listedForDiscovery(cardPolicy(project)) && !hasProjectCardBounty(project));
}

/** @throws {RangeError} */
function homeCard(project: ListedProject, index: number): HomeCard {
  const amount = toAmount(project.reward.kind === "monthly-pool" && project.pool === "PoolFunded" ? project.reward.monthlyCapMinor : 0n);
  const stablecoin = project.rewardAsset === undefined || project.rewardAsset.kind === "stablecoin";
  return { group: homeGroup(cardPolicy(project).reward, amount, stablecoin), amount, featured: project.listingTier === "featured", index };
}

/** The home grid's order over the projects as shown this month. @throws {RangeError} */
export function homeProjectOrder<P extends ListedProject>(projects: ReadonlyArray<P>): P[] {
  return projects
    .map((project, index) => ({ project, card: homeCard(project, index) }))
    .sort((left, right) => (homeBefore(left.card, right.card) ? -1 : homeBefore(right.card, left.card) ? 1 : 0))
    .map(({ project }) => project);
}
