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
 *
 * The input file holds `programId`, `upgradeAuthority` (null once removed), `codeSha256`,
 * `owner`, `resolver`, and for the vault `mint` and `payer`. RPC URL, expected genesis and a
 * fresh blockhash come from SLOP_SOLANA_RPC_URL, SLOP_SOLANA_GENESIS and
 * SLOP_SOLANA_RECENT_BLOCKHASH. The output omits the RPC URL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
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

/** What is on chain now: the code, who can still replace it, the Config and one vault. */
export async function status(input, runtime) {
  const { connection, program, config, ledger, vault } = await connect(
    input,
    runtime,
  );
  await verifyProgram(connection, program.programId, input);
  const stored = await program.account.config.fetchNullable(config, "finalized");
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
  if (!["initialize", "vault", "status"].includes(mode) || !file)
    throw new Error(
      "Usage: node submission-deposits-plan.mjs initialize|vault|status reviewed-input.json",
    );
  const input = JSON.parse(readFileSync(file, "utf8"));
  const runtime = {
    rpcUrl: process.env.SLOP_SOLANA_RPC_URL,
    expectedGenesis: process.env.SLOP_SOLANA_GENESIS,
    recentBlockhash: process.env.SLOP_SOLANA_RECENT_BLOCKHASH,
  };
  console.log(
    JSON.stringify(
      mode === "initialize"
        ? await initializePlan(input, runtime)
        : mode === "vault"
          ? await vaultPlan(input, runtime)
          : await status(input, runtime),
      null,
      2,
    ),
  );
}
