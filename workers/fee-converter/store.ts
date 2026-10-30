import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  type Hex,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  type TransactionSerializedEIP1559,
} from "viem";
import {
  SOLANA_NATIVE_ASSET,
  solanaBase58,
} from "../../contracts/solana/adapter";
import { decodeBase58Bytes } from "../../src/lib/base58";
import type { Network } from "./config";
import type {
  ConversionRow,
  ConversionStore,
  FeeVault,
  SendReplacement,
} from "./core";
import { assertJupiterRoute } from "./jupiter-route";
import {
  JUPITER_PROGRAM,
  parseTransaction as parseSolanaTransaction,
} from "./solana";
import {
  retainedRouteExpectation,
  type SolanaAccountProof,
  verifySolanaAccountProof,
} from "./solana-accounts";

type D1Value = string | number | null;
interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface FeeD1Database {
  prepare(query: string): D1Statement;
}

/**
 * One lease covers a whole run. core.ts sizes its own renewal interval from
 * this so a run never signs after the lease it holds has expired.
 */
export const LOCK_MS = 14 * 60 * 1000;

const COLUMNS: [keyof ConversionRow, string][] = [
  ["id", "id"],
  ["kind", "kind"],
  ["runId", "run_id"],
  ["network", "network"],
  ["mode", "mode"],
  ["feeWallet", "fee_wallet"],
  ["token", "token"],
  ["targetToken", "target_token"],
  ["amountIn", "amount_in"],
  ["route", "route"],
  ["quoteAmountOut", "quote_amount_out"],
  ["minAmountOut", "min_amount_out"],
  ["quoteValueMicro", "quote_value_micro"],
  ["priceImpactBps", "price_impact_bps"],
  ["quote", "quote"],
  ["approvalTxId", "approval_tx_id"],
  ["txId", "tx_id"],
  ["rawTx", "raw_tx"],
  ["evmNonce", "evm_nonce"],
  ["expiresAt", "expires_at"],
  ["amountOut", "amount_out"],
  ["tokenBalanceBefore", "token_balance_before"],
  ["targetBalanceBefore", "target_balance_before"],
  ["targetBalanceAfter", "target_balance_after"],
  ["state", "state"],
  ["reason", "reason"],
  ["createdAt", "created_at"],
  ["updatedAt", "updated_at"],
  ["submittedAt", "submitted_at"],
  ["finalizedAt", "finalized_at"],
  ["landedTxId", "landed_tx_id"],
  ["nativeGasId", "native_gas_id"],
];
const COLUMN = new Map(COLUMNS);
const SELECT = COLUMNS.map(([, column]) => column).join(", ");

function fromRow(row: Record<string, D1Value>): ConversionRow {
  return Object.fromEntries(
    COLUMNS.map(([key, column]) => [key, row[column] ?? null]),
  ) as unknown as ConversionRow;
}

export class D1ConversionStore implements ConversionStore {
  constructor(private readonly db: FeeD1Database) {}

