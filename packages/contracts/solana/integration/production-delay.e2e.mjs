import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  createAccount,
  createMint,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { configPlan } from "../scripts/config-plan.mjs";
import {
  configAddress,
  configFees,
  configIdentity,
  configRotation,
  expectedDeployment,
  initializeConfig,
} from "./deployment.mjs";

// Runs only against the deployable build (no `short-delay-for-tests` feature).
const { AnchorProvider, Program, BN } = anchor;
const provider = AnchorProvider.env();
const payer = provider.wallet.payer;
const program = new Program(
  JSON.parse(readFileSync("target/idl/slop_escrow.json")),
  provider,
);
const hash = (s) => [...createHash("sha256").update(s).digest()];
const pda = (...seeds) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];

// This suite runs first on a fresh validator, before any Config exists.
test("only the upgrade authority initializes the Config, exactly once", async () => {
  const stranger = Keypair.generate();
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: stranger.publicKey,
        lamports: 1_000_000_000,
      }),
    ),
    [payer],
  );
  await assert.rejects(
    initializeConfig(program, { authority: stranger }),
    /NotUpgradeAuthority/,
  );
  assert.equal(
    await provider.connection.getAccountInfo(configAddress(program.programId)),
    null,
  );
  // The identity authority and the fee recipient must be distinct, non-default keys.
  await assert.rejects(
    initializeConfig(program, { fees: configIdentity.publicKey }),
    /InvalidIdentity/,
  );
  await assert.rejects(
    initializeConfig(program, { rotation: configFees.publicKey }),
    /InvalidIdentity/,
  );
  await assert.rejects(
    initializeConfig(program, { rotation: configIdentity.publicKey }),
    /InvalidIdentity/,
  );
  // The human runbook path: config-plan builds the unsigned transaction and the
  // upgrade authority signs it.
  const reviewed = {
    programId: program.programId.toBase58(),
    ...expectedDeployment,
    identityAuthority: configIdentity.publicKey.toBase58(),
    feeRecipient: configFees.publicKey.toBase58(),
  };
  const runtime = async () => ({
    rpcUrl: provider.connection.rpcEndpoint,
    expectedGenesis: await provider.connection.getGenesisHash(),
    recentBlockhash: (await provider.connection.getLatestBlockhash()).blockhash,
  });
  const plan = await configPlan(reviewed, await runtime());
  assert.equal(plan.requiredSigner, payer.publicKey.toBase58());
  const transaction = Transaction.from(
    Buffer.from(plan.transactionBase64, "base64"),
  );
  assert.equal(
    transaction.signatures.every((s) => s.signature === null),
    true,
  );
  await provider.connection.confirmTransaction(
    await sendAndConfirmTransaction(provider.connection, transaction, [payer]),
    "finalized",
  );
  await assert.rejects(
    configPlan(reviewed, await runtime()),
    /Config already exists/,
  );
  const config = await program.account.config.fetch(
    configAddress(program.programId),
  );
  assert.equal(
    config.identityAuthority.toBase58(),
    configIdentity.publicKey.toBase58(),
  );
  assert.equal(config.feeRecipient.toBase58(), configFees.publicKey.toBase58());
  assert.equal(
    config.rotationAuthority.toBase58(),
    configRotation.publicKey.toBase58(),
  );
  // No second initialization, and no update instruction exists.
  await assert.rejects(initializeConfig(program), /already in use|0x0/);
  await assert.rejects(
    initializeConfig(program, {
      identity: Keypair.generate().publicKey,
      fees: Keypair.generate().publicKey,
    }),
    /already in use|0x0/,
  );
});

