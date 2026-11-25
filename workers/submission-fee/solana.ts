/**
 * Solana client of the submission-fee Worker (PRD section 6, "Submission fee
 * deposits", "Solana"; operator decision, 25 November 2026). It reads the
 * `slop-submission-deposits` program's accounts and transactions at
 * `finalized` commitment only, and signs, broadcasts and reconciles the
 * resolver's transaction of `resolve` instructions. What to send is decided
 * in core.ts; this file knows only the chain.
 *
 * The resolver key can mark an open deposit "refund" (to the payer's
 * associated token account) or "kept" (to the associated token account of
 * the wallet fixed at deposit time). It can send a deposit nowhere else,
 * holds no tokens and pays only the transaction's network fee. This client
 * never creates a token account and never builds an instruction for a mint
 * other than the one in the reviewed table.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaAssociatedTokenAddress,
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
  solanaPubkey,
} from "../../contracts/solana/adapter";
import {
  decodeSubmissionConfig,
  decodeSubmissionDeposit,
  resolveInstruction,
  type SubmissionDeposit,
  type SubmissionDepositsIdl,
  submissionConfigAddress,
  submissionCreation,
  submissionDepositAddress,
  submissionDepositDiscriminator,
  submissionDepositSize,
  submissionSettlement,
} from "../../contracts/solana/submission-deposits";
import { CLASSIC_TOKEN_PROGRAM } from "../../contracts/solana/token";
import {
  concat,
  type Instruction,
  message as legacyMessage,
} from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import type { NetworkConfig } from "./config";
import {
  type ChainDeposit,
  GasBudgetError,
  PayoutFailedError,
  type PreparedSend,
  type ProbeResult,
  type ResolverChain,
  type SendEntry,
  SendRevertedError,
  type SendRow,
  type SendStatus,
} from "./core";

/** The Solana ledger: a `NetworkConfig` whose limits are in lamports. */
export interface SolanaLedgerConfig extends NetworkConfig {
  /** The cluster's genesis hash, checked before anything is read. */
  genesisHash: string;
  /** The one accepted mint (USDC). */
  mint: string;
  /** The wallet whose associated token account receives a kept fee. */
  feeWallet: string;
}

/** One open deposit: the program's record and the record's address. */
export interface SolanaOpenDeposit extends SubmissionDeposit {
  account: string;
}

export interface SolanaSnapshot {
  /** The finalized slot the `Config` was read at. */
  slot: number;
  /** Deposits ever made at that slot, and so the latest id. */
  depositCount: number;
  depositsPaused: boolean;
  resolver: string;
  /**
   * Every open deposit at a finalized slot not before `slot`. It can hold
   * deposits made after `slot`, whose ids are above `depositCount`.
   */
  open: SolanaOpenDeposit[];
  /** The finalized slot `open` was read at. */
  openSlot: number;
}

export interface SolanaFeeChain extends ResolverChain {
  genesisHash(): Promise<string>;
  snapshot(): Promise<SolanaSnapshot>;
  /**
   * The finalized transaction that created the deposit a record address held
   * at `atSlot`. A payer can use an address again once its deposit is
   * settled, so this is the newest creation on the address at or before that
   * slot, not the first.
   */
  created(
    account: string,
    atSlot: number,
  ): Promise<{ signature: string; slot: number }>;
  /**
   * How a recorded deposit whose record is gone, or now holds another
   * deposit, was settled: the first `resolve` or `reclaim` on its address
   * after the transaction that created it, proven from that finalized
   * transaction. Null while that transaction is not readable yet.
   */
  settlement(row: {
    account: string;
    /** The signature of the transaction that created this deposit. */
    txHash: string;
    payer: string;
    token: string;
    amount: string;
    keptTo: string;
  }): Promise<{
    state: "refunded" | "kept" | "reclaimed";
    txHash: string;
    at: string;
  } | null>;
  /** Names the record address of a deposit id for the resolver's steps. */
  track(depositId: number, account: string): void;
}

/** The provider did not answer usefully. Carries a status or code, no text. */
export class SolanaFeeRpcError extends Error {
  constructor(
    readonly method: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super("The Solana endpoint did not answer");
    this.name = "SolanaFeeRpcError";
  }
}