  private async validateNativeSend(
    id: string | null | undefined,
    rawTx: string | null,
    txId: string | null,
    row?: ConversionRow,
  ) {
    if (!id) return;
    const reserved = await this.db
      .prepare(
        "SELECT intent_hash,fee_wallet,network,solana_account_proof FROM fee_native_gas WHERE id=?",
      )
      .bind(id)
      .first<{
        intent_hash: string;
        fee_wallet: string;
        network: string;
        solana_account_proof: string | null;
      }>();
    if (!reserved || !rawTx)
      throw new Error("Native reservation lacks its signed intent");
    if (reserved.network === "solana") {
      const raw = Uint8Array.from(atob(rawTx), (c) => c.charCodeAt(0));
      const parsed = parseSolanaTransaction(raw);
      if (
        !parsed.legacy ||
        parsed.programs.includes(JUPITER_PROGRAM) ||
        reserved.solana_account_proof
      ) {
        if (!reserved.solana_account_proof)
          throw new Error(
            "Versioned Solana signing lacks retained account evidence",
          );
        const proof: SolanaAccountProof = JSON.parse(
          reserved.solana_account_proof,
        );
        verifySolanaAccountProof(raw, parsed, proof);
        if (parsed.programs.includes(JUPITER_PROGRAM)) {
          if (!proof.route || !row)
            throw new Error("Jupiter send lacks its retained account review");
          const expected = retainedRouteExpectation(proof.route);
          if (
            expected.program !== JUPITER_PROGRAM ||
            expected.wallet !== reserved.fee_wallet ||
            (expected.nativeInput
              ? row.token !== SOLANA_NATIVE_ASSET
              : expected.inputMint !== row.token) ||
            expected.outputMint !== row.targetToken ||
            expected.amountIn.toString() !== row.amountIn ||
            expected.minimumOut.toString() !== row.minAmountOut
          )
            throw new Error(
              "Jupiter account review differs from the recorded swap",
            );
          assertJupiterRoute(raw, parsed, proof, expected);
        }
      }
      const message = raw.slice(parsed.messageOffset);
      const signature = raw.slice(
        parsed.messageOffset - 64,
        parsed.messageOffset,
      );
      if (
        parsed.signatureCount !== 1 ||
        parsed.requiredSignatures !== 1 ||
        parsed.staticKeys[0] !== reserved.fee_wallet ||
        solanaBase58(signature) !== txId ||
        solanaBase58(sha256(message)) !== reserved.intent_hash ||
        !ed25519.verify(
          signature,
          message,
          decodeBase58Bytes(reserved.fee_wallet),
        )
      )
        throw new Error(
          "Native signature differs from its reserved Solana intent",
        );
      return;
    }
    if (keccak256(rawTx as Hex) !== txId)
      throw new Error("Native signed attempt hash differs");
    const {
      r: _r,
      s: _s,
      v: _v,
      yParity: _y,
      ...unsigned
    } = parseTransaction(rawTx as Hex);
    if (
      !reserved ||
      keccak256(serializeTransaction(unsigned)) !== reserved.intent_hash ||
      (
        await recoverTransactionAddress({
          serializedTransaction: rawTx as TransactionSerializedEIP1559,
        })
      ).toLowerCase() !== reserved.fee_wallet
    )
      throw new Error("Native signature differs from its reserved intent");
  }

