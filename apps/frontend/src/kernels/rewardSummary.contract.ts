// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"
import { type CardProject, discoveryProjects, hasBountyOverview, hasProjectCardBounty, type ListingTier, projectRewardSummaries, type RewardSummary, type SecurityBounty, securityBountyAmountLabel } from "./rewardSummary.ts";
import { vectors } from "./vectors.ts";

const ETH_NATIVE = "0x0000000000000000000000000000000000000000";
const TOKEN = `0x${"a".repeat(40)}`;
const PUMP = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVpump";

const criticalBounty: SecurityBounty = {
  rewardMode: "separate",
  status: "open",
  eligibility: "critical-loss-of-funds",
  amount: { grossMinor: 10_000_000_000n, decimals: 6 },
};

const pointsProject: CardProject = {
  status: "active",
  listingTier: "community",
  reward: { kind: "monthly-pool", monthlyCapMinor: 0n },
  securityBounty: criticalBounty,
};

const ethPool: CardProject = {
  status: "active",
  listingTier: "featured",
  reward: { kind: "monthly-pool", monthlyCapMinor: 10n ** 18n },
  rewardAsset: { kind: "native", network: "ethereum", address: ETH_NATIVE, symbol: "ETH", decimals: 18 },
};

const bountyOnly = (status: SecurityBounty["status"]): CardProject => ({
  ...ethPool,
  securityBounty: { ...criticalBounty, rewardMode: "bounty-only", status },
});

const withBounty = (patch: Partial<SecurityBounty>): CardProject => ({ ...pointsProject, securityBounty: { ...criticalBounty, ...patch } });

export const cardsNameASeparateBountyOnlyWhenItIsTheOpenOffer = vectors<CardProject, boolean>([
  [pointsProject, true],
  [withBounty({ status: "draft" }), false],
  [withBounty({ status: "pending-approval" }), false],
  [withBounty({ status: "paused" }), false],
  [withBounty({ status: "closed" }), false],
  [{ ...pointsProject, reward: { kind: "monthly-pool", monthlyCapMinor: 1_000_000_000n } }, false],
  [{ ...pointsProject, reward: { kind: "external-prize-share", monthlyCapMinor: 0n } }, false],
  [{ status: "active", listingTier: "community", reward: pointsProject.reward }, false],
  [{ ...pointsProject, securityBounty: { ...criticalBounty, rewardMode: "bounty-only", status: "closed" } }, true],
], hasProjectCardBounty);

export const bountyAmountsAreCompactInTheirAsset = vectors<SecurityBounty["amount"], string>([
  [{ grossMinor: 10_000_000_000n, decimals: 6 }, "$10k"],
  [{ grossMinor: 2_000_000_000n, decimals: 6, asset: { kind: "token", symbol: "CREDIT" } }, "2k $CREDIT"],
  [{ grossMinor: 1_500_000_000n, decimals: 6, asset: { kind: "stablecoin", symbol: "USDC" } }, "1.5k USDC"],
  [{ grossMinor: 1_500_000_000n, decimals: 9, asset: { kind: "native", symbol: "SOL" } }, "1.5 SOL"],
  [{ grossMinor: 1_234_567n, decimals: 6 }, "$1.234567"],
], (amount) => securityBountyAmountLabel({ amount }));

export const cardsShowOneVariantPerPolicy = vectors<CardProject, RewardSummary[]>([
  [pointsProject, [{ kind: "security-bounty", amount: "$10k", status: "open", eligibility: "critical-loss-of-funds" }]],
  [{ ...pointsProject, securityBounty: undefined }, [{ kind: "points-only" }]],
  [ethPool, [{ kind: "monthly-pool", amount: "1", token: { symbol: "ETH", url: "https://etherscan.io/" } }]],
  [
    { ...ethPool, rewardAsset: { kind: "token", network: "ethereum", address: TOKEN, symbol: "$EPYH", decimals: 18 } },
    [{ kind: "monthly-pool", amount: "1", token: { symbol: "$EPYH", url: `https://etherscan.io/token/${TOKEN}` } }],
  ],
  [
    { ...ethPool, reward: { kind: "monthly-pool", monthlyCapMinor: 25_000_000_000_000n }, rewardAsset: { kind: "token", network: "solana", address: PUMP, symbol: "SLOP", decimals: 6 } },
    [{ kind: "monthly-pool", amount: "25m", token: { symbol: "$SLOP", url: `https://pump.fun/coin/${PUMP}` } }],
  ],
  [
    { ...ethPool, rewardAsset: { kind: "native", network: "base", address: ETH_NATIVE, symbol: "ETH", decimals: 18 } },
    [{ kind: "monthly-pool", amount: "1", token: { symbol: "ETH", url: "https://basescan.org/" } }],
  ],
  [{ ...ethPool, reward: { kind: "monthly-pool", monthlyCapMinor: 2_500_000_000n }, rewardAsset: undefined }, [{ kind: "monthly-pool", amount: "$2,500" }]],
  [
    { ...pointsProject, reward: { kind: "external-prize-share", monthlyCapMinor: 0n, externalOpportunity: { advertisedAmountDisplay: "$50,000" } } },
    [{ kind: "external-prize", amount: "$50,000" }, { kind: "security-bounty", amount: "$10k", status: "open", eligibility: "critical-loss-of-funds" }],
  ],
  [{ ...pointsProject, securityBounty: undefined, reward: { kind: "external-prize-share", monthlyCapMinor: 0n } }, [{ kind: "external-prize", amount: null }]],
  [bountyOnly("open"), [{ kind: "security-bounty", amount: "$10k", status: "open", eligibility: "critical-loss-of-funds" }]],
], projectRewardSummaries);

export const onlyBountyOnlyProgramsReplaceOrdinaryWork = vectors<CardProject, boolean>([
  [bountyOnly("closed"), true],
  [bountyOnly("open"), true],
  [pointsProject, false],
  [ethPool, false],
], hasBountyOverview);

const listed: ReadonlyArray<CardProject> = [
  ethPool,
  { ...ethPool, status: "paused" },
  bountyOnly("closed"),
  bountyOnly("open"),
  pointsProject,
  { ...pointsProject, listingTier: "retired" },
];

export const discoveryListsFollowPlacementAndOpenPrograms = vectors<ListingTier, number[]>([
  ["featured", [0, 3]],
  ["community", [4]],
], (tier) => discoveryProjects(listed, tier).map((project) => listed.indexOf(project)));
