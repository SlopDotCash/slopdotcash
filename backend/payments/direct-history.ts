import type {
  DirectTransfer,
  DirectTransferPage,
} from "../../src/lib/payments/contracts";
import type { D1Database } from "../d1";

/** The same append-boundary protocol as ordinary vault-payment history. */
export async function directTransferPage(
  db: D1Database,
  column: "project_id" | "github_user_id",
  value: string,
  after: number,
  requestedThrough: number | null,
): Promise<DirectTransferPage> {
  const bound = await db
    .prepare(
      "SELECT COALESCE(MAX(rowid),0) value FROM payment_direct_transfers",
    )
    .first<{ value: number }>();
  if (!bound) throw new Error("Direct payment history boundary unavailable");
  const through = requestedThrough ?? bound.value;
  if (
    !Number.isSafeInteger(after) ||
    !Number.isSafeInteger(through) ||
    after < 0 ||
    through < after ||
    through > bound.value
  )
    throw new RangeError("Invalid direct payment history cursor");
  const count = await db
    .prepare(
      `SELECT COUNT(*) value FROM payment_direct_transfers WHERE ${column}=? AND rowid<=?`,
    )
    .bind(value, through)
    .first<{ value: number }>();
  const result = await db
    .prepare(`SELECT json_group_array(json_object('sequence',sequence,'transfer',json(item))) items FROM (
    SELECT rowid sequence, json_object('projectId',project_id,'contributionMonth',contribution_month,'githubUserId',github_user_id,'login',github_login,'network',network,'chain',chain,'recipient',recipient,'amountMicro',amount_micro,'transactionId',transaction_id,'blockTime',block_time) item
    FROM payment_direct_transfers WHERE ${column}=? AND rowid>? AND rowid<=? ORDER BY rowid LIMIT 101)`)
    .bind(value, after, through)
    .first<{ items: string }>();
  if (!count || !result)
    throw new Error("Direct payment history read incomplete");
  const rows = JSON.parse(result.items) as {
    sequence: number;
    transfer: DirectTransfer;
  }[];
  const selected = rows.slice(0, 100);
  const transfers = selected.map((row) => row.transfer);
  return {
    transfers,
    totalMicro: transfers
      .reduce((sum, row) => sum + BigInt(row.amountMicro), 0n)
      .toString(),
    through,
    next: rows.length > 100 ? selected[selected.length - 1].sequence : null,
    total: count.value,
  };
}
