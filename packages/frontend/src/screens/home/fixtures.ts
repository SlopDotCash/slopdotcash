// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"
import { toAmount } from "@repo/settlement/kernels/amounts";
import type { PoolFacts } from "../../../gen/frontend__projections.ts";
import type { LifetimeTotal } from "./standings.ts";
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

export const listed: ReadonlyArray<ListedProject> = [prize, bounty, ...community, tokenPool, pool];

export const current = <T>(value: T): Shown<T> => ({ status: "Current", value });

export const failed = <T>(): Shown<T> => ({ status: "Failed", value: undefined, onRetry: () => undefined });

export const loading = <T>(): Shown<T> => ({ status: "Loading", value: undefined });

export const totals: ReadonlyArray<LifetimeTotal> = [
  { actor: { id: "U_kgDOAAAD6Q", login: "alice" }, total: 420 },
  { actor: { id: "U_kgDOAAAD6g", login: "bob" }, total: 420 },
  { actor: { id: "U_kgDOAAAD6w", login: "carol" }, total: 60 },
];

export const mergeLine = (project: ListedProject) => (project.id === pool.id ? "Last merge 2 days ago · 3 outside PRs waiting 7+ days" : null);
