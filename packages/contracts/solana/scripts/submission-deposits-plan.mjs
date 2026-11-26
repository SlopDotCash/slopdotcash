#!/usr/bin/env node
/**
 * Read-only planner for the submission deposit program's deployment runbook
 * (docs/submission-deposits-solana-deploy-runbook.md). No key file, signing or broadcasting.
 *
 *   node scripts/submission-deposits-plan.mjs initialize reviewed-input.json
 *     Builds the unsigned `initialize` transaction that the program's upgrade authority
 *     signs once. The reclaim delay is fixed here at 30 days.
 *   node scripts/submission-deposits-plan.mjs vault reviewed-input.json
 *     Builds the unsigned `open_vault` transaction for `mint`, paid by `payer`.
 *   node scripts/submission-deposits-plan.mjs status reviewed-input.json
 *     Reads back the program's upgrade authority, its Config and the vault of `mint`.
 *   node scripts/submission-deposits-plan.mjs smoke-deposit reviewed-input.json
 *     Builds the unsigned `deposit` of the runbook's smoke test: one base unit of `mint`
 *     from `payer`, kept wallet `keptTo`, at the address of (`payer`, `smokeNonce`).
 *   node scripts/submission-deposits-plan.mjs smoke-resolve reviewed-input.json
 *     Builds the unsigned `resolve` that refunds that deposit, for the Config's resolver. It
 *     names the id stored in the record and refuses any deposit that is not one base unit.
 *
 * The input file holds `programId`, `upgradeAuthority` (null once removed), `codeSha256`,
 * `owner`, `resolver`, for the vault `mint` and `payer`, and for the smoke test `keptTo` and
 * `smokeNonce` (a decimal string). RPC URL, expected genesis and a
 * fresh blockhash come from SLOP_SOLANA_RPC_URL, SLOP_SOLANA_GENESIS and
 * SLOP_SOLANA_RECENT_BLOCKHASH. The output omits the RPC URL.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { verifyProgram } from "./owner-plan.mjs";

/** The delay every deployment fixes: 30 days, as on Base and Robinhood Chain. */
export const RECLAIM_DELAY_SECONDS = 30 * 86_400;
const UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const FORMAT = "solana-unsigned-legacy-transaction-v1";
/** The smoke test moves one base unit and nothing else can be planned here. */
export const SMOKE_AMOUNT = 1n;
/** A fixed item no pull request hashes to, so a reader never takes it for a fee. */
export const SMOKE_ITEM = createHash("sha256")
  .update("slop-submission-deposits:deployment-smoke-test")
  .digest();

async function connect(input, runtime) {
  const connection = new Connection(runtime.rpcUrl, "finalized");
  if (
    typeof runtime.expectedGenesis !== "string" ||
    (await connection.getGenesisHash()) !== runtime.expectedGenesis
  )
    throw new Error("Wrong cluster genesis");
  const idl = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../idl/slop_submission_deposits.json", import.meta.url),
      ),
    ),
  );
  if (idl.address !== input.programId)
    throw new Error("IDL program identity mismatch");
  const program = new anchor.Program(idl, { connection });
  const address = (...seeds) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  return {
    connection,
    program,
    config: address(Buffer.from("config")),
    ledger: (mint) => address(Buffer.from("ledger"), mint.toBuffer()),
    vault: (mint) => address(Buffer.from("vault"), mint.toBuffer()),
    deposit: (payer, nonce) => {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64LE(nonce);
      return address(Buffer.from("deposit"), payer.toBuffer(), bytes);
    },
  };
}

const unsigned = (feePayer, recentBlockhash, instruction) =>
  new Transaction({ feePayer, recentBlockhash })
    .add(instruction)
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

