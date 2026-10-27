import { isEscrowChain } from "../../src/lib/escrow-policy.mjs";
import {
  isBaseUnits,
  type PublicVaultPayment,
  type PublicVaultPaymentPage,
  transactionUrl,
} from "../../src/lib/payments/contracts";
import type { D1Database } from "../d1";

const PAGE_SIZE = 100;
type Scope = { projectId: string } | { githubUserId: string } | null;

/** Only ordinary payment tables are read; security settlement tables stay private. */
const RECORDS = `FROM payment_events e
 JOIN payment_obligations o ON o.id=e.obligation_id AND o.network=e.network
   AND o.paid_transaction=e.transaction_id
 LEFT JOIN monthly_payment_obligations m ON m.project_id=o.project_id
   AND m.network=o.network AND m.vault=o.vault AND m.source_digest=o.source_digest
   AND m.github_user_id=o.github_user_id AND m.gross_base=o.gross_base AND m.fee_base=o.fee_base
 WHERE e.kind='paid' AND o.state='paid'
   AND NOT EXISTS (SELECT 1 FROM points_members p WHERE p.github_id=o.github_user_id
     AND (p.public!=1 OR p.closed_at IS NOT NULL))`;

type Row = {
  sequence: number;
  projectId: string;
  network: string;
  chain: string;
  vault: string;
  githubUserId: string;
  sourceDigest: string;
  grossBase: string;
  feeBase: string;
  assetAddress: string;
  assetDecimals: number;
  transactionId: string;
  eventIndex: number;
  obligationId: string;
  evidence: string;
  contributionMonth: string | null;
  indexedAt: string;
};

function publicRecord(row: Row): PublicVaultPayment {
  const evidence = JSON.parse(row.evidence) as Record<string, unknown>;
  if (
    !isEscrowChain(row.chain) ||
    !isBaseUnits(row.grossBase) ||
    !isBaseUnits(row.feeBase) ||
    BigInt(row.feeBase) > BigInt(row.grossBase) ||
    !Number.isSafeInteger(row.assetDecimals) ||
    row.assetDecimals < 0 ||
    row.assetDecimals > 36 ||
    !transactionUrl(row.network, row.transactionId) ||
    !Number.isFinite(Date.parse(row.indexedAt)) ||
    (row.contributionMonth !== null &&
      !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row.contributionMonth))
  )
    throw new Error("Invalid finalized payment record");
  const netBase = (BigInt(row.grossBase) - BigInt(row.feeBase)).toString();
  const facts = {
    kind: "paid",
    transactionId: row.transactionId,
    eventIndex: row.eventIndex,
    obligationId: row.obligationId,
    projectId: row.projectId,
    network: row.network,
    chain: row.chain,
    vault: row.vault,
    githubUserId: row.githubUserId,
    sourceDigest: row.sourceDigest,
    grossMicro: row.grossBase,
    feeMicro: row.feeBase,
    netMicro: netBase,
  };
  if (Object.entries(facts).some(([key, value]) => evidence[key] !== value))
    throw new Error("Finalized payment evidence does not match obligation");
  if (
    (evidence.assetAddress !== undefined &&
      evidence.assetAddress !== row.assetAddress) ||
    (evidence.assetDecimals !== undefined &&
      evidence.assetDecimals !== row.assetDecimals)
  )
    throw new Error("Finalized payment asset evidence does not match");
  return {
    id: `${row.network}:${row.transactionId}:${row.eventIndex}`,
    projectId: row.projectId,
    network: row.network,
    chain: row.chain,
    contributionMonth: row.contributionMonth,
    assetAddress: row.assetAddress,
    assetDecimals: row.assetDecimals,
    netBase,
    transactionId: row.transactionId,
    indexedAt: row.indexedAt,
  };
}

/** A frozen append boundary keeps a multi-page read independent of later payments. */
export async function publicVaultPayments(
  db: D1Database,
  scope: Scope,
  after: number,
  requestedThrough: number | null,
): Promise<PublicVaultPaymentPage> {
  const bound = await db
    .prepare("SELECT COALESCE(MAX(rowid),0) value FROM payment_events")
    .first<{ value: number }>();
  if (!bound) throw new Error("Payment history boundary unavailable");
  const highest = bound.value;
  const through = requestedThrough ?? highest;
  if (
    !Number.isSafeInteger(after) ||
    !Number.isSafeInteger(through) ||
    after < 0 ||
    through < after ||
    through > highest
  )
    throw new RangeError("Invalid payment history cursor");
  const filter = scope
    ? "projectId" in scope
      ? " AND o.project_id=?"
      : " AND o.github_user_id=?"
    : "";
  const values = scope
    ? ["projectId" in scope ? scope.projectId : scope.githubUserId]
    : [];
  const count = await db
    .prepare(`SELECT COUNT(*) value ${RECORDS}${filter} AND e.rowid<=?`)
    .bind(...values, through)
    .first<{ value: number }>();
  const result = await db
    .prepare(`SELECT json_group_array(json(item)) items FROM (
      SELECT json_object('sequence',e.rowid,'projectId',o.project_id,
        'network',o.network,'chain',o.chain,'vault',o.vault,'githubUserId',o.github_user_id,
        'sourceDigest',o.source_digest,'grossBase',o.gross_base,'feeBase',o.fee_base,
        'assetAddress',o.asset_address,'assetDecimals',o.asset_decimals,
        'transactionId',e.transaction_id,'eventIndex',e.event_index,
        'obligationId',o.id,'evidence',e.evidence_json,
        'contributionMonth',m.period,'indexedAt',e.observed_at) item
      ${RECORDS}${filter} AND e.rowid>? AND e.rowid<=?
      ORDER BY e.rowid LIMIT ?)`)
    .bind(...values, after, through, PAGE_SIZE + 1)
    .first<{ items: string }>();
  if (!result || !count) throw new Error("Payment history read incomplete");
  const rows = JSON.parse(result.items) as Row[];
  const selected = rows.slice(0, PAGE_SIZE);
  return {
    payments: selected.map(publicRecord),
    through,
    next:
      rows.length > PAGE_SIZE ? selected[selected.length - 1].sequence : null,
    total: count.value,
  };
}
