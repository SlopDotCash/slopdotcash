// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month's configured amount is positive"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"
import { toAmount } from "@repo/settlement/kernels/amounts";
import type { PoolFacts } from "../../../gen/frontend__projections.ts";
import type { ListedProject, Shown } from "./listing.ts";

export const origin = "https://slop.cash";

export const copied = () => Promise.resolve();

export const refused = () => Promise.reject(new Error("The browser refused the copy."));

export const pointsOnly: PoolFacts = {
  read: "PoolCurrent",
  monthlyPool: true,
  period: 202612,
  amount: toAmount(0n),
  priorAmount: toAmount(0n),
  priorPending: false,
  freeNow: toAmount(0n),
  monthStartRead: false,
  freeAtStart: toAmount(0n),
  withdrawnSince: false,
  pledgeSupport: false,
  pledged: toAmount(0n),
};

export const funded = (amountMinor: bigint): PoolFacts => ({ ...pointsOnly, amount: toAmount(amountMinor), freeNow: toAmount(amountMinor), monthStartRead: true, freeAtStart: toAmount(amountMinor) });

export const withdrawn = (amountMinor: bigint): PoolFacts => ({ ...funded(amountMinor), freeNow: toAmount(0n), withdrawnSince: true });

export const unread = (amountMinor: bigint): PoolFacts => ({ ...funded(amountMinor), read: "PoolFailed" });

const base = {
  status: "active",
  listingTier: "featured",
  description: "Agent-built open source with paid monthly pools.",
  repositories: [{ id: "SlopDotCash/slopdotcash" }],
  funding: pointsOnly,
} as const;

export const pool: ListedProject = {
  ...base,
  id: "slopdotcash",
  slug: "slopdotcash",
  name: "Slop",
  funding: funded(5_000_000_000n),
  reward: { kind: "monthly-pool", monthlyCapMinor: 5_000_000_000n, monthlyCapDisplay: "5,000 USDC", chain: "base" },
  rewardAsset: { kind: "stablecoin", network: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
  escrow: { deployments: [{ network: "base" }] },
  shareLine: "Maintainer share 10%",
  coverage: { tag: "Covers", months: toAmount(3n) },
};

export const bounty: ListedProject = {
  ...base,
  id: "vault-kit",
  slug: "vault-kit",
  name: "Vault Kit",
  reward: { kind: "monthly-pool", monthlyCapMinor: 0n, monthlyCapDisplay: "0 USDC" },
  securityBounty: { rewardMode: "bounty-only", status: "open", eligibility: "critical-loss-of-funds", amount: { grossMinor: 50_000_000_000n, decimals: 6 }, funding: { state: "verified" } },
};

export const prize: ListedProject = {
  ...base,
  id: "prize-lab",
  slug: "prize-lab",
  name: "Prize Lab",
  funding: { ...pointsOnly, monthlyPool: false },
  reward: { kind: "external-prize-share", monthlyCapMinor: 0n, monthlyCapDisplay: "0 USDC", externalOpportunity: { name: "Agent Cup", advertisedAmountDisplay: "$25,000" } },
};

export const tokenPool: ListedProject = {
  ...base,
  listingTier: "community",
  id: "token-pool",
  slug: "token-pool",
  name: "Token Pool",
  funding: funded(25_000_000_000_000n),
  reward: { kind: "monthly-pool", monthlyCapMinor: 25_000_000_000_000n, monthlyCapDisplay: "25,000,000 SLOP", chain: "solana" },
  rewardAsset: { kind: "token", network: "solana", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVpump", symbol: "SLOP", decimals: 6 },
  escrow: { deployments: [{ network: "solana-mainnet" }] },
};

export const community: ListedProject[] = Array.from({ length: 4 }, (_, index) => ({
  ...base,
  listingTier: "community",
  id: `community-${index + 1}`,
  slug: `community-${index + 1}`,
  name: `Community project ${index + 1}`,
  reward: { kind: "monthly-pool", monthlyCapMinor: 0n, monthlyCapDisplay: "0 USDC" },
}));

const promisedMonth: PoolFacts = { ...pointsOnly, amount: toAmount(250_000_000n) };

export const promised: ListedProject = {
  ...pool,
  listingTier: "community",
  id: "promised-pool",
  slug: "promised-pool",
  name: "Promised Pool",
  funding: promisedMonth,
  promise: { pool: promisedMonth, honorSystem: true, vaultUnread: false },
  reward: { ...pool.reward, monthlyCapMinor: 250_000_000n, monthlyCapDisplay: "250 USDC" },
};

export const unverified: ListedProject = { ...promised, id: "unverified-pool", slug: "unverified-pool", name: "Unverified Pool", promise: { pool: promisedMonth, honorSystem: true, vaultUnread: true } };

export const configured: ListedProject = { ...promised, id: "configured-pool", slug: "configured-pool", name: "Configured Pool", promise: { pool: promisedMonth, honorSystem: false, vaultUnread: false } };

export const held: ListedProject = { ...pool, id: "held-pool", slug: "held-pool", name: "Held Pool", held: true };

export const longDescription: ListedProject = { ...configured, id: "long-description", slug: "long-description", name: "Long Description", description: "An agent-built toolkit for open source maintainers. ".repeat(12).trim() };

export const manyCommunity: ReadonlyArray<ListedProject> = Array.from({ length: 23 }, (_, index) => ({
  ...(index % 3 === 0 ? configured : index % 3 === 1 ? promised : tokenPool),
  listingTier: "community",
  id: `row-${index + 1}`,
  slug: `row-${index + 1}`,
  name: `Community row ${index + 1}`,
}));

export const reviewed: ListedProject = {
  ...pool,
  id: "reviewed-pool",
  slug: "reviewed-pool",
  name: "Reviewed Pool",
  reward: { ...pool.reward, reviewBudget: { committedMinor: 300_000_000n, fundingState: "committed", monthlyCapDisplay: "$500" } },
};

export const listed: ReadonlyArray<ListedProject> = [prize, bounty, ...community, tokenPool, pool, promised, unverified, configured, reviewed, held, longDescription];

export const current = <T>(value: T): Shown<T> => ({ status: "Current", value });

export const failed = <T>(): Shown<T> => ({ status: "Failed", value: undefined, onRetry: () => undefined });

export const loading = <T>(): Shown<T> => ({ status: "Loading", value: undefined });

export const mergeLine = (project: ListedProject) => (project.id === pool.id ? "Last merge 2 days ago · 3 outside PRs waiting 7+ days" : null);