  async acquireLock(network: Network, runId: string, now: Date) {
    const expires = new Date(now.getTime() + LOCK_MS).toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO fee_converter_locks (network, run_id, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(network) DO UPDATE SET run_id = excluded.run_id,
           expires_at = excluded.expires_at
         WHERE fee_converter_locks.expires_at < ?`,
      )
      .bind(network, runId, expires, now.toISOString())
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  /**
   * Deletes this run's lease only while it is still live. The `run_id` match
   * alone never removes a successor's row, but it would remove this run's own
   * already-expired row; `acquireLock` reclaims that through `expires_at < now`.
   */
  async releaseLock(network: Network, runId: string, now: Date) {
    await this.db
      .prepare(
        `DELETE FROM fee_converter_locks
          WHERE network = ? AND run_id = ? AND expires_at >= ?`,
      )
      .bind(network, runId, now.toISOString())
      .run();
  }

  /**
   * Extends this run's own unexpired lease, so a long run keeps the lock it
   * holds instead of losing it to the next cron run. Returns false when the
   * lease is no longer this run's (taken over or lapsed): the caller must stop
   * signing, because another run may now own the network.
   */
  async renewLock(network: Network, runId: string, now: Date) {
    const expires = new Date(now.getTime() + LOCK_MS).toISOString();
    const result = await this.db
      .prepare(
        `UPDATE fee_converter_locks SET expires_at = ?
          WHERE network = ? AND run_id = ? AND expires_at >= ?`,
      )
      .bind(expires, network, runId, now.toISOString())
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async openRows(network: Network) {
    const { results } = await this.db
      .prepare(
        `SELECT ${SELECT} FROM fee_conversions
          WHERE network = ? AND mode = 'live'
            AND (state IN ('submitted', 'unknown', 'quoted') OR
              (approval_tx_id IS NOT NULL AND raw_tx IS NULL AND tx_id IS NULL))
          ORDER BY created_at`,
      )
      .bind(network)
      .all<Record<string, D1Value>>();
    return results.map(fromRow);
  }

  async insert(row: ConversionRow, lease?: { runId: string; now: Date }) {
    await this.validateNativeSend(row.nativeGasId, row.rawTx, row.txId, row);
    const result = await this.db
      .prepare(
        `INSERT INTO fee_conversions (${SELECT}) SELECT ${COLUMNS.map(() => "?").join(", ")}${lease ? " WHERE EXISTS (SELECT 1 FROM fee_converter_locks WHERE network = ? AND run_id = ? AND expires_at >= ?)" : ""}`,
      )
      .bind(
        ...COLUMNS.map(
          ([key]) =>
            (key === "kind"
              ? (row.kind ?? "conversion")
              : (row[key] ?? null)) as D1Value,
        ),
        ...(lease ? [row.network, lease.runId, lease.now.toISOString()] : []),
      )
      .run();
    if ((result.meta?.changes ?? 0) < 1)
      throw new Error("Fee send lost its lease before journaling");
  }

  async update(id: string, fields: Partial<ConversionRow>) {
    const entries = Object.entries(fields).filter(
      ([key]) => key !== "id" && key !== "createdAt",
    );
    if (entries.length === 0) return;
    const result = await this.db
      .prepare(
        `UPDATE fee_conversions SET ${entries
          .map(([key]) => {
            const column = COLUMN.get(key as keyof ConversionRow);
            if (!column) throw new TypeError(`Unknown field ${key}`);
            return `${column} = ?`;
          })
          .join(", ")} WHERE id = ?`,
      )
      .bind(...entries.map(([, value]) => value as D1Value), id)
      .run();
    if ((result.meta?.changes ?? 0) !== 1)
      throw new Error("Fee conversion record was not updated");
  }

  async replacements(conversionId: string) {
    const { results } = await this.db
      .prepare(
        `SELECT id, conversion_id, network, attempt, evm_nonce, tx_id, raw_tx,
                max_fee_per_gas, max_priority_fee_per_gas, created_at, native_gas_id
           FROM fee_send_replacements WHERE conversion_id = ?
          ORDER BY attempt`,
      )
      .bind(conversionId)
      .all<Record<string, D1Value>>();
    return results.map(
      (row): SendReplacement => ({
        id: row.id as string,
        conversionId: row.conversion_id as string,
        network: row.network as Network,
        attempt: row.attempt as number,
        evmNonce: row.evm_nonce as number,
        txId: row.tx_id as string,
        rawTx: row.raw_tx as string,
        maxFeePerGas: row.max_fee_per_gas as string,
        maxPriorityFeePerGas: row.max_priority_fee_per_gas as string,
        createdAt: row.created_at as string,
        nativeGasId: row.native_gas_id as string | null,
      }),
    );
  }

  async insertReplacement(
    replacement: SendReplacement,
    runId: string,
    now: Date,
  ) {
    await this.validateNativeSend(
      replacement.nativeGasId,
      replacement.rawTx,
      replacement.txId,
    );
    const result = await this.db
      .prepare(
        `INSERT INTO fee_send_replacements (id, conversion_id, network, attempt,
           evm_nonce, tx_id, raw_tx, max_fee_per_gas, max_priority_fee_per_gas,
           created_at, native_gas_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM fee_converter_locks
             WHERE network = ? AND run_id = ? AND expires_at >= ?
          ) AND EXISTS (
            SELECT 1 FROM fee_conversions
             WHERE id = ? AND network = ? AND evm_nonce = ?
               AND mode = 'live' AND state IN ('submitted', 'unknown')
          ) AND ? = (
            SELECT COALESCE(MAX(attempt), 0) + 1 FROM fee_send_replacements
             WHERE conversion_id = ?
          )`,
      )
      .bind(
        replacement.id,
        replacement.conversionId,
        replacement.network,
        replacement.attempt,
        replacement.evmNonce,
        replacement.txId,
        replacement.rawTx,
        replacement.maxFeePerGas,
        replacement.maxPriorityFeePerGas,
        replacement.createdAt,
        replacement.nativeGasId ?? null,
        replacement.network,
        runId,
        now.toISOString(),
        replacement.conversionId,
        replacement.network,
        replacement.evmNonce,
        replacement.attempt,
        replacement.conversionId,
      )
      .run();
    return (result.meta?.changes ?? 0) >= 1;
  }

  async liveValueSince(network: Network, since: string) {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(quote_value_micro), 0) AS total FROM fee_conversions
          WHERE network = ? AND mode = 'live' AND kind = 'conversion'
            AND state IN ('submitted', 'unknown', 'finalized')
            AND created_at >= ?`,
      )
      .bind(network, since)
      .first<{ total: number }>();
    return BigInt(row?.total ?? 0);
  }

