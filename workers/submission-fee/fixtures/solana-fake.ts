/**
 * Test support: a small Solana cluster that behaves like the
 * `slop-submission-deposits` program as far as the Worker can observe it
 * through JSON-RPC. It holds accounts, executes the resolver's signed
 * `resolve` transaction with the program's own refusals (wrong resolver,
 * record not open, destination missing, frozen or not the wallet's), and
 * serves finalized reads. No production code imports this file.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaAssociatedTokenAddress,
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
  solanaPublicKeyBytes,
} from "../../../contracts/solana/adapter";
import {
  decodeSubmissionDeposit,
  SUBMISSION_DEPOSITS_IDL,
  type SubmissionDepositsIdl,
  submissionConfigAddress,
  submissionDepositAddress,
  submissionVaultAddress,
} from "../../../contracts/solana/submission-deposits";
import { CLASSIC_TOKEN_PROGRAM } from "../../../contracts/solana/token";
import { decodeBase58Bytes, encodeBase58Bytes } from "../../../src/lib/base58";

const u64 = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
};
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const hex32 = (value: string) =>
  Uint8Array.from(value.slice(2).match(/../gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );

/** A test address: 32 bytes of one value. */
export const fakeAddress = (byte: number) =>
  encodeBase58Bytes(new Uint8Array(32).fill(byte));

interface Account {
  owner: string;
  data: Uint8Array;
}
interface Landed {
  slot: number;
  blockTime: number;
  json: Record<string, unknown>;
  failed: boolean;
}
interface Compiled {
  program: string;
  accounts: string[];
  data: Uint8Array;
}

function decodeMessage(body: Uint8Array) {
  let offset = 0;
  const take = (length: number) => {
    const value = body.slice(offset, offset + length);
    offset += length;
    return value;
  };
  const short = () => {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = take(1)[0];
      value |= (byte & 127) << shift;
      if (byte < 128) return value;
    }
  };
  take(3);
  const keys = Array.from({ length: short() }, () => solanaBase58(take(32)));
  const blockhash = solanaBase58(take(32));
  const instructions = Array.from({ length: short() }, () => {
    const programIndex = take(1)[0];
    const accountIndexes = Array.from(take(short()));
    return { programIndex, accountIndexes, data: take(short()) };
  });
  return { keys, blockhash, instructions };
}

export class FakeSolana {
  readonly genesis = fakeAddress(9);
  readonly programId = fakeAddress(200);
  readonly mint = fakeAddress(201);
  readonly feeWallet = fakeAddress(202);
  resolver = fakeAddress(203);
  slot = 1000;
  height = 500;
  time = 1_796_000_000;
  count = 0;
  paused = false;
  /** Makes account reads lag the Config read by refusing `minContextSlot`. */
  calls: string[] = [];
  failMethod: string | null = null;
  /** Runs before each request is answered; a test changes the chain here. */
  onCall: ((method: string, params: unknown[]) => void) | null = null;
  readonly accounts = new Map<string, Account>();
  readonly landed = new Map<string, Landed>();
  readonly history = new Map<string, string[]>();
  readonly mempool = new Map<string, Uint8Array>();
  readonly broadcasts: string[] = [];
  /** Payer transactions a wallet sent, as raw wire bytes by signature. */
  readonly wallet = new Map<string, { wire: Uint8Array; failed: boolean }>();
  private nonce = 0n;

  constructor(readonly idl: SubmissionDepositsIdl = SUBMISSION_DEPOSITS_IDL) {
    this.tokenAccount(this.feeWallet, this.mint);
    this.accounts.set(submissionVaultAddress(this.programId, this.mint), {
      owner: CLASSIC_TOKEN_PROGRAM,
      data: this.tokenData(this.mint, fakeAddress(250), 0n, 1),
    });
  }

  /** A blockhash that changes with the block height, as a real one does. */
  blockhash() {
    return solanaBase58(
      join(new Uint8Array(24).fill(77), u64(BigInt(this.height))),
    );
  }

  private discriminator(kind: "accounts" | "instructions", name: string) {
    const found = (
      this.idl[kind] as { name: string; discriminator: number[] }[]
    ).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return Uint8Array.from(found.discriminator);
  }

