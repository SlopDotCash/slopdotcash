import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  escrowInvocations,
  readVaultTotals,
  SOLANA_NATIVE_ASSET,
  solanaAllocationProof,
  solanaAllocationRoot,
  solanaAwardId,
  solanaMonthlyMessage,
  solanaPaymentAdapter,
  solanaRpc,
} from "../.local/adapter.mjs";
import { submitPermissionlessSolanaPayment } from "../.local/executor.mjs";
import {
  checkSolanaFunding,
  prepareSolanaFunding,
} from "../.local/funding.mjs";
import {
  prepareSolanaVaultCreation,
  verifySolanaVaultCreation,
} from "../.local/owner-creation.mjs";
import {
  configFees,
  configIdentity,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const bn = (value) => new anchor.BN(String(value));
const raw = (value) => [...Buffer.from(value, "hex")];

test("native SOL vault creates, accepts real SOL, reserves, pays, withdraws and claims only credited funds above rent", {
  timeout: 600000,
}, async () => {
  const provider = anchor.AnchorProvider.env();
  const owner = provider.wallet.payer;
  const connection = provider.connection;
  const finalized = async (pending) => {
    const signature = await pending;
    await connection.confirmTransaction(signature, "finalized");
    return signature;
  };
  const program = new anchor.Program(
    JSON.parse(readFileSync("target/idl/slop_escrow.json")),
    provider,
  );
  await ensureConfig(program);
  const recipient = Keypair.generate();
  const donor = Keypair.generate();
  await provider.sendAndConfirm(
    new Transaction().add(
      ...[recipient, donor].map((w) =>
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: w.publicKey,
          lamports: 2000000000,
        }),
      ),
    ),
  );
  const projectDigest = hash("native-sol-integration-project");
  const networkDomain = hash("native-sol-integration-domain");
  const infra = {
    ...expectedDeployment,
    rpcUrl: connection.rpcEndpoint,
    genesisHash: await connection.getGenesisHash(),
    programId: program.programId.toBase58(),
    network: "solana-localnet",
    networkDomain,
    identityAuthority: configIdentity.publicKey.toBase58(),
    feeRecipient: configFees.publicKey.toBase58(),
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "0",
  };
  const input = {
    ...infra,
    owner: owner.publicKey.toBase58(),
    mint: SOLANA_NATIVE_ASSET,
    projectDigest,
    monthlyCap: "100000000",
    automaticMonthly: false,
  };
  const plan = await prepareSolanaVaultCreation(infra, input);
  assert.equal(plan.decimals, 9);
  assert.equal(plan.tokenProgram, SOLANA_NATIVE_ASSET);
  const sendWire = async (wire, signer = owner) => {
    const tx = Transaction.from(Buffer.from(wire, "base64"));
    tx.sign(signer);
    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(signature, "finalized");
    return signature;
  };
  const created = await sendWire(plan.transaction.transaction);
  assert.deepEqual(await verifySolanaVaultCreation(infra, input, created), {
    projectPda: plan.projectPda,
    vault: plan.vault,
  });
  const project = new PublicKey(plan.projectPda),
    vault = new PublicKey(plan.vault);
  const config = {
    ...infra,
    projectId: projectDigest,
    projectPda: plan.projectPda,
    vault: plan.vault,
    mint: SOLANA_NATIVE_ASSET,
    owner: owner.publicKey.toBase58(),
  };
  const pda = (...seeds) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const key = (p) => p.toBuffer();
  const seed = (s) => Buffer.from(s);
  const u64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const nativeInfo = await connection.getAccountInfo(vault, "finalized");
  const rent = await connection.getMinimumBalanceForRentExemption(0);
  assert(nativeInfo.owner.equals(program.programId));
  assert.equal(nativeInfo.data.length, 0);
  assert.equal(nativeInfo.lamports, rent);
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: vault,
        lamports: 7,
      }),
    ),
  );
  assert.equal(
    (await readVaultTotals(config)).freeBalance,
    "0",
    "unsolicited SOL never becomes credited principal",
  );
  const funding = await prepareSolanaFunding(config, {
    operation: "deposit",
    wallet: donor.publicKey.toBase58(),
    gross: "1000000000",
  });
  const funded = await sendWire(funding.transaction, donor);
  assert.equal(await checkSolanaFunding(config, funding, funded), "finalized");
  assert.equal((await readVaultTotals(config)).freeBalance, "1000000000");
  const actor = 710101n;
  const binding = pda(seed("wallet"), key(project), u64(actor));
  const source = hash("native-manual-source");
  const awardId = solanaAwardId(plan.projectPda, source);
  const obligation = pda(
    seed("award"),
    key(project),
    Buffer.from(awardId, "hex"),
  );
  const origin = pda(seed("origin"), key(project), Buffer.from(source, "hex"));
  await finalized(
    program.methods
      .commit(raw(awardId), raw(source), bn(actor), bn(100000000))
      .accountsStrict({
        owner: owner.publicKey,
        project,
        vault,
        origin,
        obligation,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  );
  await assert.rejects(
    () =>
      prepareSolanaFunding(config, {
        operation: "withdraw",
        wallet: owner.publicKey.toBase58(),
        gross: "900000001",
      }),
    /free balance/,
  );
  const bound = await program.methods
    .bindWallet(
      bn(actor),
      raw(networkDomain),
      bn(0),
      raw(hash("native-claim")),
      bn(Math.floor(Date.now() / 1000) + 600),
    )
    .accountsStrict({
      payer: owner.publicKey,
      identityAuthority: configIdentity.publicKey,
      destination: donor.publicKey,
      project,
      binding,
      systemProgram: SystemProgram.programId,
    })
    .signers([configIdentity, donor])
    .rpc();
  await connection.confirmTransaction(bound, "finalized");
  const replacement = await program.methods
    .bindWallet(
      bn(actor),
      raw(networkDomain),
      bn(1),
      raw(hash("native-successor-claim")),
      bn(Math.floor(Date.now() / 1000) + 600),
    )
    .accountsStrict({
      payer: owner.publicKey,
      identityAuthority: configIdentity.publicKey,
      destination: recipient.publicKey,
      project,
      binding,
      systemProgram: SystemProgram.programId,
    })
    .signers([configIdentity, recipient])
    .rpc();
  await connection.confirmTransaction(replacement, "finalized");
  const veto = pda(seed("veto"), key(project), u64(actor), u64(2));
  const pay = (destination) =>
    program.methods
      .payNative(bn(2))
      .accountsStrict({
        project,
        obligation,
        binding,
        vault,
        destination,
        veto,
      })
      .rpc();
  await assert.rejects(
    () =>
      program.methods
        .payNative(bn(1))
        .accountsStrict({
          project,
          obligation,
          binding,
          vault,
          destination: recipient.publicKey,
          veto,
        })
        .rpc(),
    /StaleBinding/,
  );
  await assert.rejects(
    () => pay(donor.publicKey),
    /ConstraintAddress|WrongDestination/,
  );
  const before = await connection.getBalance(recipient.publicKey, "finalized");
  const paid = await pay(recipient.publicKey);
  await connection.confirmTransaction(paid, "finalized");
  assert.equal(
    (await connection.getBalance(recipient.publicKey, "finalized")) - before,
    98000000,
  );
  const tx = await solanaRpc(config, "getTransaction", [
    paid,
    {
      commitment: "finalized",
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  const [invocation] = escrowInvocations(tx, program.programId.toBase58());
  assert.equal(invocation.kind, "paid");
  const payment = await solanaPaymentAdapter(config).verifyFinalized({
    kind: "paid",
    transactionId: paid,
    eventIndex: invocation.index,
    obligationId: awardId,
  });
  assert.equal(payment.netMicro, "98000000");
  assert.equal(payment.destination, recipient.publicKey.toBase58());
  await assert.rejects(() => pay(recipient.publicKey), /AlreadyPaid/);
  const feeBefore = await connection.getBalance(
    configFees.publicKey,
    "finalized",
  );
  const claimed = await program.methods
    .claimFeesNative()
    .accountsStrict({ project, vault, feeAccount: configFees.publicKey })
    .rpc();
  await connection.confirmTransaction(claimed, "finalized");
  assert.equal(
    (await connection.getBalance(configFees.publicKey, "finalized")) -
      feeBefore,
    2000000,
  );
  // The same reservation and monthly Merkle proof path must work for native SOL.
  await finalized(
    program.methods
      .setMonthlyCommitment(bn(100000000), true)
      .accountsStrict({ owner: owner.publicKey, project })
      .rpc(),
  );
  const now = await connection.getBlockTime(
    await connection.getSlot("finalized"),
  );
  const date = new Date(now * 1000);
  date.setUTCMonth(date.getUTCMonth() - (date.getUTCDate() >= 4 ? 1 : 2), 1);
  const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const n = Number(period.replace("-", "")),
    pbytes = Buffer.alloc(4);
  pbytes.writeUInt32LE(n);
  const month = pda(seed("month"), key(project), pbytes);
  const entries = [
    {
      githubUserId: String(actor),
      grossMicro: "100000000",
      sourceDigest: hash("native-monthly-source"),
    },
  ];
  const root = solanaAllocationRoot(entries);
  const message = solanaMonthlyMessage(
    config.programId,
    config.projectPda,
    period,
    root,
    "100000000",
    String(now),
    networkDomain,
  );
  await finalized(
    program.methods
      .commitMonthly(n, raw(root), bn(100000000), bn(now))
      .accountsStrict({
        payer: owner.publicKey,
        project,
        vault,
        month,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        Ed25519Program.createInstructionWithPrivateKey({
          privateKey: configIdentity.secretKey,
          message,
        }),
      ])
      .rpc(),
  );
  const monthlyId = solanaAwardId(config.projectPda, entries[0].sourceDigest);
  const monthlyAward = pda(
    seed("award"),
    key(project),
    Buffer.from(monthlyId, "hex"),
  );
  const monthlyOrigin = pda(
    seed("origin"),
    key(project),
    Buffer.from(entries[0].sourceDigest, "hex"),
  );
  await finalized(
    program.methods
      .commitMonthlyAward(
        n,
        raw(monthlyId),
        raw(entries[0].sourceDigest),
        bn(actor),
        bn(100000000),
        0,
        1,
        solanaAllocationProof(entries, 0).map((p) => ({
          hash: raw(p.hash),
          total: bn(p.total),
        })),
      )
      .accountsStrict({
        payer: owner.publicKey,
        project,
        vault,
        month,
        origin: monthlyOrigin,
        obligation: monthlyAward,
        settled: pda(
          seed("settled"),
          key(month),
          Buffer.from(entries[0].sourceDigest, "hex"),
        ),
        monthlySource: pda(
          seed("monthly-source"),
          key(project),
          Buffer.from(entries[0].sourceDigest, "hex"),
        ),
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  );
  const journalRows = new Map();
  const journal = {
    async get(key) {
      return journalRows.get(key);
    },
    async put(key, value) {
      journalRows.set(key, value);
    },
    async transaction(fn) {
      return fn(journal);
    },
  };
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(donor.secretKey.slice(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const execution = await submitPermissionlessSolanaPayment(
    {
      PAYMENT_DEPLOYMENTS: JSON.stringify([{ ...config, chain: "solana" }]),
      PAYMENT_RPC_URLS: JSON.stringify({
        "solana-localnet": connection.rpcEndpoint,
      }),
      ALLOW_LOCAL_TEST_CHAIN: true,
      LOCAL_SOLANA_GENESIS: infra.genesisHash,
      JOURNAL: journal,
      SOLANA_SIGNER: {
        address: donor.publicKey.toBase58(),
        async signMessage(message) {
          return new Uint8Array(sign(null, Buffer.from(message), privateKey));
        },
      },
    },
    {
      network: "solana-localnet",
      vault: config.vault,
      obligationId: monthlyId,
      githubUserId: String(actor),
    },
  );
  assert.equal(execution.state, "submitted");
  await connection.confirmTransaction(execution.transactionId, "finalized");
  const withdraw = await prepareSolanaFunding(config, {
    operation: "withdraw",
    wallet: owner.publicKey.toBase58(),
    gross: "800000000",
  });
  const withdrawn = await sendWire(withdraw.transaction);
  assert.equal(
    await checkSolanaFunding(config, withdraw, withdrawn),
    "finalized",
  );
  const finalClaim = await program.methods
    .claimFeesNative()
    .accountsStrict({ project, vault, feeAccount: configFees.publicKey })
    .rpc();
  await connection.confirmTransaction(finalClaim, "finalized");
  const totals = await readVaultTotals(config);
  assert.equal(totals.freeBalance, "0");
  assert.equal(totals.reserved, "0");
  assert.equal(totals.accruedFees, "0");
  assert.equal(totals.totalPaid, "196000000");
  assert.equal(totals.totalPayoutFees, "4000000");
  assert.equal(totals.totalGrossWithdrawn, "800000000");
  assert.equal(totals.totalWithdrawalFees, "16000000");
  assert.equal(
    await connection.getBalance(vault, "finalized"),
    rent + 7,
    "rent and unsolicited funds never leave through rewards, refunds or fees",
  );
});
