import { sha256 } from "@noble/hashes/sha2.js";
import type { Network } from "./config";
import type { SolanaAccountProof } from "./solana-accounts";
import {
  type ExpiryCoverage,
  type ExpiryCoverageStore,
  type ExpiryProof,
  matchingCompletedCoverage,
} from "./solana-expiry";
import type { FeeD1Database } from "./store";

export interface NativeGasLimits {
  perTransaction: string;
  perDay: string;
  additionalFeeReserve: string;
}
export function nativeInteger(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value))
    throw new Error("Native fee must be an exact non-negative integer");
  return BigInt(value);
}
export function validateNativeLimits(limits: NativeGasLimits) {
  const transaction = nativeInteger(limits.perTransaction);
  const day = nativeInteger(limits.perDay);
  const additional = nativeInteger(limits.additionalFeeReserve);
  if (transaction === 0n || day < transaction || additional >= transaction)
    throw new Error(
      "Native daily budget must cover one positive transaction limit and its additional fees",
    );
}
export interface NativeAttempt {
  id: string;
  network: Network;
  fee_wallet: string;
  nonce: number;
  intent_hash: string;
  maximum_wei: string;
  state: "reserved" | "signed" | "abandoned";
  tx_id: string | null;
  conversion_id: string | null;
  actual_wei: string | null;
  solana_blockhash_slot: number | null;
  solana_account_proof: string | null;
  settled_day: string | null;
  receipt_block_hash: string | null;
}
export interface RecordedNativeSend {
  txId: string;
  rawTx: string | null;
  conversionId: string;
  feeWallet: string;
  nonce: number | null;
}
export interface NativeReceiptCost {
  txId: string;
  actualWei: string;
  blockHash: string;
}
const LEASE =
  "EXISTS(SELECT 1 FROM fee_converter_locks WHERE network=? AND run_id=? AND expires_at>=?)";

/** Exact BigInt accounting with a SQL revision fence; no float or SQL SUM of wei. */
export class NativeGasJournal {
  constructor(
    private readonly db: FeeD1Database,
    readonly network: Network,
    readonly feeWallet: string,
    readonly runId: string,
    readonly limits: NativeGasLimits,
    private readonly now: () => Date,
  ) {
    validateNativeLimits(limits);
  }
  private lease() {
    return [this.network, this.runId, this.now().toISOString()];
  }

  async rows() {
    return (
      await this.db
        .prepare("SELECT * FROM fee_native_gas WHERE network=?")
        .bind(this.network)
        .all<NativeAttempt>()
    ).results;
  }

  async recoverUnsigned() {
    // No broadcast can precede the atomic signed-record commit. A successor
    // can retire only the uncommitted reservation; a stale holder cannot commit it.
    await this.db
      .prepare(`UPDATE fee_native_gas SET state='abandoned'
      WHERE network=? AND state='reserved' AND run_id!=? AND ${LEASE}`)
      .bind(this.network, this.runId, ...this.lease())
      .run();
  }

  /** Solana has no account nonce; allocate a journal sequence under the revision fence.
   * Reserve the whole approved transaction ceiling until a finalized receipt.
   */
  async reserveSolana(
    intentHash: string,
    blockhashSlot?: number,
    accountProof?: SolanaAccountProof,
  ) {
    if (this.network !== "solana")
      throw new Error("Solana reservation needs its own network journal");
    const rows = await this.rows();
    const nonce = rows.reduce((n, row) => Math.max(n, row.nonce + 1), 0);
    if (!Number.isSafeInteger(nonce))
      throw new Error("Native journal sequence exhausted");
    return this.reserve({
      nonce,
      intentHash,
      maximumWei: this.limits.perTransaction,
      solanaBlockhashSlot: blockhashSlot,
      solanaAccountProof: accountProof,
    });
  }

