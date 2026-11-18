/**
 * Records each registered ordinary vault's finalized deposits for the
 * "Funded by" list (operator decision, 18 November 2026, PRD section 6).
 *
 * This read is separate from the payment scanner. It has its own cursor, it
 * starts at the vault's creation, and it writes only `vault_deposits` and
 * `vault_deposit_cursors`. It reads the chain and signs nothing. The list is
 * display evidence: a failed read is retried on the next run and never
 * changes a balance, a funded month or a payment.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  D1TransactionalDatabase as D1Database,
  D1Statement,
} from "../../backend/d1";
import {
  type VaultDepositRecord,
  vaultDepositInsert,
} from "../../backend/payments/vault-deposits";
import { EVM_ESCROW_EVENT_TOPICS, evmRpc } from "../../contracts/evm/adapter";
import { assertSolanaGenesis, solanaRpc } from "../../contracts/solana/adapter";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { bytesToHex } from "../../src/lib/byte-encoding";
import { chainFamily } from "../../src/lib/escrow-policy.mjs";
import type { DeploymentView } from "./deployment-types";

export type DepositScanDeployment = DeploymentView<
  "projectId" | "vault" | "chain",
  | "deploymentTransaction"
  | "scanPageBlocks"
  | "projectPda"
  | "programId"
  | "payoutPolicy"
> & { chainId?: string | bigint };

/** EVM log pages read for one vault in one run, each of the reviewed size. */
export const EVM_DEPOSIT_PAGES_PER_RUN = 10;
/** Solana transactions read for one vault in one run. */
export const SOLANA_DEPOSIT_TRANSACTIONS_PER_RUN = 25;
/** No further vault is started once one run has spent this long on deposits. */
const RUN_BUDGET_MS = 20_000;

const DEPOSITED = EVM_ESCROW_EVENT_TOPICS.Deposited;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const WORD = /^0x[0-9a-fA-F]{64}$/u;
const U128 = (1n << 128n) - 1n;

type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid RPC object");
  return value as Obj;
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value))
    throw new Error("Invalid RPC quantity");
  return BigInt(value);
}

/**
 * Reads up to ten reviewed log pages of the vault's `Deposited` event, oldest
 * first, through the finalized block. Each page's deposits and its cursor are
 * one atomic write, and the cursor never moves back, so an older overlapping
 * run cannot rewind it. Returns the number of deposits in the pages read.
 */