  /**
   * An account's bytes in the IDL's own field order. A field the caller does
   * not name is zero, so a field a later program version adds needs no
   * change here.
   */
  private accountData(name: string, values: Record<string, Uint8Array>) {
    const struct = this.idl.types.find((entry) => entry.name === name);
    if (!struct?.type.fields) throw new Error(`no ${name}`);
    return join(
      this.discriminator("accounts", name),
      ...struct.type.fields.map((field) => {
        const size =
          typeof field.type === "string"
            ? { pubkey: 32, u64: 8, i64: 8, bool: 1, u8: 1 }[field.type]
            : field.type.array[1];
        if (size === undefined) throw new Error(`no size for ${field.name}`);
        const value = values[field.name] ?? new Uint8Array(size);
        if (value.length !== size) throw new Error(`bad ${field.name}`);
        return value;
      }),
    );
  }

  private configData() {
    return this.accountData("Config", {
      owner: solanaPublicKeyBytes(fakeAddress(204)),
      resolver: solanaPublicKeyBytes(this.resolver),
      reclaim_delay: u64(2_592_000n),
      deposit_count: u64(BigInt(this.count)),
      deposits_paused: Uint8Array.of(this.paused ? 1 : 0),
    });
  }

  private tokenData(
    mint: string,
    owner: string,
    amount: bigint,
    state: number,
  ) {
    const data = new Uint8Array(165);
    data.set(solanaPublicKeyBytes(mint), 0);
    data.set(solanaPublicKeyBytes(owner), 32);
    data.set(u64(amount), 64);
    data[108] = state;
    return data;
  }

  /** Creates, replaces or (with `state` 0) removes a wallet's associated token account. */
  tokenAccount(wallet: string, mint: string, state = 1, owner = wallet) {
    const address = solanaAssociatedTokenAddress(mint, wallet);
    if (state === 0) this.accounts.delete(address);
    else
      this.accounts.set(address, {
        owner: CLASSIC_TOKEN_PROGRAM,
        data: this.tokenData(mint, owner, this.balance(address), state),
      });
    return address;
  }

  balance(address: string): bigint {
    const account = this.accounts.get(address);
    return account
      ? new DataView(account.data.buffer).getBigUint64(64, true)
      : 0n;
  }

  private credit(address: string, amount: bigint) {
    const account = this.accounts.get(address);
    if (!account) throw new Error("no token account");
    new DataView(account.data.buffer).setBigUint64(
      64,
      this.balance(address) + amount,
      true,
    );
  }

  private record(signature: string, addresses: string[], entry: Landed) {
    this.landed.set(signature, entry);
    for (const address of addresses)
      this.history.set(address, [
        signature,
        ...(this.history.get(address) ?? []),
      ]);
  }

  private signature() {
    this.nonce += 1n;
    return solanaBase58(join(new Uint8Array(56), u64(this.nonce)));
  }

  /** A payer's deposit, finalized at once. Returns its id and record address. */
  pay(input: {
    payer: string;
    item: string;
    amount?: bigint;
    mint?: string;
    keptTo?: string;
    /** A token account for the payer; false leaves the payer without one. */
    tokenAccount?: boolean;
    /** The payer's nonce; the same one names the same record address. */
    nonce?: bigint;
  }) {
    const mint = input.mint ?? this.mint;
    const amount = input.amount ?? 2_000_000n;
    const keptTo = input.keptTo ?? this.feeWallet;
    this.count += 1;
    this.slot += 1;
    this.height += 1;
    this.time += 1;
    const id = this.count;
    this.nonce += 1n;
    const nonce = input.nonce ?? this.nonce;
    const account = submissionDepositAddress(
      this.programId,
      input.payer,
      nonce,
    );
    if (this.accounts.has(account)) throw new Error("account already in use");
    if (
      input.tokenAccount !== false &&
      !this.accounts.has(solanaAssociatedTokenAddress(mint, input.payer))
    )
      this.tokenAccount(input.payer, mint);
    this.accounts.set(account, {
      owner: this.programId,
      data: this.accountData("Deposit", {
        id: u64(BigInt(id)),
        nonce: u64(nonce),
        payer: solanaPublicKeyBytes(input.payer),
        mint: solanaPublicKeyBytes(mint),
        kept_to: solanaPublicKeyBytes(keptTo),
        item: hex32(input.item),
        amount: u64(amount),
        deposited_at: u64(BigInt(this.time)),
      }),
    });
    const spec = this.idl.instructions.find(
      (entry) => entry.name === "deposit",
    );
    if (!spec) throw new Error("no deposit");
    const named: Record<string, string> = {
      payer: input.payer,
      config: submissionConfigAddress(this.programId),
      ledger: fakeAddress(250),
      mint,
      source: solanaAssociatedTokenAddress(mint, input.payer),
      vault: submissionVaultAddress(this.programId, mint),
      deposit: account,
    };
    const keys = [
      ...new Set([
        ...spec.accounts.map((meta) => meta.address ?? named[meta.name]),
        this.programId,
      ]),
    ];
    const signature = this.signature();
    this.record(signature, [account], {
      slot: this.slot,
      blockTime: this.time,
      failed: false,
      json: {
        slot: this.slot,
        blockTime: this.time,
        transaction: {
          message: {
            accountKeys: keys,
            instructions: [
              {
                programIdIndex: keys.indexOf(this.programId),
                accounts: spec.accounts.map((meta) =>
                  keys.indexOf(meta.address ?? named[meta.name]),
                ),
                data: encodeBase58Bytes(
                  join(Uint8Array.from(spec.discriminator), new Uint8Array(80)),
                ),
              },
            ],
          },
        },
        meta: { err: null, innerInstructions: [] },
      },
    });
    return { id, account, signature };
  }

