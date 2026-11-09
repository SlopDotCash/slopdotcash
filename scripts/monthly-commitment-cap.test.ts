/**
 * The vault's monthly commitment cap against month-specific reward caps
 * (PRD sections 6 and 11). A reviewed manifest may pin an individual month
 * to its own amount through `reward.cycleCaps`: the monthly proposal, the
 * owner's allocation cap and the frozen total all resolve that month's cap,
 * and an owner's amount change writes such pins for every month through the
 * open one so the new amount starts with the next cycle
 * (backend/projects/handler.ts, prospectiveFinancialChange). The vault
 * contract admits a month only when its gross total is within the vault's
 * one monthly cap, so the cap the owner's authorization review targets must
 * cover a pinned month as well as the default amount. A pin counts only
 * while its month can still commit: both vaults close a cycle's window 72
 * hours after the start of the month two months later, and pins are never
 * pruned, so an expired pin must not hold the target up forever.
 */
import { expect, test } from "bun:test";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "../src/lib/escrow-policy.mjs";
import {
  monthlyTarget,
  vaultMonthlyCap,
} from "../src/lib/monthly-commitment-actions";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { resolveRewardCapMinor } from "../src/lib/reward-cap.mjs";

const NETWORK = ESCROW_NETWORKS["solana-devnet"];
const DECIMALS = NETWORK.assetDecimals;
if (DECIMALS === null)
  throw new Error("solana-devnet must record its asset decimals");

function projectWith(
  monthlyCapMinor: string,
  cycleCaps?: { cycleId: string; monthlyCapMinor: string }[],
) {
  return {
    reward: {
      kind: "monthly-pool",
      chain: "solana",
      monthlyCapMinor,
      ...(cycleCaps ? { cycleCaps } : {}),
    },
    rewardAsset: undefined,
  } as unknown as Pick<ProjectDefinition, "reward" | "rewardAsset">;
}

const deployment = {
  network: "solana-devnet",
  asset: NETWORK.asset,
} as Pick<EscrowDeployment, "network" | "asset">;

const capOf = (
  project: Pick<ProjectDefinition, "reward" | "rewardAsset">,
  now?: Date,
) => vaultMonthlyCap(project, deployment, DECIMALS, now);

// September 2026 commits from 2026-10-04 until 2026-11-04, so this moment
// sits inside that pin's window.
const IN_SEPTEMBER_WINDOW = new Date("2026-10-15T00:00:00Z");

test("without month-specific caps the vault target is the monthly amount", () => {
  expect(capOf(projectWith("1000"))).toBe(1000n);
});

test("a month pinned above the monthly amount raises the vault target to the pin", () => {
  const project = projectWith("1000", [
    { cycleId: "2026-09", monthlyCapMinor: "5000" },
  ]);
  // The proposal side resolves September's cap to the pin, so that month
  // may finalize a total the flat amount would never admit on chain.
  expect(resolveRewardCapMinor(project as ProjectDefinition, "2026-09")).toBe(
    "5000",
  );
  expect(capOf(project, IN_SEPTEMBER_WINDOW)).toBe(5000n);
  expect(
    monthlyTarget(true, capOf(project, IN_SEPTEMBER_WINDOW), {
      cap: "0",
      enabled: false,
    }),
  ).toEqual({ cap: "5000", enabled: true });
});

test("a month pinned below the monthly amount keeps the vault target at the monthly amount", () => {
  const project = projectWith("5000", [
    { cycleId: "2026-09", monthlyCapMinor: "1000" },
  ]);
  expect(capOf(project, IN_SEPTEMBER_WINDOW)).toBe(5000n);
});

test("a zero pin does not lower the vault target, and a positive pin covers a zero monthly amount", () => {
  expect(
    capOf(
      projectWith("1000", [{ cycleId: "2026-09", monthlyCapMinor: "0" }]),
      IN_SEPTEMBER_WINDOW,
    ),
  ).toBe(1000n);
  const pinned = projectWith("0", [
    { cycleId: "2026-09", monthlyCapMinor: "5000" },
  ]);
  expect(capOf(pinned, IN_SEPTEMBER_WINDOW)).toBe(5000n);
  expect(
    monthlyTarget(true, capOf(pinned, IN_SEPTEMBER_WINDOW), {
      cap: "0",
      enabled: false,
    }),
  ).toEqual({ cap: "5000", enabled: true });
});

test("a pin whose commit window has closed no longer raises the vault target", () => {
  // June 2026 could commit only until 2026-08-04, when its window closed;
  // the pin is never pruned, but by 2026-11-09 it can never be used again.
  const project = projectWith("1000", [
    { cycleId: "2026-06", monthlyCapMinor: "5000" },
  ]);
  expect(capOf(project, new Date("2026-11-09T00:00:00Z"))).toBe(1000n);
});

test("a pin counts until its window closes and not at the closing moment", () => {
  const project = projectWith("1000", [
    { cycleId: "2026-06", monthlyCapMinor: "5000" },
  ]);
  expect(capOf(project, new Date("2026-08-03T23:59:59Z"))).toBe(5000n);
  expect(capOf(project, new Date("2026-08-04T00:00:00Z"))).toBe(1000n);
});

test("an expired pin does not mask a live one, and a future pin still counts", () => {
  const now = new Date("2026-11-09T00:00:00Z");
  const mixed = projectWith("1000", [
    { cycleId: "2026-06", monthlyCapMinor: "5000" },
    { cycleId: "2026-10", monthlyCapMinor: "3000" },
  ]);
  // October's window closes 2026-12-04, so the live pin sets the target.
  expect(capOf(mixed, now)).toBe(3000n);
  const future = projectWith("1000", [
    { cycleId: "2026-12", monthlyCapMinor: "5000" },
  ]);
  // December's window has not opened yet, but the month can still commit
  // once it does, so the standing target covers it.
  expect(capOf(future, now)).toBe(5000n);
});

test("the recorded-asset checks still guard the target", () => {
  expect(() =>
    vaultMonthlyCap(projectWith("1000"), deployment, DECIMALS + 1),
  ).toThrow("decimals differ");
  expect(() =>
    vaultMonthlyCap(
      projectWith("1000"),
      {
        network: "solana-devnet",
        asset: "So11111111111111111111111111111111111111112",
      },
      DECIMALS,
    ),
  ).toThrow("vault token differs");
});