export async function scanEvmDeposits(
  db: D1Database,
  deployment: DepositScanDeployment,
  rpcUrl: string,
  now: () => Date = () => new Date(),
): Promise<number> {
  const page = deployment.scanPageBlocks;
  if (page === undefined || !/^[1-9][0-9]{0,6}$/u.test(page))
    throw new Error("Reviewed scan page size required for deposit scanning");
  // Authenticate the chain before reading or advancing coverage.
  if (
    !deployment.chainId ||
    quantity(await evmRpc({ rpcUrl }, "eth_chainId", [])) !==
      BigInt(deployment.chainId)
  )
    throw new Error("Deposit scanner chain mismatch");
  const key = [deployment.projectId, deployment.network, deployment.vault];
  const cursor = await db
    .prepare(
      "SELECT position FROM vault_deposit_cursors WHERE project_id=? AND network=? AND vault=?",
    )
    .bind(...key)
    .first<{ position: string | null }>();
  let from: bigint;
  if (cursor?.position) from = BigInt(cursor.position) + 1n;
  else {
    if (!deployment.deploymentTransaction)
      throw new Error("Deployment transaction required for deposit origin");
    const receipt = (await evmRpc({ rpcUrl }, "eth_getTransactionReceipt", [
      deployment.deploymentTransaction,
    ])) as { status?: unknown; blockNumber?: unknown } | null;
    if (receipt?.status !== "0x1")
      throw new Error("Deployment origin unavailable");
    from = quantity(receipt.blockNumber);
  }
  const finalized = (await evmRpc({ rpcUrl }, "eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as { number?: unknown } | null;
  if (!finalized) throw new Error("Finalized chain head unavailable");
  const end = quantity(finalized.number);
  const span = BigInt(page) - 1n;
  let recorded = 0;
  for (
    let pages = 0;
    pages < EVM_DEPOSIT_PAGES_PER_RUN && from <= end;
    pages += 1
  ) {
    const to = from + span < end ? from + span : end;
    const logs = (await evmRpc({ rpcUrl }, "eth_getLogs", [
      {
        address: deployment.vault,
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
        topics: [DEPOSITED],
      },
    ])) as unknown;
    if (!Array.isArray(logs)) throw new Error("Invalid finalized log page");
    const times = new Map<string, string>();
    const statements: D1Statement[] = [];
    for (const entry of logs) {
      const log = object(entry);
      const topics = log.topics;
      const block = quantity(log.blockNumber);
      if (
        log.removed === true ||
        typeof log.address !== "string" ||
        log.address.toLowerCase() !== deployment.vault.toLowerCase() ||
        !Array.isArray(topics) ||
        topics.length !== 2 ||
        typeof topics[0] !== "string" ||
        topics[0].toLowerCase() !== DEPOSITED ||
        typeof topics[1] !== "string" ||
        !/^0x0{24}[0-9a-fA-F]{40}$/u.test(topics[1]) ||
        typeof log.data !== "string" ||
        !WORD.test(log.data) ||
        typeof log.transactionHash !== "string" ||
        !WORD.test(log.transactionHash) ||
        block < from ||
        block > to
      )
        throw new Error("Unexpected deposit event");
      const amount = BigInt(log.data);
      if (amount <= 0n || amount > U128)
        throw new Error("Unexpected deposit amount");
      const blockKey = block.toString();
      let blockTime = times.get(blockKey);
      if (blockTime === undefined) {
        const header = (await evmRpc({ rpcUrl }, "eth_getBlockByNumber", [
          `0x${block.toString(16)}`,
          false,
        ])) as { hash?: unknown; timestamp?: unknown } | null;
        // The log must belong to the canonical block whose time it is given.
        if (
          !header ||
          typeof header.hash !== "string" ||
          typeof log.blockHash !== "string" ||
          header.hash.toLowerCase() !== log.blockHash.toLowerCase()
        )
          throw new Error("Deposit block unavailable");
        blockTime = new Date(
          Number(quantity(header.timestamp)) * 1000,
        ).toISOString();
        times.set(blockKey, blockTime);
      }
      statements.push(
        vaultDepositInsert(
          db,
          {
            projectId: deployment.projectId,
            network: deployment.network,
            chain: deployment.chain,
            vault: deployment.vault,
            transactionId: log.transactionHash.toLowerCase(),
            eventIndex: Number(quantity(log.logIndex)),
            depositor: `0x${topics[1].slice(26).toLowerCase()}`,
            amount: amount.toString(),
            blockNumber: blockKey,
            blockTime,
          } satisfies VaultDepositRecord,
          now().toISOString(),
        ),
      );
    }
    statements.push(
      db
        .prepare(
          "INSERT INTO vault_deposit_cursors(project_id,network,vault,position,synced_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,network,vault) DO UPDATE SET position=excluded.position,synced_at=excluded.synced_at WHERE vault_deposit_cursors.position IS NULL OR length(excluded.position)>length(vault_deposit_cursors.position) OR (length(excluded.position)=length(vault_deposit_cursors.position) AND excluded.position>=vault_deposit_cursors.position)",
        )
        .bind(...key, to.toString(), now().toISOString()),
    );
    const results = await db.batch(statements);
    if (results.some((result) => !result.success))
      throw new Error("Vault deposit write failed");
    recorded += logs.length;
    from = to + 1n;
  }
  return recorded;
}

const anchorTag = (name: string) =>
  bytesToHex(sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8));
const DEPOSIT = anchorTag("deposit");
const DEPOSIT_NATIVE = anchorTag("deposit_native");

/**
 * The vault program's deposits in one finalized transaction, for one project.
 * Top-level and inner instructions are read in execution order, so a deposit
 * made through another program counts and its index is stable. A transaction
 * succeeds only if every instruction did, so a deposit instruction of the
 * reviewed program in a successful transaction moved exactly its amount.
 */
export function solanaDeposits(
  transaction: Obj,
  programId: string,
  projectPda: string,
): { index: number; depositor: string; amount: string }[] {
  const meta = object(transaction.meta);
  const message = object(object(transaction.transaction).message);
  const inner = new Map<number, unknown[]>();
  if (!Array.isArray(message.instructions))
    throw new Error("Invalid transaction instructions");
  for (const group of (Array.isArray(meta.innerInstructions)
    ? meta.innerInstructions
    : []
  ).map(object)) {
    if (!Array.isArray(group.instructions))
      throw new Error("Invalid inner instructions");
    inner.set(Number(group.index), group.instructions);
  }
  const flat: Obj[] = [];
  message.instructions.forEach((value, top) => {
    flat.push(object(value));
    for (const child of inner.get(top) ?? []) flat.push(object(child));
  });
  const found: { index: number; depositor: string; amount: string }[] = [];
  flat.forEach((instruction, index) => {
    if (instruction.programId !== programId) return;
    if (typeof instruction.data !== "string") return;
    const data = decodeBase58Bytes(instruction.data);
    const tag = bytesToHex(data.slice(0, 8));
    if (tag !== DEPOSIT && tag !== DEPOSIT_NATIVE) return;
    const accounts = instruction.accounts;
    if (
      data.length !== 16 ||
      !Array.isArray(accounts) ||
      typeof accounts[0] !== "string" ||
      typeof accounts[1] !== "string"
    )
      throw new Error("Unexpected deposit instruction");
    if (accounts[1] !== projectPda) return;
    // The amount is a little-endian u64.
    let amount = 0n;
    for (let byte = 15; byte >= 8; byte -= 1)
      amount = (amount << 8n) | BigInt(data[byte]);
    if (amount <= 0n) throw new Error("Unexpected deposit amount");
    found.push({ index, depositor: accounts[0], amount: amount.toString() });
  });
  return found;
}

/**
 * Reads the project account's finalized transactions newest first, at most
 * twenty-five in one run. `position` is the newest signature at or below
 * which everything has been read; while an interval above it is being read,
 * `pending_top` is its newest signature and `resume_before` the oldest one
 * already read. Each transaction's deposits and that progress are one atomic
 * write, conditional on `position` being unchanged, so a run that another run
 * has overtaken stops without moving the cursor. Returns the deposits found.
 */
export async function scanSolanaDeposits(
  db: D1Database,
  deployment: DepositScanDeployment & { genesisHash: string | undefined },
  rpcUrl: string,
  now: () => Date = () => new Date(),
): Promise<number> {
  const { projectPda, programId } = deployment;
  if (!projectPda || !programId)
    throw new Error("Solana project deployment missing");
  await assertSolanaGenesis({ rpcUrl, genesisHash: deployment.genesisHash });
  const key = [deployment.projectId, deployment.network, deployment.vault];
  await db
    .prepare(
      "INSERT OR IGNORE INTO vault_deposit_cursors(project_id,network,vault,synced_at) VALUES(?,?,?,?)",
    )
    .bind(...key, now().toISOString())
    .run();
  const cursor = await db
    .prepare(
      "SELECT position,pending_top,resume_before FROM vault_deposit_cursors WHERE project_id=? AND network=? AND vault=?",
    )
    .bind(...key)
    .first<{
      position: string | null;
      pending_top: string | null;
      resume_before: string | null;
    }>();
  if (!cursor) throw new Error("Deposit cursor unavailable");
  const page = (await solanaRpc({ rpcUrl }, "getSignaturesForAddress", [
    projectPda,
    {
      commitment: "finalized",
      limit: SOLANA_DEPOSIT_TRANSACTIONS_PER_RUN,
      ...(cursor.resume_before ? { before: cursor.resume_before } : {}),
      ...(cursor.position ? { until: cursor.position } : {}),
    },
  ])) as unknown;
  if (!Array.isArray(page)) throw new Error("Invalid Solana signature page");
  const fence = "project_id=? AND network=? AND vault=? AND position IS ?";
  const fenced = [...key, cursor.position];
  const top =
    cursor.pending_top ??
    (page.length ? (object(page[0]).signature as string) : null);
  let recorded = 0;
  for (const entry of page) {
    const item = object(entry);
    if (typeof item.signature !== "string")
      throw new Error("Invalid Solana signature page");
    const statements: D1Statement[] = [];
    if (!item.err) {
      const transaction = (await solanaRpc({ rpcUrl }, "getTransaction", [
        item.signature,
        {
          commitment: "finalized",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ])) as Obj | null;
      const meta = transaction?.meta as { err?: unknown } | undefined;
      if (!transaction || !meta || meta.err)
        throw new Error("Finalized transaction unavailable");
      if (
        !Number.isSafeInteger(transaction.slot) ||
        !Number.isSafeInteger(transaction.blockTime)
      )
        throw new Error("Finalized transaction time unavailable");
      for (const deposit of solanaDeposits(transaction, programId, projectPda))
        statements.push(
          vaultDepositInsert(
            db,
            {
              projectId: deployment.projectId,
              network: deployment.network,
              chain: deployment.chain,
              vault: deployment.vault,
              transactionId: item.signature,
              eventIndex: deposit.index,
              depositor: deposit.depositor,
              amount: deposit.amount,
              blockNumber: String(transaction.slot),
              blockTime: new Date(
                (transaction.blockTime as number) * 1000,
              ).toISOString(),
            } satisfies VaultDepositRecord,
            now().toISOString(),
          ),
        );
    }
    recorded += statements.length;
    statements.push(
      db
        .prepare(
          `UPDATE vault_deposit_cursors SET pending_top=?,resume_before=?,synced_at=? WHERE ${fence}`,
        )
        .bind(top, item.signature, now().toISOString(), ...fenced),
    );
    const results = await db.batch(statements);
    if (results.some((result) => !result.success))
      throw new Error("Vault deposit write failed");
    // Another run finished this interval; its cursor is authoritative.
    if (results[results.length - 1].meta?.changes !== 1) return recorded;
  }
  // A short page reached the covered position: the interval is complete.
  if (page.length < SOLANA_DEPOSIT_TRANSACTIONS_PER_RUN) {
    const done = await db
      .prepare(
        `UPDATE vault_deposit_cursors SET position=COALESCE(?,position),pending_top=NULL,resume_before=NULL,synced_at=? WHERE ${fence}`,
      )
      .bind(top, now().toISOString(), ...fenced)
      .run();
    if (!done.success) throw new Error("Vault deposit cursor write failed");
  }
  return recorded;
}

/** Marks a vault as tried without moving its position. Best effort. */
async function touchCursor(
  db: D1Database,
  deployment: DepositScanDeployment,
  at: string,
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO vault_deposit_cursors(project_id,network,vault,synced_at) VALUES(?,?,?,?) ON CONFLICT(project_id,network,vault) DO UPDATE SET synced_at=excluded.synced_at",
      )
      .bind(deployment.projectId, deployment.network, deployment.vault, at)
      .run();
  } catch {
    // Ordering only; the next run still tries every vault it has time for.
  }
}

