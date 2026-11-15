import { expect, test } from "bun:test";
import {
  asShown,
  type PoolFundingIndex,
  poolFunded,
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