  async latest(network: Network, token: string) {
    const row = await this.db
      .prepare(
        `SELECT ${SELECT} FROM fee_conversions WHERE network = ? AND token = ? AND kind = 'conversion'
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind(network, token)
      .first<Record<string, D1Value>>();
    return row ? fromRow(row) : null;
  }

  /**
   * Native gas deposits are not fee income. Spend only native amounts proven
   * by finalized vault claims, less prior native conversions and gas. Amounts
   * stay decimal text in D1; summing them as SQLite integers would overflow.
   */
  async nativeFeeBalance(network: Network, token: string, feeWallet: string) {
    const { results } = await this.db
      .prepare(
        `SELECT c.kind,c.state,c.amount_in,c.amount_out,
                COALESCE(g.created_at,c.created_at) AS created_at
         FROM fee_conversions c LEFT JOIN fee_native_gas g ON g.id=c.native_gas_id
         WHERE c.network=? AND c.token=? AND c.fee_wallet=? AND c.mode='live'
           AND ((c.kind='claim' AND c.state='finalized') OR
                (c.kind='conversion' AND c.state IN ('quoted','submitted','unknown','finalized')))`,
      )
      .bind(network, token, feeWallet)
      .all<{
        kind: string;
        state: string;
        amount_in: string;
        amount_out: string | null;
        created_at: string;
      }>();
    let balance = 0n;
    let firstReceipt: string | null = null;
    let hasDirectCredit = false;
    // A completed direct award proves its exact fee transfer without a vault claim.
    // The worker reads only the fee fields, never private report or payer data.
    const direct = await this.db
      .prepare(
        "SELECT json_extract(p.intent,'$.feeBase') fee_base,json_extract(p.intent,'$.transfers[1].recipient') recipient,json_extract(p.intent,'$.transfers[1].amountBase') transfer_amount,p.prepared_at FROM security_direct_payments p JOIN security_direct_payment_receipts r ON r.case_id=p.case_id WHERE json_extract(p.intent,'$.chain')=? AND json_extract(p.intent,'$.asset.address')=?",
      )
      .bind(network, token)
      .all<{
        fee_base: string;
        recipient: string | null;
        transfer_amount: string | null;
        prepared_at: string;
      }>();
    for (const row of direct.results) {
      if (!/^(0|[1-9]\d*)$/u.test(row.fee_base))
        throw new Error("Direct fee has an invalid amount");
      if (row.fee_base === "0") continue;
      if (!row.recipient || row.transfer_amount !== row.fee_base)
        throw new Error("Direct fee differs from its immutable transfers");
      const sameWallet =
        network === "solana"
          ? row.recipient === feeWallet
          : row.recipient.toLowerCase() === feeWallet.toLowerCase();
      if (!sameWallet) continue;
      balance += BigInt(row.fee_base);
      hasDirectCredit = true;
      if (firstReceipt === null || row.prepared_at < firstReceipt)
        firstReceipt = row.prepared_at;
    }
    for (const row of results) {
      if (row.kind === "claim") {
        if (
          row.amount_out === null ||
          !/^(0|[1-9][0-9]*)$/u.test(row.amount_out)
        )
          throw new Error("Finalized native claim has no verified amount");
        balance += BigInt(row.amount_out);
        if (firstReceipt === null || row.created_at < firstReceipt)
          firstReceipt = row.created_at;
      } else {
        balance -= BigInt(row.amount_in);
      }
    }
    if (firstReceipt === null) return 0n;
    const { results: gas } = await this.db
      .prepare(
        `SELECT id,nonce,maximum_wei,actual_wei FROM fee_native_gas
         WHERE network=? AND fee_wallet=? AND state!='abandoned'${hasDirectCredit ? "" : " AND created_at>=?"}`,
      )
      // Pages timestamps and worker timestamps have independent clocks. Direct
      // credits conservatively cover every recorded expense; a skew cannot
      // reclassify a gas top-up as earned native revenue.
      .bind(
        ...(hasDirectCredit
          ? [network, feeWallet]
          : [network, feeWallet, firstReceipt]),
      )
      .all<{
        id: string;
        nonce: number;
        maximum_wei: string;
        actual_wei: string | null;
      }>();
    const liabilities = new Map<string, bigint>();
    for (const row of gas) {
      const amount = BigInt(row.actual_wei ?? row.maximum_wei);
      // EVM replacements consume one account nonce. Each Solana signed
      // transaction has its own reservation and incurs its own fee.
      const attempt = network === "solana" ? row.id : String(row.nonce);
      if ((liabilities.get(attempt) ?? 0n) < amount)
        liabilities.set(attempt, amount);
    }
    for (const amount of liabilities.values()) balance -= amount;
    return balance > 0n ? balance : 0n;
  }
}

/**
 * Reward tokens named by D1 project manifests for one network: a token
 * `rewardAsset` on the network, and the asset of each ordinary or bounty deployment on its
 * escrow network keys. Only reviewed manifests contribute; tokens that merely
 * arrive in the fee wallet are never discovered.
 */
export async function projectRewardTokens(
  db: FeeD1Database,
  network: string,
  escrowNetworks: readonly string[],
): Promise<string[]> {
  const [rewardAssets, deployments, bountyAssets, directAssets] =
    await Promise.all([
      db
        .prepare(
          `SELECT DISTINCT json_extract(manifest, '$.rewardAsset.address') AS asset
           FROM projects
          WHERE json_extract(manifest, '$.rewardAsset.network') = ?
            AND json_extract(manifest, '$.rewardAsset.kind') IN ('token','native')`,
        )
        .bind(network)
        .all<{ asset: unknown }>(),
      db
        .prepare(
          `SELECT DISTINCT json_extract(d.value, '$.asset') AS asset
           FROM projects,
             json_each('["$.escrow.deployments","$.securityBounty.settlement.deployments"]') AS scope,
             json_each(projects.manifest, scope.value) AS d
          WHERE json_extract(d.value, '$.network') IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(escrowNetworks))
        .all<{ asset: unknown }>(),
      db
        .prepare(
          "SELECT DISTINCT json_extract(manifest,'$.securityBounty.amount.asset.address') asset FROM projects WHERE json_extract(manifest,'$.securityBounty.amount.asset.network')=?",
        )
        .bind(network)
        .all<{ asset: unknown }>(),
      // Retain the asset of paid historical awards even after the public offer changes.
      db
        .prepare(
          "SELECT DISTINCT json_extract(p.intent,'$.asset.address') asset FROM security_direct_payments p JOIN security_direct_payment_receipts r ON r.case_id=p.case_id WHERE json_extract(p.intent,'$.chain')=? AND json_extract(p.intent,'$.feeBase')<>'0'",
        )
        .bind(network)
        .all<{ asset: unknown }>(),
    ]);
  return [
    ...new Set(
      [
        ...rewardAssets.results,
        ...deployments.results,
        ...bountyAssets.results,
        ...directAssets.results,
      ].map((row) => row.asset),
    ),
  ].filter((asset): asset is string => typeof asset === "string");
}

