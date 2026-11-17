// spec/settlement/vaultSnapshots.md, "From December 2026 a month is promised only if a first read within an hour of 00:00 UTC holds this and the previous month's amount"; spec/settlement/vaultSnapshots.md, "A promise is shown only while the vault still covers what is owed, and Slop's pages refuse a withdrawal that would break it"
import { type Period, periodContaining } from "@repo/settlement/kernels/calendar";
import { type FundingMonthStart, type FundingVault, type PoolCap, type PoolFunding, poolFunding, withdrawalKeepsFunding, zeroedPoolCap } from "./poolFunding.ts";
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
    vaults: vaults?.map((vault) => ({ network: "base-mainnet", vault: VAULT.toLowerCase(), freeBalance: 250_000_000n, ...vault })),
    networkPays,
    nowMs: Date.parse(now),
  });

const midNovember = "2026-11-15T12:00:00Z";

export const oldPoolFundingVectorsKeepTheirOutcome = vectors<Case, PoolFunding>([
  [{ vaults: [{}], now: midNovember }, { state: "Promised", period: november, owed: 250_000_000n }],
  [{ vaults: [{ freeBalance: 249_999_999n }], now: midNovember }, { state: "PointsOnly", period: november }],
  [{ vaults: [], now: midNovember }, { state: "PointsOnly", period: november }],
  [{ vaults: undefined, now: midNovember }, { state: "PointsOnly", period: november }],
  [{ vaults: [{ freeBalance: null }], now: midNovember }, { state: "PointsOnly", period: november }],
  [{ vaults: [{ vault: "0xother" }], now: midNovember }, { state: "PointsOnly", period: november }],
  [{ network: "ethereum", vaults: [{ network: "ethereum" }], now: midNovember }, { state: "PointsOnly", period: november }],
  [{ network: "base-sepolia", vaults: [{ network: "base-sepolia" }], now: midNovember }, { state: "Promised", period: november, owed: 250_000_000n }],
  [{ cap: (period) => (period === november ? 500_000_000n : 250_000_000n), vaults: [{}], now: midNovember }, { state: "PointsOnly", period: november }],
  [{ cap: () => 0n, vaults: [{}], now: midNovember }, { state: "PointsOnly", period: november }],
  [{ vaults: [{ freeBalance: 500_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(500_000_000n)] }], now: "2026-12-02T10:00:00Z" }, { state: "Promised", period: december, owed: 500_000_000n }],
  [{ vaults: [{ freeBalance: 250_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(250_000_000n)] }], now: "2026-12-02T10:00:00Z" }, { state: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 900_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(0n)] }], now: "2026-12-10T00:00:00Z" }, { state: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 900_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(900_000_000n, 0n, "2026-12-01T02:00:00Z")] }], now: "2026-12-10T00:00:00Z" }, { state: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 250_000_000n, totalGrossWithdrawn: 0n, monthStarts: [start(500_000_000n)] }], now: "2026-12-05T00:00:00Z" }, { state: "Promised", period: december, owed: 250_000_000n }],
  [{ vaults: [{ freeBalance: 100_000_000n, totalGrossWithdrawn: 400_000_000n, monthStarts: [start(500_000_000n)] }], now: "2026-12-10T00:00:00Z" }, { state: "WithdrawnDuringMonth", period: december }],
  [{ vaults: [{ freeBalance: 100_000_000n, monthStarts: [start(500_000_000n)] }], now: "2026-12-10T00:00:00Z" }, { state: "PointsOnly", period: december }],
  [{ vaults: [{ freeBalance: 500_000_000n, monthStarts: [start(500_000_000n)] }], now: "2026-12-02T00:00:00Z" }, { state: "Promised", period: december, owed: 500_000_000n }],
], fundingOf);

const pool: PoolCap = { monthlyPool: true, monthlyCapMinor: 250_000_000n, hasCycleCaps: false };
const promised: PoolFunding = { state: "Promised", period: december, owed: 250_000_000n };
const withdrawn: PoolFunding = { state: "WithdrawnDuringMonth", period: december };
const pointsOnly: PoolFunding = { state: "PointsOnly", period: december };

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

export const withdrawalsKeepWhatAPromisedMonthOwes = vectors<readonly [PoolFunding, bigint, bigint], boolean>([
  [[promised, 400_000_000n, 100_000_000n], true],
  [[promised, 400_000_000n, 150_000_000n], true],
  [[promised, 400_000_000n, 150_000_001n], false],
  [[promised, 100_000_000n, 200_000_000n], false],
  [[pointsOnly, 100_000_000n, 200_000_000n], true],
  [[withdrawn, 0n, 1n], true],
], ([funding, freeBalance, gross]) => withdrawalKeepsFunding({ funding, freeBalance, gross }));
