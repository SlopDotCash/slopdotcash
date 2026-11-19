// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/settlement/monthPledges.md, "Pool funding serves a vault's open total, or none without pledge support, with its pledges above zero from the previous UTC month on and every one still open"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { fromAmount } from "./amounts.ts";
import { type Period, periodContaining } from "./calendar.ts";
import { type FactsVault, type PoolFacts, poolFacts } from "./poolFacts.ts";

const VAULT = "0x4F891b8c3d3fab9150fcdc94176b96863cd02899";
const seconds = (iso: string) => Date.parse(iso) / 1000;
const december: Period = periodContaining(seconds("2026-12-01T00:00:00Z"));
const january: Period = periodContaining(seconds("2027-01-01T00:00:00Z"));
const midDecember = seconds("2026-12-15T12:00:00Z");
const cap = 250_000_000n;

interface Shown {
  readonly freeNow: bigint;
  readonly monthStartRead: boolean;
  readonly freeAtStart: bigint;
  readonly withdrawnSince: boolean;
  readonly pledgeSupport: boolean;
  readonly pledged: bigint;
}

const shown = (facts: PoolFacts): Shown => ({
  freeNow: fromAmount(facts.freeNow),
  monthStartRead: facts.monthStartRead,
  freeAtStart: fromAmount(facts.freeAtStart),
  withdrawnSince: facts.withdrawnSince,
  pledgeSupport: facts.pledgeSupport,
  pledged: fromAmount(facts.pledged),
});

const vault = (fields: Partial<FactsVault>): FactsVault => ({ network: "base-sepolia", vault: VAULT.toLowerCase(), freeBalance: cap, ...fields });

const firstRead = { period: december, freeBalance: cap, totalGrossWithdrawn: 0n, blockTime: seconds("2026-12-01T00:04:00Z") };

const cases: ReadonlyArray<readonly [ReadonlyArray<FactsVault>, Shown]> = [
  [
    [vault({ freeBalance: 0n, openPledgedGross: cap, pledges: [{ period: december, amount: cap, open: true }, { period: january, amount: cap, open: true }] })],
    { freeNow: 0n, monthStartRead: false, freeAtStart: 0n, withdrawnSince: false, pledgeSupport: true, pledged: cap },
  ],
  [
    [vault({ totalGrossWithdrawn: 0n, monthStarts: [firstRead] })],
    { freeNow: cap, monthStartRead: true, freeAtStart: cap, withdrawnSince: false, pledgeSupport: false, pledged: 0n },
  ],
  [
    [vault({ freeBalance: cap - 1n, totalGrossWithdrawn: 1n, monthStarts: [firstRead] })],
    { freeNow: cap - 1n, monthStartRead: true, freeAtStart: cap, withdrawnSince: true, pledgeSupport: false, pledged: 0n },
  ],
  [
    [vault({ openPledgedGross: null, pledges: [], monthStarts: [firstRead] })],
    { freeNow: cap, monthStartRead: true, freeAtStart: cap, withdrawnSince: false, pledgeSupport: false, pledged: 0n },
  ],
  [
    [vault({ network: "base-mainnet", openPledgedGross: cap, pledges: [{ period: december, amount: cap, open: false }] }), vault({ vault: "0xother" })],
    { freeNow: 0n, monthStartRead: false, freeAtStart: 0n, withdrawnSince: false, pledgeSupport: false, pledged: 0n },
  ],
];

const run = (vaults: ReadonlyArray<FactsVault>) =>
  shown(poolFacts({
    pool: { monthlyPool: true, deployments: [{ network: "base-sepolia", vault: VAULT }, { network: "ethereum", vault: VAULT }], capFor: () => cap },
    read: "PoolCurrent",
    vaults,
    pays: (network) => network !== "ethereum",
    nowSeconds: midDecember,
  }));

const same = (left: Shown, right: Shown) => (Object.keys(left) as Array<keyof Shown>).every((key) => left[key] === right[key]);

export const poolFactsCountPledgesOnlyInPledgingVaultsAndFreeFundsElsewhere = contract({
  input: Arbitrary.Constant(cases),
  run: (all) => all.map(([vaults]) => run(vaults)),
  invariant: (all, outcomes) => all.every(([, expected], index) => {
    const outcome = outcomes[index];
    return outcome !== undefined && same(outcome, expected);
  }),
});
