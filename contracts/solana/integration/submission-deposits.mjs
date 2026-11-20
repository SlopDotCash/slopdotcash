/** Shared fixture and call helpers of the submission deposit suites. Local validator only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";

const { AnchorProvider, BN, Program, Wallet } = anchor;

export const PROGRAM_NAME = "slop_submission_deposits";
export const IDL_PATH = `target/idl/${PROGRAM_NAME}.json`;
export const PROGRAM_PATH = `target/deploy/${PROGRAM_NAME}.so`;
export const BPF_UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
/** The reclaim delay of the lifecycle and invariant stage, in seconds. */
export const SHORT_DELAY = 6;
/** The delay a mainnet deployment fixes: 30 days. */
export const PRODUCTION_DELAY = 30 * 86_400;

const sha256 = (value) => createHash("sha256").update(value).digest();
/** A key derived from a public label. It has no value outside a local validator. */
export const fixtureKey = (label) =>
  Keypair.fromSeed(sha256(`slop-submission-deposits-e2e:${label}`));

export const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
export const programId = new PublicKey(idl.address);
const seed = (value) =>
  typeof value === "string" ? Buffer.from(value) : value;
const pda = (...seeds) =>
  PublicKey.findProgramAddressSync(seeds.map(seed), programId)[0];
export const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};
export const addresses = {
  config: () => pda("config"),
  ledger: (mint) => pda("ledger", mint.toBuffer()),
  vault: (mint) => pda("vault", mint.toBuffer()),
  deposit: (id) => pda("deposit", u64(id)),
  programData: () =>
    PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      BPF_UPGRADEABLE_LOADER,
    )[0],
};
export const ata = (wallet, mint) =>
  getAssociatedTokenAddressSync(mint, wallet, true, TOKEN_PROGRAM_ID);

export function localPayer() {
  return Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(process.env.ANCHOR_WALLET ?? ".local/payer.json", "utf8"),
      ),
    ),
  );
}

/** Refuses anything but a loopback validator, so fixture keys never sign elsewhere. */
export function localEndpoint() {
  const endpoint = new URL(process.env.ANCHOR_PROVIDER_URL ?? "");
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
  )
    throw new Error("The submission deposit suites require a local validator");
  return endpoint.toString();
}

export function connect() {
  const connection = new Connection(localEndpoint(), "confirmed");
  const payer = localPayer();
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);
  return { connection, payer, provider, program };
}

export const context = connect();
const { connection, payer, program } = context;

export async function fund(keypair, lamports = 2_000_000_000) {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: keypair.publicKey ?? keypair,
        lamports,
      }),
    ),
    [payer],
  );
  return keypair;
}

/** A classic SPL mint whose mint and freeze authority is the local payer. */
export const newMint = (decimals = 6, keypair = Keypair.generate()) =>
  createMint(
    connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    decimals,
    keypair,
    undefined,
    TOKEN_PROGRAM_ID,
  );

/** Creates the wallet's associated token account if needed and mints `amount` into it. */
export async function tokens(mint, wallet, amount = 0n) {
  const account = await createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    mint,
    wallet,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    true,
  );
  if (amount > 0n)
    await mintTo(connection, payer, mint, account, payer, amount);
  return account;
}

export const balance = async (account) =>
  (await getAccount(connection, account, "confirmed", TOKEN_PROGRAM_ID)).amount;
export const lamports = (address) => connection.getBalance(address, "confirmed");
export const exists = async (address) =>
  (await connection.getAccountInfo(address, "confirmed")) !== null;

/** The cluster clock the program reads, in seconds. */
export async function chainTime() {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  return Number(info.data.readBigInt64LE(32));
}
export async function waitForChainTime(target) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if ((await chainTime()) >= target) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local cluster clock did not reach the target time");
}

export const readConfig = () =>
  program.account.config.fetch(addresses.config(), "confirmed");
export const readLedger = (mint) =>
  program.account.ledger.fetch(addresses.ledger(mint), "confirmed");
export const readDeposit = (id) =>
  program.account.deposit.fetchNullable(addresses.deposit(id), "confirmed");
export const nextId = async () =>
  BigInt((await readConfig()).depositCount.toString()) + 1n;

export function initialize({
  authority = payer,
  owner,
  resolver,
  delay,
  accounts = {},
}) {
  return program.methods
    .initialize(owner, resolver, new BN(delay.toString()))
    .accountsStrict({
      authority: authority.publicKey,
      config: addresses.config(),
      program: programId,
      programData: addresses.programData(),
      systemProgram: SystemProgram.programId,
      ...accounts,
    })
    .signers([authority])
    .rpc();
}

export function openVault(mint, { funder = payer, accounts = {} } = {}) {
  return program.methods
    .openVault()
    .accountsStrict({
      funder: funder.publicKey,
      mint,
      ledger: addresses.ledger(mint),
      vault: addresses.vault(mint),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ...accounts,
    })
    .signers([funder])
    .rpc();
}

