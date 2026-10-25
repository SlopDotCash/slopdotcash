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
import {
  checkSolanaCommitment,
  prepareSolanaCommitment,
} from "../.local/commitment.mjs";
import {
  checkSolanaFunding,
  prepareSolanaFunding,
} from "../.local/funding.mjs";
import { handlePaymentsApi } from "../.local/handler.mjs";
import { listProjects, migratePlan } from "../scripts/config-plan.mjs";
import { awardIdFor, ownerPlan } from "../scripts/owner-plan.mjs";
import {
  configFees,
  configIdentity,
  configRotation,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";
import { legacyMint, legacyOwner, legacyProject } from "./legacy-project.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
test("unsigned owner plans initialize, fund, reserve, veto and withdraw on actual SPL program", {
  timeout: 480000,
}, async () => {
  const provider = anchor.AnchorProvider.env(),
    owner = provider.wallet.payer;
  await ensureConfig(
    new anchor.Program(
      JSON.parse(readFileSync("idl/slop_escrow.json")),
      provider,
    ),
  );
  // The identity authority and fee recipient are the ones pinned in Config.
  const identity = configIdentity,
    fees = configFees,
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
    // The claim-fees plan must create the fee recipient's account itself.
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
      JSON.parse(readFileSync("idl/slop_escrow.json")).address,
    ),
    projectDigest = hash("owner-plan-project");
  const project = PublicKey.findProgramAddressSync(
    [
      Buffer.from("project"),
      owner.publicKey.toBuffer(),
      Buffer.from(projectDigest, "hex"),
      Buffer.from([0]),
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
    ...expectedDeployment,
    bindingDelaySeconds: "3600",
    rotationDelaySeconds: "604800",
  };
  const expectedGenesis = await provider.connection.getGenesisHash();
  async function execute(operation, extra, signer = owner) {
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
    assert.equal(plan.requiredSigner, signer.publicKey.toBase58());
    const signature = await sendAndConfirmTransaction(
      provider.connection,
      transaction,
      [signer],
    );
    await provider.connection.confirmTransaction(signature, "finalized");
  }
  const fundingConfig = {
    ...deployment,
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: expectedGenesis,
    projectId: "owner-plan-project",
    network: "solana-localnet",
    mint: deployment.asset,
  };
  async function fundingApi(body, endpoint = "solana-funding") {
    const request = new Request(
      `https://slop.cash/api/v1/payments/projects/owner-plan-project/${endpoint}`,
      {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          network: "solana-localnet",
          vault: deployment.vault,
          ...body,
        }),
      },
    );
    const response = await handlePaymentsApi(request, {
      db: {
        prepare() {
          throw new Error(
            "Permissionless funding must not query a member session",
          );
        },
      },
      solanaFundingConfig: async (id, network, vault) => {
        assert.equal(id, "owner-plan-project");
        assert.equal(network, "solana-localnet");
        assert.equal(vault, deployment.vault);
        return fundingConfig;
      },
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(
      JSON.stringify(result).includes(provider.connection.rpcEndpoint),
      false,
    );
    return result;
  }
  async function executeFunding(operation, gross, signer = owner) {
    const intent = { operation, gross, wallet: signer.publicKey.toBase58() };
    const units = BigInt(gross);
    const amount = `${units / 1_000_000n}.${(units % 1_000_000n).toString().padStart(6, "0")}`;
    const { plan } = await fundingApi({ step: "review", ...intent, amount });
    assert.equal(
      JSON.stringify(plan).includes(provider.connection.rpcEndpoint),
      false,
    );
    const transaction = Transaction.from(
      Buffer.from(plan.transaction, "base64"),
    );
    assert.equal(
      transaction.signatures.every((s) => s.signature === null),
      true,
    );
    assert.equal(transaction.feePayer.toBase58(), signer.publicKey.toBase58());
    // Preserve the exact reviewed blockhash. sendAndConfirmTransaction replaces
    // it before signing, which is a different action from the pending intent.
    transaction.sign(signer);
    const signature = await provider.connection.sendRawTransaction(
      transaction.serialize(),
      { skipPreflight: false, maxRetries: 0 },
    );
    await provider.connection.confirmTransaction(signature, "finalized");
    assert.equal(
      (
        await fundingApi({
          step: "check",
          ...intent,
          blockhash: plan.blockhash,
          transactionId: signature,
        })
      ).status,
      "finalized",
    );
    await assert.rejects(
      checkSolanaFunding(
        fundingConfig,
        { ...plan, gross: String(BigInt(gross) + 1n) },
        signature,
      ),
      /does not match/,
    );
    return plan;
  }
  // initialize refuses a deployment whose authorities differ from the pinned Config.
  const pinned = deployment.feeRecipient;
  deployment.feeRecipient = Keypair.generate().publicKey.toBase58();
  await assert.rejects(
    execute("initialize", { projectDigest }),
    /pinned escrow Config/,
  );
  deployment.feeRecipient = pinned;
  await assert.rejects(
    execute("initialize", { projectDigest }),
    /positive u64/,
  );
  assert.equal(
    await provider.connection.getAccountInfo(project),
    null,
    "a missing cap creates no project",
  );
  await execute("initialize", { projectDigest, monthlyCap: "60000000" });
  const created = await new anchor.Program(
    JSON.parse(readFileSync("idl/slop_escrow.json")),
    provider,
  ).account.project.fetch(project, "finalized");
  assert.equal(
    created.monthlyEnabled,
    true,
    "creation enables monthly commitments",
  );
  assert.equal(created.monthlyCap.toString(), "60000000");
  const optOutDigest = hash("owner-plan-opt-out");
  const optOutProject = PublicKey.findProgramAddressSync(
    [
      Buffer.from("project"),
      owner.publicKey.toBuffer(),
      Buffer.from(optOutDigest, "hex"),
      Buffer.from([0]),
    ],
    programId,
  )[0];
  const optOutVault = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), optOutProject.toBuffer()],
    programId,
  )[0];
  const optOutPlan = await ownerPlan(
    {
      deployment: {
        ...deployment,
        projectPda: optOutProject.toBase58(),
        vault: optOutVault.toBase58(),
      },
      operation: "initialize",
      projectDigest: optOutDigest,
      monthlyCap: "60000000",
      automaticMonthly: false,
    },
    {
      rpcUrl: provider.connection.rpcEndpoint,
      expectedGenesis,
      recentBlockhash: (
        await provider.connection.getLatestBlockhash("finalized")
      ).blockhash,
    },
  );
  const optOutTransaction = Transaction.from(
    Buffer.from(optOutPlan.transactionBase64, "base64"),
  );
  assert.equal(
    optOutTransaction.instructions.length,
    2,
    "initialize and monthly policy are atomic",
  );
  const optOutSignature = await sendAndConfirmTransaction(
    provider.connection,
    optOutTransaction,
    [owner],
  );
  await provider.connection.confirmTransaction(optOutSignature, "finalized");
  const optedOut = await new anchor.Program(
    JSON.parse(readFileSync("idl/slop_escrow.json")),
    provider,
  ).account.project.fetch(optOutProject, "finalized");
  assert.equal(
    optedOut.monthlyEnabled,
    false,
    "creation preserves the owner's opt-out",
  );
  assert.equal(optedOut.monthlyCap.toString(), "60000000");
  // Exercise the browser's monthly-setting API against the actual SPL program.
  const monthlyEndpoint = "solana-monthly-commitment";
  for (const enabled of [false, true]) {
    const target = { cap: "60000000", enabled };
    const intent = { ...target, wallet: owner.publicKey.toBase58() };
    const { plan } = await fundingApi(
      { step: "review", ...intent },
      monthlyEndpoint,
    );
    assert.notEqual(plan.transaction, null);
    const transaction = Transaction.from(
      Buffer.from(plan.transaction.transaction, "base64"),
    );
    assert.equal(
      transaction.signatures.every((s) => s.signature === null),
      true,
    );
    transaction.sign(owner);
    const signature = await provider.connection.sendRawTransaction(
      transaction.serialize(),
      { skipPreflight: false, maxRetries: 0 },
    );
    await provider.connection.confirmTransaction(signature, "finalized");
    assert.equal(
      (
        await fundingApi(
          {
            step: "check",
            ...intent,
            blockhash: plan.transaction.blockhash,
            transactionId: signature,
          },
          monthlyEndpoint,
        )
      ).status,
      "finalized",
    );
    assert.deepEqual(
      (await fundingApi({ step: "read" }, monthlyEndpoint)).setting.current,
      target,
    );
    assert.equal(
      (await fundingApi({ step: "review", ...intent }, monthlyEndpoint)).plan
        .transaction,
      null,
      "the finalized setting needs no second signature",
    );
  }
  await execute("deposit", { grossMicro: "60000000" });
  // Any depositor can fund the project from its own token account.
  const donor = Keypair.generate();
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: donor.publicKey,
        lamports: 1_000_000_000,
      }),
    ),
    [owner],
  );
  const donorSource = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    mint,
    donor.publicKey,
  );
  const minted = await mintTo(
    provider.connection,
    owner,
    mint,
    donorSource.address,
    owner,
    40_000_000n,
  );
  await provider.connection.confirmTransaction(minted, "finalized");
  await assert.rejects(
    prepareSolanaFunding(fundingConfig, {
      operation: "deposit",
      wallet: donor.publicKey.toBase58(),
      gross: "40000001",
    }),
    /balance is too low/,
  );
  const deposit = await executeFunding("deposit", "40000000", donor);
  assert.equal(deposit.decimals, 6);
  assert.equal(deposit.fee, "0");
  await assert.rejects(
    prepareSolanaFunding(fundingConfig, {
      operation: "withdraw",
      wallet: donor.publicKey.toBase58(),
      gross: "1",
    }),
    /Only the vault owner's wallet/,
  );
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
  const commitmentIntent = {
    wallet: owner.publicKey.toBase58(),
    sourceDigest,
    githubUserId: "999",
    gross: "25000000",
  };
  await assert.rejects(
    prepareSolanaCommitment(fundingConfig, {
      ...commitmentIntent,
      wallet: donor.publicKey.toBase58(),
    }),
    /owner's wallet/,
  );
  await assert.rejects(
    prepareSolanaCommitment(fundingConfig, {
      ...commitmentIntent,
      gross: "100000001",
    }),
    /insufficient free funds/,
  );
  const commitment = await prepareSolanaCommitment(
    fundingConfig,
    commitmentIntent,
  );
  assert.equal(commitment.fee, "500000");
  assert.equal(commitment.net, "24500000");
  const unsigned = Transaction.from(
    Buffer.from(commitment.transaction, "base64"),
  );
  assert.equal(
    unsigned.signatures.every((s) => s.signature === null),
    true,
  );
  const cliCommitment = await ownerPlan(
    {
      deployment,
      operation: "commit",
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
    },
    {
      rpcUrl: provider.connection.rpcEndpoint,
      expectedGenesis,
      recentBlockhash: commitment.blockhash,
    },
  );
  const cliTransaction = Transaction.from(
    Buffer.from(cliCommitment.transactionBase64, "base64"),
  );
  assert.deepEqual(unsigned.instructions, cliTransaction.instructions);
  unsigned.sign(owner);
  const signature = await provider.connection.sendRawTransaction(
    unsigned.serialize(),
    { skipPreflight: false, maxRetries: 0 },
  );
  await provider.connection.confirmTransaction(signature, "finalized");
  assert.equal(
    await checkSolanaCommitment(fundingConfig, commitment, signature),
    "finalized",
  );
  await assert.rejects(
    checkSolanaCommitment(
      fundingConfig,
      { ...commitment, githubUserId: "1000" },
      signature,
    ),
    /does not match/,
  );
  await assert.rejects(
    prepareSolanaCommitment(fundingConfig, commitmentIntent),
    /already committed/,
  );
  // The identity authority and the destination wallet bind actor 999; the
  // owner vetoes it while pending.
  const program = new anchor.Program(
    JSON.parse(readFileSync("idl/slop_escrow.json")),
    provider,
  );
  const actor = new anchor.BN(999).toArrayLike(Buffer, "le", 8),
    version = new anchor.BN(1).toArrayLike(Buffer, "le", 8),
    wallet = Keypair.generate();
  await program.methods
    .bindWallet(
      new anchor.BN(999),
      [...Buffer.from(deployment.networkDomain, "hex")],
      new anchor.BN(0),
      [...Buffer.from(hash("owner-plan-claim"), "hex")],
      new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
    )
    .accountsStrict({
      payer: owner.publicKey,
      identityAuthority: identity.publicKey,
      destination: wallet.publicKey,
      project,
      binding: PublicKey.findProgramAddressSync(
        [Buffer.from("wallet"), project.toBuffer(), actor],
        programId,
      )[0],
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([identity, wallet])
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
  await assert.rejects(
    prepareSolanaFunding(fundingConfig, {
      operation: "withdraw",
      wallet: owner.publicKey.toBase58(),
      gross: "75000001",
    }),
    /free balance/,
  );
  const withdrawal = await executeFunding("withdraw", "75000000");
  assert.equal(withdrawal.freeBalance, "75000000");
  assert.equal(withdrawal.fee, "1500000");
  assert.equal(withdrawal.net, "73500000");
  // The withdrawal fee stays in the vault until claim_fees.
  assert.equal(
    (await getAccount(provider.connection, vault)).amount,
    26_500_000n,
  );
  // 2% of 75,000,000 is 1,500,000. The owner started with 100M and deposited 60M.
  assert.equal(
    (await getAccount(provider.connection, source.address)).amount,
    113_500_000n,
  );
  await assert.rejects(
    getAccount(provider.connection, feeAccount.address),
    /TokenAccountNotFound/,
  );
  await execute("claim-fees");
  assert.equal(
    (await getAccount(provider.connection, feeAccount.address)).amount,
    1_500_000n,
  );
  assert.equal(
    (await getAccount(provider.connection, vault)).amount,
    25_000_000n,
  );
  assert.equal(
    (
      await program.account.project.fetch(project, "finalized")
    ).accruedFees.toString(),
    "0",
  );
  // The owner's rotation plans, and the upgrade runbook's project list, which
  // marks a project in the current layout with the pinned fee recipient.
  const next = Keypair.generate().publicKey;
  await execute("propose-rotation", { nextIdentityAuthority: next.toBase58() });
  assert.equal(
    (
      await program.account.project.fetch(project, "finalized")
    ).pendingIdentityAuthority.toBase58(),
    next.toBase58(),
  );
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: configRotation.publicKey,
        lamports: 1_000_000,
      }),
    ),
    [owner],
  );
  await execute("confirm-rotation", {}, configRotation);
  assert.equal(
    (await program.account.project.fetch(project, "finalized"))
      .rotationConfirmed,
    true,
  );
  await execute("cancel-rotation");
  assert.equal(
    (
      await program.account.project.fetch(project, "finalized")
    ).pendingIdentityAuthority.toBase58(),
    anchor.web3.SystemProgram.programId.toBase58(),
  );
  const listed = await listProjects(
    { programId: programId.toBase58() },
    {
      rpcUrl: provider.connection.rpcEndpoint,
      expectedGenesis: await provider.connection.getGenesisHash(),
    },
  );
  const row = listed.projects.find((p) => p.address === project.toBase58());
  assert.equal(row.pinned, true);
  assert.equal(row.size, 332);
  assert.equal(row.migrationRequired, false);
});

