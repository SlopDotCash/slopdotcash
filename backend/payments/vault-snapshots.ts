import type { VaultTotals } from "../../contracts/vault-totals";
import { chainFamily } from "../../src/lib/escrow-policy.mjs";
import {
  isAssetDecimals,
  isBaseUnits,
  type PaymentChain,
  type PayoutPolicy,
  type VaultSnapshot,
} from "../../src/lib/payments/contracts";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import type { StoredMonthPledges } from "./month-pledges";
import { firstDecreasedCounter, vaultCounterHeader } from "./verified-evidence";

/** One finalized vault read, as both chain adapters' `readVaultTotals` return it. */
export type { VaultTotals };
/**
 * A vault read with its month pledges (migration 0128): null when the vault's
 * contract has no pledge support, undefined when they were not read, which
 * leaves the stored pledges as they are.
 */
export type VaultRead = VaultTotals & {
  monthPledges?: StoredMonthPledges | null;
};
export interface SnapshotDeployment {
  projectId: string;
  network: string;
  chain: PaymentChain;
  vault: string;
  asset: string;
  payoutPolicy?: PayoutPolicy;
  /** Solana only: the adapter reads, and reports as `vault`, the project PDA. */
  projectPda?: string | null;
}
type VaultTotalsReader<D extends SnapshotDeployment> = (
  deployment: D,
  rpcUrl: string,
) => Promise<VaultRead>;

const CUMULATIVE = [
  "totalDeposited",
  "totalPaid",
  "totalPayoutFees",
  "totalGrossWithdrawn",
  "totalWithdrawalFees",
] as const;
const CURRENT = [
  "freeBalance",
  "reservedPrincipal",
  "reservedFees",
  "accruedFees",
  "reserved",
] as const;
const COLUMNS: Record<(typeof CUMULATIVE | typeof CURRENT)[number], string> = {
  totalDeposited: "total_deposited",
  totalPaid: "total_paid",
  totalPayoutFees: "total_payout_fees",
  totalGrossWithdrawn: "total_gross_withdrawn",
  totalWithdrawalFees: "total_withdrawal_fees",
  freeBalance: "free_balance",
  reservedPrincipal: "reserved_principal",
  reservedFees: "reserved_fees",
  accruedFees: "accrued_fees",
  reserved: "reserved",
};