/** Builder of a deposit. `id` is the id the caller expects to be next. */
export async function depositCall({
  from,
  mint,
  amount,
  keptTo,
  item = Buffer.alloc(32, 7),
  id,
  accounts = {},
}) {
  const expected = id ?? (await nextId());
  return program.methods
    .deposit([...item], new BN(amount.toString()), keptTo)
    .accountsStrict({
      payer: from.publicKey,
      config: addresses.config(),
      ledger: addresses.ledger(mint),
      mint,
      source: ata(from.publicKey, mint),
      vault: addresses.vault(mint),
      deposit: addresses.deposit(expected),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      ...accounts,
    })
    .signers([from]);
}

/** Makes a deposit and returns its id and transaction signature. */
export async function deposit(input) {
  const id = input.id ?? (await nextId());
  const signature = await (await depositCall({ ...input, id })).rpc();
  return { id, signature };
}

/** Builder of a resolve. Defaults follow the recorded deposit, as the Worker would. */
export async function resolveCall({ resolver, id, refund, accounts = {} }) {
  const record = await readDeposit(id);
  assert.ok(record, `deposit ${id} is not open`);
  const wallet = refund ? record.payer : record.keptTo;
  return program.methods
    .resolve(refund)
    .accountsStrict({
      resolver: resolver.publicKey,
      config: addresses.config(),
      deposit: addresses.deposit(id),
      ledger: addresses.ledger(record.mint),
      mint: record.mint,
      vault: addresses.vault(record.mint),
      destination: ata(wallet, record.mint),
      payer: record.payer,
      tokenProgram: TOKEN_PROGRAM_ID,
      ...accounts,
    })
    .signers([resolver]);
}
export const resolve = async (input) => (await resolveCall(input)).rpc();

export async function reclaimCall({ from, id, destination, accounts = {} }) {
  const record = await readDeposit(id);
  assert.ok(record, `deposit ${id} is not open`);
  return program.methods
    .reclaim()
    .accountsStrict({
      payer: from.publicKey,
      config: addresses.config(),
      deposit: addresses.deposit(id),
      ledger: addresses.ledger(record.mint),
      mint: record.mint,
      vault: addresses.vault(record.mint),
      destination: destination ?? ata(from.publicKey, record.mint),
      tokenProgram: TOKEN_PROGRAM_ID,
      ...accounts,
    })
    .signers([from]);
}
export const reclaim = async (input) => (await reclaimCall(input)).rpc();

const ownerCall = (method, owner, accounts) =>
  method
    .accountsStrict({
      owner: owner.publicKey,
      config: addresses.config(),
      ...accounts,
    })
    .signers([owner])
    .rpc();
export const setResolver = (owner, next, accounts = {}) =>
  ownerCall(program.methods.setResolver(next), owner, accounts);
export const pauseDeposits = (owner, paused, accounts = {}) =>
  ownerCall(program.methods.pauseDeposits(paused), owner, accounts);
export const transferOwnership = (owner, next, accounts = {}) =>
  ownerCall(program.methods.transferOwnership(next), owner, accounts);
export const acceptOwnership = (pendingOwner) =>
  program.methods
    .acceptOwnership()
    .accountsStrict({
      pendingOwner: pendingOwner.publicKey,
      config: addresses.config(),
    })
    .signers([pendingOwner])
    .rpc();

/** Text of an error with its program logs, which carry the program's own error name. */
export function errorText(error) {
  const logs = error?.logs ?? error?.transactionLogs ?? [];
  return `${error?.name ?? ""} ${error?.message ?? error} ${logs.join("\n")}`;
}

/** The call must fail, and the failure must be the named one, not an unrelated error. */
export async function refuses(call, pattern) {
  let failure;
  try {
    await call;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, `expected a refusal matching ${pattern}`);
  assert.match(errorText(failure), pattern);
}

/** The program's events in one transaction, decoded from its logs. */
export async function events(signature) {
  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const parser = new anchor.EventParser(programId, program.coder);
  return [...parser.parseLogs(transaction.meta.logMessages)];
}

/** Everything the suites compare before and after a refused call for one mint. */
export async function snapshot(mint, accounts = []) {
  const ledger = await readLedger(mint);
  const config = await readConfig();
  return JSON.stringify({
    count: config.depositCount.toString(),
    paused: config.depositsPaused,
    owner: config.owner.toBase58(),
    pending: config.pendingOwner.toBase58(),
    resolver: config.resolver.toBase58(),
    open: ledger.openTotal.toString(),
    vault: (await balance(addresses.vault(mint))).toString(),
    accounts: await Promise.all(
      accounts.map(async (account) => (await balance(account)).toString()),
    ),
  });
}

export { BN, TOKEN_PROGRAM_ID };
