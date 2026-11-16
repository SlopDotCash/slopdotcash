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
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  checkSolanaFunding,
  prepareSolanaFunding,
} from "../.local/funding.mjs";
import {
  prepareSolanaVaultCreation,
  verifySolanaVaultCreation,
} from "../.local/owner-creation.mjs";
import { buildInitializeVaultInstructions } from "../.local/owner-instructions.mjs";
import { ownerPlan } from "../scripts/owner-plan.mjs";
import {
  configFees,
  configIdentity,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

test("edge owner instructions create distinct vaults with atomic monthly choice and accept funds", {
  timeout: 600000,
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
  const minted = await mintTo(
    provider.connection,
    owner,
    mint,
    source.address,
    owner,
    30n,
  );
  await provider.connection.confirmTransaction(minted, "finalized");
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
  const infrastructure = {
    programId: base.programId,
    networkDomain: base.networkDomain,
    identityAuthority: base.identityAuthority,
    feeRecipient: base.feeRecipient,
    bindingDelaySeconds: base.bindingDelaySeconds,
    rotationDelaySeconds: base.rotationDelaySeconds,
    ...expectedDeployment,
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash,
    network: "solana-localnet",
  };
  // The first project is absent: neither preparation nor signature verification
  // may require a prior registered vault. Keep the reviewed Config/code checks.
  await assert.rejects(
    () =>
      prepareSolanaVaultCreation(
        {
          ...infrastructure,
          codeSha256: "0".repeat(64),
        },
        { ...base, monthlyCap: "20", automaticMonthly: true },
      ),
    /reviewed digest/,
  );
  await assert.rejects(
    () =>
      prepareSolanaVaultCreation(
        {
          ...infrastructure,
          feeRecipient: owner.publicKey.toBase58(),
        },
        { ...base, monthlyCap: "20", automaticMonthly: true },
      ),
    /pinned escrow Config/,
  );
  await assert.rejects(
    () =>
      prepareSolanaVaultCreation(
        {
          ...infrastructure,
          genesisHash: "different-cluster",
        },
        { ...base, monthlyCap: "20", automaticMonthly: true },
      ),
    /Wrong Solana cluster/,
  );
  await assert.rejects(
    () =>
      prepareSolanaVaultCreation(infrastructure, {
        ...base,
        networkDomain: hash("unreviewed-domain"),
        monthlyCap: "20",
        automaticMonthly: true,
      }),
    /creation policy differs/,
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
    assert.equal(
      await provider.connection.getAccountInfo(expectedProject, "finalized"),
      null,
    );
    const prepared = await prepareSolanaVaultCreation(infrastructure, input);
    assert.equal(prepared.existingVault, null);
    const transaction = Transaction.from(
      Buffer.from(prepared.transaction.transaction, "base64"),
    );
    assert.equal(transaction.signatures.length, 1);
    assert.equal(transaction.signatures[0].signature, null);
    assert.equal(transaction.signatures[0].publicKey.toBase58(), input.owner);
    assert.equal(transaction.instructions.length, bounty ? 1 : 2);
    assert.deepEqual(
      transaction.instructions.map(instructionRecord),
      referenceTx.instructions.map(instructionRecord),
    );
    // A real wallet adds its priority fee and may recompile the account order.
    // Creation recovery must still bind the exact application instructions.
    if (choice.name === "on")
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
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
    if (!bounty) {
      const changed = await program.methods
        .setMonthlyCommitment(new anchor.BN(30), !input.automaticMonthly)
        .accountsStrict({ owner: owner.publicKey, project: expectedProject })
        .rpc();
      await provider.connection.confirmTransaction(changed, "finalized");
      const current = await program.account.project.fetch(
        expectedProject,
        "finalized",
      );
      assert.equal(current.monthlyCap.toString(), "30");
      assert.equal(current.monthlyEnabled, !input.automaticMonthly);
    }
    const recovered = await prepareSolanaVaultCreation(
      infrastructure,
      input,
      true,
    );
    assert.equal(recovered.existingVault, plan.vault);
    assert.equal(recovered.transaction, null);
    assert.deepEqual(
      await verifySolanaVaultCreation(infrastructure, input, signature),
      {
        projectPda: plan.projectPda,
        vault: plan.vault,
      },
    );
    await assert.rejects(
      () =>
        verifySolanaVaultCreation(
          { ...infrastructure, networkDomain: hash("other-cluster-domain") },
          { ...input, networkDomain: hash("other-cluster-domain") },
          signature,
        ),
      /does not match the pending wallet action/,
    );
    if (!bounty)
      await assert.rejects(
        () =>
          verifySolanaVaultCreation(
            config,
            {
              ...input,
              monthlyCap: "30",
              automaticMonthly: !input.automaticMonthly,
            },
            signature,
          ),
        /does not match the pending wallet action/,
      );
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

  // A successful creation plus an additional transfer is not the reviewed action.
  const input = {
    ...base,
    projectDigest: hash("slop-project:edge-owner-extra-action"),
    monthlyCap: "20",
    automaticMonthly: true,
  };
  const prepared = await prepareSolanaVaultCreation(infrastructure, input);
  const transaction = Transaction.from(
    Buffer.from(prepared.transaction.transaction, "base64"),
  );
  transaction.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  );
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: configFees.publicKey,
      lamports: 1_000_000,
    }),
  );
  transaction.sign(owner);
  const signature = await provider.connection.sendRawTransaction(
    transaction.serialize(),
  );
  await provider.connection.confirmTransaction(signature, "finalized");
  assert.notEqual(
    await program.account.project.fetchNullable(
      new PublicKey(prepared.projectPda),
      "finalized",
    ),
    null,
  );
  await assert.rejects(
    () => verifySolanaVaultCreation(infrastructure, input, signature),
    /does not match the pending wallet action/,
  );
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