export interface DepositScanReport {
  scanned: number;
  recorded: number;
  failures: { projectId: string; network: string; error: string }[];
}

/**
 * Reads the deposits of every served ordinary vault, least recently read
 * first, within a bounded time. It never throws: each failure is returned
 * and logged by name, and the next run retries it. Private bounty vaults are
 * skipped, so their funding stays out of the public list.
 */
export async function recordVaultDeposits(
  db: D1Database,
  deployments: readonly DepositScanDeployment[],
  rpcUrls: Record<string, string>,
  solanaGenesis: (network: string) => string | undefined,
  now: () => Date = () => new Date(),
): Promise<DepositScanReport> {
  const report: DepositScanReport = { scanned: 0, recorded: 0, failures: [] };
  const ordinary = deployments.filter(
    (deployment) => deployment.payoutPolicy !== "security-bounty",
  );
  let order = ordinary;
  try {
    const row = await db
      .prepare(
        "SELECT json_group_array(json_object('projectId',project_id,'network',network,'vault',vault,'syncedAt',synced_at)) items FROM vault_deposit_cursors",
      )
      .first<{ items: string }>();
    const synced = new Map(
      (
        JSON.parse(row?.items ?? "[]") as {
          projectId: string;
          network: string;
          vault: string;
          syncedAt: string;
        }[]
      ).map((cursor) => [
        `${cursor.projectId}\n${cursor.network}\n${cursor.vault}`,
        cursor.syncedAt,
      ]),
    );
    const last = (deployment: DepositScanDeployment) =>
      synced.get(
        `${deployment.projectId}\n${deployment.network}\n${deployment.vault}`,
      ) ?? "";
    order = [...ordinary].sort((left, right) =>
      last(left).localeCompare(last(right)),
    );
  } catch (error) {
    report.failures.push({
      projectId: "*",
      network: "*",
      error: error instanceof Error ? error.name : "Error",
    });
  }
  const started = Date.now();
  for (const deployment of order) {
    if (Date.now() - started >= RUN_BUDGET_MS) break;
    report.scanned += 1;
    try {
      const rpcUrl = rpcUrls[deployment.network];
      if (!rpcUrl) throw new Error("Private RPC configuration unavailable");
      report.recorded +=
        chainFamily(deployment.chain) === "evm"
          ? await scanEvmDeposits(db, deployment, rpcUrl, now)
          : await scanSolanaDeposits(
              db,
              {
                ...deployment,
                genesisHash: solanaGenesis(deployment.network),
              },
              rpcUrl,
              now,
            );
    } catch (error) {
      // The message can carry provider detail; the name and place are enough.
      report.failures.push({
        projectId: deployment.projectId,
        network: deployment.network,
        error: error instanceof Error ? error.name : "Error",
      });
      // A vault that keeps failing goes to the back of the next run's order.
      await touchCursor(db, deployment, now().toISOString());
    }
  }
  if (report.failures.length)
    console.error("vault deposit scan incomplete", report.failures);
  return report;
}