  /** The program's instructions of a message, in order. */
  private compiled(body: Uint8Array): { keys: string[]; calls: Compiled[] } {
    const message = decodeMessage(body);
    return {
      keys: message.keys,
      calls: message.instructions.map((entry) => ({
        program: message.keys[entry.programIndex],
        accounts: entry.accountIndexes.map((index) => message.keys[index]),
        data: entry.data,
      })),
    };
  }

  private depositOf(address: string) {
    const account = this.accounts.get(address);
    if (!account || account.owner !== this.programId) return null;
    const record = decodeSubmissionDeposit(account.data, this.idl);
    return {
      id: record.id,
      payer: record.payer,
      mint: record.mint,
      keptTo: record.keptTo,
      amount: BigInt(record.amount),
    };
  }

  /** The index of the first instruction the program would refuse, or null. */
  private refusal(feePayer: string, calls: Compiled[]): number | null {
    const closed = new Set<string>();
    for (const [index, call] of calls.entries()) {
      if (call.program !== this.programId) return index;
      const [resolver, , deposit, , mint, , destination, payer] = call.accounts;
      const record = closed.has(deposit) ? null : this.depositOf(deposit);
      const spec = this.idl.instructions.find((e) => e.name === "resolve");
      const expects = spec?.args.some((arg) => arg.name === "expected_id");
      if (
        expects &&
        record !== null &&
        new DataView(call.data.buffer, call.data.byteOffset).getBigUint64(
          9,
          true,
        ) !== BigInt(record.id)
      )
        return index;
      const wallet =
        record === null
          ? ""
          : call.data[8] === 1
            ? record.payer
            : record.keptTo;
      const token = this.accounts.get(destination);
      if (
        resolver !== feePayer ||
        resolver !== this.resolver ||
        record === null ||
        record.mint !== mint ||
        record.payer !== payer ||
        destination !== solanaAssociatedTokenAddress(mint, wallet) ||
        !token ||
        token.data[108] !== 1 ||
        solanaBase58(token.data.slice(32, 64)) !== wallet
      )
        return index;
      closed.add(deposit);
    }
    return null;
  }

