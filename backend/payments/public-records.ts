import {
  ESCROW_NETWORKS,
  isEscrowChain,
} from "../../src/lib/escrow-policy.mjs";
import {
  isBaseUnits,
  type PublicVaultPayment,
  type PublicVaultPaymentPage,
  transactionUrl,
} from "../../src/lib/payments/contracts";
import { isUsdMicroAsset } from "../../src/lib/received-totals";
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

/** At most this many finalized records feed one aggregate; more fails closed. */
export const MAX_RECEIVED_RECORDS = 20_000;
/** Vault rows carry their evidence (1.5 to 2.5 KB); 100 stay near 250 KB. */
const VAULT_PAGE_SIZE = 100;
const DIRECT_PAGE_SIZE = 500;

/**
 * Reads every row of one append-only table through bounded json pages under a
 * frozen rowid boundary. More than MAX_RECEIVED_RECORDS rows fails closed.
 */
async function pagedRows<T>(
  db: D1Database,
  table: "payment_events" | "payment_direct_transfers",
  page: (after: number, through: number) => { sql: string; values: number[] },
): Promise<T[]> {
  const bound = await db
    .prepare(`SELECT COALESCE(MAX(rowid),0) value FROM ${table}`)
    .first<{ value: number }>();
  if (!bound) throw new Error("Received totals boundary unavailable");
  const rows: T[] = [];
  let after = 0;
  for (;;) {
    const { sql, values } = page(after, bound.value);
    const result = await db
      .prepare(sql)
      .bind(...values)
      .first<{ items: string; last: number | null }>();
    if (!result) throw new Error("Received totals read incomplete");
    const items = JSON.parse(result.items) as T[];
    if (items.length === 0 || result.last === null) return rows;
    rows.push(...items);
    if (rows.length > MAX_RECEIVED_RECORDS)
      throw new Error("Received totals exceed the aggregate bound");
    after = result.last;
  }
}

/** One contributor's all-time finalized receipts, in exact base units. */
export interface ReceivedContributor {
  githubUserId: string;
  login: string | null;
  /** Disclosed direct USDC transfers plus finalized USD-stablecoin vault payments. */
  usdMicro: string;
  directMicro: string;
  vaultUsdMicro: string;
  directTransfers: number;
  vaultPayments: number;
  /** The same dollar receipts by project, largest first. */
  projects: { projectId: string; usdMicro: string }[];
  /** Finalized vault payments in other assets, never converted to dollars. */
  otherAssets: {
    network: string;
    assetAddress: string;
    assetDecimals: number;
    netBase: string;
  }[];
}
export interface ReceivedTotals {
  schemaVersion: "1";
  contributors: ReceivedContributor[];
  totals: {
    usdMicro: string;
    directMicro: string;
    vaultUsdMicro: string;
    directTransfers: number;
    vaultPayments: number;
    contributors: number;
  };
}

/**
 * All-time money received per public contributor: every disclosed direct
 * transfer plus every finalized ordinary vault payment. Each vault record is
 * revalidated against its finalized evidence; one bad record fails the read.
 */