/** Signatures read per page, and pages read, for one address. */
const SIGNATURE_PAGE = 1000;
const SIGNATURE_PAGES = 3;
/** Transactions after a deposit's creation looked at for its settlement. */
const SETTLEMENT_CANDIDATES = 25;
/** A legacy transaction's size limit, in bytes. */
export const SOLANA_TRANSACTION_BYTES = 1232;
/**
 * Deposits one resolve transaction carries. Each `resolve` adds up to three
 * accounts the others do not share (the record, the payer, the payer's
 * token account), and a legacy transaction holds 1,232 bytes: seven refunds
 * to seven payers measure 1,201 bytes and eight do not fit
 * (`solana.test.ts`). Five leaves room for compute budget instructions and
 * keeps the transaction's compute well inside the default allowance of
 * 200,000 units an instruction.
 */
export const SOLANA_MAX_BATCH = 5;

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Solana response");
  return value as Obj;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid Solana response");
  return value;
};
const integer = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error("Invalid Solana response");
  return Number(value);
};

interface SolanaFeeChainOptions {
  network: SolanaLedgerConfig;
  /** The resolver's 32-byte seed as 64 hex digits. Absent in dry_run. */
  seed?: string;
  fetch?: typeof fetch;
  /** Tests only: another program interface than the committed IDL. */
  idl?: SubmissionDepositsIdl;
}

