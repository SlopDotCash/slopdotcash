import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  monthPledged,
  otherOpenPledges,
  type StoredMonthPledges,
} from "./month-pledges";
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

test("pledges read with a snapshot are stored per month; null marks no pledge support", async () => {
  const { db, sqlite } = sqliteD1();
  const read = (block: string, monthPledges?: StoredMonthPledges | null) => ({
    ...totals(block, "2026-12-02T10:00:00.000Z", "500000000"),
    ...(monthPledges === undefined ? {} : { monthPledges }),
  });
  const store = (t: ReturnType<typeof read>) =>
    storeVaultSnapshot(db as never, deployment, t, t.blockTime);
  await store(read("10", null));
  expect(
    sqlite.query("SELECT open_pledged_gross FROM vault_snapshots").get(),
  ).toEqual({ open_pledged_gross: null });
  await store(
    read("11", {
      openPledgedGross: "500000000",
      pledges: [
        { period: "2026-12", amount: "250000000", open: true },
        { period: "2027-01", amount: "250000000", open: true },
      ],
    }),
  );
  // A refresh that could not read the pledges keeps the stored ones.
  await store(read("12"));
  expect(
    sqlite.query("SELECT open_pledged_gross FROM vault_snapshots").get(),
  ).toEqual({ open_pledged_gross: "500000000" });
  // December is reserved: its pledge closes and the row stays.
  await store(
    read("13", {
      openPledgedGross: "250000000",
      pledges: [
        { period: "2026-12", amount: "250000000", open: false },
        { period: "2027-01", amount: "250000000", open: true },
      ],
    }),
  );
  expect(
    sqlite
      .query(
        "SELECT period, amount, open, block_number FROM vault_month_pledges ORDER BY period",
      )
      .all(),
  ).toEqual([
    { period: "2026-12", amount: "250000000", open: 0, block_number: "13" },
    { period: "2027-01", amount: "250000000", open: 1, block_number: "13" },
  ]);
  const scope = (period: string, vault = deployment.vault) => ({
    projectId: "acme",
    network: deployment.network,
    vault,
    period,
  });
  expect(await monthPledged(db as never, scope("2026-12"))).toBe(true);
  expect(await monthPledged(db as never, scope("2027-02"))).toBe(false);
  // A pledge in another vault of the project gives this one no consent.
  expect(
    await monthPledged(
      db as never,
      scope("2026-12", "0x3333333333333333333333333333333333333333"),
    ),
  ).toBe(false);
  expect(
    await otherOpenPledges(db as never, {
      projectId: "acme",
      network: deployment.network,
      vault: deployment.vault,
      period: "2027-01",
    }),
  ).toBe(0n);
  expect(
    await otherOpenPledges(db as never, {
      projectId: "acme",
      network: deployment.network,
      vault: deployment.vault,
      period: "2027-02",
    }),
  ).toBe(250000000n);
});