  async reserve(input: {
    nonce: number;
    intentHash: string;
    maximumWei: string;
    replaces?: string;
    solanaBlockhashSlot?: number;
    solanaAccountProof?: SolanaAccountProof;
  }) {
    if (
      input.solanaAccountProof &&
      (this.network !== "solana" ||
        input.solanaAccountProof.messageHash !== input.intentHash)
    )
      throw new Error(
        "Solana account evidence differs from its reserved intent",
      );
    const revision = await this.db
      .prepare("SELECT gas_revision FROM fee_converter_locks WHERE network=?")
      .bind(this.network)
      .first<{ gas_revision: number }>();
    if (!revision)
      throw new Error("Native gas reservation needs the network lease");
    const rows = await this.rows();
    const maximum = nativeInteger(input.maximumWei);
    if (maximum === 0n || maximum > nativeInteger(this.limits.perTransaction))
      throw new Error("Native fee exceeds the transaction budget");
    const sameNonce = rows.filter(
      (r) =>
        r.state !== "abandoned" &&
        r.fee_wallet === this.feeWallet &&
        r.nonce === input.nonce,
    );
    if (input.replaces) {
      if (
        !sameNonce.some(
          (r) =>
            r.state === "signed" &&
            r.tx_id === input.replaces &&
            r.actual_wei === null,
        ) ||
        sameNonce.some((r) => r.state === "reserved" || r.actual_wei !== null)
      )
        throw new Error(
          "Native replacement reservation does not match an unresolved send",
        );
    } else if (sameNonce.length)
      throw new Error("Native gas nonce is already reserved");
    const day = this.now().toISOString().slice(0, 10);
    let spent = 0n;
    const pending = new Map<string, bigint>();
    for (const row of rows) {
      if (row.state === "abandoned") continue;
      if (row.actual_wei !== null) {
        const actual = nativeInteger(row.actual_wei);
        if (actual > nativeInteger(row.maximum_wei))
          throw new Error(
            "A finalized native fee exceeded its reserved maximum; signing is held",
          );
        if (row.settled_day === day) spent += actual;
      } else {
        const key = `${row.fee_wallet}:${row.nonce}`;
        const value = nativeInteger(row.maximum_wei);
        if ((pending.get(key) ?? 0n) < value) pending.set(key, value);
      }
    }
    const key = `${this.feeWallet}:${input.nonce}`;
    if ((pending.get(key) ?? 0n) < maximum) pending.set(key, maximum);
    for (const value of pending.values()) spent += value;
    if (spent > nativeInteger(this.limits.perDay))
      throw new Error(
        "Native daily budget reached; unknown sends stay reserved",
      );
    const id = crypto.randomUUID();
    const result = await this.db
      .prepare(`INSERT INTO fee_native_gas
      (id,network,fee_wallet,nonce,intent_hash,run_id,maximum_wei,per_transaction_wei,per_day_wei,state,created_at,solana_blockhash_slot,solana_account_proof)
      SELECT ?,?,?,?,?,?,?,?,?,'reserved',?,?,? WHERE ${LEASE}
      AND (SELECT gas_revision FROM fee_converter_locks WHERE network=?)=?`)
      .bind(
        id,
        this.network,
        this.feeWallet,
        input.nonce,
        input.intentHash,
        this.runId,
        input.maximumWei,
        this.limits.perTransaction,
        this.limits.perDay,
        this.now().toISOString(),
        input.solanaBlockhashSlot ?? null,
        input.solanaAccountProof
          ? JSON.stringify(input.solanaAccountProof)
          : null,
        ...this.lease(),
        this.network,
        revision.gas_revision,
      )
      .run();
    if ((result.meta?.changes ?? 0) < 1)
      throw new Error(
        "Native gas reservation lost its lease or budget revision; retry next run",
      );
    return id;
  }

  /** Historical signed bytes are liabilities too, even after a router deadline. */
  async unaccounted(): Promise<RecordedNativeSend[]> {
    const { results } = await this.db
      .prepare(`SELECT c.tx_id txId,c.raw_tx rawTx,c.id conversionId,c.fee_wallet feeWallet,c.evm_nonce nonce
      FROM fee_conversions c WHERE c.network=? AND c.mode='live' AND c.tx_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM fee_native_gas g WHERE g.network=c.network AND g.tx_id=c.tx_id)
      UNION ALL SELECT r.tx_id,r.raw_tx,r.conversion_id,c.fee_wallet,r.evm_nonce
      FROM fee_send_replacements r JOIN fee_conversions c ON c.id=r.conversion_id WHERE r.network=?
      AND NOT EXISTS(SELECT 1 FROM fee_native_gas g WHERE g.network=r.network AND g.tx_id=r.tx_id)
      UNION ALL SELECT c.approval_tx_id,NULL,c.id,c.fee_wallet,NULL FROM fee_conversions c
      WHERE c.network=? AND c.mode='live' AND c.approval_tx_id IS NOT NULL AND c.approval_tx_id IS NOT c.tx_id
      AND NOT EXISTS(SELECT 1 FROM fee_native_gas g WHERE g.network=c.network AND g.tx_id=c.approval_tx_id)`)
      .bind(this.network, this.network, this.network)
      .all<RecordedNativeSend>();
    const unique = new Map<string, RecordedNativeSend>();
    for (const send of results) {
      const prior = unique.get(send.txId);
      if (prior && prior.feeWallet !== send.feeWallet)
        throw new Error("Historical fee signer records disagree");
      if (!prior || (!prior.rawTx && send.rawTx)) unique.set(send.txId, send);
    }
    return [...unique.values()];
  }

  async importRecorded(
    send: RecordedNativeSend,
    nonce: number,
    intentHash: string,
    maximumWei: string,
  ) {
    nativeInteger(maximumWei);
    const result = await this.db
      .prepare(`INSERT INTO fee_native_gas
      (id,network,fee_wallet,nonce,intent_hash,run_id,maximum_wei,per_transaction_wei,per_day_wei,state,tx_id,conversion_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,'signed',?,?,? WHERE ${LEASE}`)
      .bind(
        crypto.randomUUID(),
        this.network,
        send.feeWallet,
        nonce,
        intentHash,
        this.runId,
        maximumWei,
        this.limits.perTransaction,
        this.limits.perDay,
        send.txId,
        send.conversionId,
        this.now().toISOString(),
        ...this.lease(),
      )
      .run();
    if ((result.meta?.changes ?? 0) < 1)
      throw new Error("Historical native fee import lost its lease");
  }

