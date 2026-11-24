// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month's configured amount is positive"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"; spec/frontend/projections.md, "Free funds show how many whole months of the current amount they cover"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"; spec/backend/backlogRule.md, "The lists leave an out-of-rotation project out and its page says why"
import { formatBaseUnits, fromAmount } from "@repo/settlement/kernels/amounts";
import type { Tier } from "../../../gen/backend__projects.ts";
import { type HomeCard, type HomeEntry, homeBefore, homeDescriptionLimit, homeGroup, type ListingFacts, listedThisMonth as listedThisMonthOf, onHome } from "../../../gen/frontend__poolListing.ts";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { projectImage } from "../../../gen/frontend__presentation.ts";
import { type Coverage, type FundingTag, fundingTag, listedAmount, listingWarning, listingWarningText, type PoolFacts, type PromiseFacts } from "../../../gen/frontend__projections.ts";
import { reviewBudgetShown } from "../../../gen/frontend__views.ts";
import { formatRewardCapDisplay, formatRewardMinor, type PoolCommitment } from "../../kernels/assetText.ts";
import { type CardProject, cardPolicy, hasBountyOverview, hasProjectCardBounty, type SecurityBounty, securityBountyAmountLabel } from "../../kernels/rewardSummary.ts";
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
    readonly cycleCaps?: ReadonlyArray<unknown>;
  };
  readonly securityBounty?: SecurityBounty & { readonly funding: { readonly state: string } };
  readonly escrow?: { readonly deployments: ReadonlyArray<{ readonly network: string }> };
  /** Whether the owner's intake cap holds the project out of the lists; never while the merge activity read is pending or failed. */
  readonly held?: boolean;
  /** Whether the backlog rule holds the project out of rotation; never while the merge activity read is pending or failed. */
  readonly outOfRotation?: boolean;
  /** The owner's published maintainer share as a card line, when there is one. */
  readonly shareLine?: string;
  /** How many whole months the recorded vaults' free funds cover of this month's amount. */
  readonly coverage?: Coverage;
}

export type ShownTag = Exclude<FundingTag, "NoTag">;

