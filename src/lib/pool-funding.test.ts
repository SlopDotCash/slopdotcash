import { expect, test } from "bun:test";
import {
  asShown,
  type PoolFundingIndex,
  poolFunded,
  poolFundingStatus,
  type VaultFreeBalance,
} from "./pool-funding";
import type { ProjectDefinition } from "./projects.mjs";

const NOW = new Date("2026-11-15T12:00:00Z");
const VAULT = "0x4F891b8c3d3fab9150fcdc94176b96863cd02899";

function project(
  cap: string,
  network = "base-mainnet",
  patch: Partial<ProjectDefinition["reward"]> = {},
): ProjectDefinition {
  return {
    id: "demo",
    reward: {
      kind: "monthly-pool",
      monthlyCapMinor: cap,
      monthlyCapDisplay: "$250",
      ...patch,
    },
    escrow: { deployments: [{ network, vault: VAULT }] },
  } as unknown as ProjectDefinition;
}

function index(...vaults: Partial<VaultFreeBalance>[]): PoolFundingIndex {
  return new Map([
    [
      "demo",
      vaults.map((vault) => ({
        network: "base-mainnet",
        vault: VAULT.toLowerCase(),
        freeBalance: "250000000",
        blockTime: "2026-11-15T11:00:00Z",
        observedAt: "2026-11-15T11:05:00Z",
        ...vault,
      })),
    ],
  ]);
}

test("a vault holding the monthly amount shows the money", () => {
  expect(poolFunded(project("250000000"), index({}), NOW)).toBe(true);
  expect(asShown(project("250000000"), index({}), NOW).reward).toMatchObject({
    monthlyCapMinor: "250000000",
  });
});

test("a vault short of the monthly amount reads as points only", () => {
  const shown = asShown(
    project("250000000"),
    index({ freeBalance: "249999999" }),
    NOW,
  );
  expect(shown.reward.monthlyCapMinor).toBe("0");
  expect(shown.reward.monthlyCapDisplay).toBe("$0");
});

test("a pledge with no vault, or balances not loaded, shows no amount", () => {
  expect(poolFunded(project("250000000"), new Map(), NOW)).toBe(false);
  expect(poolFunded(project("250000000"), null, NOW)).toBe(false);
});

test("only the project's own recorded vault on a paying network counts", () => {
  expect(
    poolFunded(project("250000000"), index({ vault: "0xother" }), NOW),
  ).toBe(false);
  expect(
    poolFunded(
      project("250000000", "ethereum"),
      index({ network: "ethereum" }),
      NOW,
    ),
  ).toBe(false);
  // A test network is not on the mainnet switch.
  expect(
    poolFunded(
      project("250000000", "base-sepolia"),
      index({ network: "base-sepolia" }),
      NOW,
    ),
  ).toBe(true);
});

test("this month's amount comes from the month's own cap when one is listed", () => {
  const capped = project("250000000", "base-mainnet", {
    cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "500000000" }],
  } as Partial<ProjectDefinition["reward"]>);
  expect(poolFunded(capped, index({}), NOW)).toBe(false);
  expect(asShown(capped, index({}), NOW).reward.cycleCaps).toBeUndefined();
});

test("a points-only pool and other reward kinds pass through unchanged", () => {
  const points = project("0");
  expect(asShown(points, null, NOW)).toBe(points);
  const prize = {
    ...project("0"),
    reward: { kind: "external-prize-share" },
  } as unknown as ProjectDefinition;
  expect(asShown(prize, null, NOW)).toBe(prize);
});

const DEC = (iso: string) => new Date(`2026-12-${iso}Z`);
const START = (
  free: string,
  withdrawn = "0",
  blockTime = "2026-12-01T00:04:00Z",
) => ({
  period: "2026-12",
  freeBalance: free,
  totalGrossWithdrawn: withdrawn,
  blockTime,
});

test("from December a month is promised only if the 1st covered it and last month", () => {
  // 250 for December plus 250 for November, which pays out from the 4th.
  const both = index({
    freeBalance: "500000000",
    totalGrossWithdrawn: "0",
    monthStarts: [START("500000000")],
  });
  expect(
    poolFundingStatus(project("250000000"), both, DEC("02T10:00:00")).state,
  ).toBe("funded");
  const oneMonth = index({
    freeBalance: "250000000",
    totalGrossWithdrawn: "0",
    monthStarts: [START("250000000")],
  });
  expect(
    poolFundingStatus(project("250000000"), oneMonth, DEC("02T10:00:00")).state,
  ).toBe("points");
});

test("a deposit after the 1st does not make that month promised", () => {
  const late = index({
    freeBalance: "900000000",
    totalGrossWithdrawn: "0",
    monthStarts: [START("0")],
  });
  expect(
    poolFundingStatus(project("250000000"), late, DEC("10T00:00:00")).state,
  ).toBe("points");
  const firstReadLate = index({
    freeBalance: "900000000",
    totalGrossWithdrawn: "0",
    monthStarts: [START("900000000", "0", "2026-12-01T02:00:00Z")],
  });
  expect(
    poolFundingStatus(project("250000000"), firstReadLate, DEC("10T00:00:00"))
      .state,
  ).toBe("points");
});

test("after November is reserved, the vault needs only December's amount", () => {
  const reserved = index({
    freeBalance: "250000000",
    totalGrossWithdrawn: "0",
    monthStarts: [START("500000000")],
  });
  expect(
    poolFundingStatus(project("250000000"), reserved, DEC("05T00:00:00")).state,
  ).toBe("funded");
});

test("a withdrawal during the month that leaves it short is shown as withdrawn", () => {
  const pulled = index({
    freeBalance: "100000000",
    totalGrossWithdrawn: "400000000",
    monthStarts: [START("500000000")],
  });
  const status = poolFundingStatus(
    project("250000000"),
    pulled,
    DEC("10T00:00:00"),
  );
  expect(status).toEqual({ state: "withdrawn", period: "2026-12" });
  expect(
    poolFundingStatus(
      project("250000000"),
      index({ freeBalance: "500000000", monthStarts: [START("500000000")] }),
      DEC("02T00:00:00"),
    ),
  ).toEqual({ state: "funded", period: "2026-12", owedMinor: 500000000n });
  expect(
    asShown(project("250000000"), pulled, DEC("10T00:00:00")).reward
      .monthlyCapMinor,
  ).toBe("0");
});
