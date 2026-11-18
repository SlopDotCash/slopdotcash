// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { type PoolFacts, poolDisplay } from "../../../gen/frontend__projections.ts";
import { hasProjectCardBounty, type SecurityProgramStatus } from "../../kernels/rewardSummary.ts";
import { vectors } from "../../kernels/vectors.ts";
import { bounty, community, funded, mergeLine, pointsOnly, pool, prize, tokenPool, unread, withdrawn } from "./fixtures.ts";
import { cardLine, cardNotes, homeProjectOrder, homeProjects, homeSections, type ListedProject } from "./listing.ts";

const separateBounty = (status: SecurityProgramStatus): ListedProject => ({
  ...community[0]!,
  securityBounty: { rewardMode: "separate", status, eligibility: "in-scope-security", amount: { grossMinor: 50_000_000_000n, decimals: 6 }, funding: { state: "verified" } },
});

export const cardsHeadlineOnlyAnOpenOfferOrAFundedPool = vectors<ListedProject, ReturnType<typeof cardLine>>([
  [pool, { amount: "$5,000/mo" }],
  [{ ...pool, funding: withdrawn(5_000_000_000n) }, { amount: "Points only" }],
  [{ ...pool, funding: pointsOnly }, { amount: "Points only" }],
  [{ ...pool, funding: unread(5_000_000_000n) }, { amount: "Points only" }],
  [bounty, { amount: "$50k / Critical", state: "Funding verified" }],
  [prize, { amount: "$25k + points", state: "External prize" }],
  [community[0]!, { amount: "Points only" }],
  [separateBounty("open"), { amount: "$50k / Finding", state: "Funding verified" }],
  [separateBounty("paused"), { amount: "Points only" }],
  [separateBounty("closed"), { amount: "Points only" }],
  [separateBounty("draft"), { amount: "Points only" }],
], cardLine);

export const cardNotesKeepStateThenMergeActivity = vectors<ListedProject, string[]>([
  [pool, ["Last merge 2 days ago · 3 outside PRs waiting 7+ days"]],
  [bounty, ["Funding verified"]],
  [prize, ["External prize"]],
], (project) => cardNotes(project, mergeLine(project)));

const statuses: ReadonlyArray<SecurityProgramStatus> = ["draft", "pending-approval", "open", "paused", "closed"];
const fundings: ReadonlyArray<PoolFacts> = [funded(5_000_000_000n), withdrawn(5_000_000_000n), pointsOnly, unread(5_000_000_000n)];
const policies: ReadonlyArray<ListedProject> = [pool, bounty, prize, ...statuses.map(separateBounty)].flatMap((project) => fundings.map((funding) => ({ ...project, funding })));

export const aCardNamesABountyOnlyWhenItIsTheOpenOfferAndAnAmountOnlyWhenFunded = contract({
  input: Arbitrary.Constant(policies),
  run: (projects) => projects.map(cardLine),
  deterministic: true,
  invariant: (projects, lines) =>
    projects.every((project, index) => {
      const { amount } = lines[index]!;
      return (!/ \/ (Critical|Finding)$/u.test(amount) || hasProjectCardBounty(project)) && (!amount.endsWith("/mo") || poolDisplay(project.funding) === "PoolFunded");
    }),
});

const ids = (projects: ReadonlyArray<ListedProject>) => projects.map((project) => project.id);

const named = (project: ListedProject, id: string, patch: Partial<ListedProject> = {}): ListedProject => ({ ...project, ...patch, id, slug: id });

const usdcPool = (id: string, capMinor: bigint, patch: Partial<ListedProject> = {}) => named(pool, id, { reward: { ...pool.reward, monthlyCapMinor: capMinor }, funding: funded(capMinor), ...patch });

export const homeListsOpenPlacedProjectsWithoutBountyCards = vectors<ReadonlyArray<ListedProject>, string[]>([
  [
    [
      pool,
      bounty,
      prize,
      community[0]!,
      named(community[1]!, "paused", { status: "paused" }),
      named(community[2]!, "retired", { listingTier: "retired" }),
      named(separateBounty("open"), "open-bounty"),
      named(separateBounty("closed"), "closed-bounty"),
      usdcPool("funded-bounty", 1_000_000_000n, { securityBounty: separateBounty("open").securityBounty }),
      named(bounty, "closed-bounty-only", { securityBounty: { ...bounty.securityBounty!, status: "closed" } }),
    ],
    ["slopdotcash", "prize-lab", "community-1", "closed-bounty", "funded-bounty"],
  ],
], (projects) => ids(homeProjects(projects)));

export const homeOrdersByShownMonthlyAmountThenGroupThenFeaturedThenRegistry = vectors<ReadonlyArray<ListedProject>, string[]>([
  [
    [
      community[0]!,
      prize,
      tokenPool,
      pool,
      usdcPool("larger", 9_000_000_000n, { listingTier: "community" }),
      usdcPool("withdrawn", 9_000_000_000n, { funding: withdrawn(9_000_000_000n) }),
      named(community[1]!, "featured-points", { listingTier: "featured" }),
    ],
    ["larger", "slopdotcash", "token-pool", "prize-lab", "withdrawn", "featured-points", "community-1"],
  ],
  [
    [usdcPool("community-same", 5_000_000_000n, { listingTier: "community" }), pool, usdcPool("featured-same", 5_000_000_000n)],
    ["slopdotcash", "featured-same", "community-same"],
  ],
  [
    [named(tokenPool, "small-token", { reward: { ...tokenPool.reward, monthlyCapMinor: 1n }, funding: funded(1n) }), tokenPool, usdcPool("no-asset", 1n, { rewardAsset: undefined })],
    ["no-asset", "small-token", "token-pool"],
  ],
  [
    [pool, usdcPool("cycle-cap-larger", 1_000_000_000n, { funding: funded(9_000_000_000n) }), usdcPool("cycle-cap-smaller", 9_000_000_000n, { funding: funded(1_000_000_000n) })],
    ["cycle-cap-larger", "slopdotcash", "cycle-cap-smaller"],
  ],
], (projects) => ids(homeProjectOrder(projects)));

export const homeSplitsTheOneOrderIntoFeaturedThenCommunitySections = vectors<ReadonlyArray<ListedProject>, Array<[string, string[]]>>([
  [[community[0]!, bounty, tokenPool, prize, pool, usdcPool("community-larger", 9_000_000_000n, { listingTier: "community" })], [["featured", ["slopdotcash", "prize-lab"]], ["community", ["community-larger", "token-pool", "community-1"]]]],
  [[community[0]!, community[1]!], [["community", ["community-1", "community-2"]]]],
  [[bounty, named(community[0]!, "retired", { listingTier: "retired" })], []],
], (projects) => homeSections(projects).map(({ tier, projects: entries }): [string, string[]] => [tier, ids(entries)]));
