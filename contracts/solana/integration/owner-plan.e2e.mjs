import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { awardIdFor, ownerPlan } from "../scripts/owner-plan.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
test("unsigned owner plans initialize, fund, reserve, veto and withdraw on actual SPL program", {
  timeout: 120000,
}, async () => {
  const provider = anchor.AnchorProvider.env(),
    owner = provider.wallet.payer;
  const identity = Keypair.generate(),
    fees = Keypair.generate(),
    mint = await createMint(
      provider.connection,
      owner,
      owner.publicKey,
      null,
      6,
    );
  const source = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner,
      mint,
      owner.publicKey,
    ),
    // The withdraw plan must create the fee recipient's account itself.
    feeAccount = {
      address: getAssociatedTokenAddressSync(mint, fees.publicKey),
    };
  await mintTo(
    provider.connection,
    owner,
    mint,
    source.address,
    owner,
    100_000_000n,
  );
  const programId = new PublicKey(
      "5KFQm1jLFkcS1V5PFpUFg6omNHoDQZTaxqTwwEpnenSL",
    ),
    projectDigest = hash("owner-plan-project");
  const project = PublicKey.findProgramAddressSync(
    [
      Buffer.from("project"),
      owner.publicKey.toBuffer(),
      Buffer.from(projectDigest, "hex"),
    ],
    programId,
  )[0];
  const vault = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), project.toBuffer()],
    programId,
  )[0];
  const deployment = {
    programId: programId.toBase58(),
    projectPda: project.toBase58(),
    networkDomain: hash("owner-plan-domain"),
    vault: vault.toBase58(),
    asset: mint.toBase58(),
    owner: owner.publicKey.toBase58(),
    identityAuthority: identity.publicKey.toBase58(),
    feeRecipient: fees.publicKey.toBase58(),
    codeSha256: hash(readFileSync("target/deploy/slop_escrow.so")),
    upgradeAuthority: "11111111111111111111111111111111",
    bindingDelaySeconds: "3600",
  };
  const expectedGenesis = await provider.connection.getGenesisHash();
  async function execute(operation, extra) {
    const block = await provider.connection.getLatestBlockhash("finalized");
    const plan = await ownerPlan(
      { deployment, operation, ...extra },
      {
        rpcUrl: provider.connection.rpcEndpoint,
        expectedGenesis,
        recentBlockhash: block.blockhash,
      },
    );
    assert.equal(
      JSON.stringify(plan).includes(provider.connection.rpcEndpoint),
      false,
    );
    const transaction = Transaction.from(
      Buffer.from(plan.transactionBase64, "base64"),
    );
    assert.equal(
      transaction.signatures.every((s) => s.signature === null),
      true,
    );
    const signature = await sendAndConfirmTransaction(
      provider.connection,
      transaction,
      [owner],
    );
    await provider.connection.confirmTransaction(signature, "finalized");
  }
  await execute("initialize", { projectDigest });
  await execute("deposit", { grossMicro: "100000000" });
  const sourceDigest = hash("owner-plan-source");
  await assert.rejects(
    execute("commit", {
      awards: [
        {
          awardId: hash("owner-plan-award"),
          sourceDigest,
          githubUserId: "999",
          grossMicro: "25000000",
        },
      ],
    }),
    /not bound to this project/,
  );
  await execute("commit", {
    awards: [
      {
        awardId: Buffer.from(
          awardIdFor(project, Buffer.from(sourceDigest, "hex")),
        ).toString("hex"),
        sourceDigest,
        githubUserId: "999",
        grossMicro: "25000000",
      },
    ],
  });
  // The identity authority binds actor 999; the owner vetoes it while pending.
  const program = new anchor.Program(
    JSON.parse(readFileSync("idl/slop_escrow.json")),
    provider,
  );
  const actor = new anchor.BN(999).toArrayLike(Buffer, "le", 8),
    version = new anchor.BN(1).toArrayLike(Buffer, "le", 8);
  await program.methods
    .bindWallet(
      new anchor.BN(999),
      [...Buffer.from(deployment.networkDomain, "hex")],
      new anchor.BN(0),
      Keypair.generate().publicKey,
      [...Buffer.from(hash("owner-plan-claim"), "hex")],
    )
    .accountsStrict({
      payer: owner.publicKey,
      identityAuthority: identity.publicKey,
      project,
      binding: PublicKey.findProgramAddressSync(
        [
          Buffer.from("wallet"),
          identity.publicKey.toBuffer(),
          Buffer.from(deployment.networkDomain, "hex"),
          actor,
        ],
        programId,
      )[0],
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([identity])
    .rpc();
  await execute("veto", { githubUserId: "999", bindingVersion: "1" });
  assert.ok(
    await provider.connection.getAccountInfo(
      PublicKey.findProgramAddressSync(
        [Buffer.from("veto"), project.toBuffer(), actor, version],
        programId,
      )[0],
      "finalized",
    ),
  );
  await execute("withdraw", { grossMicro: "75000000" });
  assert.equal(
    (await getAccount(provider.connection, vault)).amount,
    25_000_000n,
  );
  assert.equal(
    (await getAccount(provider.connection, source.address)).amount,
    67_500_000n,
  );
  assert.equal(
    (await getAccount(provider.connection, feeAccount.address)).amount,
    7_500_000n,
  );
});
