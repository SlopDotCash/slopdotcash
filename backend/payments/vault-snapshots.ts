import type { VaultTotals } from "../../contracts/vault-totals";
import { chainFamily } from "../../src/lib/escrow-policy.mjs";
import {
  isAssetDecimals,
  isBaseUnits,
  type PaymentChain,
  type VaultSnapshot,
} from "../../src/lib/payments/contracts";
import type { D1TransactionalDatabase as D1Database } from "../d1";

/** One finalized vault read, as both chain adapters' `readVaultTotals` return it. */
export type { VaultTotals };
export interface SnapshotDeployment {
  projectId: string;
  network: string;
  chain: PaymentChain;
  vault: string;
  asset: string;
  /** Solana only: the adapter reads, and reports as `vault`, the project PDA. */
  projectPda?: string | null;
}
export type VaultTotalsReader<D extends SnapshotDeployment> = (
  deployment: D,
  rpcUrl: string,
) => Promise<VaultTotals>;

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

export function sameAddress(chain: PaymentChain, a: string, b: string) {
  return chainFamily(chain) === "evm"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/**
 * Stores one finalized read for a reviewed deployment. The read must name the
 * reviewed vault and asset. Cumulative counters and the block never go back:
 * a read that contradicts the stored row fails and the stored row stays.
 */
export async function storeVaultSnapshot(
  db: D1Database,
  deployment: SnapshotDeployment,
  totals: VaultTotals,
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
    if (BigInt(totals.blockNumber) < BigInt(prior.block_number as string))
      return "older";
    if (
      prior.asset_address !== deployment.asset ||
      prior.asset_decimals !== totals.decimals
    )
      throw new Error("Vault asset changed");
    for (const key of CUMULATIVE)
      if (BigInt(totals[key]) < BigInt(prior[COLUMNS[key]] as string))
        throw new Error("Vault counter decreased");
  }
  const blockTime = new Date(totals.blockTime).toISOString();
  const keys = [...CUMULATIVE, ...CURRENT];
  // total_service_fees stays in the append-only schema for earlier rows. The
  // vault contracts have no service charge (owner decision D13), so a new row
  // records 0 and an update never changes the stored value.
  // Compare canonical decimal text exactly, including values above SQLite int64.
  // These write-time guards also cover refreshes that read the same prior row.
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
        )}) ON CONFLICT(project_id,network,vault) DO UPDATE SET ${keys.map((k) => `${COLUMNS[k]}=excluded.${COLUMNS[k]}`).join(",")},block_number=excluded.block_number,block_time=excluded.block_time,observed_at=excluded.observed_at WHERE CAST(excluded.block_number AS INTEGER)>=CAST(vault_snapshots.block_number AS INTEGER) AND excluded.asset_address=vault_snapshots.asset_address AND excluded.asset_decimals=vault_snapshots.asset_decimals AND excluded.chain=vault_snapshots.chain AND ${monotonicCounters}`,
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
        "SELECT block_number FROM vault_snapshots WHERE project_id=? AND network=? AND vault=?",
      )
      .bind(deployment.projectId, deployment.network, deployment.vault)
      .first<{ block_number: string }>();
    if (latest && BigInt(totals.blockNumber) < BigInt(latest.block_number))
      return "older";
    throw new Error("Vault snapshot conflicts with stored counters or asset");
  }
  return "stored";
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