function sameAddress(chain: PaymentChain, a: string, b: string) {
  return chainFamily(chain) === "evm"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/**
 * Stores one finalized read for a reviewed deployment. The read must name the
 * reviewed vault and asset. Cumulative counters and the block never go back.
 * Within a block, a superseded observation leaves the stored row unchanged.
 */
export async function storeVaultSnapshot(
  db: D1Database,
  deployment: SnapshotDeployment,
  totals: VaultRead,
  observedAt: string,
): Promise<"stored" | "older"> {
  if (
    totals.network !== deployment.network ||
    !sameAddress(
      deployment.chain,
      totals.vault,
      chainFamily(deployment.chain) === "solana"
        ? (deployment.projectPda ?? "")
        : deployment.vault,
    ) ||
    !sameAddress(deployment.chain, totals.asset, deployment.asset) ||
    !isAssetDecimals(totals.decimals) ||
    !/^(0|[1-9][0-9]{0,17})$/.test(totals.blockNumber) ||
    typeof totals.blockTime !== "string" ||
    Number.isNaN(Date.parse(totals.blockTime)) ||
    !CUMULATIVE.every((key) => isBaseUnits(totals[key])) ||
    !CURRENT.every((key) => totals[key] === null || isBaseUnits(totals[key]))
  )
    throw new Error("Vault totals differ from the reviewed deployment");
  const prior = await db
    .prepare(
      "SELECT * FROM vault_snapshots WHERE project_id=? AND network=? AND vault=?",
    )
    .bind(deployment.projectId, deployment.network, deployment.vault)
    .first<Record<string, string | number | null>>();
  if (prior) {
    const header = vaultCounterHeader(
      {
        block: BigInt(totals.blockNumber),
        asset: deployment.asset,
        decimals: totals.decimals,
      },
      {
        block: BigInt(prior.block_number as string),
        asset: prior.asset_address as string,
        decimals: prior.asset_decimals as number,
      },
    );
    if (header === "older") return "older";
    if (header === "asset-changed") throw new Error("Vault asset changed");
    const incomingCounters: bigint[] = [],
      priorCounters: bigint[] = [];
    for (const key of CUMULATIVE) {
      incomingCounters.push(BigInt(totals[key]));
      priorCounters.push(BigInt(prior[COLUMNS[key]] as string));
    }
    if (firstDecreasedCounter(incomingCounters, priorCounters) >= 0)
      throw new Error("Vault counter decreased");
  }
  const blockTime = new Date(totals.blockTime).toISOString();
  const keys = [...CUMULATIVE, ...CURRENT];
  // total_service_fees stays in the append-only schema for earlier rows. The
  // vault contracts have no service charge (owner decision D13), so a new row
  // records 0 and an update never changes the stored value.
  // Compare canonical decimal text exactly, including values above SQLite int64.
  // These write-time guards also cover refreshes that read the same prior row.
  // Block order takes precedence over the refresh's start time. Only compare
  // observation times within the same block, keeping balances with their own
  // timestamp. julianday compares instants rather than ISO timezone spellings.
  const monotonicCounters = CUMULATIVE.map((key) => {
    const column = COLUMNS[key];
    return `(length(excluded.${column}) > length(vault_snapshots.${column}) OR (length(excluded.${column}) = length(vault_snapshots.${column}) AND excluded.${column} >= vault_snapshots.${column}))`;
  }).join(" AND ");
  const result = await db
    .prepare(
      `INSERT INTO vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,${keys.map((k) => COLUMNS[k]).join(",")},total_service_fees,block_number,block_time,observed_at) VALUES(${Array(
        10 + keys.length,
      )
        .fill("?")
        .join(
          ",",
        )}) ON CONFLICT(project_id,network,vault) DO UPDATE SET ${keys.map((k) => `${COLUMNS[k]}=excluded.${COLUMNS[k]}`).join(",")},block_number=excluded.block_number,block_time=excluded.block_time,observed_at=excluded.observed_at WHERE CAST(excluded.block_number AS INTEGER)>=CAST(vault_snapshots.block_number AS INTEGER) AND (CAST(excluded.block_number AS INTEGER)>CAST(vault_snapshots.block_number AS INTEGER) OR julianday(excluded.observed_at)>=julianday(vault_snapshots.observed_at)) AND excluded.asset_address=vault_snapshots.asset_address AND excluded.asset_decimals=vault_snapshots.asset_decimals AND excluded.chain=vault_snapshots.chain AND ${monotonicCounters}`,
    )
    .bind(
      deployment.projectId,
      deployment.network,
      deployment.chain,
      deployment.vault,
      deployment.asset,
      totals.decimals,
      ...keys.map((k) => totals[k]),
      "0",
      totals.blockNumber,
      blockTime,
      observedAt,
    )
    .run();
  if (!result.success) throw new Error("Vault snapshot write failed");
  if (result.meta?.changes !== 1) {
    const latest = await db
      .prepare(
        "SELECT block_number,observed_at FROM vault_snapshots WHERE project_id=? AND network=? AND vault=?",
      )
      .bind(deployment.projectId, deployment.network, deployment.vault)
      .first<{ block_number: string; observed_at: string }>();
    if (
      latest &&
      (BigInt(totals.blockNumber) < BigInt(latest.block_number) ||
        (BigInt(totals.blockNumber) === BigInt(latest.block_number) &&
          Date.parse(observedAt) < Date.parse(latest.observed_at)))
    )
      return "older";
    throw new Error("Vault snapshot conflicts with stored counters or asset");
  }
  if (deployment.payoutPolicy !== "security-bounty") {
    await recordMonthStart(db, deployment, totals, blockTime, observedAt);
    if (totals.monthPledges !== undefined)
      await recordMonthPledges(
        db,
        deployment,
        totals.monthPledges,
        totals.blockNumber,
        observedAt,
      );
  }
  return "stored";
}

/**
 * Stores the pledges read with this snapshot. Each month's row keeps the read
 * of the newest block. A failure fails the refresh, so the next one retries:
 * the coordinator relies on these rows to freeze a pledged month.
 */
async function recordMonthPledges(
  db: D1Database,
  deployment: SnapshotDeployment,
  read: StoredMonthPledges | null,
  blockNumber: string,
  observedAt: string,
): Promise<void> {
  const statements = [
    db
      .prepare(
        "UPDATE vault_snapshots SET open_pledged_gross=? WHERE project_id=? AND network=? AND vault=? AND block_number=? AND observed_at=?",
      )
      .bind(
        read?.openPledgedGross ?? null,
        deployment.projectId,
        deployment.network,
        deployment.vault,
        blockNumber,
        observedAt,
      ),
    ...(read?.pledges ?? []).map((pledge) =>
      db
        .prepare(
          "INSERT INTO vault_month_pledges(project_id,network,vault,period,amount,open,block_number,observed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id,network,vault,period) DO UPDATE SET amount=excluded.amount,open=excluded.open,block_number=excluded.block_number,observed_at=excluded.observed_at WHERE CAST(excluded.block_number AS INTEGER)>=CAST(vault_month_pledges.block_number AS INTEGER)",
        )
        .bind(
          deployment.projectId,
          deployment.network,
          deployment.vault,
          pledge.period,
          pledge.amount,
          pledge.open ? 1 : 0,
          blockNumber,
          observedAt,
        ),
    ),
  ];
  const results = await db.batch(statements);
  if (results.some((result) => !result.success))
    throw new Error("Vault pledge write failed");
}

/**
 * Keeps the first stored read of each UTC month (migration 0127), so pages
 * can tell whether a month was funded on the 1st (operator decision,
 * 15 November 2026). It never fails the refresh: a missed row only means
 * that month is not shown as promised.
 */
async function recordMonthStart(
  db: D1Database,
  deployment: SnapshotDeployment,
  totals: VaultTotals,
  blockTime: string,
  observedAt: string,
): Promise<void> {
  if (totals.freeBalance === null) return;
  try {
    await db
      .prepare(
        "INSERT INTO vault_month_starts(project_id,network,vault,period,free_balance,total_gross_withdrawn,block_number,block_time,observed_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM vault_month_starts WHERE project_id=? AND network=? AND vault=? AND period=?)",
      )
      .bind(
        deployment.projectId,
        deployment.network,
        deployment.vault,
        blockTime.slice(0, 7),
        totals.freeBalance,
        totals.totalGrossWithdrawn,
        totals.blockNumber,
        blockTime,
        observedAt,
        deployment.projectId,
        deployment.network,
        deployment.vault,
        blockTime.slice(0, 7),
      )
      .run();
  } catch {
    // The month start is display evidence only; the refresh stands.
  }
}

/** One failing vault never stops the others; failures are reported together. */
export async function refreshVaultSnapshots<D extends SnapshotDeployment>(
  db: D1Database,
  deployments: readonly D[],
  rpcUrls: Record<string, string>,
  read: VaultTotalsReader<D>,
  now = new Date(),
): Promise<void> {
  const failures: { index: number; error: unknown }[] = [];
  let next = 0;
  // Bound read-only RPC work; each vault keeps its own monotonic D1 write.
  await Promise.all(
    Array.from({ length: Math.min(4, deployments.length) }, async () => {
      while (next < deployments.length) {
        const index = next++;
        const deployment = deployments[index];
        try {
          const rpcUrl = rpcUrls[deployment.network];
          if (!rpcUrl) throw new Error("Private RPC configuration unavailable");
          await storeVaultSnapshot(
            db,
            deployment,
            await read(deployment, rpcUrl),
            now.toISOString(),
          );
        } catch (error) {
          failures.push({ index, error });
        }
      }
    }),
  );
  if (failures.length)
    throw new AggregateError(
      failures.sort((a, b) => a.index - b.index).map(({ error }) => error),
      "Vault snapshot failures",
    );
}

export async function projectVaultSnapshots(
  db: D1Database,
  projectId: string,
): Promise<VaultSnapshot[]> {
  const row = await db
    .prepare(
      `SELECT json_group_array(json_object('projectId',project_id,'network',network,'chain',chain,'vault',vault,'assetAddress',asset_address,'assetDecimals',asset_decimals,${[
        ...CUMULATIVE,
        ...CURRENT,
      ]
        .map((k) => `'${k}',${COLUMNS[k]}`)
        .join(
          ",",
        )},'blockNumber',block_number,'blockTime',block_time,'observedAt',observed_at)) items FROM (SELECT * FROM vault_snapshots WHERE project_id=? ORDER BY network,vault)`,
    )
    .bind(projectId)
    .first<{ items: string }>();
  return JSON.parse(row?.items ?? "[]") as VaultSnapshot[];
}
