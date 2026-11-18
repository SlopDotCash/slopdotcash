// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/poolListing.md, "Home shows one grid of the open Featured and Community projects that are listed this month, leaving bounty cards to the security bounties section"; spec/frontend/poolListing.md, "The home grid orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import type { PoolDisplay } from "../../../gen/frontend__projections.ts";
import { hasProjectCardBounty, type SecurityProgramStatus } from "../../kernels/rewardSummary.ts";
import { vectors } from "../../kernels/vectors.ts";
import { bounty, community, mergeLine, pool, prize, tokenPool } from "./fixtures.ts";
import { cardLine, cardNotes, homeProjectOrder, homeProjects, type ListedProject } from "./listing.ts";

const separateBounty = (status: SecurityProgramStatus): ListedProject => ({
  ...community[0]!,
  securityBounty: { rewardMode: "separate", status, eligibility: "in-scope-security", amount: { grossMinor: 50_000_000_000n, decimals: 6 }, funding: { state: "verified" } },
});

export const cardsHeadlineOnlyAnOpenOfferOrAFundedPool = vectors<ListedProject, ReturnType<typeof cardLine>>([
  [pool, { amount: "$5,000/mo" }],
  [{ ...pool, pool: "PoolWithdrawn" }, { amount: "Points only" }],
  [{ ...pool, pool: "PointsOnly" }, { amount: "Points only" }],
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
const displays: ReadonlyArray<PoolDisplay> = ["PoolFunded", "PoolWithdrawn", "PointsOnly"];
const policies: ReadonlyArray<ListedProject> = [pool, bounty, prize, ...statuses.map(separateBounty)].flatMap((project) => displays.map((display) => ({ ...project, pool: display })));

export const aCardNamesABountyOnlyWhenItIsTheOpenOfferAndAnAmountOnlyWhenFunded = contract({
  input: Arbitrary.Constant(policies),
  run: (projects) => projects.map(cardLine),
  deterministic: true,
  invariant: (projects, lines) =>
    projects.every((project, index) => {
      const { amount } = lines[index]!;
      return (!/ \/ (Critical|Finding)$/u.test(amount) || hasProjectCardBounty(project)) && (!amount.endsWith("/mo") || project.pool === "PoolFunded");
    }),
});

const ids = (projects: ReadonlyArray<ListedProject>) => projects.map((project) => project.id);

const named = (project: ListedProject, id: string, patch: Partial<ListedProject> = {}): ListedProject => ({ ...project, ...patch, id, slug: id });

const usdcPool = (id: string, capMinor: bigint, patch: Partial<ListedProject> = {}) => named(pool, id, { reward: { ...pool.reward, monthlyCapMinor: capMinor }, ...patch });

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
      usdcPool("withdrawn", 9_000_000_000n, { pool: "PoolWithdrawn" }),
      named(community[1]!, "featured-points", { listingTier: "featured" }),
    ],
    ["larger", "slopdotcash", "token-pool", "prize-lab", "withdrawn", "featured-points", "community-1"],
  ],
  [
    [usdcPool("community-same", 5_000_000_000n, { listingTier: "community" }), pool, usdcPool("featured-same", 5_000_000_000n)],
    ["slopdotcash", "featured-same", "community-same"],
  ],
  [
    [named(tokenPool, "small-token", { reward: { ...tokenPool.reward, monthlyCapMinor: 1n } }), tokenPool, usdcPool("no-asset", 1n, { rewardAsset: undefined })],
    ["no-asset", "small-token", "token-pool"],
  ],
], (projects) => ids(homeProjectOrder(projects)));
