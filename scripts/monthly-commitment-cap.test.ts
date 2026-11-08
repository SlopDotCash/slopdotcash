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
 * cover a pinned month as well as the default amount.
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

const capOf = (project: Pick<ProjectDefinition, "reward" | "rewardAsset">) =>
  vaultMonthlyCap(project, deployment, DECIMALS);

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
  expect(capOf(project)).toBe(5000n);
  expect(
    monthlyTarget(true, capOf(project), { cap: "0", enabled: false }),
  ).toEqual({ cap: "5000", enabled: true });
});

test("a month pinned below the monthly amount keeps the vault target at the monthly amount", () => {
  const project = projectWith("5000", [
    { cycleId: "2026-09", monthlyCapMinor: "1000" },
  ]);
  expect(capOf(project)).toBe(5000n);
});

test("a zero pin does not lower the vault target, and a positive pin covers a zero monthly amount", () => {
  expect(
    capOf(projectWith("1000", [{ cycleId: "2026-09", monthlyCapMinor: "0" }])),
  ).toBe(1000n);
  const pinned = projectWith("0", [
    { cycleId: "2026-09", monthlyCapMinor: "5000" },
  ]);
  expect(capOf(pinned)).toBe(5000n);
  expect(
    monthlyTarget(true, capOf(pinned), { cap: "0", enabled: false }),
  ).toEqual({ cap: "5000", enabled: true });
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
