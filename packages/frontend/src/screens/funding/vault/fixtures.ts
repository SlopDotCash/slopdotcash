// spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"; spec/frontend/monthLock.md, "The card appears only once the finalized read shows pledge support"
import { periodContaining } from "@repo/settlement/kernels/calendar";
import type { FundingVault } from "../../../kernels/poolFunding.ts";
import type { FundingDeployment, FundingProject } from "./project.schema.ts";
import type { ShownVaultSnapshot } from "../../../reads/payments.vibe";

export const usdcSnapshot: ShownVaultSnapshot = {
  projectId: "slop",
  network: "base-mainnet",
  chain: "base",
  vault: "0x5e1f0000000000000000000000000000000000aa",
  assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  assetDecimals: 6,
  totalDeposited: "1500000000",
  totalPaid: "420000000",
  totalPayoutFees: "8400000",
  totalGrossWithdrawn: "0",
  totalWithdrawalFees: "0",
  freeBalance: "900000000",
  reservedPrincipal: "160000000",
  reservedFees: "3200000",
  accruedFees: "8400000",
  reserved: "163200000",
  blockNumber: "28100000",
  blockTime: "2026-11-17T12:00:00.000Z",
  observedAt: "2026-11-17T12:00:30.000Z",
  stale: false,
};

export const staleSnapshot: ShownVaultSnapshot = { ...usdcSnapshot, stale: true, observedAt: "2026-11-17T09:10:00.000Z" };

export const legacySnapshot: ShownVaultSnapshot = { ...usdcSnapshot, freeBalance: null, reservedPrincipal: null, reservedFees: null, reserved: null };

export const walletHash = "0x9c1d4c0a4b0e3c7d2f1e6a5b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70812";

export const lockDeployment: FundingDeployment = { network: usdcSnapshot.network, vault: usdcSnapshot.vault, asset: usdcSnapshot.assetAddress, owner: "0x0000000000000000000000000000000000000a11" };

export const lockProject: FundingProject = { id: "slop", slug: "slop", reward: { kind: "monthly-pool", monthlyCapMinor: "250000000" }, escrow: { chain: "base", deployments: [lockDeployment] } };

const monthOf = (iso: string) => periodContaining(Date.parse(iso) / 1000);

export const pledgedRow: FundingVault = {
  network: lockDeployment.network,
  vault: lockDeployment.vault,
  freeBalance: 900_000_000n,
  openPledgedGross: 500_000_000n,
  pledges: [
    { period: monthOf("2026-09-01T00:00:00Z"), amount: 250_000_000n, open: true },
    { period: monthOf("2099-12-01T00:00:00Z"), amount: 250_000_000n, open: true },
  ],
};

export const unpledgedRow: FundingVault = { ...pledgedRow, openPledgedGross: 0n, pledges: [] };
