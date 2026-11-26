// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month's configured amount is positive"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"
import { vectors } from "../../kernels/vectors.ts";
import type { SecurityProgramStatus } from "../../kernels/rewardSummary.ts";
import { bounty, community, configured, funded, held, pointsOnly, pool, prize, promised, reviewed, tokenPool, unread, unverified, withdrawn } from "./fixtures.ts";
import { type CardReward, cardLines, cardReward, homeDescription, homeProjectOrder, homeProjects, homeSections, listedThisMonth, type ListedProject, onSponsors, sponsorPoolLine } from "./listing.ts";

const separateBounty = (status: SecurityProgramStatus): ListedProject => ({
  ...community[0],
  id: `bounty-${status}`,
  slug: `bounty-${status}`,
  securityBounty: { rewardMode: "separate", status, eligibility: "in-scope-security", amount: { grossMinor: 50_000_000_000n, decimals: 6 }, funding: { state: "verified" } },
});

const named = (project: ListedProject, id: string, patch: Partial<ListedProject> = {}): ListedProject => ({ ...project, ...patch, id, slug: id });

const ids = (projects: ReadonlyArray<ListedProject>) => projects.map((project) => project.id);

export const cardsTagAPositiveMonthAndNameAnOpenOfferAPrizeOrPointsOnly = vectors<ListedProject, CardReward>([
  [pool, { amount: "$5k", unit: "/mo", tag: "Vaulted" }],
  [promised, { amount: "250 USDC", unit: "/mo", tag: "Promised", warning: "Not vaulted" }],
  [unverified, { amount: "250 USDC", unit: "/mo", tag: "Promised", warning: "Vault funding unverified" }],
  [configured, { amount: "250 USDC", unit: "/mo", tag: "Configured", warning: "Not vaulted" }],
  [{ ...pool, funding: withdrawn(5_000_000_000n) }, { amount: "5,000 USDC", unit: "/mo", tag: "Configured", warning: "Not vaulted" }],
  [{ ...pool, funding: pointsOnly }, { amount: "Points only" }],
  [bounty, { amount: "$50k", unit: "/ Critical" }],
  [separateBounty("open"), { amount: "$50k", unit: "/ Finding" }],
  [separateBounty("closed"), { amount: "Points only" }],
  [prize, { amount: "Points", unit: "+ external prize" }],
], cardReward);

export const cardLinesShowACommittedReviewBudgetAndTheShareBesideAShownMonth = vectors<ListedProject, ReadonlyArray<string>>([
  [pool, ["Maintainer share 10%"]],
  [{ ...pool, funding: pointsOnly }, []],
  [reviewed, ["+$300 reviews", "Maintainer share 10%"]],
  [{ ...reviewed, funding: pointsOnly, reward: { ...reviewed.reward, reviewBudget: { ...reviewed.reward.reviewBudget!, fundingState: "pledged" } } }, []],
], cardLines);

export const aMonthlyPoolIsListedOnlyWithAPositiveConfiguredAmount = vectors<ListedProject, boolean>([
  [pool, true],
  [{ ...pool, funding: withdrawn(250_000_000n) }, true],
  [{ ...pool, funding: unread(250_000_000n) }, true],
  [{ ...pool, funding: pointsOnly }, false],
  [{ ...pool, funding: { ...pointsOnly, read: "PoolFailed" } }, false],
  [{ ...pool, status: "paused", funding: pointsOnly }, false],
  [separateBounty("open"), true],
  [separateBounty("draft"), false],
  [prize, true],
], listedThisMonth);

export const sponsorsListAnyStatusButLeaveAHeldProjectOut = vectors<ListedProject, boolean>([
  [pool, true],
  [{ ...pool, status: "paused" }, true],
  [held, false],
  [{ ...pool, funding: pointsOnly }, false],
], onSponsors);

export const sponsorsWriteTheMonthWithItsTagOrInTheVault = vectors<ListedProject, string>([
  [pool, "5,000 USDC monthly · in the vault"],
  [promised, "250 USDC monthly · Promised · Not vaulted"],
  [configured, "250 USDC monthly · Configured · Not vaulted"],
  [unverified, "250 USDC monthly · Promised · Vault funding unverified"],
  [bounty, "Security bounty"],
], sponsorPoolLine);

export const homeListsSettledListedPlacedProjectsWithoutBountyCards = vectors<ReadonlyArray<ListedProject>, string[]>([
  [
    [
      pool,
      bounty,
      prize,
      community[0],
      named(pool, "paused", { status: "paused" }),
      named(pool, "retired", { listingTier: "retired" }),
      held,
      named(pool, "loading", { funding: { ...funded(5_000_000_000n), read: "PoolLoading" } }),
      named(pool, "failed-read", { funding: unread(5_000_000_000n) }),
    ],
    ["slopdotcash", "prize-lab", "failed-read"],
  ],
], (projects) => ids(homeProjects(projects)));

const larger = named(pool, "larger", { listingTier: "community", funding: funded(9_000_000_000n), reward: { ...pool.reward, monthlyCapMinor: 9_000_000_000n } });

export const homeOrdersByListedAmountThenGroupThenFeaturedThenRegistry = vectors<ReadonlyArray<ListedProject>, string[]>([
  [[configured, prize, tokenPool, pool, larger], ["larger", "slopdotcash", "configured-pool", "token-pool", "prize-lab"]],
  [[named(pool, "community-same", { listingTier: "community" }), pool], ["slopdotcash", "community-same"]],
], (projects) => ids(homeProjectOrder(projects)));

export const homeSplitsTheOneOrderIntoFeaturedCardsAndCommunityRows = vectors<ReadonlyArray<ListedProject>, [string[], string[]]>([
  [[configured, bounty, tokenPool, prize, pool, larger], [["slopdotcash", "prize-lab"], ["larger", "configured-pool", "token-pool"]]],
  [[bounty, held], [[], []]],
], (projects) => {
  const { featured, community: rows } = homeSections(projects);
  return [ids(featured), ids(rows)];
});

export const homeCutsADescriptionAtFiveHundredCodePoints = vectors<string, string>([
  ["Short.", "Short."],
  ["a".repeat(500), "a".repeat(500)],
  ["a".repeat(501), `${"a".repeat(500)}...`],
  [`${"a".repeat(499)} b`, `${"a".repeat(499)}...`],
  ["\u{1F600}".repeat(501), `${"\u{1F600}".repeat(500)}...`],
], homeDescription);