test("the deployable build permits immediate payment and rotation and rejects invalid delay bounds", async () => {
  const mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
  );
  const initialize = (delay, rotationDelay = 3600) => {
    const id = hash(`production-delay:${delay}:${rotationDelay}`);
    const project = pda(
      Buffer.from("project"),
      payer.publicKey.toBuffer(),
      Buffer.from(id),
      Buffer.from([0]),
    );
    return program.methods
      .initialize(
        id,
        hash("solana:localnet:escrow-v2"),
        configIdentity.publicKey,
        configFees.publicKey,
        new BN(delay),
        new BN(rotationDelay),
        { ordinary: {} },
      )
      .accountsStrict({
        owner: payer.publicKey,
        project,
        mint,
        vault: pda(Buffer.from("vault"), project.toBuffer()),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        config: configAddress(program.programId),
      })
      .rpc();
  };
  await assert.rejects(initialize(-1), /InvalidDelay/);
  await assert.rejects(initialize(30 * 86400 + 1), /InvalidDelay/);
  await assert.rejects(initialize(0, -1), /InvalidDelay/);
  await assert.rejects(initialize(0, 90 * 86400 + 1), /InvalidDelay/);
  await initialize(0, 0);
  const project = pda(
    Buffer.from("project"),
    payer.publicKey.toBuffer(),
    Buffer.from(hash("production-delay:0:0")),
    Buffer.from([0]),
  );
  const vault = pda(Buffer.from("vault"), project.toBuffer());
  const wallet = Keypair.generate();
  const source = await createAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey,
  );
  const destination = await createAccount(
    provider.connection,
    payer,
    mint,
    wallet.publicKey,
  );
  const feeAccount = await createAccount(
    provider.connection,
    payer,
    mint,
    configFees.publicKey,
  );
  await mintTo(provider.connection, payer, mint, source, payer, 1000n);
  await program.methods
    .deposit(new BN(1000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const origin = Buffer.from(hash("immediate-payment"));
  const awardId = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("slop-escrow-award"),
        project.toBuffer(),
        origin,
      ]),
    )
    .digest();
  const actorSeed = new BN(101).toArrayLike(Buffer, "le", 8);
  const obligation = pda(Buffer.from("award"), project.toBuffer(), awardId);
  const binding = pda(Buffer.from("wallet"), project.toBuffer(), actorSeed);
  const commit = await program.methods
    .commit([...awardId], [...origin], new BN(101), new BN(1000))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      vault,
      obligation,
      origin: pda(Buffer.from("origin"), project.toBuffer(), origin),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const bind = await program.methods
    .bindWallet(
      new BN(101),
      hash("solana:localnet:escrow-v2"),
      new BN(0),
      hash("immediate-claim"),
      new BN(Math.floor(Date.now() / 1000) + 3600),
    )
    .accountsStrict({
      payer: payer.publicKey,
      identityAuthority: configIdentity.publicKey,
      destination: wallet.publicKey,
      project,
      binding,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const payAccounts = {
    project,
    obligation,
    binding,
    mint,
    vault,
    destination,
    tokenProgram: TOKEN_PROGRAM_ID,
    veto: pda(
      Buffer.from("veto"),
      project.toBuffer(),
      actorSeed,
      new BN(1).toArrayLike(Buffer, "le", 8),
    ),
  };
  const pay = await program.methods
    .pay(new BN(1))
    .accountsStrict(payAccounts)
    .instruction();
  // Same transaction: no slot or time can pass between commitment, binding and payment.
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(commit, bind, pay),
    [payer, configIdentity, wallet],
  );
  assert.equal(
    (await getAccount(provider.connection, destination)).amount,
    980n,
  );
  // The fee accrues in the vault; anyone moves it to the fee recipient's account.
  assert.equal(
    (await program.account.project.fetch(project)).accruedFees.toString(),
    "20",
  );
  assert.equal((await getAccount(provider.connection, feeAccount)).amount, 0n);
  await program.methods
    .claimFees()
    .accountsStrict({
      project,
      mint,
      vault,
      feeAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  assert.equal((await getAccount(provider.connection, feeAccount)).amount, 20n);
  assert.equal(
    (await program.account.project.fetch(project)).reserved.toString(),
    "0",
  );
  await assert.rejects(
    program.methods.pay(new BN(1)).accountsStrict(payAccounts).rpc(),
    /AlreadyPaid/,
  );
  const next = Keypair.generate().publicKey;
  const propose = await program.methods
    .proposeAuthorityRotation(next)
    .accountsStrict({
      owner: payer.publicKey,
      project,
      config: configAddress(program.programId),
    })
    .instruction();
  const confirm = await program.methods
    .confirmAuthorityRotation()
    .accountsStrict({
      rotationAuthority: configRotation.publicKey,
      project,
      config: configAddress(program.programId),
    })
    .instruction();
  const execute = await program.methods
    .executeAuthorityRotation()
    .accountsStrict({ project })
    .instruction();
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(propose, confirm, execute),
    [payer, configRotation],
  );
  assert.equal(
    (await program.account.project.fetch(project)).identityAuthority.toBase58(),
    next.toBase58(),
  );
});