export function createSolanaFeeChain(
  options: SolanaFeeChainOptions,
): SolanaFeeChain {
  const { network, idl } = options;
  const doFetch = options.fetch ?? fetch;
  const programId = network.contract;
  const seed = options.seed
    ? (() => {
        if (!/^[0-9a-f]{64}$/u.test(options.seed))
          throw new TypeError(
            "SUBMISSION_FEE_SOLANA_RESOLVER_SEED is malformed",
          );
        return Uint8Array.from(options.seed.match(/../gu) ?? [], (pair) =>
          Number.parseInt(pair, 16),
        );
      })()
    : null;
  const resolver = seed ? solanaBase58(ed25519.getPublicKey(seed)) : null;
  const tracked = new Map<number, string>();
  const FINAL = "finalized";

  let sequence = 0;
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const id = ++sequence;
    let body: Obj;
    try {
      const response = await doFetch(network.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new SolanaFeeRpcError(method, response.status);
      body = object(await response.json());
    } catch (error) {
      if (error instanceof SolanaFeeRpcError) throw error;
      // The cause may hold the endpoint; only its class is ever logged.
      const failure = new SolanaFeeRpcError(method);
      failure.cause = error;
      throw failure;
    }
    if (body.error) {
      const code = object(body.error).code;
      throw new SolanaFeeRpcError(
        method,
        undefined,
        Number.isSafeInteger(code) ? Number(code) : undefined,
      );
    }
    if (body.id !== id || !("result" in body))
      throw new SolanaFeeRpcError(method);
    return body.result;
  }

  const accountBytes = (value: unknown, owner: string): Uint8Array => {
    const info = object(value);
    const data = list(info.data);
    if (
      info.owner !== owner ||
      data[1] !== "base64" ||
      typeof data[0] !== "string"
    )
      throw new Error("Unexpected Solana account");
    return solanaBase64Bytes(data[0]);
  };

  /** One account at finalized commitment, or null when it does not exist. */
  const account = async (address: string, minContextSlot?: number) => {
    const result = object(
      await rpc("getAccountInfo", [
        address,
        {
          commitment: FINAL,
          encoding: "base64",
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
        },
      ]),
    );
    return {
      slot: integer(object(result.context).slot),
      value: result.value ?? null,
    };
  };

  const record = async (depositId: number) => {
    const address = tracked.get(depositId);
    if (!address) throw new Error("A Solana deposit's record is not known");
    const { value } = await account(address);
    if (value === null) return { address, deposit: null };
    const deposit = decodeSubmissionDeposit(
      accountBytes(value, programId),
      idl,
    );
    // The payer used the address again: this deposit's own record is closed.
    if (deposit.id !== depositId) return { address, deposit: null };
    return { address, deposit };
  };

  /**
   * Whether a payout can be delivered: the wallet's associated token account
   * of the mint exists, is a classic SPL Token account of that mint, is
   * still owned by the wallet and is not frozen. The program never creates
   * a token account and neither does this Worker.
   */
  const deliverable = async (mint: string, wallet: string) => {
    const { value } = await account(solanaAssociatedTokenAddress(mint, wallet));
    if (value === null) return false;
    const info = object(value);
    const data = list(info.data);
    if (
      info.owner !== CLASSIC_TOKEN_PROGRAM ||
      data[1] !== "base64" ||
      typeof data[0] !== "string"
    )
      return false;
    const bytes = solanaBase64Bytes(data[0]);
    return (
      bytes.length === 165 &&
      solanaPubkey(bytes, 0) === mint &&
      solanaPubkey(bytes, 32) === wallet &&
      // 1 is initialized; 2 is frozen.
      bytes[108] === 1
    );
  };

  /** The open records of these entries and their `resolve` instructions. */
  const instructions = async (entries: readonly SendEntry[]) => {
    if (!resolver)
      throw new Error(
        "Signing is disabled without SUBMISSION_FEE_SOLANA_RESOLVER_SEED",
      );
    const built: Instruction[] = [];
    for (const entry of entries) {
      // Read again at finalized commitment right before building: the
      // instruction is built from this record and names its id, never from
      // an address alone.
      const { address, deposit } = await record(entry.id);
      // Settled since it was planned, or the address now holds a later
      // deposit: nothing is built or signed for it.
      if (deposit === null)
        throw new SendRevertedError("A deposit of the batch is settled");
      // Never an instruction for a mint outside the reviewed table.
      if (deposit.mint !== network.mint)
        throw new Error("A planned deposit is of a mint outside the table");
      if (
        !(await deliverable(
          deposit.mint,
          entry.refund ? deposit.payer : deposit.keptTo,
        ))
      )
        throw new PayoutFailedError(entry.id);
      built.push(
        resolveInstruction(
          {
            programId,
            resolver,
            deposit: address,
            record: deposit,
            refund: entry.refund,
          },
          idl,
        ),
      );
    }
    return built;
  };

  const lifetime = async () => {
    const latest = object(
      object(await rpc("getLatestBlockhash", [{ commitment: FINAL }])).value,
    );
    if (
      typeof latest.blockhash !== "string" ||
      decodeBase58Bytes(latest.blockhash).length !== 32
    )
      throw new Error("Invalid Solana response");
    return {
      blockhash: latest.blockhash,
      lastValidBlockHeight: integer(latest.lastValidBlockHeight),
    };
  };

  const compile = (built: Instruction[], blockhash: string) => {
    const body = legacyMessage(resolver as string, blockhash, built);
    if (body.length + 65 > SOLANA_TRANSACTION_BYTES)
      throw new Error("The resolve transaction is too large");
    return body;
  };

  /**
   * Runs the unsigned transaction against the bank. A program or token
   * failure becomes SendRevertedError; anything else (an unknown blockhash,
   * a fee payer without SOL) says nothing about a deposit and is thrown as
   * it is.
   */
  const simulate = async (body: Uint8Array) => {
    const value = object(
      object(
        await rpc("simulateTransaction", [
          solanaBase64(concat(Uint8Array.of(1), new Uint8Array(64), body)),
          { encoding: "base64", sigVerify: false, commitment: FINAL },
        ]),
      ).value,
    );
    if (value.err === null) return;
    if (
      typeof value.err === "object" &&
      value.err !== null &&
      "InstructionError" in (value.err as Obj)
    )
      throw new SendRevertedError("The resolve simulation failed");
    throw new Error("The resolve simulation could not run");
  };

  const signatures = async (address: string, before?: string) =>
    list(
      await rpc("getSignaturesForAddress", [
        address,
        {
          commitment: FINAL,
          limit: SIGNATURE_PAGE,
          ...(before === undefined ? {} : { before }),
        },
      ]),
    ).map((entry) => {
      const row = object(entry);
      if (typeof row.signature !== "string")
        throw new Error("Invalid Solana response");
      return {
        signature: row.signature,
        slot: integer(row.slot),
        failed: row.err !== null && row.err !== undefined,
      };
    });

  /** Every finalized transaction naming an address, newest first. */
  const history = async (address: string) => {
    const all: { signature: string; slot: number; failed: boolean }[] = [];
    let before: string | undefined;
    for (let page = 0; ; page += 1) {
      const batch = await signatures(address, before);
      all.push(...batch);
      if (batch.length < SIGNATURE_PAGE) return all;
      if (page === SIGNATURE_PAGES - 1)
        throw new Error("A deposit record has too many transactions to read");
      before = batch[batch.length - 1].signature;
    }
  };

  const transaction = async (signature: string) => {
    const result = await rpc("getTransaction", [
      signature,
      {
        commitment: FINAL,
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    return result === null ? null : object(result);
  };

  return {
    async genesisHash() {
      const hash = await rpc("getGenesisHash", []);
      if (typeof hash !== "string") throw new Error("Invalid Solana response");
      return hash;
    },

    async snapshot() {
      const configAddress = submissionConfigAddress(programId);
      const { slot, value } = await account(configAddress);
      if (value === null) throw new Error("The deposit program has no Config");
      const config = decodeSubmissionConfig(
        accountBytes(value, programId),
        idl,
      );
      // Every Deposit account, read at a slot not before the Config's, so no
      // deposit numbered at or below `depositCount` can be missing from it
      // unless it is already settled.
      const found = object(
        await rpc("getProgramAccounts", [
          programId,
          {
            commitment: FINAL,
            encoding: "base64",
            withContext: true,
            minContextSlot: slot,
            filters: [
              { dataSize: submissionDepositSize(idl) },
              {
                memcmp: {
                  offset: 0,
                  bytes: solanaBase58(submissionDepositDiscriminator(idl)),
                },
              },
            ],
          },
        ]),
      );
      if (integer(object(found.context).slot) < slot)
        throw new Error("The deposit accounts were read before the Config");
      const open: SolanaOpenDeposit[] = [];
      const ids = new Set<number>();
      for (const entry of list(found.value).map(object)) {
        if (typeof entry.pubkey !== "string")
          throw new Error("Invalid Solana response");
        const deposit = decodeSubmissionDeposit(
          accountBytes(entry.account, programId),
          idl,
        );
        // Only the program can create an account it owns, and it creates a
        // deposit's record only at the address of its payer and nonce.
        if (
          entry.pubkey !==
          submissionDepositAddress(programId, deposit.payer, deposit.nonce)
        )
          throw new Error("A deposit record is not at its own address");
        if (ids.has(deposit.id))
          throw new Error("Two open deposits carry one id");
        ids.add(deposit.id);
        open.push({ ...deposit, account: entry.pubkey });
      }
      return {
        slot,
        depositCount: config.depositCount,
        depositsPaused: config.depositsPaused,
        resolver: config.resolver,
        open: open.sort((left, right) => left.id - right.id),
        openSlot: integer(object(found.context).slot),
      };
    },

    async created(address, atSlot) {
      // Newest first: the newest successful `deposit` naming this record at
      // or before the slot the record was read at. A later one would have
      // replaced what was read; an earlier one created a deposit that is
      // settled.
      for (const candidate of await history(address)) {
        if (candidate.failed || candidate.slot > atSlot) continue;
        const tx = await transaction(candidate.signature);
        if (tx === null) continue;
        if (submissionCreation(tx, programId, address, idl))
          return { signature: candidate.signature, slot: integer(tx.slot) };
      }
      throw new Error("The transaction that created a deposit was not found");
    },

    async settlement(row) {
      const all = await history(row.account);
      const createdAt = all.findIndex(
        (entry) => entry.signature === row.txHash,
      );
      if (createdAt < 0)
        throw new Error(
          "A deposit's creating transaction is not in its history",
        );
      // Oldest first, from the transaction right after the creation: the
      // first settlement on the address after it is this deposit's. A later
      // one belongs to a deposit that used the address again.
      const after = all.slice(0, createdAt).reverse();
      for (const candidate of after.slice(0, SETTLEMENT_CANDIDATES)) {
        if (candidate.failed) continue;
        const tx = await transaction(candidate.signature);
        // Not readable yet: nothing after it can be taken for the first.
        if (tx === null) return null;
        const settled = submissionSettlement(tx, programId, row.account, idl);
        if (settled === null) continue;
        // The record's own facts, proven from what the transaction did: the
        // program's transfer of the exact amount of the deposit's mint, into
        // an account the right wallet owns, which rose by at least as much.
        const wallet = settled.kind === "kept" ? row.keptTo : row.payer;
        if (
          settled.mint !== row.token ||
          settled.amount !== row.amount ||
          settled.destinationOwner !== wallet ||
          BigInt(settled.destinationRose) < BigInt(row.amount) ||
          (settled.kind !== "reclaimed" &&
            settled.destination !==
              solanaAssociatedTokenAddress(row.token, wallet))
        )
          throw new Error("A settlement does not prove the deposit's transfer");
        const seconds = integer(tx.blockTime);
        if (seconds <= 0) throw new Error("Invalid Solana response");
        return {
          state: settled.kind,
          txHash: candidate.signature,
          at: new Date(seconds * 1000).toISOString(),
        };
      }
      if (after.length > SETTLEMENT_CANDIDATES)
        throw new Error("A deposit record has too many transactions to read");
      return null;
    },

    track(depositId, address) {
      tracked.set(depositId, address);
    },

    async deposit(depositId): Promise<ChainDeposit> {
      const { deposit } = await record(depositId);
      if (deposit === null)
        return {
          payer: "",
          token: "",
          amount: "0",
          keptTo: "",
          item: "",
          state: 0,
          closed: true,
        };
      return {
        payer: deposit.payer,
        token: deposit.mint,
        amount: deposit.amount,
        keptTo: deposit.keptTo,
        item: deposit.item,
        state: 1,
      };
    },

    address: () => resolver,

    async probe(entry): Promise<ProbeResult> {
      try {
        const built = await instructions([entry]);
        await simulate(compile(built, (await lifetime()).blockhash));
        return "ok";
      } catch (error) {
        if (error instanceof PayoutFailedError) return "payout_failed";
        if (error instanceof SendRevertedError) return "reverted";
        throw error;
      }
    },

    async prepare(entries, authorize): Promise<PreparedSend> {
      if (!seed || !resolver)
        throw new Error(
          "Signing is disabled without SUBMISSION_FEE_SOLANA_RESOLVER_SEED",
        );
      const built = await instructions(entries);
      const life = await lifetime();
      const body = compile(built, life.blockhash);
      // The program's own checks (resolver, open record, destination) and
      // every transfer run before anything is signed.
      await simulate(body);
      const fee = integer(
        object(
          await rpc("getFeeForMessage", [
            solanaBase64(body),
            { commitment: FINAL },
          ]),
        ).value,
      );
      if (fee <= 0 || BigInt(fee) > BigInt(network.gas.perTransactionWei))
        throw new GasBudgetError(
          "The transaction exceeds the network fee limit; nothing was signed",
        );
      await authorize(String(fee));
      const signature = ed25519.sign(body, seed);
      return {
        txId: solanaBase58(signature),
        rawTx: solanaBase64(concat(Uint8Array.of(1), signature, body)),
        // The height after which these bytes can no longer land.
        evmNonce: life.lastValidBlockHeight,
        maximumNativeWei: String(fee),
      };
    },

    async broadcast(rawTx) {
      const wire = solanaBase64Bytes(rawTx);
      if (wire.length <= 65 || wire[0] !== 1)
        throw new Error("The recorded transaction is malformed");
      const sent = await rpc("sendTransaction", [
        rawTx,
        { encoding: "base64", skipPreflight: true, maxRetries: 0 },
      ]);
      if (sent !== solanaBase58(wire.slice(1, 65)))
        throw new Error("Submission fee broadcast signature differs");
    },

    async status(send: SendRow): Promise<SendStatus> {
      if (
        send.network !== network.network ||
        send.contract !== programId ||
        send.txId === null ||
        send.resolver === null ||
        send.evmNonce === null
      )
        throw new Error("Submission fee journal deployment differs");
      // The height is read first. If the finalized chain is already past the
      // transaction's last valid height, any block that could hold it is
      // finalized too, so a signature the node then does not know never
      // landed and never will.
      const height = integer(
        await rpc("getBlockHeight", [{ commitment: FINAL }]),
      );
      const found = list(
        object(
          await rpc("getSignatureStatuses", [
            [send.txId],
            { searchTransactionHistory: true },
          ]),
        ).value,
      );
      if (found.length !== 1) throw new Error("Invalid Solana response");
      if (found[0] === null)
        return height > send.evmNonce
          ? {
              kind: "failed",
              reason: "blockhash expired before the transaction landed",
            }
          : { kind: "rebroadcast" };
      const status = object(found[0]);
      if (status.confirmationStatus !== FINAL) return { kind: "pending" };
      if (status.err !== null && status.err !== undefined)
        return { kind: "failed", reason: "resolve transaction failed" };
      return { kind: "finalized", blockNumber: integer(status.slot) };
    },
  };
}
