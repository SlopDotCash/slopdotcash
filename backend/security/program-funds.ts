import type { SecurityBountyTerms } from "../../src/lib/security-bounty.mjs";
import type { D1QueryStatement, D1TransactionalDatabase } from "../d1";
import { VAULT_SNAPSHOT_MAX_AGE_MS } from "./payments";

/**
 * Approved award reservations whose money is still inside the vault's free
 * balance: no finalized on-chain commitment exists for them yet, or that
 * commitment is newer than the snapshot (`?` = the snapshot time).
 * Bind order: project id, currency, snapshot time.
 */
export const OUTSTANDING_RESERVATIONS = `SELECT COALESCE(SUM(CAST(r.gross_minor AS INTEGER)), 0) FROM security_award_reservations r WHERE r.project_id = ? AND r.currency = ? AND NOT EXISTS (SELECT 1 FROM security_settlements s JOIN security_payment_obligations o ON o.id = s.obligation_id WHERE s.case_id = r.case_id AND o.created_at <= ?)`;

/**
 * The program's money that an owner can still reserve (owner decision D10,
 * PRD section 10 "verified funds versus pledges"): the finalized free
 * balance of one reviewed bounty vault, from a current snapshot in the
 * program's asset, minus every approved reservation that has not yet
 * left that free balance. Published amounts and award counts are terms, not
 * funds. Null when no reviewed vault has a current finalized snapshot.
 */
export async function readSecurityProgramFunds(
  deps: { db: D1TransactionalDatabase<D1QueryStatement>; now: () => Date },
  projectId: string,
  program: SecurityBountyTerms,
  snapshotGuards: { sql: string; values: unknown[] }[] = [],
): Promise<{
  currency: SecurityBountyTerms["amount"]["currency"];
  decimals: number;
  network: SecurityBountyTerms["amount"]["network"];
  freeMinor: string;
  snapshotAt: string;
  availableMinor: string;
} | null> {
  const now = deps.now().getTime();
  // One payment draws on one vault, so the funds are those of the single
  // reviewed vault with the largest current finalized free balance. Adding
  // vaults together would reserve money that no single payment can use.
  let best: {
    deployment: { network: string; vault: string };
    snapshot: {
      asset_address: string;
      asset_decimals: number;
      observed_at: string;
      free_balance: string;
    };
  } | null = null;
  for (const deployment of program.settlement?.deployments ?? []) {
    const snapshot = await deps.db
      .prepare(
        "SELECT asset_address, asset_decimals, observed_at, free_balance FROM security_vault_snapshots WHERE project_id = ? AND network = ? AND vault = ?",
      )
      .bind(projectId, deployment.network, deployment.vault)
      .first<{
        asset_address: string;
        asset_decimals: number;
        observed_at: string;
        free_balance: string | null;
      }>();
    if (
      snapshot === null ||
      snapshot.free_balance === null ||
      snapshot.asset_address !== deployment.asset ||
      snapshot.asset_decimals !== program.amount.decimals ||
      !(now - Date.parse(snapshot.observed_at) <= VAULT_SNAPSHOT_MAX_AGE_MS)
    )
      continue;
    if (
      best === null ||
      BigInt(snapshot.free_balance) > BigInt(best.snapshot.free_balance)
    )
      best = {
        deployment,
        snapshot: { ...snapshot, free_balance: snapshot.free_balance },
      };
  }
  if (best === null) return null;
  const { snapshot } = best;
  // An award write must still see the exact balance used by this read.
  // Keep this internal SQL guard out of the private case response.
  snapshotGuards.push({
    sql: "EXISTS (SELECT 1 FROM security_vault_snapshots WHERE project_id = ? AND network = ? AND vault = ? AND asset_address = ? AND asset_decimals = ? AND free_balance = ? AND observed_at = ?)",
    values: [
      projectId,
      best.deployment.network,
      best.deployment.vault,
      snapshot.asset_address,
      snapshot.asset_decimals,
      snapshot.free_balance,
      snapshot.observed_at,
    ],
  });
  const free = BigInt(snapshot.free_balance);
  const snapshotAt = snapshot.observed_at;
  const outstanding = await deps.db
    .prepare(`SELECT CAST((${OUTSTANDING_RESERVATIONS}) AS TEXT) AS total`)
    .bind(projectId, program.amount.currency, snapshotAt)
    .first<{ total: string }>();
  const available = free - BigInt(outstanding?.total ?? 0);
  return {
    currency: program.amount.currency,
    decimals: program.amount.decimals,
    network: program.amount.network,
    freeMinor: free.toString(),
    snapshotAt,
    availableMinor: (available > 0n ? available : 0n).toString(),
  };
}
