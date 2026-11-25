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
  submissionDepositOffset,
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

/**
 * The open deposit records of the accepted mint whose kept wallet is the fee
 * wallet, by record address, with the id each holds. A record of any other
 * mint or kept wallet is filtered out by the endpoint and never fetched: the
 * Worker never resolves one, and its payer reclaims it from the program.
 */
export interface SolanaListing {
  /** The finalized slot the `Config` was read at. */
  slot: number;
  /** Deposits ever made at that slot, of every mint. */
  depositCount: number;
  depositsPaused: boolean;
  resolver: string;
  /** Record address to deposit id, read at `openSlot`. */
  open: Map<string, number>;
  /** The finalized slot the records were listed at, not before `slot`. */
  openSlot: number;
}

/** The facts of a recorded deposit a settlement is proven against. */
export interface SolanaSettledRow {
  account: string;
  payer: string;
  token: string;
  amount: string;
  keptTo: string;
}

export interface SolanaSettlement {
  state: "refunded" | "kept" | "reclaimed";
  txHash: string;
  at: string;
}

/** Where a search for a settlement stands (migration 0155). */
export interface SolanaSearch {
  /** The record was still open at this finalized slot. */
  afterSlot: number;
  /** The record was first seen gone at this finalized slot. */
  untilSlot: number;
  /** Continue with the transactions before this signature; null to start. */
  before: string | null;
  /** The oldest settlement found so far between the two slots. */
  candidate: string | null;
}

export type SolanaSearchStep =
  | { done: true; settlement: SolanaSettlement | null }
  | { done: false; before: string | null; candidate: string | null };

/** What one run may still spend on searches, shared by every deposit. */
export interface SolanaSearchBudget {
  pages: number;
  reads: number;
}

export interface SolanaFeeChain extends ResolverChain {
  genesisHash(): Promise<string>;
  /** The program's `Config` alone, at a finalized slot. */
  config(): Promise<Omit<SolanaListing, "open" | "openSlot">>;
  listing(): Promise<SolanaListing>;
  /**
   * The full records at these addresses (at most 100), read together at a
   * finalized slot not before `minSlot`. Null where no record of this
   * program is there.
   */
  records(
    accounts: readonly string[],
    minSlot: number,
  ): Promise<{ slot: number; records: Map<string, SubmissionDeposit | null> }>;
  /**
   * The transaction that created a deposit, when one bounded read of its
   * address finds it: a successful `deposit` at the record's own cluster
   * time whose payer, mint, item, amount, kept wallet and nonce are the
   * record's. Null otherwise. The Worker records the deposit either way.
   */
  creation(
    account: string,
    record: SubmissionDeposit,
  ): Promise<{ signature: string; slot: number } | null>;
  /**
   * The settlement a transaction the Worker sent made of a deposit, proven
   * from that transaction. Null while the transaction is not readable.
   */
  settledBy(
    signature: string,
    row: SolanaSettledRow,
  ): Promise<SolanaSettlement | null>;
  /**
   * One bounded step of the search for a settlement nobody told the Worker
   * about: the oldest `resolve` or `reclaim` on the record address between
   * the slot it was still open at and the slot it was seen gone at. Spends
   * from `budget` and returns where to continue when that runs out.
   */
  search(
    row: SolanaSettledRow,
    search: SolanaSearch,
    budget: SolanaSearchBudget,
  ): Promise<SolanaSearchStep>;
  /** Names the record address of a deposit id for the resolver's steps. */
  track(depositId: number, account: string): void;
  /** Where the record address of an untracked deposit id is looked up. */
  locate(lookup: (depositId: number) => Promise<string | null>): void;
  /** Requests made to the endpoint so far in this run. */
  requests(): number;
}

/**
 * The recorded reason of a send that never landed: its blockhash expired
 * while a node that had seen the finalized chain past it did not know its
 * signature. It paid no fee, so it is not counted in the day's spend.
 */
export const SOLANA_EXPIRED = "blockhash expired before the transaction landed";

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

/** The run has made every request it may; nothing more is asked. */
export class SolanaFeeBudgetError extends Error {
  constructor() {
    super("The run's Solana request limit is reached");
    this.name = "SolanaFeeBudgetError";
  }
}

/**
 * Requests one run may make to the Solana endpoint. Every request goes
 * through one counter, and the request after the last is refused before it
 * is sent. The steps' own limits (solana-core.ts) add up to less.
 */
