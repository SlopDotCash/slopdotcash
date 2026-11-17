// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "Slop's pages refuse a withdrawal below the promised amount"; spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"
import { type Period, periodContaining } from "@repo/settlement/kernels/calendar";
import type { PoolDisplay } from "../../gen/frontend__projections.ts";
import { type FundingMonthStart, type FundingVault, type PoolCap, type PoolFunding, poolFunding, promisedOwed, unreadLocks, withdrawalKeepsFunding, zeroedPoolCap } from "./poolFunding.ts";
import { vectors } from "./vectors.ts";

const VAULT = "0x4F891b8c3d3fab9150fcdc94176b96863cd02899";
const seconds = (iso: string) => Date.parse(iso) / 1000;
const november = periodContaining(seconds("2026-11-01T00:00:00Z"));
const december = periodContaining(seconds("2026-12-01T00:00:00Z"));
const executionSwitch: Readonly<Record<string, boolean>> = { "base-mainnet": true, ethereum: false, "robinhood-mainnet": true, "solana-mainnet": true };
const networkPays = (network: string) => executionSwitch[network] ?? true;

interface Case {
  readonly network?: string;
  readonly cap?: (period: Period) => bigint;
  readonly vaults: ReadonlyArray<Partial<FundingVault>> | undefined;
  readonly now: string;
}

const start = (free: bigint, withdrawn = 0n, blockTime = "2026-12-01T00:04:00Z"): FundingMonthStart => ({
  period: december,
  freeBalance: free,
  totalGrossWithdrawn: withdrawn,
  blockTime: seconds(blockTime),
});

const fundingOf = ({ network = "base-mainnet", cap = () => 250_000_000n, vaults, now }: Case): PoolFunding =>
  poolFunding({
    pool: { monthlyPool: true, deployments: [{ network, vault: VAULT }], capFor: cap },
    read: vaults === undefined ? "PoolLoading" : "PoolCurrent",
    vaults: (vaults ?? []).map((vault) => ({ network: "base-mainnet", vault: VAULT.toLowerCase(), freeBalance: 250_000_000n, ...vault })),
    networkPays,
    nowMs: Date.parse(now),
  });

interface Shown {
  readonly display: PoolDisplay;
  readonly period: Period;
  readonly owed?: bigint;
}

const shownFunding = (funding: PoolFunding): Shown => {
  const owed = promisedOwed(funding);
  return owed === undefined ? { display: funding.display, period: funding.period } : { display: funding.display, period: funding.period, owed };
};

const midNovember = "2026-11-15T12:00:00Z";

