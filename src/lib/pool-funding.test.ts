import { expect, test } from "bun:test";
import {
  asShown,
  cyclePoolFunded,
  listedThisMonth,
  listingPoolReward,
  monthsCovered,
  monthsCoveredLabel,
  type PoolFundingIndex,
  payingVaultFreeMinor,
  poolFunded,
  poolFundingStatus,
  publicPoolReward,
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
  expect(listingPoolReward(project("250000000"), index({}), NOW)).toMatchObject(
    {
      fundingTag: "Vaulted",
      warning: null,
    },
  );
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

test("an owner promise distinguishes a short vault from an unread vault", () => {
  const optedIn = project("250000000", "base-mainnet", { honorSystem: true });
  const missing = index({ freeBalance: null });
  const unread = publicPoolReward(optedIn, missing, NOW);
  expect(unread.promise).toBe("Promised · Vault funding unverified");
  expect(listingPoolReward(optedIn, missing, NOW)).toMatchObject({
    fundingTag: "Promised",
    warning: "Vault funding unverified",
  });
  const short = index({ freeBalance: "249999999" });
  const promised = publicPoolReward(optedIn, short, NOW);
  expect(promised.promise).toBe("Promised · Not vaulted");
  expect(promised.project.reward.monthlyCapDisplay).toBe("$250");
  expect(poolFunded(optedIn, short, NOW)).toBe(false);
  expect(publicPoolReward(optedIn, index({}), NOW).promise).toBeNull();
  expect(listingPoolReward(optedIn, short, NOW)).toEqual({
    project: promised.project,
    fundingTag: "Promised",
    warning: "Not vaulted",
  });
  expect(listingPoolReward(optedIn, index({}), NOW)).toMatchObject({
    fundingTag: "Vaulted",
    warning: null,
  });
});

test("home shows a configured amount without treating it as an owner promise or verified funding", () => {
  const configured = project("250000000");
  const unread = listingPoolReward(configured, null, NOW);
  expect(unread).toMatchObject({
    fundingTag: "Configured",
    warning: "Vault funding unverified",
  });
  expect(unread.project.reward.monthlyCapMinor).toBe("250000000");
  const short = index({ freeBalance: "249999999" });
  const shown = listingPoolReward(configured, short, NOW);
  expect(shown).toMatchObject({
    fundingTag: "Configured",
    warning: "Not vaulted",
  });
  expect(shown.project.reward.monthlyCapDisplay).toBe("$250");
  expect(poolFunded(configured, short, NOW)).toBe(false);
  const details = publicPoolReward(configured, short, NOW);
  expect(details.promise).toBeNull();
  expect(details.project.reward.monthlyCapMinor).toBe("0");
  expect(configured.reward.honorSystem).toBeUndefined();
});

test("home does not replace a zero current-month override with the positive base cap", () => {
  const capped = project("250000000", "base-mainnet", {
    honorSystem: true,
    cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "0" }],
  });
  const home = listingPoolReward(capped, index({}), NOW);
  expect(home).toMatchObject({ fundingTag: null, warning: null });
  expect(home.project.reward.monthlyCapMinor).toBe("0");
  expect(home.project.reward.monthlyCapDisplay).toBe("$0");
  const details = publicPoolReward(capped, null, NOW);
  expect(details.promise).toBeNull();
  expect(details.project.reward.monthlyCapMinor).toBe("0");
  expect(capped.reward.monthlyCapMinor).toBe("250000000");
  expect(capped.reward.cycleCaps).toEqual([
    { cycleId: "2026-11", monthlyCapMinor: "0" },
  ]);
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
  expect(listingPoolReward(capped, index({}), NOW)).toMatchObject({
    project: { reward: { monthlyCapMinor: "500000000" } },
    fundingTag: "Configured",
    warning: "Not vaulted",
  });
});

test("a points-only pool and other reward kinds pass through unchanged", () => {
  const points = project("0");
  expect(asShown(points, null, NOW)).toBe(points);
  const prize = {
    ...project("0"),
    reward: { kind: "external-prize-share" },
  } as unknown as ProjectDefinition;
  expect(asShown(prize, null, NOW)).toBe(prize);
  expect(listingPoolReward(prize, null, NOW)).toEqual({
    project: prize,
    fundingTag: null,
    warning: null,
  });
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
  ).toEqual({
    state: "funded",
    period: "2026-12",
    owedMinor: 500000000n,
    locked: false,
  });
  expect(
    asShown(project("250000000"), pulled, DEC("10T00:00:00")).reward
      .monthlyCapMinor,
  ).toBe("0");
});

const OTHER_VAULT = "0x1111111111111111111111111111111111111111";
const pledge = (period: string, amount: string, open = true) => ({
  period,
  amount,
  open,
});

