import { bytesToHex } from "@noble/hashes/utils.js";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { EVM_ESCROW_EVENT_TOPICS, evmRpc } from "../../contracts/evm/adapter";
import { escrowInvocations, solanaRpc } from "../../contracts/solana/adapter";
import type { DeploymentView } from "./index";

type ScanDeployment = DeploymentView<
  "projectId" | "vault",
  "deploymentTransaction" | "scanPageBlocks" | "projectPda" | "programId"
>;
export interface ScanEvent {
  projectId: string;
  network: string;
  transactionId: string;
  eventIndex: number;
  kind: "reserved" | "paid";
  obligationId: string;
}
// The adapter derives each topic from the reviewed event signature.
const RESERVED = EVM_ESCROW_EVENT_TOPICS.AwardCommitted;
const PAID = EVM_ESCROW_EVENT_TOPICS.Paid;
/** A cursor advances only after every recognized finalized event is durably verified and indexed. The page size comes from the reviewed deployment record. */
export async function scanEvmPayments(
  db: D1Database,
  deployment: ScanDeployment,
  rpcUrl: string,
  index: (event: ScanEvent) => Promise<void>,
): Promise<void> {
  const page = deployment.scanPageBlocks;
  if (page === undefined || !/^[1-9][0-9]{0,6}$/.test(page))
    throw new Error("Reviewed scan page size required for EVM scanning");
  const span = BigInt(page) - 1n;
  const cursor = await db
    .prepare(
      "SELECT position FROM payment_chain_cursors WHERE project_id=? AND network=?",
    )
    .bind(deployment.projectId, deployment.network)
    .first<{ position: string }>();
  let from: bigint;
  if (cursor) from = BigInt(cursor.position) + 1n;
  else {
    if (!deployment.deploymentTransaction)
      throw new Error("Deployment transaction required for scanner origin");
    const receipt = (await evmRpc({ rpcUrl }, "eth_getTransactionReceipt", [
      deployment.deploymentTransaction,
    ])) as { status: string; blockNumber: string } | null;
    if (receipt?.status !== "0x1")
      throw new Error("Deployment origin unavailable");
    from = BigInt(receipt.blockNumber);
  }
  const finalized = (await evmRpc({ rpcUrl }, "eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number: string } | null;
  if (!finalized) throw new Error("Finalized chain head unavailable");
  const end = BigInt(finalized.number);
  if (from > end) return;
  const to = from + span < end ? from + span : end;
  const logs = (await evmRpc({ rpcUrl }, "eth_getLogs", [
    {
      address: deployment.vault,
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      topics: [[RESERVED, PAID]],
    },
  ])) as {
    topics: string[];
    transactionHash: string;
    logIndex: string;
    blockNumber: string;
  }[];
  if (!Array.isArray(logs)) throw new Error("Invalid finalized log page");
  logs.sort((a, b) =>
    BigInt(a.blockNumber) === BigInt(b.blockNumber)
      ? Number(BigInt(a.logIndex) - BigInt(b.logIndex))
      : BigInt(a.blockNumber) < BigInt(b.blockNumber)
        ? -1
        : 1,
  );
  for (const log of logs) {
    if (log.topics[0] !== RESERVED && log.topics[0] !== PAID)
      throw new Error("Unexpected scanner event");
    await index({
      projectId: deployment.projectId,
      network: deployment.network,
      transactionId: log.transactionHash,
      eventIndex: Number(BigInt(log.logIndex)),
      kind: log.topics[0] === RESERVED ? "reserved" : "paid",
      obligationId: log.topics[1],
    });
  }
  await db
    .prepare(
      "INSERT INTO payment_chain_cursors VALUES(?,?,?,?) ON CONFLICT(project_id,network) DO UPDATE SET position=excluded.position,synced_at=excluded.synced_at WHERE length(excluded.position)>length(payment_chain_cursors.position) OR (length(excluded.position)=length(payment_chain_cursors.position) AND excluded.position>=payment_chain_cursors.position)",
    )
    .bind(
      deployment.projectId,
      deployment.network,
      to.toString(),
      new Date().toISOString(),
    )
    .run();
}
const SOLANA_SIGNATURE_PAGE_SIZE = 1000;
const SOLANA_TRANSACTIONS_PER_RUN = 100;
/**
 * Indexes this project's escrow instructions oldest first. Anyone can mention
 * the project account in a transaction, so other projects' instructions are
 * skipped, work per run is bounded, and the cursor advances per verified chunk.
 */
export async function scanSolanaPayments(
  db: D1Database,
  deployment: ScanDeployment,
  rpcUrl: string,
  index: (event: ScanEvent) => Promise<void>,
): Promise<void> {
  const { projectPda, programId } = deployment;
  if (!projectPda || !programId)
    throw new Error("Solana project deployment missing");
  // Freeze a discovery interval. A later run resumes its oldest fetched page;
  // newly arriving transactions belong to the next interval.
  await db
    .prepare(
      "INSERT OR IGNORE INTO payment_solana_scans(project_id,network,generation,until_signature) VALUES(?,?,?,(SELECT position FROM payment_chain_cursors WHERE project_id=? AND network=?))",
    )
    .bind(
      deployment.projectId,
      deployment.network,
      crypto.randomUUID(),
      deployment.projectId,
      deployment.network,
    )
    .run();
  const scan = await db
    .prepare(
      "SELECT * FROM payment_solana_scans WHERE project_id=? AND network=?",
    )
    .bind(deployment.projectId, deployment.network)
    .first<{
      generation: string;
      until_signature: string | null;
      before_signature: string | null;
      next_page: number;
      ready: number;
      revision: number;
    }>();
  if (!scan) return;
  // Every checkpoint is one atomic compare-and-swap batch. An overlapping or
  // resumed stale run may reverify events, but cannot rewind or delete progress.
  const fence =
    "EXISTS(SELECT 1 FROM payment_solana_scans WHERE project_id=? AND network=? AND generation=? AND revision=?)";
  const keys = [deployment.projectId, deployment.network, scan.generation];
  const expected = [...keys, scan.revision];
  if (!scan.ready) {
    const result = (await solanaRpc({ rpcUrl }, "getSignaturesForAddress", [
      projectPda,
      {
        commitment: "finalized",
        limit: SOLANA_SIGNATURE_PAGE_SIZE,
        ...(scan.before_signature ? { before: scan.before_signature } : {}),
        ...(scan.until_signature ? { until: scan.until_signature } : {}),
      },
    ])) as { signature: string; err: unknown }[];
    if (!Array.isArray(result))
      throw new Error("Invalid Solana signature page");
    const ready = result.length < SOLANA_SIGNATURE_PAGE_SIZE ? 1 : 0;
    await db.batch([
      ...(result.length
        ? [
            db
              .prepare(
                `INSERT INTO payment_solana_scan_pages SELECT ?,?,?,?,? WHERE ${fence}`,
              )
              .bind(
                ...keys,
                scan.next_page,
                JSON.stringify(result.reverse()),
                ...expected,
              ),
          ]
        : []),
      db
        .prepare(
          "UPDATE payment_solana_scans SET before_signature=?,next_page=next_page+?,ready=?,revision=revision+1 WHERE project_id=? AND network=? AND generation=? AND revision=?",
        )
        .bind(
          result[0]?.signature ?? scan.before_signature,
          result.length ? 1 : 0,
          ready,
          ...expected,
        ),
    ]);
    // One discovery page per run keeps RPC and D1 writes bounded. Processing
    // starts only after the old cursor is reached, preserving reserve/pay order.
    return;
  }
  const page = await db
    .prepare(
      "SELECT page,signatures_json FROM payment_solana_scan_pages WHERE project_id=? AND network=? AND generation=? ORDER BY page DESC LIMIT 1",
    )
    .bind(...keys)
    .first<{ page: number; signatures_json: string }>();
  if (!page) {
    await db
      .prepare(
        "DELETE FROM payment_solana_scans WHERE project_id=? AND network=? AND generation=? AND revision=?",
      )
      .bind(...expected)
      .run();
    return;
  }
  const signatures = JSON.parse(page.signatures_json) as {
    signature: string;
    err: unknown;
  }[];
  const chunk = signatures.slice(0, SOLANA_TRANSACTIONS_PER_RUN);
  for (const [processed, item] of chunk.entries()) {
    if (!item.err) {
      const tx = (await solanaRpc({ rpcUrl }, "getTransaction", [
        item.signature,
        {
          commitment: "finalized",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ])) as Record<string, unknown> | null;
      const meta = tx?.meta as { err: unknown } | undefined;
      if (!tx || !meta || meta.err)
        throw new Error("Finalized transaction unavailable");
      for (const invocation of escrowInvocations(tx, programId)) {
        const project =
          invocation.kind === "reserved"
            ? invocation.accounts[1]
            : invocation.accounts[0];
        if (project !== projectPda) continue;
        let obligationId: string;
        if (invocation.kind === "reserved") {
          if (!invocation.awardId) throw new Error("Commit award ID missing");
          obligationId = invocation.awardId;
        } else {
          const award = (await solanaRpc({ rpcUrl }, "getAccountInfo", [
            invocation.accounts[1],
            { commitment: "finalized", encoding: "base64" },
          ])) as { value: { data: [string, string] } | null };
          if (!award?.value) throw new Error("Paid award account missing");
          const bytes = Uint8Array.from(atob(award.value.data[0]), (c) =>
            c.charCodeAt(0),
          );
          obligationId = bytesToHex(bytes.slice(80, 112));
        }
        await index({
          projectId: deployment.projectId,
          network: deployment.network,
          transactionId: item.signature,
          eventIndex: invocation.index,
          kind: invocation.kind,
          obligationId,
        });
      }
    }
    // A scheduled invocation can end before all 100 reads finish. Retain each
    // fully verified transaction, never a partially indexed transaction.
    const remaining = signatures.slice(processed + 1);
    const checkpoint = await db.batch([
      db
        .prepare(
          `INSERT INTO payment_chain_cursors SELECT ?,?,?,? WHERE ${fence} ON CONFLICT(project_id,network) DO UPDATE SET position=excluded.position,synced_at=excluded.synced_at`,
        )
        .bind(
          deployment.projectId,
          deployment.network,
          item.signature,
          new Date().toISOString(),
          ...expected,
        ),
      remaining.length
        ? db
            .prepare(
              `UPDATE payment_solana_scan_pages SET signatures_json=? WHERE project_id=? AND network=? AND generation=? AND page=? AND ${fence}`,
            )
            .bind(JSON.stringify(remaining), ...keys, page.page, ...expected)
        : db
            .prepare(
              `DELETE FROM payment_solana_scan_pages WHERE project_id=? AND network=? AND generation=? AND page=? AND ${fence}`,
            )
            .bind(...keys, page.page, ...expected),
      db
        .prepare(
          "UPDATE payment_solana_scans SET revision=revision+1 WHERE project_id=? AND network=? AND generation=? AND revision=?",
        )
        .bind(...expected),
    ]);
    // A concurrent run advanced this interval. Its prefix is authoritative;
    // do not fetch further transactions using this run's stale page.
    if (checkpoint[2].meta?.changes !== 1) return;
    expected[3] = ++scan.revision;
  }
}