export async function publicReceivedTotals(
  db: D1Database,
  includeTestnets: boolean,
): Promise<ReceivedTotals> {
  // Bounded pages keep every returned value far below D1's 2 MB value limit;
  // a frozen rowid boundary keeps the pages one consistent read.
  const vaultRows = await pagedRows<Row & { memberLogin: string | null }>(
    db,
    "payment_events",
    (after, through) => ({
      sql: `SELECT json_group_array(json(item)) items, MAX(sequence) last FROM (
      SELECT e.rowid sequence, json_object('sequence',e.rowid,'projectId',o.project_id,
        'network',o.network,'chain',o.chain,'vault',o.vault,'githubUserId',o.github_user_id,
        'sourceDigest',o.source_digest,'grossBase',o.gross_base,'feeBase',o.fee_base,
        'assetAddress',o.asset_address,'assetDecimals',o.asset_decimals,
        'transactionId',e.transaction_id,'eventIndex',e.event_index,
        'obligationId',o.id,'evidence',e.evidence_json,
        'contributionMonth',m.period,'indexedAt',e.observed_at,
        'memberLogin',(SELECT login FROM points_members p WHERE p.github_id=o.github_user_id
          AND p.public=1 AND p.closed_at IS NULL)) item
      ${RECORDS} AND e.rowid>? AND e.rowid<=? ORDER BY e.rowid LIMIT ?)`,
      values: [after, through, VAULT_PAGE_SIZE],
    }),
  );
  const directRows = await pagedRows<{
    githubUserId: string;
    projectId: string;
    login: string;
    amountMicro: string;
    memberLogin: string | null;
  }>(db, "payment_direct_transfers", (after, through) => ({
    sql: `SELECT json_group_array(json(item)) items, MAX(sequence) last FROM (
      SELECT d.rowid sequence, json_object('githubUserId',d.github_user_id,
        'projectId',d.project_id,'login',d.github_login,'amountMicro',d.amount_micro,
        'memberLogin',(SELECT login FROM points_members p WHERE p.github_id=d.github_user_id
          AND p.public=1 AND p.closed_at IS NULL)) item
      FROM payment_direct_transfers d WHERE d.rowid>? AND d.rowid<=?
      ORDER BY d.rowid LIMIT ?)`,
    values: [after, through, DIRECT_PAGE_SIZE],
  }));
  const people = new Map<
    string,
    {
      login: string | null;
      direct: bigint;
      vaultUsd: bigint;
      directTransfers: number;
      vaultPayments: number;
      projects: Map<string, bigint>;
      other: Map<string, ReceivedContributor["otherAssets"][number]>;
    }
  >();
  const person = (githubUserId: string) => {
    let value = people.get(githubUserId);
    if (!value) {
      value = {
        login: null,
        direct: 0n,
        vaultUsd: 0n,
        directTransfers: 0,
        vaultPayments: 0,
        projects: new Map(),
        other: new Map(),
      };
      people.set(githubUserId, value);
    }
    return value;
  };
  for (const row of directRows) {
    if (
      !/^[1-9]\d{0,15}$/u.test(row.githubUserId) ||
      !isBaseUnits(row.amountMicro)
    )
      throw new Error("Invalid direct transfer record");
    const value = person(row.githubUserId);
    // A disclosed transfer names its recipient; a later sign-in login wins.
    value.login = row.memberLogin ?? row.login;
    value.direct += BigInt(row.amountMicro);
    value.directTransfers++;
    value.projects.set(
      row.projectId,
      (value.projects.get(row.projectId) ?? 0n) + BigInt(row.amountMicro),
    );
  }
  for (const row of vaultRows) {
    const record = publicRecord(row);
    if (
      !includeTestnets &&
      ESCROW_NETWORKS[record.network as keyof typeof ESCROW_NETWORKS]?.testnet
    )
      continue;
    const value = person(row.githubUserId);
    value.login ??= row.memberLogin;
    value.vaultPayments++;
    if (
      isUsdMicroAsset(
        record.network,
        record.assetAddress,
        record.assetDecimals,
        includeTestnets,
      )
    ) {
      value.vaultUsd += BigInt(record.netBase);
      value.projects.set(
        record.projectId,
        (value.projects.get(record.projectId) ?? 0n) + BigInt(record.netBase),
      );
      continue;
    }
    const key = `${record.network}\u0000${record.assetAddress}`;
    const asset = value.other.get(key) ?? {
      network: record.network,
      assetAddress: record.assetAddress,
      assetDecimals: record.assetDecimals,
      netBase: "0",
    };
    asset.netBase = (BigInt(asset.netBase) + BigInt(record.netBase)).toString();
    value.other.set(key, asset);
  }
  const contributors = [...people.entries()]
    .map(([githubUserId, value]) => ({
      githubUserId,
      login: value.login,
      usdMicro: (value.direct + value.vaultUsd).toString(),
      directMicro: value.direct.toString(),
      vaultUsdMicro: value.vaultUsd.toString(),
      directTransfers: value.directTransfers,
      vaultPayments: value.vaultPayments,
      projects: [...value.projects.entries()]
        .sort(([a, left], [b, right]) =>
          left < right ? 1 : left > right ? -1 : a.localeCompare(b),
        )
        .map(([projectId, usdMicro]) => ({
          projectId,
          usdMicro: usdMicro.toString(),
        })),
      otherAssets: [...value.other.values()],
    }))
    .sort((a, b) => {
      const left = BigInt(a.usdMicro);
      const right = BigInt(b.usdMicro);
      return left < right
        ? 1
        : left > right
          ? -1
          : a.githubUserId.localeCompare(b.githubUserId);
    });
  const sum = (key: "directMicro" | "vaultUsdMicro") =>
    contributors.reduce((total, c) => total + BigInt(c[key]), 0n);
  const directMicro = sum("directMicro");
  const vaultUsdMicro = sum("vaultUsdMicro");
  return {
    schemaVersion: "1",
    contributors,
    totals: {
      usdMicro: (directMicro + vaultUsdMicro).toString(),
      directMicro: directMicro.toString(),
      vaultUsdMicro: vaultUsdMicro.toString(),
      directTransfers: directRows.length,
      vaultPayments: contributors.reduce(
        (total, c) => total + c.vaultPayments,
        0,
      ),
      contributors: contributors.length,
    },
  };
}