/** The unsigned `initialize` transaction for the reviewed upgrade authority. */
export async function initializePlan(input, runtime) {
  if (typeof input.upgradeAuthority !== "string")
    throw new Error("initialize needs the current upgrade authority");
  const { connection, program, config } = await connect(input, runtime);
  await verifyProgram(connection, program.programId, input);
  const authority = new PublicKey(input.upgradeAuthority),
    owner = new PublicKey(input.owner),
    resolver = new PublicKey(input.resolver);
  if (
    owner.equals(PublicKey.default) ||
    resolver.equals(PublicKey.default) ||
    owner.equals(resolver)
  )
    throw new Error("Owner and resolver must be nonzero and distinct");
  if (await connection.getAccountInfo(config, "finalized"))
    throw new Error("Config already exists; its delay cannot change");
  const instruction = await program.methods
    .initialize(owner, resolver, new anchor.BN(RECLAIM_DELAY_SECONDS))
    .accountsStrict({
      authority,
      config,
      program: program.programId,
      programData: PublicKey.findProgramAddressSync(
        [program.programId.toBuffer()],
        UPGRADEABLE_LOADER,
      )[0],
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const blockhash = new PublicKey(runtime.recentBlockhash).toBase58();
  return {
    format: FORMAT,
    programId: input.programId,
    operation: "initialize",
    config: config.toBase58(),
    owner: owner.toBase58(),
    resolver: resolver.toBase58(),
    reclaimDelaySeconds: RECLAIM_DELAY_SECONDS,
    requiredSigner: authority.toBase58(),
    recentBlockhash: blockhash,
    transactionBase64: unsigned(authority, blockhash, instruction),
  };
}

/** The unsigned `open_vault` transaction for one classic SPL mint. Any key may pay. */
export async function vaultPlan(input, runtime) {
  const { connection, program, ledger, vault } = await connect(input, runtime);
  await verifyProgram(connection, program.programId, input);
  const mint = new PublicKey(input.mint),
    payer = new PublicKey(input.payer);
  const info = await connection.getParsedAccountInfo(mint, "finalized");
  if (
    !info.value?.owner.equals(TOKEN_PROGRAM_ID) ||
    info.value.data?.parsed?.type !== "mint"
  )
    throw new Error("The mint is not a classic SPL Token mint");
  if (await connection.getAccountInfo(ledger(mint), "finalized"))
    throw new Error("This mint's vault is already open");
  const instruction = await program.methods
    .openVault()
    .accountsStrict({
      funder: payer,
      mint,
      ledger: ledger(mint),
      vault: vault(mint),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const blockhash = new PublicKey(runtime.recentBlockhash).toBase58();
  return {
    format: FORMAT,
    programId: input.programId,
    operation: "open-vault",
    mint: mint.toBase58(),
    decimals: info.value.data.parsed.info.decimals,
    freezeAuthority: info.value.data.parsed.info.freezeAuthority ?? null,
    ledger: ledger(mint).toBase58(),
    vault: vault(mint).toBase58(),
    requiredSigner: payer.toBase58(),
    recentBlockhash: blockhash,
    transactionBase64: unsigned(payer, blockhash, instruction),
  };
}

function smokeInput(input) {
  if (
    typeof input.smokeNonce !== "string" ||
    !/^\d{1,20}$/.test(input.smokeNonce)
  )
    throw new Error("smokeNonce must be a decimal string");
  const nonce = BigInt(input.smokeNonce);
  if (nonce > 0xffff_ffff_ffff_ffffn)
    throw new Error("smokeNonce does not fit in 64 bits");
  return {
    nonce,
    mint: new PublicKey(input.mint),
    payer: new PublicKey(input.payer),
  };
}

/** The unsigned one-base-unit `deposit` of the smoke test, signed by `payer`. */
export async function smokeDepositPlan(input, runtime) {
  const { connection, program, config, ledger, vault, deposit } = await connect(
    input,
    runtime,
  );
  await verifyProgram(connection, program.programId, input);
  const { nonce, mint, payer } = smokeInput(input);
  const keptTo = new PublicKey(input.keptTo);
  const stored = await program.account.config.fetchNullable(
    config,
    "finalized",
  );
  if (!stored) throw new Error("No Config: initialize has not landed");
  if (stored.depositsPaused) throw new Error("Deposits are paused");
  if (!(await connection.getAccountInfo(ledger(mint), "finalized")))
    throw new Error("This mint's vault is not open");
  const address = deposit(payer, nonce);
  if (await connection.getAccountInfo(address, "finalized"))
    throw new Error("A deposit is already open at this payer and nonce");
  const instruction = await program.methods
    .deposit(
      [...SMOKE_ITEM],
      new anchor.BN(SMOKE_AMOUNT.toString()),
      keptTo,
      new anchor.BN(nonce.toString()),
    )
    .accountsStrict({
      payer,
      config,
      ledger: ledger(mint),
      mint,
      source: getAssociatedTokenAddressSync(mint, payer),
      vault: vault(mint),
      deposit: address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const blockhash = new PublicKey(runtime.recentBlockhash).toBase58();
  return {
    format: FORMAT,
    programId: input.programId,
    operation: "smoke-deposit",
    mint: mint.toBase58(),
    amount: SMOKE_AMOUNT.toString(),
    keptTo: keptTo.toBase58(),
    nonce: nonce.toString(),
    deposit: address.toBase58(),
    depositCountBefore: stored.depositCount.toString(),
    requiredSigner: payer.toBase58(),
    recentBlockhash: blockhash,
    transactionBase64: unsigned(payer, blockhash, instruction),
  };
}

/** The unsigned `resolve` that refunds the smoke deposit, signed by the Config's resolver,
 * which also pays the transaction fee. */
export async function smokeResolvePlan(input, runtime) {
  const { connection, program, config, ledger, vault, deposit } = await connect(
    input,
    runtime,
  );
  await verifyProgram(connection, program.programId, input);
  const { nonce, mint, payer } = smokeInput(input);
  const stored = await program.account.config.fetchNullable(
    config,
    "finalized",
  );
  if (!stored) throw new Error("No Config: initialize has not landed");
  if (stored.resolver.toBase58() !== input.resolver)
    throw new Error("The Config's resolver is not the reviewed resolver");
  const address = deposit(payer, nonce);
  const record = await program.account.deposit.fetchNullable(
    address,
    "finalized",
  );
  if (!record) throw new Error("No open deposit at this payer and nonce");
  if (
    record.amount.toString() !== SMOKE_AMOUNT.toString() ||
    !record.mint.equals(mint) ||
    !Buffer.from(record.item).equals(SMOKE_ITEM)
  )
    throw new Error("The deposit at this address is not the smoke deposit");
  const instruction = await program.methods
    .resolve(true, record.id)
    .accountsStrict({
      resolver: stored.resolver,
      config,
      deposit: address,
      ledger: ledger(mint),
      mint,
      vault: vault(mint),
      destination: getAssociatedTokenAddressSync(mint, payer),
      payer,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const blockhash = new PublicKey(runtime.recentBlockhash).toBase58();
  return {
    format: FORMAT,
    programId: input.programId,
    operation: "smoke-resolve",
    deposit: address.toBase58(),
    depositId: record.id.toString(),
    refund: true,
    refundTo: getAssociatedTokenAddressSync(mint, payer).toBase58(),
    requiredSigner: stored.resolver.toBase58(),
    recentBlockhash: blockhash,
    transactionBase64: unsigned(stored.resolver, blockhash, instruction),
  };
}

/** What is on chain now: the code, who can still replace it, the Config and one vault. */
export async function status(input, runtime) {
  const { connection, program, config, ledger, vault } = await connect(
    input,
    runtime,
  );
  await verifyProgram(connection, program.programId, input);
  const stored = await program.account.config.fetchNullable(
    config,
    "finalized",
  );
  const result = {
    programId: input.programId,
    codeSha256: input.codeSha256,
    upgradeAuthority: input.upgradeAuthority,
    upgradeable: input.upgradeAuthority !== null,
    config: stored
      ? {
          address: config.toBase58(),
          owner: stored.owner.toBase58(),
          pendingOwner: stored.pendingOwner.equals(PublicKey.default)
            ? null
            : stored.pendingOwner.toBase58(),
          resolver: stored.resolver.toBase58(),
          reclaimDelaySeconds: stored.reclaimDelay.toNumber(),
          depositCount: stored.depositCount.toString(),
          depositsPaused: stored.depositsPaused,
        }
      : null,
  };
  if (typeof input.mint === "string") {
    const mint = new PublicKey(input.mint);
    const opened = await program.account.ledger.fetchNullable(
      ledger(mint),
      "finalized",
    );
    const balance = opened
      ? await connection.getTokenAccountBalance(vault(mint), "finalized")
      : null;
    result.vault = opened
      ? {
          mint: mint.toBase58(),
          ledger: ledger(mint).toBase58(),
          address: vault(mint).toBase58(),
          openTotal: opened.openTotal.toString(),
          balance: balance.value.amount,
        }
      : null;
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, file] = process.argv.slice(2);
  const modes = {
    initialize: initializePlan,
    vault: vaultPlan,
    status,
    "smoke-deposit": smokeDepositPlan,
    "smoke-resolve": smokeResolvePlan,
  };
  if (!Object.hasOwn(modes, mode) || !file)
    throw new Error(
      "Usage: node submission-deposits-plan.mjs initialize|vault|status|smoke-deposit|smoke-resolve reviewed-input.json",
    );
  const input = JSON.parse(readFileSync(file, "utf8"));
  const runtime = {
    rpcUrl: process.env.SLOP_SOLANA_RPC_URL,
    expectedGenesis: process.env.SLOP_SOLANA_GENESIS,
    recentBlockhash: process.env.SLOP_SOLANA_RECENT_BLOCKHASH,
  };
  process.stdout.write(`${JSON.stringify(await modes[mode](input, runtime), null, 2)}\n`);
}
