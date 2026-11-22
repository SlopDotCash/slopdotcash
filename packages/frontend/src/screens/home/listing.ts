// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/poolListing.md, "An active monthly pool without an open security program is listed only while its pool shows as funded"; spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
import { fromAmount } from "@repo/settlement/kernels/amounts";
import { type HomeCard, homeBefore, homeGroup, homeShownAmount, type ListingFacts, listedThisMonth as listedThisMonthOf } from "../../../gen/frontend__poolListing.ts";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { projectImage } from "../../../gen/frontend__presentation.ts";
import { type PoolFacts, type PromiseFacts, poolDisplay, promiseText, promiseWarning } from "../../../gen/frontend__projections.ts";
import { listedForDiscovery, reviewBudgetShown } from "../../../gen/frontend__views.ts";
import { formatRewardMinor, type PoolCommitment } from "../../kernels/assetText.ts";
import { type CardProject, cardPolicy, hasBountyOverview, hasProjectCardBounty, projectRewardSummaries, type RewardSummary, type SecurityBounty } from "../../kernels/rewardSummary.ts";
import { noPromise } from "./promise.ts";

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
  readonly funding: PoolFacts;
  readonly promise?: PromiseFacts;
  readonly reward: CardProject["reward"] & {
    readonly monthlyCapDisplay: string;
    readonly chain?: string;
    readonly reviewBudget?: PoolCommitment;
    readonly externalOpportunity?: { readonly name?: string; readonly advertisedAmountDisplay?: string };
  };
  readonly securityBounty?: SecurityBounty & { readonly funding: { readonly state: string } };
  readonly escrow?: { readonly deployments: ReadonlyArray<{ readonly network: string }> };
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
  return bounty.funding.state === "pledged" ? "Pledged" : "Funded";
}

/** @throws {never} */
export function compactPrizeLabel(label: string): string {
  return label.replace(/\$([\d,]+)(?![\d,.])/gu, (_amount, digits: string) => prizeCompact.format(BigInt(digits.replaceAll(",", ""))).toLowerCase());
}

/** @throws {RangeError} */
export function reviewBudgetLabel(budget: PoolCommitment): string {
  return budget.fundingState === "committed" ? `${formatRewardMinor(budget.committedMinor)} of ${budget.monthlyCapDisplay} review budget funded` : `${budget.monthlyCapDisplay} review budget · not funded`;
}

/** The project's honor-system facts this month; none without the owner's opt-in. @throws {never} */
export function promiseOf(project: Pick<ListedProject, "funding" | "promise">): PromiseFacts {
  return project.promise ?? noPromise(project.funding);
}

/** @throws {RangeError} */
function amountOf(summary: RewardSummary | undefined, project: ListedProject): string {
  switch (summary?.kind) {
    case "security-bounty":
      return `${summary.amount} / ${eligibilityWord(summary)}`;
    case "monthly-pool":
      return poolDisplay(project.funding) === "PoolFunded" ? `${summary.amount}${summary.token ? ` ${summary.token.symbol}` : ""}/mo` : "Points only";
    case "external-prize":
      return "Points + external prize";
    case "points-only":
    case undefined:
      return "Points only";
    default: {
      const _exhaustive: never = summary;
      return _exhaustive;
    }
  }
}

/** A home card's reward line: its open offer, its funded or promised monthly pool, an external prize, or Points only. @throws {RangeError} */
export function cardAmount(project: ListedProject): string {
  const bounty = hasProjectCardBounty(project);
  const warning = promiseWarning(promiseOf(project));
  if (!bounty && warning !== "NoPromise") return `${formatRewardMinor(fromAmount(project.funding.amount), project.rewardAsset)}/mo · ${promiseText(warning)}`;
  return amountOf(projectRewardSummaries(project).find((summary) => (summary.kind === "security-bounty") === bounty), project);
}

/** A home card's review budget, once its funding is committed. @throws {RangeError} */
export function cardNote(project: ListedProject): string | undefined {
  const budget = project.reward.reviewBudget;
  return budget && reviewBudgetShown(budget.fundingState === "committed") ? `+${formatRewardMinor(budget.committedMinor)} reviews` : undefined;
}

/** @throws {never} */
export function openOffers(projects: ReadonlyArray<ListedProject>): ListedProject[] {
  return projects.filter((project) => project.status === "active" && project.securityBounty?.status === "open");
}

/** This month's listing facts of a project: whether it is active, whether its security program is open, and its pool. @throws {never} */
export function listingOf(project: Pick<CardProject, "status" | "securityBounty"> & { readonly funding: PoolFacts }): ListingFacts {
  return { active: project.status === "active", securityOpen: project.securityBounty?.status === "open", pool: project.funding };
}

/** Whether /sponsors and agent discovery list the project this month; every project while the funding read is not current. @throws {never} */
export function listedThisMonth(project: ListedProject): boolean {
  return listedThisMonthOf(listingOf(project));
}

/** Every open Featured or Community project whose card does not advertise a security bounty, in registry order. @throws {never} */
export function homeProjects<P extends ListedProject>(projects: ReadonlyArray<P>): P[] {
  return projects.filter((project) => project.listingTier !== "retired" && listedForDiscovery(cardPolicy(project)) && !hasProjectCardBounty(project));
}

export const homeTiers = ["featured", "community"] as const;

export type HomeTier = (typeof homeTiers)[number];

/** @throws {RangeError} */
function homeCard(project: ListedProject, index: number): HomeCard {
  const amount = homeShownAmount(promiseOf(project));
  const stablecoin = project.rewardAsset === undefined || project.rewardAsset.kind === "stablecoin";
  return { group: homeGroup(cardPolicy(project).reward, amount, stablecoin), amount, featured: project.listingTier === "featured", index };
}

/** Home's order over the projects as shown this month. @throws {RangeError} */
export function homeProjectOrder<P extends ListedProject>(projects: ReadonlyArray<P>): P[] {
  return projects
    .map((project, index) => ({ project, card: homeCard(project, index) }))
    .sort((left, right) => (homeBefore(left.card, right.card) ? -1 : homeBefore(right.card, left.card) ? 1 : 0))
    .map(({ project }) => project);
}

/** Home's Featured then Community sections, each in the home order computed once over every home project; an empty tier has no section. @throws {RangeError} */
export function homeSections<P extends ListedProject>(projects: ReadonlyArray<P>): ReadonlyArray<{ readonly tier: HomeTier; readonly projects: P[] }> {
  const shown = homeProjectOrder(homeProjects(projects));
  return homeTiers.map((tier) => ({ tier, projects: shown.filter((project) => project.listingTier === tier) })).filter((section) => section.projects.length > 0);
}