export const SOLANA_REQUESTS_PER_RUN = 300;
/** Signatures read per page for one address. */
export const SOLANA_SIGNATURE_PAGE = 1000;
/** Transactions read to find the one that created a deposit. */
const CREATION_READS = 2;
/** Records read together in one request. */
export const SOLANA_RECORDS_PER_READ = 100;
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
  /** Tests only: another request limit for the run. */
  requests?: number;
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
  let lookup: ((depositId: number) => Promise<string | null>) | null = null;
  const FINAL = "finalized";
  const limit = options.requests ?? SOLANA_REQUESTS_PER_RUN;

  let sequence = 0;
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    if (sequence >= limit) throw new SolanaFeeBudgetError();
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

  /** Up to 100 accounts read together at one finalized slot. */
  const accounts = async (
    addresses: readonly string[],
    minContextSlot?: number,
  ) => {
    if (addresses.length === 0 || addresses.length > SOLANA_RECORDS_PER_READ)
      throw new Error("Between 1 and 100 accounts are read together");
    const result = object(
      await rpc("getMultipleAccounts", [
        addresses,
        {
          commitment: FINAL,
          encoding: "base64",
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
        },
      ]),
    );
    const values = list(result.value);
    if (values.length !== addresses.length)
      throw new Error("Invalid Solana response");
    return { slot: integer(object(result.context).slot), values };
  };

  /** The deposit record in an account, or null when it holds none. */
  const recordOf = (value: unknown): SubmissionDeposit | null => {
    if (value === null || value === undefined) return null;
    // An account at this address that another program owns holds no record.
    if (object(value).owner !== programId) return null;
    return decodeSubmissionDeposit(accountBytes(value, programId), idl);
  };

  const addressOf = async (depositId: number) => {
    const known = tracked.get(depositId);
    if (known) return known;
    const found = lookup ? await lookup(depositId) : null;
    if (!found) throw new Error("A Solana deposit's record is not known");
    tracked.set(depositId, found);
    return found;
  };

  const record = async (depositId: number) => {
    const address = await addressOf(depositId);
    const deposit = recordOf((await account(address)).value);
    // The payer used the address again: this deposit's own record is closed.
    if (deposit === null || deposit.id !== depositId)
      return { address, deposit: null };
    return { address, deposit };
  };

  /**
   * Whether a payout can be delivered: the account is the wallet's
   * associated token account of the mint, a classic SPL Token account of
   * that mint, still owned by the wallet and not frozen. The program never
   * creates a token account and neither does this Worker.
   */
  const deliverable = (value: unknown, mint: string, wallet: string) => {
    if (value === null || value === undefined) return false;
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
    if (entries.length === 0 || entries.length > SOLANA_MAX_BATCH)
      throw new Error("A resolve transaction carries one to five deposits");
    const addresses: string[] = [];
    for (const entry of entries) addresses.push(await addressOf(entry.id));
    // Read again at finalized commitment right before building: each
    // instruction is built from the record read here and names its id,
    // never from an address alone.
    const read = await accounts(addresses);
    const open: SubmissionDeposit[] = [];
    for (const [at, entry] of entries.entries()) {
      const deposit = recordOf(read.values[at]);
      // Settled since it was planned, or the address now holds a later
      // deposit: nothing is built or signed for it.
      if (deposit === null || deposit.id !== entry.id)
        throw new SendRevertedError("A deposit of the batch is settled");
      // Never an instruction for a mint outside the reviewed table, and a
      // kept fee only to the fee wallet of the table. Neither can be
      // planned; a deposit that fails here is set aside alone.
      if (
        deposit.mint !== network.mint ||
        (!entry.refund && deposit.keptTo !== network.feeWallet)
      )
        throw new PayoutFailedError(entry.id);
      open.push(deposit);
    }
    // The destinations, read together at a slot not before the records'.
    const wallets = open.map((deposit, at) =>
      entries[at].refund ? deposit.payer : deposit.keptTo,
    );
    const destinations = await accounts(
      wallets.map((wallet) =>
        solanaAssociatedTokenAddress(network.mint, wallet),
      ),
      read.slot,
    );
    return open.map((deposit, at) => {
      if (!deliverable(destinations.values[at], network.mint, wallets[at]))
        throw new PayoutFailedError(entries[at].id);
      return resolveInstruction(
        {
          programId,
          resolver,
          deposit: addresses[at],
          record: deposit,
          refund: entries[at].refund,
        },
        idl,
      );
    });
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

  /** One page of the finalized transactions naming an address, newest first. */
  const signatures = async (address: string, before: string | null) =>
    list(
      await rpc("getSignaturesForAddress", [
        address,
        {
          commitment: FINAL,
          limit: SOLANA_SIGNATURE_PAGE,
          ...(before === null ? {} : { before }),
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
        blockTime: Number.isSafeInteger(row.blockTime)
          ? Number(row.blockTime)
          : null,
      };
    });

  const read = new Map<string, Obj>();
  const transaction = async (signature: string) => {
    const known = read.get(signature);
    if (known) return known;
    const result = await rpc("getTransaction", [
      signature,
      {
        commitment: FINAL,
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    if (result === null) return null;
    const found = object(result);
    read.set(signature, found);
    return found;
  };

  /**
   * The record's own facts, proven from what the transaction did: the
   * program's transfer of the exact amount of the deposit's mint, into an
   * account the right wallet owns, which rose by at least as much.
   */
  const proven = (
    tx: Obj,
    signature: string,
    row: SolanaSettledRow,
  ): SolanaSettlement | null => {
    const settled = submissionSettlement(tx, programId, row.account, idl);
    if (settled === null) return null;
    const wallet = settled.kind === "kept" ? row.keptTo : row.payer;
    if (
      settled.mint !== row.token ||
      settled.amount !== row.amount ||
      settled.destinationOwner !== wallet ||
      BigInt(settled.destinationRose) < BigInt(row.amount) ||
      (settled.kind !== "reclaimed" &&
        settled.destination !== solanaAssociatedTokenAddress(row.token, wallet))
    )
      throw new Error("A settlement does not prove the deposit's transfer");
    const seconds = integer(tx.blockTime);
    if (seconds <= 0) throw new Error("Invalid Solana response");
    return {
      state: settled.kind,
      txHash: signature,
      at: new Date(seconds * 1000).toISOString(),
    };
  };

  const readConfig = async () => {
    const { slot, value } = await account(submissionConfigAddress(programId));
    if (value === null) throw new Error("The deposit program has no Config");
    const config = decodeSubmissionConfig(accountBytes(value, programId), idl);
    return {
      slot,
      depositCount: config.depositCount,
      depositsPaused: config.depositsPaused,
      resolver: config.resolver,
    };
  };

  return {
    async genesisHash() {
      const hash = await rpc("getGenesisHash", []);
      if (typeof hash !== "string") throw new Error("Invalid Solana response");
      return hash;
    },

    config: readConfig,

    async listing() {
      const config = await readConfig();
      const slot = config.slot;
      const id = submissionDepositOffset("id", idl);
      // The endpoint filters: a record of this program (size and first eight
      // bytes), of the table's mint, whose kept wallet is the fee wallet.
      // Only the eight bytes of each record's id are returned. Read at a
      // slot not before the Config's.
      const found = object(
        await rpc("getProgramAccounts", [
          programId,
          {
            commitment: FINAL,
            encoding: "base64",
            withContext: true,
            minContextSlot: slot,
            dataSlice: { offset: id, length: 8 },
            filters: [
              { dataSize: submissionDepositSize(idl) },
              {
                memcmp: {
                  offset: 0,
                  bytes: solanaBase58(submissionDepositDiscriminator(idl)),
                },
              },
              {
                memcmp: {
                  offset: submissionDepositOffset("mint", idl),
                  bytes: network.mint,
                },
              },
              {
                memcmp: {
                  offset: submissionDepositOffset("kept_to", idl),
                  bytes: network.feeWallet,
                },
              },
            ],
          },
        ]),
      );
      const openSlot = integer(object(found.context).slot);
      if (openSlot < slot)
        throw new Error("The deposit accounts were read before the Config");
      const open = new Map<string, number>();
      const ids = new Set<number>();
      for (const entry of list(found.value).map(object)) {
        if (typeof entry.pubkey !== "string")
          throw new Error("Invalid Solana response");
        const bytes = accountBytes(entry.account, programId);
        if (bytes.length !== 8) throw new Error("Invalid Solana response");
        const value = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          8,
        ).getBigUint64(0, true);
        if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error("Invalid Solana response");
        if (ids.has(Number(value)))
          throw new Error("Two open deposits carry one id");
        ids.add(Number(value));
        open.set(entry.pubkey, Number(value));
      }
      return { ...config, open, openSlot };
    },

    async records(addresses, minSlot) {
      const found = await accounts(addresses, minSlot);
      const records = new Map<string, SubmissionDeposit | null>();
      for (const [at, address] of addresses.entries()) {
        let deposit: SubmissionDeposit | null = null;
        try {
          deposit = recordOf(found.values[at]);
          // Only the program can create an account it owns, and it creates
          // a deposit's record only at the address of its payer and nonce.
          if (
            deposit !== null &&
            address !==
              submissionDepositAddress(programId, deposit.payer, deposit.nonce)
          )
            deposit = null;
        } catch {
          // An account that does not decode as a record holds none.
          deposit = null;
        }
        records.set(address, deposit);
      }
      return { slot: found.slot, records };
    },

    async creation(address, deposit) {
      // One page, newest first. The creating transaction ran at the cluster
      // time the program stored in the record, so every other transaction
      // that merely names the address is passed over without being read.
      const candidates = (await signatures(address, null)).filter(
        (entry) => !entry.failed && entry.blockTime === deposit.depositedAt,
      );
      for (const candidate of candidates.slice(0, CREATION_READS)) {
        const tx = await transaction(candidate.signature);
        if (tx === null) continue;
        if (submissionCreation(tx, programId, address, idl, deposit))
          return { signature: candidate.signature, slot: integer(tx.slot) };
      }
      return null;
    },

    async settledBy(signature, row) {
      const tx = await transaction(signature);
      if (tx === null) return null;
      const settled = proven(tx, signature, row);
      if (settled === null)
        throw new Error("A finalized send does not settle its deposit");
      return settled;
    },

    async search(row, search, budget) {
      let before = search.before;
      let candidate = search.candidate;
      const paused = (): SolanaSearchStep => ({
        done: false,
        before,
        candidate,
      });
      for (;;) {
        if (budget.pages <= 0) return paused();
        budget.pages -= 1;
        const page = await signatures(row.account, before);
        let reachedStart = false;
        for (const entry of page) {
          // At or before the slot the record was still open at: the
          // settlement cannot be this old, and nothing older is read.
          if (entry.slot <= search.afterSlot) {
            reachedStart = true;
            break;
          }
          // After the record was seen gone, or failed: not the settlement.
          if (entry.slot <= search.untilSlot && !entry.failed) {
            if (budget.reads <= 0) return paused();
            budget.reads -= 1;
            const tx = await transaction(entry.signature);
            // Not readable yet: the same place is read again next time.
            if (tx === null) return paused();
            // Newest first, so a later match here is an older settlement:
            // the first one after the record was last seen open.
            if (
              submissionSettlement(tx, programId, row.account, idl) !== null
            )
              candidate = entry.signature;
          }
          before = entry.signature;
        }
        if (reachedStart || page.length < SOLANA_SIGNATURE_PAGE) break;
      }
      if (candidate === null) return { done: true, settlement: null };
      if (!read.has(candidate)) {
        if (budget.reads <= 0) return paused();
        budget.reads -= 1;
      }
      const tx = await transaction(candidate);
      if (tx === null) return paused();
      const settled = proven(tx, candidate, row);
      if (settled === null)
        throw new Error("A settlement candidate settles nothing");
      return { done: true, settlement: settled };
    },

    track(depositId, address) {
      tracked.set(depositId, address);
    },

    locate(found) {
      lookup = found;
    },

    requests: () => sequence,

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
      // The finalized slot and its block height, from one answer. If the
      // finalized chain is already past the transaction's last valid
      // height, every block that could hold it is finalized too.
      const epoch = object(
        await rpc("getEpochInfo", [{ commitment: FINAL }]),
      );
      const finalizedSlot = integer(epoch.absoluteSlot);
      const height = integer(epoch.blockHeight);
      const statuses = object(
        await rpc("getSignatureStatuses", [
          [send.txId],
          { searchTransactionHistory: true },
        ]),
      );
      const found = list(statuses.value);
      if (found.length !== 1) throw new Error("Invalid Solana response");
      if (found[0] === null) {
        if (height <= send.evmNonce) return { kind: "rebroadcast" };
        // "Not found" counts only from a node that has itself seen the
        // finalized slot the height was read at. A node behind it may not
        // know a transaction that landed, so the send stays in flight and
        // the next run asks again.
        if (integer(object(statuses.context).slot) < finalizedSlot)
          return { kind: "pending" };
        return { kind: "failed", reason: SOLANA_EXPIRED };
      }
      const status = object(found[0]);
      if (status.confirmationStatus !== FINAL) return { kind: "pending" };
      if (status.err !== null && status.err !== undefined)
        return { kind: "failed", reason: "resolve transaction failed" };
      return { kind: "finalized", blockNumber: integer(status.slot) };
    },
  };
}
