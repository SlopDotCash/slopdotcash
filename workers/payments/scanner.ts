import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import { escrowInvocations } from "../../contracts/solana/adapter";
export interface ScanDeployment {
  projectId: string;
  network: string;
  chain: string;
  vault: string;
  deploymentTransaction?: string;
  projectPda?: string;
  programId?: string;
}
export interface ScanEvent {
  projectId: string;
  network: string;
  transactionId: string;
  eventIndex: number;
  kind: "reserved" | "paid";
  obligationId: string;
}
const RESERVED =
  "0xd42548deb9ef20b582fe02f194f3c5e39fd0b7d1803321cd197e4ce48c30a857";
const PAID =
  "0x4bf296cb04d665f3fe904ce30894876ea577c828bbc117e8bacad4c4bcb757f7";
async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Scanner RPC unavailable");
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error || !("result" in body)) throw new Error("Scanner RPC failed");
  return body.result;
}
/** A cursor advances only after every recognized finalized event is durably verified and indexed. */
export async function scanBasePayments(
  db: D1Database,
  deployment: ScanDeployment,
  rpcUrl: string,
  index: (event: ScanEvent) => Promise<void>,
): Promise<void> {
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
    const receipt = (await rpc(rpcUrl, "eth_getTransactionReceipt", [
      deployment.deploymentTransaction,
    ])) as { status: string; blockNumber: string } | null;
    if (receipt?.status !== "0x1")
      throw new Error("Deployment origin unavailable");
    from = BigInt(receipt.blockNumber);
  }
  const finalized = (await rpc(rpcUrl, "eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number: string } | null;
  if (!finalized) throw new Error("Finalized chain head unavailable");
  const end = BigInt(finalized.number);
  if (from > end) return;
  const to = from + 1999n < end ? from + 1999n : end;
  const logs = (await rpc(rpcUrl, "eth_getLogs", [
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
      "INSERT INTO payment_chain_cursors VALUES(?,?,?,?) ON CONFLICT(project_id,network) DO UPDATE SET position=excluded.position,synced_at=excluded.synced_at",
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
    const result = (await rpc(rpcUrl, "getSignaturesForAddress", [
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
  for (const item of chunk) {
    if (!item.err) {
      const tx = (await rpc(rpcUrl, "getTransaction", [
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
        if (invocation.kind === "reserved")
          obligationId = hex(invocation.data.slice(8, 40));
        else {
          const award = (await rpc(rpcUrl, "getAccountInfo", [
            invocation.accounts[1],
            { commitment: "finalized", encoding: "base64" },
          ])) as { value: { data: [string, string] } | null };
          if (!award?.value) throw new Error("Paid award account missing");
          const bytes = Uint8Array.from(atob(award.value.data[0]), (c) =>
            c.charCodeAt(0),
          );
          obligationId = hex(bytes.slice(80, 112));
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
  }
  const remaining = signatures.slice(chunk.length);
  await db.batch([
    db
      .prepare(
        `INSERT INTO payment_chain_cursors SELECT ?,?,?,? WHERE ${fence} ON CONFLICT(project_id,network) DO UPDATE SET position=excluded.position,synced_at=excluded.synced_at`,
      )
      .bind(
        deployment.projectId,
        deployment.network,
        chunk[chunk.length - 1].signature,
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
}
const hex = (value: Uint8Array) =>
  Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