test("a vault with pledge support is funded by the month pledged on chain", () => {
  const locked = index({
    freeBalance: "250000000",
    openPledgedGross: "250000000",
    pledges: [pledge("2026-12", "250000000")],
  });
  expect(
    poolFundingStatus(project("250000000"), locked, DEC("10T00:00:00")),
  ).toEqual({
    state: "funded",
    period: "2026-12",
    owedMinor: 250000000n,
    locked: true,
  });
  // No reading on the 1st is needed: the contract holds the pledge.
  expect(
    poolFundingStatus(project("250000000"), locked, DEC("20T00:00:00")).state,
  ).toBe("funded");
  expect(
    listingPoolReward(
      project("250000000", "base-mainnet", { honorSystem: true }),
      locked,
      DEC("20T00:00:00"),
    ),
  ).toMatchObject({ fundingTag: "Vaulted", warning: null });
  // A pledge above the monthly amount counts in full.
  expect(
    poolFundingStatus(
      project("250000000"),
      index({
        openPledgedGross: "300000000",
        pledges: [pledge("2026-12", "300000000")],
      }),
      DEC("10T00:00:00"),
    ),
  ).toMatchObject({ owedMinor: 300000000n, locked: true });
});

test("free funds in a vault with pledge support count for nothing without a pledge", () => {
  const unpledged = index({
    freeBalance: "900000000",
    openPledgedGross: "0",
    pledges: [],
    monthStarts: [START("900000000")],
  });
  expect(
    poolFundingStatus(project("250000000"), unpledged, DEC("10T00:00:00")),
  ).toEqual({ state: "points", period: "2026-12" });
  // November is judged the same way: free funds do not count.
  expect(poolFunded(project("250000000"), unpledged, NOW)).toBe(false);
});

test("a pledge short of this month's amount, or for another month, reads as points", () => {
  const short = index({
    openPledgedGross: "249999999",
    pledges: [pledge("2026-12", "249999999")],
  });
  expect(
    poolFundingStatus(project("250000000"), short, DEC("10T00:00:00")).state,
  ).toBe("points");
  const nextMonth = index({
    openPledgedGross: "250000000",
    pledges: [pledge("2027-01", "250000000")],
  });
  expect(
    poolFundingStatus(project("250000000"), nextMonth, DEC("10T00:00:00"))
      .state,
  ).toBe("points");
  expect(
    poolFundingStatus(
      project("250000000"),
      nextMonth,
      new Date("2027-01-05T00:00:00Z"),
    ).state,
  ).toBe("funded");
});

test("a pledge in a vault off the paying networks or not recorded counts for nothing", () => {
  expect(
    poolFunded(
      project("250000000"),
      index({
        vault: "0xother",
        openPledgedGross: "250000000",
        pledges: [pledge("2026-11", "250000000")],
      }),
      NOW,
    ),
  ).toBe(false);
});

test("pledges add up across the project's vaults with pledge support", () => {
  const twoVaults = {
    ...project("250000000"),
    escrow: {
      deployments: [
        { network: "base-mainnet", vault: VAULT },
        { network: "base-mainnet", vault: OTHER_VAULT },
      ],
    },
  } as unknown as ProjectDefinition;
  const both = index(
    {
      openPledgedGross: "100000000",
      pledges: [pledge("2026-12", "100000000")],
    },
    {
      vault: OTHER_VAULT,
      openPledgedGross: "150000000",
      pledges: [pledge("2026-12", "150000000")],
    },
  );
  expect(poolFundingStatus(twoVaults, both, DEC("10T00:00:00"))).toMatchObject({
    state: "funded",
    owedMinor: 250000000n,
    locked: true,
  });
});

test("a mixed project: a pledge covers it, otherwise the vault without pledge support decides by the 1st", () => {
  const twoVaults = {
    ...project("250000000"),
    escrow: {
      deployments: [
        { network: "base-mainnet", vault: VAULT },
        { network: "base-mainnet", vault: OTHER_VAULT },
      ],
    },
  } as unknown as ProjectDefinition;
  const upgraded = (amount: string) => ({
    vault: OTHER_VAULT,
    freeBalance: "900000000",
    openPledgedGross: amount,
    pledges: amount === "0" ? [] : [pledge("2026-12", amount)],
    monthStarts: [START("900000000")],
  });
  // The pledge covers the month.
  expect(
    poolFundingStatus(
      twoVaults,
      index({ freeBalance: "0" }, upgraded("250000000")),
      DEC("10T00:00:00"),
    ),
  ).toMatchObject({ state: "funded", locked: true });
  // No pledge: the older vault funded on the 1st still promises the month,
  // and the upgraded vault's free funds are not added to it.
  expect(
    poolFundingStatus(
      twoVaults,
      index(
        {
          freeBalance: "500000000",
          monthStarts: [START("500000000")],
        },
        upgraded("0"),
      ),
      DEC("10T00:00:00"),
    ),
  ).toEqual({
    state: "funded",
    period: "2026-12",
    owedMinor: 250000000n,
    locked: false,
  });
  expect(
    poolFundingStatus(
      twoVaults,
      index(
        { freeBalance: "100000000", monthStarts: [START("100000000")] },
        upgraded("0"),
      ),
      DEC("10T00:00:00"),
    ).state,
  ).toBe("points");
});