export const oldPoolFundingVectorsKeepTheirOutcome = vectors<Case, Shown>([
  [{ vaults: [{}], now: midNovember }, { display: "PoolFunded", period: november, owed: 250_000_000n }],
  [{ vaults: [{ freeBalance: 249_999_999n }], now: midNovember }, { display: "PointsOnly", period: november }],
  [{ vaults: [], now: midNovember }, { display: "PointsOnly", period: november }],
  [{ vaults: undefined, now: midNovember }, { display: "PointsOnly", period: november }],
  [{ vaults: [{ freeBalance: null }], now: midNovember }, { display: "PointsOnly", period: november }],
  [{ vaults: [{ vault: "0xother" }], now: midNovember }, { display: "PointsOnly", period: november }],
  [{ network: "ethereum", vaults: [{ network: "ethereum" }], now: midNovember }, { display: "PointsOnly", period: november }],
  [{ network: "base-sepolia", vaults: [{ network: "base-sepolia" }], now: midNovember }, { display: "PoolFunded", period: november, owed: 250_000_000n }],
  [{ cap: (period) => (period === november ? 500_000_000n : 250_000_000n), vaults: [{}], now: midNovember }, { display: "PointsOnly", period: november }],
  [{ cap: () => 0n, vaults: [{}], now: midNovember }, { display: "PointsOnly", period: november }],
  [{ vaults: [{ freeBalance: 500_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(500_000_000n)] }], now: "2026-12-02T10:00:00Z" }, { display: "PoolFunded", period: december, owed: 500_000_000n }],
  [{ vaults: [{ freeBalance: 250_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(250_000_000n)] }], now: "2026-12-02T10:00:00Z" }, { display: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 900_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(0n)] }], now: "2026-12-10T00:00:00Z" }, { display: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 900_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(900_000_000n, 0n, "2026-12-01T02:00:00Z")] }], now: "2026-12-10T00:00:00Z" }, { display: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 250_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(500_000_000n)] }], now: "2026-12-05T00:00:00Z" }, { display: "PoolFunded", period: december, owed: 250_000_000n }],
  [{ vaults: [{ freeBalance: 100_000_000n, totalGrossWithdrawn: 400_000_000n, monthStarts: [start(500_000_000n)] }], now: "2026-12-10T00:00:00Z" }, { display: "PoolWithdrawn", period: december }],
  [{ vaults: [{ freeBalance: 100_000_000n, monthStarts: [start(500_000_000n)] }], now: "2026-12-10T00:00:00Z" }, { display: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 500_000_000n, monthStarts: [start(500_000_000n)] }], now: "2026-12-02T00:00:00Z" }, { display: "PoolFunded", period: december, owed: 500_000_000n }],
], (input) => shownFunding(fundingOf(input)));

const decemberCase = (free: bigint, withdrawn = 0n): Case => ({ vaults: [{ freeBalance: free, totalGrossWithdrawn: withdrawn, monthStarts: [start(500_000_000n)] }], now: "2026-12-10T00:00:00Z" });
const promised = fundingOf(decemberCase(400_000_000n));
const withdrawn = fundingOf(decemberCase(100_000_000n, 400_000_000n));
const pointsOnly = fundingOf({ vaults: undefined, now: "2026-12-10T00:00:00Z" });
const pool: PoolCap = { monthlyPool: true, monthlyCapMinor: 250_000_000n, hasCycleCaps: false };

export const unfundedPoolsShowZeroInTheirOwnAsset = vectors<readonly [PoolCap, PoolFunding], ReturnType<typeof zeroedPoolCap>>([
  [[pool, promised], undefined],
  [[pool, pointsOnly], { monthlyCapMinor: 0n, monthlyCapDisplay: "$0" }],
  [[pool, withdrawn], { monthlyCapMinor: 0n, monthlyCapDisplay: "$0" }],
  [[{ ...pool, assetKind: "token" }, pointsOnly], { monthlyCapMinor: 0n, monthlyCapDisplay: "0 TOKEN" }],
  [[{ ...pool, assetKind: "native" }, pointsOnly], { monthlyCapMinor: 0n, monthlyCapDisplay: "0 TOKEN" }],
  [[{ ...pool, assetKind: "stablecoin" }, pointsOnly], { monthlyCapMinor: 0n, monthlyCapDisplay: "$0" }],
  [[{ ...pool, monthlyCapMinor: 0n }, pointsOnly], undefined],
  [[{ ...pool, monthlyCapMinor: 0n, hasCycleCaps: true }, pointsOnly], { monthlyCapMinor: 0n, monthlyCapDisplay: "$0" }],
  [[{ ...pool, monthlyPool: false }, pointsOnly], undefined],
], ([cap, funding]) => zeroedPoolCap(cap, funding));

export const withdrawalsKeepWhatAPromisedMonthOwes = vectors<readonly [PoolFunding, bigint], boolean>([
  [[promised, 100_000_000n], true],
  [[promised, 150_000_000n], true],
  [[promised, 150_000_001n], false],
  [[promised, 400_000_000n], false],
  [[pointsOnly, 200_000_000n], true],
  [[withdrawn, 1n], true],
], ([funding, gross]) => withdrawalKeepsFunding({ funding, locks: unreadLocks, gross }));
