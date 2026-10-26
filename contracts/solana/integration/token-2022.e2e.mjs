import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { readVaultTotals, solanaAwardId } from "../.local/adapter.mjs";
import {
  configAddress,
  configFees,
  configIdentity,
  ensureConfig,
} from "./deployment.mjs";

const { AnchorProvider, Program, BN } = anchor;
const provider = AnchorProvider.env(),
  payer = provider.wallet.payer;
const program = new Program(
  JSON.parse(readFileSync("target/idl/slop_escrow.json")),
  provider,
);
const digest = (text) => createHash("sha256").update(text).digest();
const pda = (...seeds) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const mint = new PublicKey("3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh");
const tokenProgram = TOKEN_2022_PROGRAM_ID;
const source = getAssociatedTokenAddressSync(
  mint,
  payer.publicKey,
  false,
  tokenProgram,
);
const bn = (value) => new BN(value.toString());

test("synthetic metadata mint state: owner deposit/withdraw/claim preserve reserved Token-2022 funds", async () => {
  await ensureConfig(program);
  const projectId = digest(`metadata:${Date.now()}`),
    network = digest("solana:localnet");
  const project = pda(
    Buffer.from("project"),
    payer.publicKey.toBuffer(),
    projectId,
    Buffer.of(0),
  );
  const vault = pda(Buffer.from("vault"), project.toBuffer());
  const initialize = (selectedProgram) =>
    program.methods
      .initialize(
        [...projectId],
        [...network],
        configIdentity.publicKey,
        configFees.publicKey,
        bn(0),
        bn(0),
        { ordinary: {} },
      )
      .accountsStrict({
        owner: payer.publicKey,
        project,
        mint,
        vault,
        tokenProgram: selectedProgram,
        systemProgram: SystemProgram.programId,
        config: configAddress(program.programId),
      })
      .rpc();
  await assert.rejects(initialize(TOKEN_PROGRAM_ID), /WrongMint/);
  await initialize(tokenProgram);
  const balance = async (address) =>
    (await getAccount(provider.connection, address, "confirmed", tokenProgram))
      .amount;
  const before = await balance(source),
    deposited = 1_000_000_000n;
  const deposit = (selectedProgram) =>
    program.methods
      .deposit(bn(deposited))
      .accountsStrict({
        depositor: payer.publicKey,
        project,
        mint,
        source,
        vault,
        tokenProgram: selectedProgram,
      })
      .rpc();
  await assert.rejects(deposit(TOKEN_PROGRAM_ID), /WrongMint/);
  await deposit(tokenProgram);
  assert.equal(await balance(vault), deposited);
  assert.equal(await balance(source), before - deposited);
  const sourceDigest = digest("metadata-reserved-local-fixture");
  const award = Buffer.from(
    solanaAwardId(project.toBase58(), sourceDigest.toString("hex")),
    "hex",
  );
  const reserved = 100_000_000n;
  await program.methods
    .commit([...award], [...sourceDigest], bn(77), bn(reserved))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      vault,
      obligation: pda(Buffer.from("award"), project.toBuffer(), award),
      origin: pda(Buffer.from("origin"), project.toBuffer(), sourceDigest),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  const withdraw = (gross) =>
    program.methods
      .withdraw(bn(gross))
      .accountsStrict({
        owner: payer.publicKey,
        project,
        mint,
        vault,
        destination: source,
        tokenProgram,
      })
      .rpc();
  await assert.rejects(
    withdraw(deposited - reserved + 1n),
    /InsufficientFreeBalance/,
  );
  const gross = 400_000_000n,
    fee = 8_000_000n;
  await withdraw(gross);
  assert.equal(await balance(source), before - deposited + gross - fee);
  assert.equal(await balance(vault), deposited - gross + fee);
  const accrued = await program.account.project.fetch(project);
  assert.equal(accrued.reserved.toString(), reserved.toString());
  assert.equal(accrued.accruedFees.toString(), fee.toString());
  const feeAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    configFees.publicKey,
    false,
    "confirmed",
    undefined,
    tokenProgram,
  );
  const claimed = await program.methods
    .claimFees()
    .accountsStrict({
      project,
      mint,
      vault,
      feeAccount: feeAccount.address,
      tokenProgram,
    })
    .rpc();
  await provider.connection.confirmTransaction(claimed, "finalized");
  assert.equal(await balance(feeAccount.address), fee);
  assert.equal(await balance(vault), deposited - gross);
  const totals = await readVaultTotals({
    rpcUrl: provider.connection.rpcEndpoint,
    network: "solana:localnet",
    projectPda: project.toBase58(),
    programId: program.programId.toBase58(),
  });
  assert.equal(totals.asset, mint.toBase58());
  assert.equal(totals.decimals, 6);
  assert.equal(totals.freeBalance, (deposited - gross - reserved).toString());
  assert.equal(totals.reserved, reserved.toString());
  assert.equal(totals.accruedFees, "0");
});