test("a vault without pledge support reads exactly as before when the API omits the fields", () => {
  const legacy = index({
    freeBalance: "500000000",
    monthStarts: [START("500000000")],
  });
  const explicitNull = index({
    freeBalance: "500000000",
    monthStarts: [START("500000000")],
    openPledgedGross: null,
    pledges: [],
  });
  for (const at of ["02T00:00:00", "10T00:00:00", "20T00:00:00"]) {
    expect(
      poolFundingStatus(project("250000000"), explicitNull, DEC(at)),
    ).toEqual(poolFundingStatus(project("250000000"), legacy, DEC(at)));
  }
});

function active(
  cap: string,
  patch: Partial<ProjectDefinition> = {},
): ProjectDefinition {
  return { ...project(cap), status: "active", ...patch } as ProjectDefinition;
}

test("discovery uses the current UTC monthly amount", () => {
  const configured = active("250000000", { escrow: undefined });
  expect(listedThisMonth(configured, NOW)).toBe(true);
  expect(
    listedThisMonth(
      {
        ...configured,
        reward: {
          ...configured.reward,
          cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "0" }],
        },
      },
      NOW,
    ),
  ).toBe(false);
  expect(listedThisMonth(active("0"), NOW)).toBe(false);
});

test("an open security program and other reward kinds stay listed", () => {
  expect(
    listedThisMonth(
      active("0", {
        securityBounty: { status: "open" },
      } as unknown as Partial<ProjectDefinition>),
      NOW,
    ),
  ).toBe(true);
  // A draft program does not keep an unfunded pool listed.
  expect(
    listedThisMonth(
      active("0", {
        securityBounty: { status: "draft" },
      } as unknown as Partial<ProjectDefinition>),
      NOW,
    ),
  ).toBe(false);
  expect(
    listedThisMonth(
      active("0", {
        reward: { kind: "external-prize-share" },
      } as unknown as Partial<ProjectDefinition>),
      NOW,
    ),
  ).toBe(true);
  expect(listedThisMonth(active("250000000", { status: "paused" }), NOW)).toBe(
    true,
  );
  expect(listedThisMonth(active("0", { status: "paused" }), NOW)).toBe(false);
});

test("extra money covers more months of the owner's monthly amount", () => {
  const vaults = (free: string | null, network = "base-mainnet") =>
    index({ freeBalance: free, network }).get("demo");
  const pool = project("250000000");
  // TOON Plugins on 14 November 2026: 253 USDC against 250 a month.
  expect(monthsCovered(pool, vaults("253000000"), NOW)).toBe(1);
  expect(monthsCovered(pool, vaults("749999999"), NOW)).toBe(2);
  expect(monthsCovered(pool, vaults("750000000"), NOW)).toBe(3);
  expect(monthsCovered(pool, vaults("249999999"), NOW)).toBe(0);
  expect(monthsCoveredLabel(3)).toBe("Covers 3 months");
  expect(monthsCoveredLabel(1)).toBe("Covers 1 month");
  expect(monthsCoveredLabel(0)).toBe("Covers less than one month");
  // No monthly amount, no vault on record, or an unread balance: no claim.
  expect(monthsCovered(project("0"), vaults("253000000"), NOW)).toBeNull();
  expect(monthsCovered(pool, undefined, NOW)).toBeNull();
  expect(monthsCovered(pool, vaults(null), NOW)).toBeNull();
  // A vault the project did not record does not count toward its months.
  expect(
    monthsCovered(pool, vaults("900000000", "robinhood-mainnet"), NOW),
  ).toBeNull();
  // This month's amount is the one that applies to this month.
  expect(
    monthsCovered(
      project("500000000", "base-mainnet", {
        cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "100000000" }],
      }),
      vaults("253000000"),
      NOW,
    ),
  ).toBe(2);
});

test("the open cycle reads funded from its vault, not the legacy commitment", () => {
  // Every registered pool is pledged with no committed instrument; the vault
  // is the only funding mode, so the cycle standings must not call a
  // vault-backed month unfunded.
  const pool = project("250000000", "base-mainnet", {
    fundingState: "pledged",
    committedMinor: "0",
  });
  expect(cyclePoolFunded(pool, index({}), "2026-11", NOW)).toBe(true);
  expect(
    cyclePoolFunded(pool, index({ freeBalance: "249999999" }), "2026-11", NOW),
  ).toBe(false);
  expect(cyclePoolFunded(pool, null, "2026-11", NOW)).toBe(false);
  // A closed cycle keeps its legacy basis: only a committed instrument funds it.
  expect(cyclePoolFunded(pool, index({}), "2026-10", NOW)).toBe(false);
  const committed = project("250000000", "base-mainnet", {
    fundingState: "committed",
    committedMinor: "250000000",
  });
  expect(cyclePoolFunded(committed, index({}), "2026-10", NOW)).toBe(true);
});

test("paying vault free funds sum the recorded vaults only", () => {
  expect(payingVaultFreeMinor(project("250000000"), index({}))).toBe(
    "250000000",
  );
  expect(
    payingVaultFreeMinor(project("250000000"), index({ freeBalance: null })),
  ).toBeNull();
  expect(payingVaultFreeMinor(project("250000000"), null)).toBeNull();
});