export interface CardReward {
  readonly amount: string;
  readonly unit?: string;
  readonly tag?: ShownTag;
  readonly warning?: string;
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

/** The project's honor-system facts this month; none without the owner's opt-in. @throws {never} */
export function promiseOf(project: Pick<ListedProject, "funding" | "promise">): PromiseFacts {
  return project.promise ?? noPromise(project.funding);
}

/** A project's month as the listings show it: the configured amount of the UTC month, its funding tag and the warning beside it. @throws {never} */
export function listingOfMonth(project: Pick<ListedProject, "funding" | "promise">): { readonly amount: bigint; readonly tag: FundingTag; readonly warning: string } {
  const promise = promiseOf(project);
  return { amount: fromAmount(listedAmount(promise)), tag: fundingTag(promise), warning: listingWarningText(listingWarning(promise)) };
}

/** A month amount as the registry writes a monthly cap: whole dollars with two-digit cents only when there are some, or the token amount and its symbol. @throws {RangeError} */
function monthAmountDisplay(amount: bigint, asset: ListedProject["rewardAsset"]): string {
  if (asset !== undefined && asset.kind !== "stablecoin") return formatRewardMinor(amount, asset);
  if (amount % 10_000n !== 0n) throw new RangeError("monthly cap must be cent-precise");
  const cents = (amount % 1_000_000n) / 10_000n;
  return `$${formatBaseUnits({ value: amount / 1_000_000n, decimals: 0 })}${cents === 0n ? "" : `.${cents.toString().padStart(2, "0")}`}`;
}

/** The month's configured amount as its registry display writes it, rewritten when a month cap replaces the default. @throws {RangeError} */
function configuredDisplay(project: ListedProject, amount: bigint): string {
  const { reward } = project;
  const display = amount === reward.monthlyCapMinor && !reward.cycleCaps?.length ? reward.monthlyCapDisplay : monthAmountDisplay(amount, project.rewardAsset);
  return formatRewardCapDisplay(display, project.rewardAsset);
}

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** A vault-backed month in its short form: a token amount compact, a whole stablecoin amount compact in dollars. @throws {RangeError} */
function vaultedDisplay(project: ListedProject, amount: bigint): string {
  const cap = configuredDisplay(project, amount);
  const kind = project.rewardAsset?.kind;
  if (kind === "token") return cap.replace(/^[\d,]+(?=\s)/u, (digits) => compactNumber.format(BigInt(digits.replaceAll(",", ""))).toLowerCase());
  if (kind !== undefined && kind !== "stablecoin") return cap;
  if (amount % 1_000_000n !== 0n) return cap;
  return prizeCompact.format(amount / 1_000_000n).replace(/K$/u, "k");
}

/** A listing card's reward: its open offer, this month's tagged pool, an external prize, or Points only. @throws {RangeError} */
export function cardReward(project: ListedProject): CardReward {
  const bounty = hasProjectCardBounty(project) ? project.securityBounty : undefined;
  const month = listingOfMonth(project);
  const pool = project.reward.kind === "monthly-pool";
  const amount = bounty ? securityBountyAmountLabel(bounty) : pool && month.tag === "NoTag" ? "Points only" : pool ? (month.tag === "Vaulted" ? vaultedDisplay(project, month.amount) : configuredDisplay(project, month.amount)) : "Points";
  if (month.tag !== "NoTag") return { amount, unit: "/mo", tag: month.tag, ...(month.warning ? { warning: month.warning } : {}) };
  if (bounty) return { amount, unit: `/ ${eligibilityWord(bounty)}` };
  return project.reward.kind === "external-prize-share" ? { amount, unit: "+ external prize" } : { amount };
}

/** A listing card's review budget, once its funding is committed. @throws {RangeError} */
export function cardNote(project: ListedProject): string | undefined {
  const budget = project.reward.reviewBudget;
  return budget && reviewBudgetShown(budget.fundingState === "committed") ? `+${formatRewardMinor(budget.committedMinor)} reviews` : undefined;
}

/** The maintainer share line of a card, only beside a shown monthly amount. @throws {never} */
export function cardShare(project: ListedProject): string | undefined {
  return listingOfMonth(project).tag === "NoTag" ? undefined : project.shareLine;
}

/** The review budget and maintainer share lines under a listed reward, or none. @throws {RangeError} */
export function cardLines(project: ListedProject): ReadonlyArray<string> {
  return [cardNote(project), cardShare(project)].filter((line) => line !== undefined);
}

/** A description as Home shows it: at most 500 characters, cut at a code point with the trailing space trimmed. @throws {never} */
export function homeDescription(description: string): string {
  const characters = Array.from(description);
  return characters.length > homeDescriptionLimit ? `${characters.slice(0, homeDescriptionLimit).join("").trimEnd()}...` : description;
}

/** The /sponsors pool line: this month's amount in the vault or with its tag and warning, or the security bounty. @throws {RangeError} */
export function sponsorPoolLine(project: ListedProject): string {
  const month = listingOfMonth(project);
  if (month.tag === "NoTag") return "Security bounty";
  return `${configuredDisplay(project, month.amount)} monthly · ${month.warning ? `${month.tag} · ${month.warning}` : "in the vault"}`;
}

/** @throws {never} */
export function openOffers(projects: ReadonlyArray<ListedProject>): ListedProject[] {
  return projects.filter((project) => project.status === "active" && project.securityBounty?.status === "open");
}

/** This month's listing facts of a project: whether its security program is open, and its pool. @throws {never} */
function listingOf(project: Pick<CardProject, "securityBounty"> & { readonly funding: PoolFacts }): ListingFacts {
  return { securityOpen: project.securityBounty?.status === "open", pool: project.funding };
}

/** Whether /sponsors and agent discovery list the project this month, from the registry alone. @throws {never} */
export function listedThisMonth(project: ListedProject): boolean {
  return listedThisMonthOf(listingOf(project));
}

/** Whether /sponsors lists the project: listed this month and not held at its intake cap or out of rotation under the backlog rule, whatever its status. @throws {never} */
export function onSponsors(project: ListedProject): boolean {
  return listedThisMonth(project) && project.held !== true && project.outOfRotation !== true;
}

const tiers = { featured: "Featured", community: "Community", retired: "Retired" } as const satisfies Record<ListedProject["listingTier"], Tier>;

/** @throws {never} */
function homeEntry(project: ListedProject): HomeEntry {
  return { policy: cardPolicy(project), tier: tiers[project.listingTier], pool: project.funding };
}

/** Every Featured or Community project Home lists once the funding read settles, in registry order. @throws {never} */
export function homeProjects<P extends ListedProject>(projects: ReadonlyArray<P>): P[] {
  return projects.filter((project) => onHome(homeEntry(project), project.held === true || project.outOfRotation === true));
}

/** @throws {never} */
function homeCard(project: ListedProject, index: number): HomeCard {
  const amount = listedAmount(promiseOf(project));
  const stablecoin = project.rewardAsset === undefined || project.rewardAsset.kind === "stablecoin";
  return { group: homeGroup(cardPolicy(project).reward, amount, stablecoin), amount, featured: project.listingTier === "featured", index };
}

/** Home's order over the projects as listed this month. @throws {never} */
export function homeProjectOrder<P extends ListedProject>(projects: ReadonlyArray<P>): P[] {
  return projects
    .map((project, index) => ({ project, card: homeCard(project, index) }))
    .sort((left, right) => (homeBefore(left.card, right.card) ? -1 : homeBefore(right.card, left.card) ? 1 : 0))
    .map(({ project }) => project);
}

/** Home's Featured and Community sections, each in the home order computed once over every listed project. @throws {never} */
export function homeSections<P extends ListedProject>(projects: ReadonlyArray<P>): { readonly featured: P[]; readonly community: P[] } {
  const shown = homeProjectOrder(homeProjects(projects));
  return { featured: shown.filter((project) => project.listingTier === "featured"), community: shown.filter((project) => project.listingTier === "community") };
}