// test-e2e.sh preloads a Project of the earlier 316-byte layout. The upgrade runbook
// lists it, plans its migration, and anyone grows it to the current layout once.
test("migrate_project grows a 316-byte Project to the current layout once", async () => {
  const provider = anchor.AnchorProvider.env(),
    payer = provider.wallet.payer,
    connection = provider.connection;
  const program = new anchor.Program(
    JSON.parse(readFileSync("idl/slop_escrow.json")),
    provider,
  );
  const config = await ensureConfig(program);
  const runtime = {
    rpcUrl: connection.rpcEndpoint,
    expectedGenesis: await connection.getGenesisHash(),
  };
  const setMonthly = () =>
    program.methods
      .setMonthlyCommitment(new anchor.BN(5), true)
      .accountsStrict({ owner: legacyOwner.publicKey, project: legacyProject })
      .signers([legacyOwner])
      .rpc();
  const migrate = (project) =>
    program.methods
      .migrateProject()
      .accountsStrict({
        payer: payer.publicKey,
        project,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  const legacyRow = async () =>
    (
      await listProjects({ programId: program.programId.toBase58() }, runtime)
    ).projects.find((p) => p.address === legacyProject.toBase58());
  let row = await legacyRow();
  assert.equal(row.size, 316);
  assert.equal(row.migrationRequired, true);
  assert.equal(row.pinned, false);
  assert.equal(row.owner, legacyOwner.publicKey.toBase58());
  assert.equal(row.mint, legacyMint.publicKey.toBase58());
  // No instruction reads the old layout before migration.
  await assert.rejects(setMonthly(), /AccountDidNotDeserialize/);
  // The planner builds one unsigned transaction per legacy project; any payer signs it.
  const block = await connection.getLatestBlockhash("finalized");
  const plan = await migratePlan(
    {
      programId: program.programId.toBase58(),
      payer: payer.publicKey.toBase58(),
      ...expectedDeployment,
    },
    { ...runtime, recentBlockhash: block.blockhash },
  );
  assert.equal(plan.requiredSigner, payer.publicKey.toBase58());
  const planned = plan.transactions.find(
    (t) => t.project === legacyProject.toBase58(),
  );
  assert.ok(planned);
  const transaction = Transaction.from(
    Buffer.from(planned.transactionBase64, "base64"),
  );
  transaction.sign(payer);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
  );
  await connection.confirmTransaction(signature, "finalized");
  const info = await connection.getAccountInfo(legacyProject, "finalized");
  assert.equal(info.data.length, 332);
  assert.ok(
    info.lamports >= (await connection.getMinimumBalanceForRentExemption(332)),
  );
  let state = await program.account.project.fetch(legacyProject, "finalized");
  assert.equal(state.accruedFees.toString(), "0");
  assert.equal(state.monthlyOutstanding.toString(), "0");
  assert.equal(state.owner.toBase58(), legacyOwner.publicKey.toBase58());
  assert.equal(state.mint.toBase58(), legacyMint.publicKey.toBase58());
  row = await legacyRow();
  assert.equal(row.size, 332);
  assert.equal(row.migrationRequired, false);
  assert.equal(row.pinned, true);
  // It migrates once, and only a legacy Project migrates.
  await assert.rejects(migrate(legacyProject), /NotLegacyProject/);
  await assert.rejects(migrate(config), /NotLegacyProject/);
  // The owner's instructions work on the migrated project.
  await setMonthly();
  state = await program.account.project.fetch(legacyProject);
  assert.equal(state.monthlyCap.toString(), "5");
  assert.equal(state.monthlyEnabled, true);
});
