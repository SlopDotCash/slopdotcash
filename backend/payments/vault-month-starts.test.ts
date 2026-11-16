import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  type SnapshotDeployment,
  storeVaultSnapshot,
  type VaultTotals,
} from "./vault-snapshots";

const deployment: SnapshotDeployment = {
  projectId: "acme",
  network: "base-sepolia",
  chain: "base",
  vault: "0x2222222222222222222222222222222222222222",
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
};
const totals = (
  block: string,
  blockTime: string,
  freeBalance: string,
  totalGrossWithdrawn = "0",
): VaultTotals => ({
  network: "base-sepolia",
  vault: deployment.vault,
  asset: deployment.asset,
  decimals: 6,
  blockNumber: block,
  blockTime,
  totalDeposited: "500000000",
  totalPaid: "0",
  totalPayoutFees: "0",
  totalGrossWithdrawn,
  totalWithdrawalFees: "0",
  freeBalance,
  reservedPrincipal: "0",
  reservedFees: "0",
  accruedFees: "0",
  reserved: null,
});

test("the first stored read of each month is kept and never changes", async () => {
  const { db, sqlite } = sqliteD1();
  const store = (t: VaultTotals) =>
    storeVaultSnapshot(db as never, deployment, t, t.blockTime);
  expect(
    await store(totals("10", "2026-11-30T23:55:00.000Z", "250000000")),
  ).toBe("stored");
  await store(totals("11", "2026-12-01T00:05:00.000Z", "500000000"));
  await store(
    totals("12", "2026-12-09T10:00:00.000Z", "200000000", "300000000"),
  );
  expect(
    sqlite
      .query(
        "SELECT period, free_balance, total_gross_withdrawn, block_time FROM vault_month_starts ORDER BY period",
      )
      .all(),
  ).toEqual([
    {
      period: "2026-11",
      free_balance: "250000000",
      total_gross_withdrawn: "0",
      block_time: "2026-11-30T23:55:00.000Z",
    },
    {
      period: "2026-12",
      free_balance: "500000000",
      total_gross_withdrawn: "0",
      block_time: "2026-12-01T00:05:00.000Z",
    },
  ]);
  expect(() =>
    sqlite.query("UPDATE vault_month_starts SET free_balance='1'").run(),
  ).toThrow("vault month start immutable");
  expect(() => sqlite.query("DELETE FROM vault_month_starts").run()).toThrow(
    "vault month start permanent",
  );
});
