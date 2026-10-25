import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  checkSolanaFunding,
  prepareSolanaFunding,
} from "../.local/funding.mjs";
import { buildInitializeVaultInstructions } from "../.local/owner-instructions.mjs";
import { message } from "../.local/transactions.mjs";
import { ownerPlan } from "../scripts/owner-plan.mjs";
import {
  configFees,
  configIdentity,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

test("edge owner instructions create distinct vaults with atomic monthly choice and accept funds", {
  timeout: 240000,
}, async () => {
  const provider = anchor.AnchorProvider.env();
  const owner = provider.wallet.payer;
  const program = new anchor.Program(
    JSON.parse(readFileSync("idl/slop_escrow.json")),
    provider,
  );
  await ensureConfig(program);
  const mint = await createMint(
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
  );
  await mintTo(provider.connection, owner, mint, source.address, owner, 30n);
  const genesisHash = await provider.connection.getGenesisHash();
  const projectId = "edge-owner-project";
  const projectDigest = hash(`slop-project:${projectId}`);
  const base = {
    programId: program.programId.toBase58(),
    owner: owner.publicKey.toBase58(),
    mint: mint.toBase58(),
    projectDigest,
    networkDomain: hash("edge-owner-domain"),
    identityAuthority: configIdentity.publicKey.toBase58(),
    feeRecipient: configFees.publicKey.toBase58(),
    bindingDelaySeconds: "3600",
    rotationDelaySeconds: "604800",
  };
  assert.throws(
    () => buildInitializeVaultInstructions({ ...base, monthlyCap: "20" }),
    /setting explicitly/,
  );
  assert.throws(
    () => buildInitializeVaultInstructions({ ...base, automaticMonthly: true }),
    /valid cap/,
  );
  assert.throws(
    () =>
      buildInitializeVaultInstructions({
        ...base,
        monthlyCap: "0",
        automaticMonthly: true,
      }),
    /valid cap/,
  );
  assert.throws(
    () =>
      buildInitializeVaultInstructions({
        ...base,
        payoutPolicy: "security-bounty",
        monthlyCap: "10",
      }),
    /no automatic monthly policy/,
  );
  const vaults = new Set();
  for (const choice of [
    { name: "on", monthlyCap: "20", automaticMonthly: true },
    {
      name: "opt-out",
      projectId: "edge-owner-opt-out",
      monthlyCap: "20",
      automaticMonthly: false,
    },
    { name: "bounty", payoutPolicy: "security-bounty" },
  ]) {
    const input = {
      ...base,
      ...choice,
      projectDigest: hash(`slop-project:${choice.projectId ?? projectId}`),
    };
    const plan = buildInitializeVaultInstructions(input);
    const bounty = input.payoutPolicy === "security-bounty";
    const expectedProject = PublicKey.findProgramAddressSync(
      [
        Buffer.from("project"),
        owner.publicKey.toBuffer(),
        Buffer.from(input.projectDigest, "hex"),
        Buffer.from([bounty ? 1 : 0]),
      ],
      program.programId,
    )[0];
    assert.equal(plan.projectPda, expectedProject.toBase58());
    assert.equal(
      vaults.has(plan.vault),
      false,
      "each purpose has a distinct vault",
    );
    vaults.add(plan.vault);
    const deployment = {
      ...base,
      ...expectedDeployment,
      projectPda: plan.projectPda,
      vault: plan.vault,
      asset: input.mint,
      payoutPolicy: input.payoutPolicy,
    };
    const block = await provider.connection.getLatestBlockhash("finalized");
    const reference = await ownerPlan(
      {
        deployment,
        operation: "initialize",
        projectDigest: input.projectDigest,
        monthlyCap: input.monthlyCap,
        automaticMonthly: input.automaticMonthly,
      },
      {
        rpcUrl: provider.connection.rpcEndpoint,
        expectedGenesis: genesisHash,
        recentBlockhash: block.blockhash,
      },
    );
    const referenceTx = Transaction.from(
      Buffer.from(reference.transactionBase64, "base64"),
    );
    const transaction = Transaction.from(
      Buffer.concat([
        Buffer.from([1]),
        Buffer.alloc(64),
        message(input.owner, block.blockhash, plan.instructions),
      ]),
    );
    assert.equal(transaction.signatures.length, 1);
    assert.equal(transaction.signatures[0].signature, null);
    assert.equal(transaction.signatures[0].publicKey.toBase58(), input.owner);
    assert.equal(transaction.instructions.length, bounty ? 1 : 2);
    assert.deepEqual(
      transaction.instructions.map(instructionRecord),
      referenceTx.instructions.map(instructionRecord),
    );
    transaction.sign(owner);
    const signature = await provider.connection.sendRawTransaction(
      transaction.serialize(),
    );
    await provider.connection.confirmTransaction(signature, "finalized");
    const state = await program.account.project.fetch(
      expectedProject,
      "finalized",
    );
    assert.equal(Boolean(state.purpose.bounty), bounty);
    assert.equal(
      state.monthlyEnabled,
      !bounty && input.automaticMonthly !== false,
    );
    assert.equal(state.monthlyCap.toString(), bounty ? "0" : input.monthlyCap);
    const config = {
      ...deployment,
      rpcUrl: provider.connection.rpcEndpoint,
      genesisHash,
      projectId: choice.projectId ?? projectId,
      network: "solana-localnet",
      mint: input.mint,
    };
    const funding = await prepareSolanaFunding(config, {
      operation: "deposit",
      wallet: input.owner,
      gross: "10",
    });
    const deposit = Transaction.from(
      Buffer.from(funding.transaction, "base64"),
    );
    deposit.sign(owner);
    const depositSignature = await provider.connection.sendRawTransaction(
      deposit.serialize(),
    );
    await provider.connection.confirmTransaction(depositSignature, "finalized");
    assert.equal(
      await checkSolanaFunding(config, funding, depositSignature),
      "finalized",
    );
    assert.equal(
      (
        await getAccount(
          provider.connection,
          new PublicKey(plan.vault),
          "finalized",
        )
      ).amount,
      10n,
    );
  }
});

function instructionRecord(instruction) {
  return {
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((key) => ({
      publicKey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: instruction.data.toString("hex"),
  };
}