  /** Includes and finalizes a broadcast transaction, as the program would. */
  land(signature: string) {
    const wire = this.mempool.get(signature);
    if (!wire) throw new Error("not in mempool");
    this.mempool.delete(signature);
    this.slot += 1;
    this.height += 1;
    this.time += 1;
    const body = wire.slice(65);
    const { keys, calls } = this.compiled(body);
    const refused = this.refusal(keys[0], calls);
    const touched = new Set<string>();
    const pre = new Map<string, bigint>();
    const inner: Record<string, unknown>[] = [];
    if (refused === null)
      for (const [index, call] of calls.entries()) {
        const [, , deposit, , mint, vault, destination] = call.accounts;
        const record = this.depositOf(deposit);
        if (!record) throw new Error("unreachable");
        if (!pre.has(destination))
          pre.set(destination, this.balance(destination));
        this.credit(destination, record.amount);
        this.accounts.delete(deposit);
        touched.add(deposit);
        const child = [...keys];
        for (const key of [CLASSIC_TOKEN_PROGRAM, vault, mint, destination])
          if (!child.includes(key)) throw new Error("account not in message");
        inner.push({
          index,
          instructions: [
            {
              programIdIndex: keys.indexOf(CLASSIC_TOKEN_PROGRAM),
              accounts: [vault, mint, destination, call.accounts[3]].map(
                (key) => keys.indexOf(key),
              ),
              data: encodeBase58Bytes(
                join(Uint8Array.of(12), u64(record.amount), Uint8Array.of(6)),
              ),
              stackHeight: 2,
            },
          ],
        });
      }
    else for (const call of calls) touched.add(call.accounts[2]);
    const balances = (read: (address: string) => bigint) =>
      [...pre.keys()].map((address) => ({
        accountIndex: keys.indexOf(address),
        mint: solanaBase58(
          this.accounts.get(address)?.data.slice(0, 32) as Uint8Array,
        ),
        owner: solanaBase58(
          this.accounts.get(address)?.data.slice(32, 64) as Uint8Array,
        ),
        uiTokenAmount: { amount: read(address).toString() },
      }));
    const message = decodeMessage(body);
    this.record(signature, [...touched], {
      slot: this.slot,
      blockTime: this.time,
      failed: refused !== null,
      json: {
        slot: this.slot,
        blockTime: this.time,
        transaction: {
          message: {
            accountKeys: keys,
            instructions: message.instructions.map((entry) => ({
              programIdIndex: entry.programIndex,
              accounts: entry.accountIndexes,
              data: encodeBase58Bytes(entry.data),
            })),
          },
        },
        meta: {
          err:
            refused === null ? null : { InstructionError: [refused, "Custom"] },
          innerInstructions: inner,
          preTokenBalances: balances((address) => pre.get(address) as bigint),
          postTokenBalances: balances((address) => this.balance(address)),
        },
      },
    });
  }

  /**
   * A payer's own reclaim of an open deposit, finalized at once: the record
   * is closed and the amount goes to the payer's associated token account.
   */
  reclaim(account: string) {
    const record = this.depositOf(account);
    if (!record) throw new Error("not open");
    this.slot += 1;
    this.height += 1;
    this.time += 1;
    const destination = solanaAssociatedTokenAddress(record.mint, record.payer);
    const vault = submissionVaultAddress(this.programId, record.mint);
    const spec = this.idl.instructions.find(
      (entry) => entry.name === "reclaim",
    );
    if (!spec) throw new Error("no reclaim");
    const named: Record<string, string> = {
      payer: record.payer,
      config: submissionConfigAddress(this.programId),
      deposit: account,
      ledger: fakeAddress(250),
      mint: record.mint,
      vault,
      destination,
    };
    const keys = [
      ...new Set([
        ...spec.accounts.map((meta) => meta.address ?? named[meta.name]),
        this.programId,
      ]),
    ];
    const before = this.balance(destination);
    this.credit(destination, record.amount);
    this.accounts.delete(account);
    const balance = (amount: bigint) => [
      {
        accountIndex: keys.indexOf(destination),
        mint: record.mint,
        owner: record.payer,
        uiTokenAmount: { amount: amount.toString() },
      },
    ];
    const signature = this.signature();
    this.record(signature, [account], {
      slot: this.slot,
      blockTime: this.time,
      failed: false,
      json: {
        slot: this.slot,
        blockTime: this.time,
        transaction: {
          message: {
            accountKeys: keys,
            instructions: [
              {
                programIdIndex: keys.indexOf(this.programId),
                accounts: spec.accounts.map((meta) =>
                  keys.indexOf(meta.address ?? named[meta.name]),
                ),
                data: encodeBase58Bytes(Uint8Array.from(spec.discriminator)),
              },
            ],
          },
        },
        meta: {
          err: null,
          innerInstructions: [
            {
              index: 0,
              instructions: [
                {
                  programIdIndex: keys.indexOf(CLASSIC_TOKEN_PROGRAM),
                  accounts: [vault, record.mint, destination, named.ledger].map(
                    (key) => keys.indexOf(key),
                  ),
                  data: encodeBase58Bytes(
                    join(
                      Uint8Array.of(12),
                      u64(record.amount),
                      Uint8Array.of(6),
                    ),
                  ),
                  stackHeight: 2,
                },
              ],
            },
          ],
          preTokenBalances: balance(before),
          postTokenBalances: balance(before + record.amount),
        },
      },
    });
    return signature;
  }

  /** Finalizes a transaction a payer's wallet signed and sent. */
  landWallet(wire: Uint8Array, failed = false) {
    this.slot += 1;
    this.height += 1;
    this.time += 1;
    const signature = solanaBase58(wire.slice(1, 65));
    this.wallet.set(signature, { wire, failed });
    this.landed.set(signature, {
      slot: this.slot,
      blockTime: this.time,
      failed,
      json: {},
    });
    return signature;
  }