  async unsettled(): Promise<RecordedNativeSend[]> {
    const { results } = await this.db
      .prepare(`SELECT g.tx_id txId,COALESCE(r.raw_tx,c.raw_tx) rawTx,g.conversion_id conversionId,g.fee_wallet feeWallet,g.nonce nonce
      FROM fee_native_gas g LEFT JOIN fee_conversions c ON c.tx_id=g.tx_id AND c.id=g.conversion_id
      LEFT JOIN fee_send_replacements r ON r.tx_id=g.tx_id AND r.conversion_id=g.conversion_id
      WHERE g.network=? AND g.state='signed' AND g.actual_wei IS NULL`)
      .bind(this.network)
      .all<RecordedNativeSend>();
    return results;
  }

  expiryCoverageStore(): ExpiryCoverageStore {
    return {
      read: async (txId, operator) => {
        const row = await this.db
          .prepare(
            "SELECT scan_json FROM fee_solana_expiry_scans WHERE tx_id=? AND operator=?",
          )
          .bind(txId, operator)
          .first<{ scan_json: string }>();
        return row ? (JSON.parse(row.scan_json) as ExpiryCoverage) : null;
      },
      save: async (previous, next, page) => {
        await this.db
          .prepare(
            "INSERT INTO fee_solana_expiry_scan_steps(tx_id,operator,prior_revision,revision,fee_wallet,run_id,scan_json,page_json,observed_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            next.txId,
            next.operator,
            previous?.revision ?? 0,
            next.revision,
            this.feeWallet,
            this.runId,
            JSON.stringify(next),
            JSON.stringify(page),
            this.now().toISOString(),
          )
          .run();
      },
    };
  }

  async resolveSolanaExpiry(send: RecordedNativeSend, proof: ExpiryProof) {
    if (
      this.network !== "solana" ||
      proof.txId !== send.txId ||
      proof.providers.length !== 2 ||
      proof.providers[0].operator === proof.providers[1].operator
    )
      throw new Error("Solana expiry needs two independent observations");
    const row = (await this.rows()).find(
      (r) => r.tx_id === send.txId && r.fee_wallet === this.feeWallet,
    );
    if (!row || row.solana_blockhash_slot !== proof.blockhashSlot)
      throw new Error(
        "Solana expiry anchor differs from the signed reservation",
      );
    for (const provider of proof.providers) {
      const retained = await this.expiryCoverageStore().read(
        send.txId,
        provider.operator,
      );
      if (
        !retained?.complete ||
        !provider.coverage?.complete ||
        JSON.stringify(retained) !== JSON.stringify(provider.coverage)
      )
        throw new Error(
          "Solana expiry lacks positive retained block-history coverage",
        );
    }
    if (
      !matchingCompletedCoverage(
        proof.providers[0].coverage,
        proof.providers[1].coverage,
      )
    )
      throw new Error("Solana completed provider histories disagree");
    const json = JSON.stringify(proof);
    const digest = Array.from(sha256(new TextEncoder().encode(json)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await this.db
      .prepare(
        "INSERT INTO fee_solana_expiry_proofs(tx_id,fee_wallet,run_id,proof_json,proof_sha256,observed_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        send.txId,
        this.feeWallet,
        this.runId,
        json,
        digest,
        this.now().toISOString(),
      )
      .run();
  }

  async solanaExpiryResolved(txId: string) {
    return !!(await this.db
      .prepare(
        "SELECT tx_id FROM fee_solana_expiry_proofs WHERE tx_id=? AND fee_wallet=?",
      )
      .bind(txId, this.feeWallet)
      .first());
  }

  async settle(send: RecordedNativeSend, cost: NativeReceiptCost) {
    nativeInteger(cost.actualWei);
    const day = this.now().toISOString().slice(0, 10);
    const result = await this.db
      .prepare(`UPDATE fee_native_gas SET
      actual_wei=CASE WHEN tx_id=? THEN ? ELSE '0' END,settled_day=?,receipt_block_hash=?
      WHERE network=? AND fee_wallet=? AND nonce=? AND state='signed' AND actual_wei IS NULL
      AND EXISTS(SELECT 1 FROM fee_native_gas g WHERE g.network=? AND g.tx_id=? AND g.fee_wallet=? AND g.nonce=?)
      AND ${LEASE}`)
      .bind(
        cost.txId,
        cost.actualWei,
        day,
        cost.blockHash,
        this.network,
        send.feeWallet,
        send.nonce,
        this.network,
        cost.txId,
        send.feeWallet,
        send.nonce,
        ...this.lease(),
      )
      .run();
    if (!result.meta?.changes)
      throw new Error(
        "Native receipt reconciliation lost its lease or attempt",
      );
  }
}