const BOUNTY_DEPLOYMENTS = "$.securityBounty.settlement.deployments";

/**
 * Ordinary and private bounty vaults named by D1 project manifests on the
 * network's escrow keys, each with its reviewed deployment record. Only these
 * vaults are claimed; a vault is never discovered on chain.
 */
export async function projectVaults(
  db: FeeD1Database,
  escrowNetworks: readonly string[],
): Promise<FeeVault[]> {
  const rows = await db
    .prepare(
      `SELECT projects.id AS project_id, scope.value AS scope, d.value AS deployment
         FROM projects,
             json_each('["$.escrow.deployments","${BOUNTY_DEPLOYMENTS}"]') AS scope,
             json_each(projects.manifest, scope.value) AS d
        WHERE json_extract(d.value, '$.network') IN (SELECT value FROM json_each(?))
          AND json_type(d.value, '$.vault') = 'text'
        ORDER BY projects.id, scope.value`,
    )
    .bind(JSON.stringify(escrowNetworks))
    .all<{ project_id: string; scope: string; deployment: string }>();
  // One entry per distinct reviewed record. A vault listed with two different
  // records stays twice, and the chain check refuses the one that is wrong.
  const vaults = new Map<string, FeeVault>();
  for (const row of rows.results) {
    const deployment = JSON.parse(row.deployment) as Record<string, unknown>;
    const payoutPolicy =
      row.scope === BOUNTY_DEPLOYMENTS ? "security-bounty" : "ordinary";
    const key = `${payoutPolicy}\u0000${row.deployment}`;
    if (vaults.has(key)) continue;
    vaults.set(key, {
      vault: deployment.vault as string,
      projectId: row.project_id,
      payoutPolicy,
      deployment,
    });
  }
  return [...vaults.values()];
}