  private info(address: string) {
    const account =
      address === submissionConfigAddress(this.programId)
        ? { owner: this.programId, data: this.configData() }
        : this.accounts.get(address);
    return account
      ? {
          owner: account.owner,
          data: [solanaBase64(account.data), "base64"],
          lamports: 1,
          executable: false,
        }
      : null;
  }

  private answer(method: string, params: unknown[]): unknown {
    const context = { slot: this.slot };
    switch (method) {
      case "getGenesisHash":
        return this.genesis;
      case "getAccountInfo":
        return { context, value: this.info(params[0] as string) };
      case "getProgramAccounts": {
        const options = params[1] as {
          minContextSlot: number;
          filters: {
            dataSize?: number;
            memcmp?: { offset: number; bytes: string };
          }[];
        };
        if (options.minContextSlot > this.slot) throw new Error("behind");
        return {
          context,
          value: [...this.accounts]
            .filter(
              ([, account]) =>
                account.owner === params[0] &&
                options.filters.every((filter) =>
                  filter.memcmp
                    ? decodeBase58Bytes(filter.memcmp.bytes).every(
                        (byte, index) => account.data[index] === byte,
                      )
                    : account.data.length === filter.dataSize,
                ),
            )
            .map(([pubkey]) => ({ pubkey, account: this.info(pubkey) })),
        };
      }
      case "getSignaturesForAddress":
        return (this.history.get(params[0] as string) ?? []).map(
          (signature) => ({
            signature,
            slot: this.landed.get(signature)?.slot,
            err: this.landed.get(signature)?.failed ? { failed: true } : null,
          }),
        );
      case "getTransaction": {
        const sent = this.wallet.get(params[0] as string);
        if (sent)
          return {
            slot: this.landed.get(params[0] as string)?.slot,
            transaction: [solanaBase64(sent.wire), "base64"],
            meta: {
              err: sent.failed ? { InstructionError: [0, "Custom"] } : null,
              innerInstructions: [],
            },
          };
        return this.landed.get(params[0] as string)?.json ?? null;
      }
      case "getBalance":
        return { context, value: 1_000_000_000 };
      case "getLatestBlockhash":
        return {
          context,
          value: {
            blockhash: this.blockhash(),
            lastValidBlockHeight: this.height + 150,
          },
        };
      case "simulateTransaction": {
        const wire = solanaBase64Bytes(params[0] as string);
        const { keys, calls } = this.compiled(wire.slice(65));
        // A payer's own deposit or reclaim: the fixture lets it through.
        const own = ["deposit", "reclaim"].some((name) =>
          this.discriminator("instructions", name).every(
            (byte, index) => calls[0]?.data[index] === byte,
          ),
        );
        const refused = own ? null : this.refusal(keys[0], calls);
        return {
          context,
          value: {
            err:
              refused === null
                ? null
                : { InstructionError: [refused, { Custom: 6008 }] },
          },
        };
      }
      case "getFeeForMessage":
        return { context, value: 5000 };
      case "getBlockHeight":
        return this.height;
      case "sendTransaction": {
        const wire = solanaBase64Bytes(params[0] as string);
        const signature = wire.slice(1, 65);
        const { keys } = this.compiled(wire.slice(65));
        if (
          !ed25519.verify(
            signature,
            wire.slice(65),
            solanaPublicKeyBytes(keys[0]),
          )
        )
          throw new Error("bad signature");
        const id = solanaBase58(signature);
        this.broadcasts.push(id);
        if (!this.landed.has(id)) this.mempool.set(id, wire);
        return id;
      }
      case "getSignatureStatuses": {
        const [signature] = params[0] as string[];
        const landed = this.landed.get(signature);
        return {
          context,
          value: [
            landed
              ? {
                  slot: landed.slot,
                  err: landed.failed ? { failed: true } : null,
                  confirmationStatus: "finalized",
                }
              : null,
          ],
        };
      }
      default:
        throw new Error(`unexpected method ${method}`);
    }
  }

  /** The cluster's JSON-RPC endpoint, as a `fetch`. */
  readonly fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    this.calls.push(request.method);
    this.onCall?.(request.method, request.params);
    if (this.failMethod === request.method)
      return new Response("", { status: 503 });
    let body: Record<string, unknown>;
    try {
      body = { result: this.answer(request.method, request.params) };
    } catch {
      body = { error: { code: -32000, message: "refused" } };
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, ...body });
  }) as unknown as typeof fetch;
}
