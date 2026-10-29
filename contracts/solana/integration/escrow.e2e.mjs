import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  AuthorityType,
  createAccount,
  createCloseAccountInstruction,
  createMint,
  createSetAuthorityInstruction,
  createTransferInstruction,
  freezeAccount,
  getAccount,
  mintTo,
  setAuthority,
  TOKEN_PROGRAM_ID,
  thawAccount,
} from "@solana/spl-token";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  escrowInvocations,
  readVaultTotals,
  solanaAllocationProof,
  solanaAllocationRoot,
  solanaAllocationTotal,
  solanaAwardId,
  solanaMonthlyMessage,
  solanaPaymentAdapter,
} from "../.local/adapter.mjs";
import {
  freezeSolanaMonthly,
  submitSolanaMonthly,
} from "../.local/monthly-executor.mjs";
import {
  checkMonthlyReserveRelease,
  prepareMonthlyReserveRelease,
} from "../.local/monthly-release-service.mjs";
import { inspectSolanaMonthlyWrongSum } from "../.local/monthly-reserve.mjs";
import { ownerPlan } from "../scripts/owner-plan.mjs";
import {
  configAddress,
  configFees,
  configIdentity,
  configRotation,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";
import {
  allocationTree,
  CROSS_ACTOR,
  CROSS_GROSS,
  CROSS_SOURCES,
  crossProject,
  EARLIER_PERIOD,
  EXPIRED_ACTOR,
  EXPIRED_GROSS,
  EXPIRED_PERIOD,
  EXPIRED_SOURCE,
  expiredOwner,
  expiredProject,
  shortProject,
  sourceDigest,
} from "./monthly-preload.mjs";

const { AnchorProvider, Program, BN } = anchor;
const provider = AnchorProvider.env();
const payer = provider.wallet.payer;
const program = new Program(
  JSON.parse(readFileSync("target/idl/slop_escrow.json")),
  provider,
);
const hash = (s) => [...createHash("sha256").update(s).digest()];
// A public test cluster keeps accounts between runs; a run salt gives each
// run new project accounts. Local runs leave it empty.
const RUN = process.env.SLOP_E2E_RUN ?? "";
const network = hash("solana:localnet:escrow-v2");
const bn = (x) => new BN(String(x));
const pda = (...seeds) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const key = (x) => x.toBuffer();
const seed = (s) => Buffer.from(s);
// The project PDA's last seed is its purpose: 0 ordinary awards, 1 private bounties.
const ORDINARY = { ordinary: {} };
const BOUNTY = { bounty: {} };
const purposeSeed = (purpose = ORDINARY) =>
  Buffer.from([purpose.bounty ? 1 : 0]);
const actorSeed = (id) => bn(id).toArrayLike(Buffer, "le", 8);
const DELAY = 8;
const ROTATION_DELAY = 4;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The program reads the validator clock, which can lag wall time on a loaded host.
// Wait until the validator clock itself has moved past the binding delay.
const chainTime = async () =>
  provider.connection.getBlockTime(
    await provider.connection.getSlot("confirmed"),
  );
async function activate() {
  const target = (await chainTime()) + DELAY + 2;
  while ((await chainTime()) < target) await sleep(500);
}
// Every project uses the identity authority and fee recipient pinned in Config.
const authority = configIdentity;
const nextAuthority = Keypair.generate();
// The identity authority in force; the rotation test below moves it to nextAuthority.
let currentAuthority = authority;
const feeOwner = configFees;
const recipient = Keypair.generate();
const late = Keypair.generate();
let mint, source, feeAccount, destination, lateDestination, project, vault;
// Bindings are per project, so one project's delay, vetoes and payments never
// change another project's binding.
const bindingIn = (projectKey, id) =>
  pda(seed("wallet"), key(projectKey), actorSeed(id));
const binding = (id) => bindingIn(project, id);
const awardOf = (origin) =>
  Buffer.from(
    solanaAwardId(
      project.toBase58(),
      Buffer.from(hash(`source:${origin}`)).toString("hex"),
    ),
    "hex",
  );
const obligation = (id) => pda(seed("award"), key(project), awardOf(id));
// Submission expiry for bind_wallet; the binding itself never expires.
const expiry = () => bn(Math.floor(Date.now() / 1000) + 3600);
// The veto account always follows the stored latest version, whatever version the
// payer names.
async function latestVersion(actor, named) {
  try {
    return (await program.account.walletBinding.fetch(binding(actor))).version;
  } catch {
    return bn(named);
  }
}
async function commit(
  id,
  actor,
  principal,
  origin = id,
  awardId = awardOf(origin),
  bounty = false,
) {
  return program.methods[bounty ? "commitBounty" : "commit"](
    [...awardId],
    hash(`source:${origin}`),
    bn(actor),
    bn(principal),
  )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      vault,
      obligation: pda(seed("award"), key(project), awardId),
      origin: pda(
        seed("origin"),
        key(project),
        Buffer.from(hash(`source:${origin}`)),
      ),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}
// The authority and the destination keypair both sign; the program reads the
// destination from its signer account. `expiresAt` limits submission only.
async function bind(
  actor,
  wallet,
  expected = 0,
  domain = network,
  {
    claim = hash(`claim:${actor}:${expected}`),
    expiresAt = expiry(),
    signer = currentAuthority,
    cosigners = [wallet],
  } = {},
) {
  return program.methods
    .bindWallet(bn(actor), domain, bn(expected), claim, expiresAt)
    .accountsStrict({
      payer: payer.publicKey,
      identityAuthority: signer.publicKey,
      destination: wallet.publicKey,
      project,
      binding: binding(actor),
      systemProgram: SystemProgram.programId,
    })
    .signers([signer, ...cosigners])
    .rpc();
}
const rotation = {
  propose: (next, signer = payer) =>
    program.methods
      .proposeAuthorityRotation(next)
      .accountsStrict({
        owner: signer.publicKey,
        project,
        config: configAddress(program.programId),
      })
      .signers(signer === payer ? [] : [signer])
      .rpc(),
  confirm: (signer = configRotation) =>
    program.methods
      .confirmAuthorityRotation()
      .accountsStrict({
        rotationAuthority: signer.publicKey,
        project,
        config: configAddress(program.programId),
      })
      .signers(signer === payer ? [] : [signer])
      .rpc(),
  cancel: (signer = payer) =>
    program.methods
      .cancelAuthorityRotation()
      .accountsStrict({ owner: signer.publicKey, project })
      .signers(signer === payer ? [] : [signer])
      .rpc(),
  execute: () =>
    program.methods
      .executeAuthorityRotation()
      .accountsStrict({ project })
      .rpc(),
};
const veto = (actor, version) =>
  pda(seed("veto"), key(project), actorSeed(actor), actorSeed(version));
async function payInstruction(id, actor, address, version = 1) {
  const latest = await latestVersion(actor, version);
  return program.methods.pay(bn(version)).accountsStrict({
    project,
    obligation: obligation(id),
    binding: binding(actor),
    mint,
    vault,
    destination: address,
    tokenProgram: TOKEN_PROGRAM_ID,
    veto: veto(actor, latest),
  });
}
async function pay(id, actor, address, version = 1) {
  return (await payInstruction(id, actor, address, version)).rpc();
}
// `award` names an unpaid award whose commit delay extends the veto window.
function vetoBinding(actor, version, signer = payer, award = null) {
  return program.methods
    .vetoBinding(bn(actor), bn(version))
    .accountsStrict({
      owner: signer.publicKey,
      project,
      binding: binding(actor),
      veto: veto(actor, version),
      obligation: award ? obligation(award) : null,
      systemProgram: SystemProgram.programId,
    })
    .signers(signer === payer ? [] : [signer])
    .rpc();
}
async function parsedTransaction(signature) {
  const response = await fetch(provider.connection.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          commitment: "finalized",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });
  return (await response.json()).result;
}
function withdraw(amount) {
  return program.methods
    .withdraw(bn(amount))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      destination: source,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
// Permissionless: moves every accrued fee to a token account the fee recipient owns.
function claimFees(to = feeAccount) {
  return program.methods
    .claimFees()
    .accountsStrict({
      project,
      mint,
      vault,
      feeAccount: to,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
const accrued = async () =>
  BigInt((await program.account.project.fetch(project)).accruedFees.toString());
const balance = async (address) =>
  (await getAccount(provider.connection, address)).amount;
test("actual SPL escrow lifecycle, late wallet claim, reserve and authority attacks", async () => {
  await ensureConfig(program);
  mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    6,
  );
  source = await createAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey,
  );
  feeAccount = await createAccount(
    provider.connection,
    payer,
    mint,
    feeOwner.publicKey,
  );
  destination = await createAccount(
    provider.connection,
    payer,
    mint,
    recipient.publicKey,
  );
  lateDestination = await createAccount(
    provider.connection,
    payer,
    mint,
    late.publicKey,
  );
  await mintTo(provider.connection, payer, mint, source, payer, 1_000_000_000n);
  project = pda(
    seed("project"),
    key(payer.publicKey),
    Buffer.from(hash(`project${RUN}`)),
    purposeSeed(),
  );
  vault = pda(seed("vault"), key(project));
  await program.methods
    .initialize(
      hash(`project${RUN}`),
      network,
      authority.publicKey,
      feeOwner.publicKey,
      bn(DELAY),
      bn(ROTATION_DELAY),
      ORDINARY,
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  await program.methods
    .deposit(bn(1_000_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const firstCommit = await commit("first", 101, 100_000_000);
  await commit("late", 102, 50_000_000);
  assert.equal(
    (await program.account.project.fetch(project)).reserved.toString(),
    "150000000",
  );
  await assert.rejects(withdraw(1_000_000_000), /InsufficientFreeBalance/);
  await assert.rejects(
    commit("overspend", 103, 1_000_000_000),
    /InsufficientFreeBalance/,
  );
  await assert.rejects(
    pay("late", 102, lateDestination),
    /AccountNotInitialized/,
  );
  // Let both awards pass their commitment period before binding.
  await activate();
  // The authority alone cannot bind a wallet it does not hold: without the
  // destination's signature the transaction never verifies.
  await assert.rejects(bind(101, recipient, 0, network, { cosigners: [] }));
  // The destination alone cannot bind itself either.
  await assert.rejects(
    bind(101, recipient, 0, network, { signer: recipient, cosigners: [] }),
  );
  await bind(101, recipient);
  await activate();
  await assert.rejects(vetoBinding(101, 1), /BindingActive/);
  await assert.rejects(bind(101, late), /StaleBinding/);
  await assert.rejects(bind(102, late, 0, hash("different-network")));
  await assert.rejects(
    pay("first", 101, lateDestination),
    /ConstraintRaw|WrongDestination/,
  );
  // A co-signing wallet with a non-authority signer is still rejected.
  await assert.rejects(bind(101, late, 1, network, { signer: payer }));
  await freezeAccount(provider.connection, payer, destination, mint, payer);
  await assert.rejects(pay("first", 101, destination));
  assert.equal(await balance(feeAccount), 0n);
  assert.equal(
    (await program.account.obligation.fetch(obligation("first"))).paid,
    false,
  );
  await thawAccount(provider.connection, payer, destination, mint, payer);
  const firstPayment = await pay("first", 101, destination);
  assert.equal(await balance(destination), 98_000_000n);
  // The fee accrues in the vault until claim_fees.
  assert.equal(await accrued(), 2_000_000n);
  assert.equal(await balance(feeAccount), 0n);
  await assert.rejects(pay("first", 101, destination), /AlreadyPaid/);
  await assert.rejects(commit("first", 101, 100_000_000));
  // An award ID that is not bound to this project and source is rejected.
  await assert.rejects(
    commit("forged", 101, 1, "forged", Buffer.from(hash("forged-id"))),
    /InvalidAward/,
  );
  await assert.rejects(
    program.methods
      .withdraw(bn(1))
      .accountsStrict({
        owner: authority.publicKey,
        project,
        mint,
        vault,
        destination: source,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc(),
    /ConstraintHasOne/,
  );
  const wrongMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
  );
  const wrongDestination = await createAccount(
    provider.connection,
    payer,
    wrongMint,
    late.publicKey,
  );
  await bind(102, late);
  await activate();
  await assert.rejects(
    pay("late", 102, wrongDestination),
    /ConstraintTokenMint|WrongDestination/,
  );
  // The 50 reserved for actor 102 cannot be withdrawn. The 2% fee rounds up
  // once per withdrawal, so splitting never avoids it: 1 pays 1 (and returns
  // nothing), and 849,999,999 pays ceil(849,999,999 / 50) = 17,000,000.
  await assert.rejects(withdraw(850_000_001), /InsufficientFreeBalance/);
  await withdraw(1);
  assert.equal(await balance(source), 0n);
  assert.equal(await accrued(), 2_000_001n);
  await withdraw(849_999_999);
  assert.equal(await balance(source), 832_999_999n);
  assert.equal(await accrued(), 19_000_001n);
  await assert.rejects(withdraw(1), /InsufficientFreeBalance/);
  // A stolen authority key rebinds actor 102 to a thief, who must expose a
  // wallet by co-signing. Only the owner can veto it, and only while it is
  // within its review period and unpaid; the vetoed version never pays.
  const thief = Keypair.generate();
  const thiefDestination = await createAccount(
    provider.connection,
    payer,
    mint,
    thief.publicKey,
  );
  await bind(102, thief, 1);
  // Fund the identity key so the owner check, not rent, rejects its veto.
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: authority.publicKey,
        lamports: 100_000_000,
      }),
    ),
    [payer],
  );
  await assert.rejects(vetoBinding(102, 2, authority), /ConstraintHasOne/);
  await vetoBinding(102, 2);
  await activate();
  await assert.rejects(pay("late", 102, thiefDestination, 2), /BindingVetoed/);
  assert.equal(await balance(thiefDestination), 0n);
  await bind(102, recipient, 2);
  // The verified successor is immediately active; version 2 cannot pay.
  await assert.rejects(pay("late", 102, destination, 2), /StaleBinding/);
  await assert.rejects(pay("late", 102, destination, 2), /StaleBinding/);
  // A third party pays with unrelated token movements in the same transaction.
  // The adapter must still verify this payment from its own instruction.
  const polluted = await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      await (await payInstruction("late", 102, destination, 3)).instruction(),
      (await import("@solana/spl-token")).createTransferInstruction(
        source,
        destination,
        payer.publicKey,
        1n,
      ),
    ),
    [payer],
  );
  assert.equal(await balance(destination), 147_000_001n);
  assert.equal(await accrued(), 20_000_001n);
  assert.equal(await balance(feeAccount), 0n);
  assert.equal(await balance(vault), 20_000_001n);
  const state = await program.account.project.fetch(project);
  assert.equal(state.reserved.toString(), "0");
  assert.equal(state.paid.toString(), "147000000");
  assert.equal(state.payoutFees.toString(), "3000000");
  assert.equal(state.withdrawalFees.toString(), "17000001");
  assert.equal(
    (await balance(source)) +
      (await balance(destination)) +
      (await balance(feeAccount)) +
      (await balance(vault)),
    1_000_000_000n,
  );
  // This payment can precede a long attack suite. Query retained history before
  // subscribing: the legacy confirmation helper can miss an already rooted signature.
  const previousPayment = await provider.connection.getSignatureStatuses(
    [firstPayment],
    { searchTransactionHistory: true },
  );
  assert.equal(previousPayment.value[0]?.err, null);
  if (previousPayment.value[0]?.confirmationStatus !== "finalized")
    await provider.connection.confirmTransaction(firstPayment, "finalized");
  await provider.connection.confirmTransaction(polluted, "finalized");
  const evidence = {
    programId: program.programId.toBase58(),
    genesisHash: await provider.connection.getGenesisHash(),
    signature: firstPayment,
    project: project.toBase58(),
    awardId: awardOf("first").toString("hex"),
    sourceDigest: Buffer.from(hash("source:first")).toString("hex"),
    actorId: 101,
    gross: "100000000",
    principal: "98000000",
    fee: "2000000",
    walletVersion: 1,
    destinationOwner: recipient.publicKey.toBase58(),
    destinationAccount: destination.toBase58(),
    vault: vault.toBase58(),
    feeAccount: feeAccount.toBase58(),
    mint: mint.toBase58(),
    network: Buffer.from(network).toString("hex"),
  };
  const workerAdapter = solanaPaymentAdapter({
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: evidence.genesisHash,
    programId: evidence.programId,
    projectPda: evidence.project,
    projectId: "local-project",
    network: "solana:localnet",
    networkDomain: evidence.network,
    vault: evidence.vault,
    mint: evidence.mint,
    owner: payer.publicKey.toBase58(),
    identityAuthority: authority.publicKey.toBase58(),
    feeRecipient: feeOwner.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: String(DELAY),
    rotationDelaySeconds: String(ROTATION_DELAY),
  });
  for (const [signature, kind] of [
    [firstCommit, "reserved"],
    [firstPayment, "paid"],
  ]) {
    const [invocation] = escrowInvocations(
      await parsedTransaction(signature),
      evidence.programId,
    );
    const input = {
      transactionId: signature,
      eventIndex: invocation.index,
      kind,
      obligationId: evidence.awardId,
    };
    const normalized = await workerAdapter.verifyFinalized(input);
    assert.equal(normalized.grossMicro, "100000000");
    assert.equal(normalized.netMicro, "98000000");
    assert.equal(normalized.githubUserId, "101");
    if (kind === "paid")
      assert.equal(normalized.destination, recipient.publicKey.toBase58());
    await assert.rejects(
      workerAdapter.verifyFinalized({
        ...input,
        eventIndex: invocation.index + 1,
      }),
      /Exact escrow instruction/,
    );
  }
  const [pollutedPay] = escrowInvocations(
    await parsedTransaction(polluted),
    evidence.programId,
  );
  const pollutedEvidence = await workerAdapter.verifyFinalized({
    transactionId: polluted,
    eventIndex: pollutedPay.index,
    kind: "paid",
    obligationId: awardOf("late").toString("hex"),
  });
  assert.equal(pollutedEvidence.netMicro, "49000000");
  assert.equal(pollutedEvidence.destination, recipient.publicKey.toBase58());
  // The vault totals read one finalized slot and match the on-chain counters.
  const totals = await readVaultTotals({
    rpcUrl: provider.connection.rpcEndpoint,
    network: "solana:localnet",
    projectPda: evidence.project,
    programId: evidence.programId,
  });
  const counters = await program.account.project.fetch(project, "finalized");
  assert.equal(totals.network, "solana:localnet");
  assert.equal(totals.vault, project.toBase58());
  assert.equal(totals.asset, mint.toBase58());
  assert.equal(totals.decimals, 6);
  assert.ok(BigInt(totals.blockNumber) > 0n);
  assert.ok(!Number.isNaN(Date.parse(totals.blockTime)));
  for (const [field, value] of [
    ["totalDeposited", counters.deposited],
    ["totalPaid", counters.paid],
    ["totalPayoutFees", counters.payoutFees],
    ["totalGrossWithdrawn", counters.withdrawnGross],
    ["totalWithdrawalFees", counters.withdrawalFees],
    ["reserved", counters.reserved],
  ])
    assert.equal(totals[field], value.toString(), field);
  assert.equal(totals.freeBalance, "0");
  assert.equal(totals.reservedPrincipal, null);
  assert.equal(totals.accruedFees, "20000001");
  assert.equal(totals.accruedFees, counters.accruedFees.toString());
  assert.equal(
    BigInt(totals.totalDeposited),
    [
      totals.freeBalance,
      totals.reserved,
      totals.totalPaid,
      totals.totalPayoutFees,
      totals.totalGrossWithdrawn,
    ].reduce((sum, value) => sum + BigInt(value), 0n),
  );
  // Anyone moves the accrued fees once; nothing is left to claim.
  await claimFees();
  assert.equal(await balance(feeAccount), 20_000_001n);
  assert.equal(await balance(vault), 0n);
  assert.equal(await accrued(), 0n);
  await assert.rejects(claimFees(), /InvalidAmount/);
  await mintTo(provider.connection, payer, mint, vault, payer, 1_000_000n);
  await assert.rejects(withdraw(1), /InsufficientFreeBalance/);
  await assert.rejects(
    commit("unsolicited", 105, 1),
    /InsufficientFreeBalance/,
  );
  assert.equal(await balance(vault), 1_000_000n);
  // Identity authority rotation: the owner proposes, the fee recipient
  // confirms, anyone executes after the delay, and the current authority has
  // no instruction that stops it. Existing bindings survive the rotation.
  await mintTo(provider.connection, payer, mint, source, payer, 20_000_000n);
  await program.methods
    .deposit(bn(20_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await commit("again", 101, 5_000_000);
  await commit("rotated", 104, 10_000_000);
  await assert.rejects(rotation.execute(), /NoRotationPending/);
  await assert.rejects(rotation.confirm(), /NoRotationPending/);
  await assert.rejects(rotation.cancel(), /NoRotationPending/);
  await assert.rejects(rotation.propose(payer.publicKey), /InvalidIdentity/);
  await assert.rejects(rotation.propose(feeOwner.publicKey), /InvalidIdentity/);
  await assert.rejects(
    rotation.propose(authority.publicKey),
    /InvalidIdentity/,
  );
  await assert.rejects(
    rotation.propose(nextAuthority.publicKey, authority),
    /ConstraintHasOne/,
  );
  await rotation.propose(nextAuthority.publicKey);
  let rotated = await program.account.project.fetch(project);
  assert.equal(
    rotated.pendingIdentityAuthority.toBase58(),
    nextAuthority.publicKey.toBase58(),
  );
  assert.equal(rotated.rotationConfirmed, false);
  await assert.rejects(
    rotation.propose(Keypair.generate().publicKey),
    /RotationPending/,
  );
  await assert.rejects(rotation.execute(), /RotationUnconfirmed/);
  await assert.rejects(rotation.confirm(authority), /ConstraintHasOne/);
  await assert.rejects(rotation.confirm(feeOwner), /ConstraintHasOne/);
  await rotation.cancel();
  await assert.rejects(rotation.execute(), /NoRotationPending/);
  await rotation.propose(nextAuthority.publicKey);
  await rotation.confirm();
  await assert.rejects(rotation.confirm(), /RotationConfirmed/);
  await assert.rejects(rotation.execute(), /RotationNotReady/);
  // The current authority still binds while the proposal waits.
  await bind(104, late);
  await sleep((ROTATION_DELAY + 2) * 1000);
  await rotation.execute();
  rotated = await program.account.project.fetch(project);
  assert.equal(
    rotated.identityAuthority.toBase58(),
    nextAuthority.publicKey.toBase58(),
  );
  assert.equal(
    rotated.pendingIdentityAuthority.toBase58(),
    SystemProgram.programId.toBase58(),
  );
  currentAuthority = nextAuthority;
  await assert.rejects(
    bind(104, late, 1, network, { signer: authority }),
    /ConstraintHasOne/,
  );
  // Bindings made before the rotation keep paying: actor 101 through its
  // active version 1, actor 104 through the version bound during the window.
  await activate();
  await pay("again", 101, destination, 1);
  assert.equal(await balance(destination), 151_900_001n);
  await activate();
  await pay("rotated", 104, lateDestination, 1);
  assert.equal(await balance(lateDestination), 9_800_000n);
  // The new authority binds the next version at the same PDA.
  await bind(104, recipient, 1, network, { signer: nextAuthority });
  assert.equal(
    (
      await program.account.walletBinding.fetch(binding(104))
    ).version.toString(),
    "2",
  );
});

// Binding lifecycle after the 12 October 2026 review (M-1, M-2, L-1 to L-5).
test("commit delay, rotation freezes the earlier wallet, veto cap, bounded delay, project-scoped bindings, bind and fee checks", async () => {
  const ata = async (owner) =>
    createAccount(provider.connection, payer, mint, owner);
  const walletA = Keypair.generate(),
    walletB = Keypair.generate(),
    walletC = Keypair.generate(),
    walletD = Keypair.generate();
  const [ataA, ataB, ataC, ataD] = await Promise.all(
    [walletA, walletB, walletC, walletD].map((k) => ata(k.publicKey)),
  );
  await mintTo(provider.connection, payer, mint, source, payer, 100_000_000n);
  await program.methods
    .deposit(bn(100_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  // M-1: a binding armed before any award pays only after the award's own delay, and
  // the owner can veto it inside that window by naming the unpaid award.
  await bind(201, walletA);
  await activate();
  await commit("m1", 201, 10_000_000);
  await assert.rejects(pay("m1", 201, ataA), /AwardPending/);
  await assert.rejects(vetoBinding(201, 1), /BindingActive/);
  await vetoBinding(201, 1, payer, "m1");
  await activate();
  await assert.rejects(pay("m1", 201, ataA), /BindingVetoed/);
  assert.equal(await balance(ataA), 0n);
  await bind(201, walletA, 1);
  await activate();
  await pay("m1", 201, ataA, 2);
  assert.equal(await balance(ataA), 9_800_000n);
  // A binding that has paid cannot be vetoed, even while a new award is in its window.
  await commit("m1b", 201, 1_000_000);
  await assert.rejects(vetoBinding(201, 2, payer, "m1b"), /BindingActive/);
  let state201 = await program.account.walletBinding.fetch(binding(201));
  assert.equal(state201.paidVersion.toString(), "2");
  assert.equal(state201.vetoCount, 0);
  // M-2: a verified successor immediately invalidates the earlier wallet.
  // If the owner vetoes it before payment, neither version can pay. A rotation away from a compromised wallet
  // therefore freezes payment to it at once.
  await commit("m2", 201, 10_000_000);
  await activate();
  await bind(201, walletB, 2);
  await assert.rejects(pay("m2", 201, ataA, 2), /StaleBinding/);
  await vetoBinding(201, 3);
  await activate();
  await assert.rejects(pay("m2", 201, ataB, 3), /BindingVetoed/);
  await assert.rejects(pay("m2", 201, ataA, 2), /BindingVetoed/);
  // The veto cap applies between payments too: after the paid version, the owner
  // can veto three rotations, and the fourth is immediately payable.
  await bind(201, walletB, 3);
  await vetoBinding(201, 4);
  await bind(201, walletB, 4);
  await vetoBinding(201, 5);
  await bind(201, walletB, 5);
  await assert.rejects(vetoBinding(201, 6), /VetoLimit/);
  await assert.rejects(pay("m2", 201, ataA, 2), /StaleBinding/);
  await pay("m2", 201, ataB, 6);
  await pay("m1b", 201, ataB, 6);
  assert.equal(await balance(ataA), 9_800_000n);
  assert.equal(await balance(ataB), 10_780_000n);
  state201 = await program.account.walletBinding.fetch(binding(201));
  assert.equal(state201.paidVersion.toString(), "6");
  assert.equal(state201.vetoCount, 0);
  // Veto cap: before the actor's first payment the owner gets three vetoes.
  await commit("c1", 202, 10_000_000);
  for (let version = 1; version <= 3; version++) {
    await bind(202, walletC, version - 1);
    await vetoBinding(202, version);
  }
  assert.equal(
    (await program.account.walletBinding.fetch(binding(202))).vetoCount,
    3,
  );
  await bind(202, walletC, 3);
  await assert.rejects(vetoBinding(202, 4), /VetoLimit/);
  await activate();
  await pay("c1", 202, ataC, 4);
  assert.equal(await balance(ataC), 9_800_000n);
  // L-4: bind_wallet rejects the project and vault PDAs, a zero claim digest and an
  // expired submission.
  // A PDA cannot co-sign, so the project and vault addresses never bind.
  await assert.rejects(
    bind(203, { publicKey: project }, 0, network, { cosigners: [] }),
  );
  await assert.rejects(
    bind(203, { publicKey: vault }, 0, network, { cosigners: [] }),
  );
  await assert.rejects(
    bind(203, walletD, 0, network, { claim: Array(32).fill(0) }),
    /InvalidIdentity/,
  );
  await assert.rejects(
    bind(203, walletD, 0, network, { expiresAt: bn(1) }),
    /BindingExpired/,
  );
  // A 49-unit award pays ceil(49 / 50) = 1 fee, so splitting an award into
  // pieces under 50 never avoids it. The fee stays in the vault, so the
  // payment is one transfer of the net 48.
  await commit("zero-fee", 204, 49);
  await bind(204, walletD);
  await activate();
  const zeroFee = await pay("zero-fee", 204, ataD);
  assert.equal(await balance(ataD), 48n);
  await provider.connection.confirmTransaction(zeroFee, "finalized");
  const [zeroFeePay] = escrowInvocations(
    await parsedTransaction(zeroFee),
    program.programId.toBase58(),
  );
  assert.equal(zeroFeePay.children.length, 1);
  const zeroFeeAdapter = solanaPaymentAdapter({
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: await provider.connection.getGenesisHash(),
    programId: program.programId.toBase58(),
    projectPda: project.toBase58(),
    projectId: "local-project",
    network: "solana:localnet",
    networkDomain: Buffer.from(network).toString("hex"),
    vault: vault.toBase58(),
    mint: mint.toBase58(),
    owner: payer.publicKey.toBase58(),
    // The authority at activation: verification continues after a rotation.
    identityAuthority: authority.publicKey.toBase58(),
    feeRecipient: feeOwner.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: String(DELAY),
    rotationDelaySeconds: String(ROTATION_DELAY),
  });
  const zeroFeeEvidence = await zeroFeeAdapter.verifyFinalized({
    transactionId: zeroFee,
    eventIndex: zeroFeePay.index,
    kind: "paid",
    obligationId: awardOf("zero-fee").toString("hex"),
  });
  assert.equal(zeroFeeEvidence.grossMicro, "49");
  assert.equal(zeroFeeEvidence.feeMicro, "1");
  assert.equal(zeroFeeEvidence.netMicro, "48");
  // L-1 and L-3: initialize rejects an out-of-range delay and a fee recipient equal to
  // the owner or the project.
  const initialize = (
    delay,
    feeRecipient = feeOwner.publicKey,
    label = "x",
    identity = authority,
  ) => {
    const id = hash(`bounds:${label}:${delay}${RUN}`);
    const p = pda(
      seed("project"),
      key(payer.publicKey),
      Buffer.from(id),
      purposeSeed(),
    );
    return program.methods
      .initialize(
        id,
        network,
        identity.publicKey,
        feeRecipient,
        bn(delay),
        bn(ROTATION_DELAY),
        ORDINARY,
      )
      .accountsStrict({
        owner: payer.publicKey,
        project: p,
        mint,
        vault: pda(seed("vault"), key(p)),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        config: configAddress(program.programId),
      })
      .rpc();
  };
  await assert.rejects(initialize(-1), /InvalidDelay/);
  await assert.rejects(initialize(30 * 86400 + 1), /InvalidDelay/);
  await assert.rejects(initialize(DELAY, payer.publicKey), /InvalidIdentity/);
  // L-3: the identity authority and the fee recipient must equal the pinned Config.
  await assert.rejects(
    initialize(DELAY, Keypair.generate().publicKey, "fee"),
    /ConfigMismatch/,
  );
  await assert.rejects(
    initialize(DELAY, feeOwner.publicKey, "identity", Keypair.generate()),
    /ConfigMismatch/,
  );
  const selfId = hash(`bounds:self:${DELAY}${RUN}`);
  await assert.rejects(
    initialize(
      DELAY,
      pda(
        seed("project"),
        key(payer.publicKey),
        Buffer.from(selfId),
        purposeSeed(),
      ),
      "self",
    ),
    /InvalidIdentity/,
  );
  await initialize(30 * 86400, feeOwner.publicKey, "max");
  // Another project with the same identity authority and network has its own
  // binding account: actor 201's bindings, vetoes and payments here do not exist
  // there, so that project's delay and veto cap start from its own binding.
  await initialize(DELAY, feeOwner.publicKey, "other");
  const other = pda(
    seed("project"),
    key(payer.publicKey),
    Buffer.from(hash(`bounds:other:${DELAY}${RUN}`)),
    purposeSeed(),
  );
  assert.notEqual(bindingIn(other, 201).toBase58(), binding(201).toBase58());
  assert.equal(
    await provider.connection.getAccountInfo(bindingIn(other, 201)),
    null,
  );
});

// Outside report (20 October 2026): the veto cap must not apply while a confirmed
// authority rotation is pending, or a stolen identity key could outlast the owner's
// remaining vetoes. The owner alone cannot lift the cap: a proposal without the fee
// recipient's confirmation keeps it. Waived vetoes do not count.
test("veto cap is waived during a confirmed authority rotation and resumes after it", async () => {
  const attacker = Keypair.generate(),
    contributor = Keypair.generate(),
    thirdAuthority = Keypair.generate();
  const [attackerAta, contributorAta] = await Promise.all(
    [attacker, contributor].map((k) =>
      createAccount(provider.connection, payer, mint, k.publicKey),
    ),
  );
  await mintTo(provider.connection, payer, mint, source, payer, 10_000_000n);
  await program.methods
    .deposit(bn(10_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await commit("k1", 206, 10_000_000);
  // One ordinary veto before the compromise: the contributor's own binding.
  await bind(206, contributor, 0);
  await vetoBinding(206, 1);
  const vetoCount = async () =>
    (await program.account.walletBinding.fetch(binding(206))).vetoCount;
  assert.equal(await vetoCount(), 1);
  // The key is stolen and binds the attacker's wallet; the owner proposes a rotation.
  // Until the rotation authority confirms, the cap still applies: two vetoes left.
  await rotation.propose(thirdAuthority.publicKey);
  await bind(206, attacker, 1);
  await vetoBinding(206, 2);
  await bind(206, attacker, 2);
  await vetoBinding(206, 3);
  await bind(206, attacker, 3);
  await assert.rejects(vetoBinding(206, 4), /VetoLimit/);
  assert.equal(await vetoCount(), 3);
  // Confirmed: the owner vetoes every attacker binding and none is counted.
  await rotation.confirm();
  await vetoBinding(206, 4);
  await bind(206, attacker, 4);
  await vetoBinding(206, 5);
  await bind(206, attacker, 5);
  assert.equal(await vetoCount(), 3);
  // The rotation executes before the last attacker binding activates; the new
  // authority binds the contributor as the next version, so the attacker never pays.
  await sleep((ROTATION_DELAY + 2) * 1000);
  await rotation.execute();
  currentAuthority = thirdAuthority;
  await assert.rejects(
    bind(206, attacker, 6, network, { signer: nextAuthority }),
    /ConstraintHasOne/,
  );
  await bind(206, contributor, 6);
  // No rotation pending: the cap is back with the count the owner had before.
  await assert.rejects(vetoBinding(206, 7), /VetoLimit/);
  assert.equal(await vetoCount(), 3);
  await activate();
  await assert.rejects(pay("k1", 206, attackerAta, 6), /StaleBinding/);
  await pay("k1", 206, contributorAta, 7);
  assert.equal(await balance(attackerAta), 0n);
  assert.equal(await balance(contributorAta), 9_800_000n);
  assert.equal(await vetoCount(), 0);
});

// Owner decisions of 18 October 2026: permissionless deposit, any classic SPL mint and
// decimals, and the withdrawal fee, 2% since the owner decision of 19 October 2026
// (#907). Token-2022 with an active mint authority remains outside the approved subset.
test("permissionless deposit, 18-, 9- and 0-decimal mints, 2% withdrawal fee, unsafe Token-2022 rejected", async () => {
  await ensureConfig(program);
  const { TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");
  currentAuthority = authority;
  const donor = Keypair.generate(),
    contributor = Keypair.generate();
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: donor.publicKey,
        lamports: 1_000_000_000,
      }),
    ),
    [payer],
  );
  const initializeFor = (
    projectMint,
    label,
    tokenProgram = TOKEN_PROGRAM_ID,
  ) => {
    const id = hash(`decimals:${label}${RUN}`);
    const p = pda(
      seed("project"),
      key(payer.publicKey),
      Buffer.from(id),
      purposeSeed(),
    );
    return {
      address: p,
      send: () =>
        program.methods
          .initialize(
            id,
            network,
            authority.publicKey,
            feeOwner.publicKey,
            bn(DELAY),
            bn(ROTATION_DELAY),
            ORDINARY,
          )
          .accountsStrict({
            owner: payer.publicKey,
            project: p,
            mint: projectMint,
            vault: pda(seed("vault"), key(p)),
            tokenProgram,
            systemProgram: SystemProgram.programId,
            config: configAddress(program.programId),
          })
          .rpc(),
    };
  };
  const deposit = (amount, signer, from) =>
    program.methods
      .deposit(bn(amount))
      .accountsStrict({
        depositor: signer.publicKey,
        project,
        mint,
        source: from,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers(signer === payer ? [] : [signer])
      .rpc();
  // The main lifecycle above covers 6 decimals.
  for (const decimals of [18, 9, 0]) {
    // 10 whole tokens at 18 or 9 decimals; 1,000 base units at 0 decimals.
    const total = decimals === 0 ? 1_000n : 10n * 10n ** BigInt(decimals);
    const gross = total / 10n,
      awardFee = (gross + 49n) / 50n,
      unused = total - gross,
      withdrawalFee = (unused + 49n) / 50n;
    mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      decimals,
    );
    source = await createAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey,
    );
    feeAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      feeOwner.publicKey,
    );
    const donorAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      donor.publicKey,
    );
    const contributorAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      contributor.publicKey,
    );
    await mintTo(provider.connection, payer, mint, donorAccount, payer, total);
    const created = initializeFor(mint, String(decimals));
    await created.send();
    project = created.address;
    vault = pda(seed("vault"), key(project));
    // A third party funds the project from its own token account.
    await assert.rejects(deposit(1, donor, source), /ConstraintTokenOwner/);
    const funded = await deposit(total, donor, donorAccount);
    await provider.connection.confirmTransaction(funded, "confirmed");
    let state = await program.account.project.fetch(project);
    assert.equal(state.deposited.toString(), total.toString());
    assert.equal(await balance(vault), total);
    const logs = (
      await provider.connection.getTransaction(funded, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      })
    ).meta.logMessages;
    const events = [
      ...new anchor.EventParser(program.programId, program.coder).parseLogs(
        logs,
      ),
    ];
    const deposited = events.find((e) => /^deposited$/i.test(e.name));
    assert.ok(deposited, "Deposited event");
    assert.equal(deposited.data.project.toBase58(), project.toBase58());
    assert.equal(
      deposited.data.depositor.toBase58(),
      donor.publicKey.toBase58(),
    );
    assert.equal(deposited.data.amount.toString(), total.toString());
    // The depositor gains no refund right: only the owner withdraws.
    await assert.rejects(
      program.methods
        .withdraw(bn(1))
        .accountsStrict({
          owner: donor.publicKey,
          project,
          mint,
          vault,
          destination: donorAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([donor])
        .rpc(),
      /ConstraintHasOne/,
    );
    // Commit, bind and pay with the mint's own decimals.
    await commit(`decimals-${decimals}`, 301, gross);
    await bind(301, contributor);
    await activate();
    const paid = await pay(`decimals-${decimals}`, 301, contributorAccount);
    assert.equal(await balance(contributorAccount), gross - awardFee);
    assert.equal(await accrued(), awardFee);
    // The owner withdraws the donor's unused funds at the 2% fee. Both fees stay in
    // the vault until claim_fees.
    const withdrawn = await withdraw(unused);
    assert.equal(await balance(source), unused - withdrawalFee);
    assert.equal(await accrued(), awardFee + withdrawalFee);
    assert.equal(await balance(vault), awardFee + withdrawalFee);
    state = await program.account.project.fetch(project);
    assert.equal(state.withdrawalFees.toString(), withdrawalFee.toString());
    // The adapter checks the transfer decimals against the mint's decimals.
    await provider.connection.confirmTransaction(paid, "finalized");
    const [payment] = escrowInvocations(
      await parsedTransaction(paid),
      program.programId.toBase58(),
    );
    const evidence = await solanaPaymentAdapter({
      rpcUrl: provider.connection.rpcEndpoint,
      genesisHash: await provider.connection.getGenesisHash(),
      programId: program.programId.toBase58(),
      projectPda: project.toBase58(),
      projectId: `decimals-${decimals}`,
      network: "solana:localnet",
      networkDomain: Buffer.from(network).toString("hex"),
      vault: vault.toBase58(),
      mint: mint.toBase58(),
      owner: payer.publicKey.toBase58(),
      identityAuthority: authority.publicKey.toBase58(),
      feeRecipient: feeOwner.publicKey.toBase58(),
      ...expectedDeployment,
      bindingDelaySeconds: String(DELAY),
      rotationDelaySeconds: String(ROTATION_DELAY),
    }).verifyFinalized({
      transactionId: paid,
      eventIndex: payment.index,
      kind: "paid",
      obligationId: awardOf(`decimals-${decimals}`).toString("hex"),
    });
    assert.equal(evidence.grossMicro, gross.toString());
    assert.equal(evidence.netMicro, (gross - awardFee).toString());
    assert.equal(evidence.feeMicro, awardFee.toString());
    // readVaultTotals reads finalized state.
    await provider.connection.confirmTransaction(withdrawn, "finalized");
    const totals = await readVaultTotals({
      rpcUrl: provider.connection.rpcEndpoint,
      network: "solana:localnet",
      projectPda: project.toBase58(),
      programId: program.programId.toBase58(),
    });
    assert.equal(totals.decimals, decimals);
    assert.equal(totals.totalDeposited, total.toString());
    assert.equal(totals.totalGrossWithdrawn, unused.toString());
    assert.equal(totals.totalWithdrawalFees, withdrawalFee.toString());
    assert.equal(totals.accruedFees, (awardFee + withdrawalFee).toString());
    assert.equal(totals.freeBalance, "0");
    await claimFees();
    assert.equal(await balance(feeAccount), awardFee + withdrawalFee);
    assert.equal(await balance(vault), 0n);
  }
  // Token-program substitution and an active Token-2022 mint authority are refused.
  const mint2022 = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  const wrongProgram = initializeFor(mint2022, "token-2022");
  await assert.rejects(wrongProgram.send(), /IncorrectProgramId/);
  assert.equal(
    await program.account.project.fetchNullable(wrongProgram.address),
    null,
  );
  assert.equal(
    await provider.connection.getAccountInfo(
      pda(seed("vault"), key(wrongProgram.address)),
    ),
    null,
  );
  await assert.rejects(
    initializeFor(mint2022, "token-2022", TOKEN_2022_PROGRAM_ID).send(),
    /UnsupportedTokenExtension/,
  );
  assert.equal(
    await program.account.project.fetchNullable(wrongProgram.address),
    null,
  );
});

test("private bounty pays exactly 75/25 from its own bounty project, and purposes never mix", async () => {
  destination = await createAccount(
    provider.connection,
    payer,
    mint,
    recipient.publicKey,
  );
  // The same owner, project ID and mint hold a separate bounty project and vault.
  const ordinaryProject = project;
  const id = hash(`decimals:0${RUN}`);
  project = pda(
    seed("project"),
    key(payer.publicKey),
    Buffer.from(id),
    purposeSeed(BOUNTY),
  );
  assert.notEqual(project.toBase58(), ordinaryProject.toBase58());
  vault = pda(seed("vault"), key(project));
  await program.methods
    .initialize(
      id,
      network,
      authority.publicKey,
      feeOwner.publicKey,
      bn(DELAY),
      bn(ROTATION_DELAY),
      BOUNTY,
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  // A bounty project refuses an ordinary award and every monthly instruction.
  await mintTo(provider.connection, payer, mint, source, payer, 100_000_000n);
  await program.methods
    .deposit(bn(100_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      vault,
      source,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await assert.rejects(
    commit("bounty-as-ordinary", 981, 100_000_000),
    /WrongPurpose/,
  );
  await assert.rejects(
    program.methods
      .setMonthlyCommitment(bn(1), true)
      .accountsStrict({ owner: payer.publicKey, project })
      .rpc(),
    /WrongPurpose/,
  );
  const actor = 981;
  await bind(actor, recipient);
  const beforeNet = await balance(destination);
  const beforeFee = await balance(feeAccount);
  await assert.rejects(
    commit(
      "private-inexact",
      actor,
      100_000_001,
      "private-inexact",
      awardOf("private-inexact"),
      true,
    ),
    /InvalidAmount/,
  );
  await commit(
    "private-bounty",
    actor,
    100_000_000,
    "private-bounty",
    awardOf("private-bounty"),
    true,
  );
  await activate();
  const paid = await pay("private-bounty", actor, destination);
  await provider.connection.confirmTransaction(paid, "finalized");
  const [payment] = escrowInvocations(
    await parsedTransaction(paid),
    program.programId.toBase58(),
  );
  const config = {
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: await provider.connection.getGenesisHash(),
    programId: program.programId.toBase58(),
    projectPda: project.toBase58(),
    projectId: "private-bounty",
    network: "solana:localnet",
    networkDomain: Buffer.from(network).toString("hex"),
    vault: vault.toBase58(),
    mint: mint.toBase58(),
    owner: payer.publicKey.toBase58(),
    identityAuthority: authority.publicKey.toBase58(),
    feeRecipient: feeOwner.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: String(DELAY),
    rotationDelaySeconds: String(ROTATION_DELAY),
  };
  const evidence = {
    transactionId: paid,
    eventIndex: payment.index,
    kind: "paid",
    obligationId: awardOf("private-bounty").toString("hex"),
  };
  const verified = await solanaPaymentAdapter({
    ...config,
    payoutPolicy: "security-bounty",
  }).verifyFinalized(evidence);
  assert.equal(verified.netMicro, "75000000");
  assert.equal(verified.feeMicro, "25000000");
  await assert.rejects(solanaPaymentAdapter(config).verifyFinalized(evidence));
  assert.equal((await balance(destination)) - beforeNet, 75_000_000n);
  assert.equal(await accrued(), 25_000_000n);
  await claimFees();
  assert.equal((await balance(feeAccount)) - beforeFee, 25_000_000n);
  await assert.rejects(pay("private-bounty", actor, destination));
  // The ordinary project refuses a bounty award.
  const bountyProject = project;
  project = ordinaryProject;
  vault = pda(seed("vault"), key(project));
  await assert.rejects(
    commit(
      "ordinary-as-bounty",
      actor,
      100_000_000,
      "ordinary-as-bounty",
      awardOf("ordinary-as-bounty"),
      true,
    ),
    /WrongPurpose/,
  );
  project = bountyProject;
  vault = pda(seed("vault"), key(project));
});

// Owner decision D13: after the period cutoff anyone records the month's allocation
// root signed by the identity authority, then anyone commits each award with its
// Merkle sum proof against the fully funded reservation, once per period and source.
// Later owner settings affect new months only. Payment stays permissionless.
test("bounded monthly commitment: signed root, cap, one period, opt-out, proofs and permissionless pay", async () => {
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
  currentAuthority = authority;
  const id = hash(`monthly${RUN}`);
  project = pda(
    seed("project"),
    key(payer.publicKey),
    Buffer.from(id),
    purposeSeed(),
  );
  vault = pda(seed("vault"), key(project));
  await program.methods
    .initialize(
      id,
      network,
      authority.publicKey,
      feeOwner.publicKey,
      bn(DELAY),
      bn(ROTATION_DELAY),
      ORDINARY,
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  await mintTo(provider.connection, payer, mint, source, payer, 100_000_000n);
  await program.methods
    .deposit(bn(55_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  // The open period is the month before the month that contains now - 72 hours.
  const shifted = new Date(((await chainTime()) - 259_200) * 1000);
  const open = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  );
  const nextOpen = new Date(
    Date.UTC(open.getUTCFullYear(), open.getUTCMonth() + 1, 1),
  );
  const label = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const period = label(open);
  const later = label(nextOpen);
  const number = (p) => Number(p.replace("-", ""));
  const periodSeed = (n) => Buffer.from(new Uint32Array([n]).buffer);
  const month = (p) => pda(seed("month"), key(project), periodSeed(number(p)));
  const sourceOf = (actor) =>
    Buffer.from(hash(`monthly:${RUN}:${actor}`)).toString("hex");
  const entries = [
    {
      githubUserId: "401",
      grossMicro: "30000000",
      sourceDigest: sourceOf(401),
    },
    {
      githubUserId: "402",
      grossMicro: "20000000",
      sourceDigest: sourceOf(402),
    },
    {
      githubUserId: "403",
      grossMicro: "10000000",
      sourceDigest: sourceOf(403),
    },
  ];
  const root = solanaAllocationRoot(entries);
  const total = solanaAllocationTotal(entries);
  // The attester freezes the allocation inside the window, before admission.
  const frozenAt = String(await chainTime());
  const message = (
    p = period,
    r = root,
    at = project,
    domain = network,
    frozen = frozenAt,
  ) =>
    solanaMonthlyMessage(
      program.programId.toBase58(),
      at.toBase58(),
      p,
      r,
      total,
      frozen,
      Buffer.from(domain).toString("hex"),
    );
  const attestation = (signer = authority, bytes = message()) =>
    Ed25519Program.createInstructionWithPrivateKey({
      privateKey: signer.secretKey,
      message: bytes,
    });
  const recordAt = (n, r, pre, frozen = frozenAt) =>
    program.methods
      .commitMonthly(n, [...Buffer.from(r, "hex")], bn(total), bn(frozen))
      .accountsStrict({
        payer: stranger.publicKey,
        project,
        vault,
        month: pda(seed("month"), key(project), periodSeed(n)),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([stranger])
      .rpc();
  const record = (
    p = period,
    r = root,
    pre = [attestation(authority, message(p, r))],
  ) => recordAt(number(p), r, pre);
  const award = (entry) =>
    Buffer.from(solanaAwardId(project.toBase58(), entry.sourceDigest), "hex");
  const commitEntry = (index, entry = entries[index], proof = undefined) =>
    program.methods
      .commitMonthlyAward(
        number(period),
        [...award(entry)],
        [...Buffer.from(entry.sourceDigest, "hex")],
        bn(entry.githubUserId),
        bn(entry.grossMicro),
        index,
        entries.length,
        (proof ?? solanaAllocationProof(entries, index)).map((sibling) => ({
          hash: [...Buffer.from(sibling.hash, "hex")],
          total: bn(sibling.total),
        })),
      )
      .accountsStrict({
        payer: stranger.publicKey,
        project,
        vault,
        month: month(period),
        origin: pda(
          seed("origin"),
          key(project),
          Buffer.from(entry.sourceDigest, "hex"),
        ),
        obligation: pda(seed("award"), key(project), award(entry)),
        settled: pda(
          seed("settled"),
          key(month(period)),
          Buffer.from(entry.sourceDigest, "hex"),
        ),
        monthlySource: pda(
          seed("monthly-source"),
          key(project),
          Buffer.from(entry.sourceDigest, "hex"),
        ),
        systemProgram: SystemProgram.programId,
      })
      .signers([stranger])
      .rpc();
  const setMonthly = (cap, enabled, signer = payer) =>
    program.methods
      .setMonthlyCommitment(bn(cap), enabled)
      .accountsStrict({ owner: signer.publicKey, project })
      .signers(signer === payer ? [] : [signer])
      .rpc();

  // Off by default; only the owner turns it on, and "on" needs a positive cap.
  let state = await program.account.project.fetch(project);
  assert.equal(state.monthlyEnabled, false);
  assert.equal(state.monthlyCap.toString(), "0");
  await assert.rejects(record(), /MonthlyDisabled/);
  await assert.rejects(
    setMonthly(50_000_000, true, stranger),
    /ConstraintHasOne/,
  );
  await assert.rejects(setMonthly(0, true), /InvalidAmount/);
  await setMonthly(50_000_000, true);
  await assert.rejects(record(), /MonthlyCapExceeded/);
  await setMonthly(60_000_000, true);
  // No obligation or reservation is admitted until the entire month is funded.
  await assert.rejects(record(), /InsufficientFreeBalance/);
  assert.equal(
    (await program.account.project.fetch(project)).reserved.toString(),
    "0",
  );
  assert.equal(
    await program.account.monthlyAllocation.fetchNullable(month(period)),
    null,
  );
  await program.methods
    .deposit(bn(45_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  // The window: an invalid period, and next month's period before its cutoff.
  await assert.rejects(
    recordAt(202613, root, [attestation()]),
    /InvalidPeriod/,
  );
  await assert.rejects(record(later), /MonthlyWindowClosed/);

  // The signature binds the network, program, project, period, root and total. Only the
  // project's identity authority attests.
  await assert.rejects(record(period, root, []), /InvalidAttestation/);
  await assert.rejects(
    record(period, root, [attestation(stranger)]),
    /InvalidAttestation/,
  );
  await assert.rejects(
    record(period, root, [attestation(authority, message(later))]),
    /InvalidAttestation/,
  );
  await assert.rejects(
    record(period, root, [
      attestation(
        authority,
        solanaMonthlyMessage(
          program.programId.toBase58(),
          project.toBase58(),
          period,
          root,
          "59000000",
          frozenAt,
          Buffer.from(network).toString("hex"),
        ),
      ),
    ]),
    /InvalidAttestation/,
  );
  await assert.rejects(
    record(period, root, [
      attestation(
        authority,
        message(period, root, project, hash("another-network")),
      ),
    ]),
    /InvalidAttestation/,
  );
  const otherRoot = solanaAllocationRoot(entries.slice(0, 2));
  await assert.rejects(
    record(period, root, [attestation(authority, message(period, otherRoot))]),
    /InvalidAttestation/,
  );
  const elsewhere = pda(
    seed("project"),
    key(payer.publicKey),
    Buffer.from(hash("elsewhere")),
    purposeSeed(),
  );
  await assert.rejects(
    record(period, root, [
      attestation(authority, message(period, root, elsewhere)),
    ]),
    /InvalidAttestation/,
  );
  // The signature binds the freeze time, which lies between the window opening and now.
  await assert.rejects(
    recordAt(
      number(period),
      root,
      [attestation(authority, message())],
      String(Number(frozenAt) - 1),
    ),
    /InvalidAttestation/,
  );
  const opensAt =
    Date.UTC(open.getUTCFullYear(), open.getUTCMonth() + 1, 1) / 1000 + 259_200;
  for (const frozen of [opensAt - 1, (await chainTime()) + 3600].map(String))
    await assert.rejects(
      recordAt(
        number(period),
        root,
        [
          attestation(
            authority,
            message(period, root, project, network, frozen),
          ),
        ],
        frozen,
      ),
      /InvalidFreeze/,
    );
  // A signature that the Ed25519 program cannot verify fails the transaction.
  const forged = attestation(authority, message());
  forged.data[16 + 32 + 1] ^= 1;
  await assert.rejects(record(period, root, [forged]));

  // Anyone records the signed root; the period records once.
  await record();
  const recorded = await program.account.monthlyAllocation.fetch(month(period));
  assert.equal(Buffer.from(recorded.allocationRoot).toString("hex"), root);
  assert.equal(recorded.committed.toString(), "0");
  assert.equal(recorded.total.toString(), total);
  assert.equal(recorded.frozenAt.toString(), frozenAt);
  assert.equal(recorded.expired, false);
  assert.equal(
    (await program.account.project.fetch(project)).reserved.toString(),
    total,
  );
  await assert.rejects(withdraw(50_000_000), /InsufficientFreeBalance/);
  await assert.rejects(record(), /already in use/);
  await assert.rejects(record(period, otherRoot), /already in use/);

  // Awards commit with their proofs, at the ordinary 2% fee, within the cap.
  await assert.rejects(
    commitEntry(0, { ...entries[0], grossMicro: "30000001" }),
    /InvalidAllocationProof/,
  );
  await assert.rejects(
    commitEntry(0, entries[0], solanaAllocationProof(entries, 1)),
    /InvalidAllocationProof/,
  );
  await assert.rejects(
    commitEntry(0, entries[0], solanaAllocationProof(entries, 0).slice(1)),
    /InvalidAllocationProof/,
  );
  await commitEntry(0);
  await commitEntry(1);
  await assert.rejects(commitEntry(0), /already in use/);
  // Later owner settings cannot cancel or expand the admitted funded month.
  await setMonthly(10_000_000, false);
  const altered = solanaAllocationProof(entries, 2).map((node) => ({
    ...node,
    total: String(BigInt(node.total) + 1n),
  }));
  await assert.rejects(
    commitEntry(2, entries[2], altered),
    /InvalidAllocationProof/,
  );
  await commitEntry(2);
  assert.equal(
    (
      await program.account.monthlyAllocation.fetch(month(period))
    ).committed.toString(),
    "60000000",
  );
  state = await program.account.project.fetch(project);
  assert.equal(state.reserved.toString(), "60000000");
  const awardAddress = pda(seed("award"), key(project), award(entries[0]));
  const first = await program.account.obligation.fetch(awardAddress);
  assert.equal(first.fee.toString(), "600000");
  assert.equal(first.actorId.toString(), "401");
  // A monthly award pays through the ordinary binding and delay rules; pay needs no owner signature.
  const wallet = Keypair.generate();
  const walletAccount = await createAccount(
    provider.connection,
    payer,
    mint,
    wallet.publicKey,
  );
  await bind(401, wallet);
  await activate();
  const paid = await program.methods
    .pay(bn(1))
    .accountsStrict({
      project,
      obligation: awardAddress,
      binding: binding(401),
      mint,
      vault,
      destination: walletAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      veto: veto(401, 1),
    })
    .rpc();
  assert.equal(await balance(walletAccount), 29_400_000n);
  // The adapter verifies the monthly reservation and its payment as ordinary awards.
  const reserveSignature = (
    await provider.connection.getSignaturesForAddress(
      awardAddress,
      {},
      "confirmed",
    )
  )
    .map((s) => s.signature)
    .at(-1);
  await provider.connection.confirmTransaction(paid, "finalized");
  const deployment = {
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: await provider.connection.getGenesisHash(),
    programId: program.programId.toBase58(),
    projectPda: project.toBase58(),
    projectId: "monthly",
    network: "solana:localnet",
    networkDomain: Buffer.from(network).toString("hex"),
    vault: vault.toBase58(),
    mint: mint.toBase58(),
    owner: payer.publicKey.toBase58(),
    identityAuthority: authority.publicKey.toBase58(),
    feeRecipient: feeOwner.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: String(DELAY),
    rotationDelaySeconds: String(ROTATION_DELAY),
  };
  const adapter = solanaPaymentAdapter(deployment);
  const [reserveInvocation] = escrowInvocations(
    await parsedTransaction(reserveSignature),
    program.programId.toBase58(),
  );
  const reserved = await adapter.verifyFinalized({
    transactionId: reserveSignature,
    eventIndex: reserveInvocation.index,
    kind: "reserved",
    obligationId: award(entries[0]).toString("hex"),
  });
  assert.equal(reserved.githubUserId, "401");
  assert.equal(reserved.grossMicro, "30000000");
  const [payInvocation] = escrowInvocations(
    await parsedTransaction(paid),
    program.programId.toBase58(),
  );
  const paidEvidence = {
    transactionId: paid,
    eventIndex: payInvocation.index,
    kind: "paid",
    obligationId: award(entries[0]).toString("hex"),
  };
  assert.equal(
    (await adapter.verifyFinalized(paidEvidence)).netMicro,
    "29400000",
  );
  await assert.rejects(
    solanaPaymentAdapter({
      ...deployment,
      payoutPolicy: "security-bounty",
    }).verifyFinalized(paidEvidence),
    /purpose/,
    "a bounty policy refuses an ordinary project",
  );
});

// Red-team review of 24 October 2026. Each test starts its own ordinary project.
async function freshProject(label, amount) {
  currentAuthority = authority;
  const id = hash(`${label}${RUN}`);
  project = pda(
    seed("project"),
    key(payer.publicKey),
    Buffer.from(id),
    purposeSeed(),
  );
  vault = pda(seed("vault"), key(project));
  await program.methods
    .initialize(
      id,
      network,
      authority.publicKey,
      feeOwner.publicKey,
      bn(DELAY),
      bn(ROTATION_DELAY),
      ORDINARY,
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  await mintTo(provider.connection, payer, mint, source, payer, amount);
  await program.methods
    .deposit(bn(amount))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

// L-2: the fee accrues in the vault, so a frozen fee recipient account stops neither a
// payout nor a withdrawal; claim_fees then goes to any account the fee recipient owns.
test("a frozen fee account stops no payout; claim_fees sends the exact accrued fees to a fee-recipient account", async () => {
  mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    6,
  );
  source = await createAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey,
  );
  feeAccount = await createAccount(
    provider.connection,
    payer,
    mint,
    feeOwner.publicKey,
  );
  await freshProject("frozen-fee", 100_000_000n);
  const wallet = Keypair.generate();
  const walletAccount = await createAccount(
    provider.connection,
    payer,
    mint,
    wallet.publicKey,
  );
  await commit("frozen-fee", 501, 10_000_000);
  await bind(501, wallet);
  await activate();
  await freezeAccount(provider.connection, payer, feeAccount, mint, payer);
  await pay("frozen-fee", 501, walletAccount);
  assert.equal(await balance(walletAccount), 9_800_000n);
  assert.equal(await accrued(), 200_000n);
  await withdraw(50_000_000);
  assert.equal(await balance(source), 49_000_000n);
  assert.equal(await accrued(), 1_200_000n);
  // The accrued fees are held: the owner cannot withdraw them as free balance.
  await assert.rejects(withdraw(40_000_001), /InsufficientFreeBalance/);
  await assert.rejects(claimFees(feeAccount), /frozen|0x11/);
  const stranger = await createAccount(
    provider.connection,
    payer,
    mint,
    wallet.publicKey,
    Keypair.generate(),
  );
  await assert.rejects(claimFees(stranger), /ConstraintRaw/);
  const fresh = await createAccount(
    provider.connection,
    payer,
    mint,
    feeOwner.publicKey,
    Keypair.generate(),
  );
  await claimFees(fresh);
  assert.equal(await balance(fresh), 1_200_000n);
  assert.equal(await accrued(), 0n);
  assert.equal(await balance(vault), 40_000_000n);
  await assert.rejects(claimFees(fresh), /InvalidAmount/);
  await thawAccount(provider.connection, payer, feeAccount, mint, payer);
});

// An Ed25519 signer with the executor's signMessage interface.
const nodeSigner = (keypair) => {
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      keypair.secretKey.slice(0, 32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return {
    address: keypair.publicKey.toBase58(),
    async signMessage(message) {
      return new Uint8Array(sign(null, message, key));
    },
  };
};
// The reviewed deployment of the current project, as the payment executor reads it.
const executorConfig = (projectId) => ({
  chain: "solana",
  network: "solana-localnet",
  projectId,
  programId: program.programId.toBase58(),
  projectPda: project.toBase58(),
  vault: vault.toBase58(),
  asset: mint.toBase58(),
  networkDomain: Buffer.from(network).toString("hex"),
  owner: payer.publicKey.toBase58(),
  identityAuthority: authority.publicKey.toBase58(),
  feeRecipient: feeOwner.publicKey.toBase58(),
  ...expectedDeployment,
  bindingDelaySeconds: String(DELAY),
  rotationDelaySeconds: String(ROTATION_DELAY),
});
// The payment executor's environment and a signed monthly authorization for `entries`
// of the current project, frozen at `frozenAt`; `stranger` pays the gas.
async function monthlyExecutor(stranger, period, entries, frozenAt, projectId) {
  const root = solanaAllocationRoot(entries),
    total = solanaAllocationTotal(entries);
  const signed = solanaMonthlyMessage(
    program.programId.toBase58(),
    project.toBase58(),
    period,
    root,
    total,
    frozenAt,
    Buffer.from(network).toString("hex"),
  );
  const config = executorConfig(projectId);
  const journal = new Map();
  const environment = {
    PAYMENT_DEPLOYMENTS: JSON.stringify([config]),
    PAYMENT_RPC_URLS: JSON.stringify({
      "solana-localnet": provider.connection.rpcEndpoint,
    }),
    ALLOW_LOCAL_TEST_CHAIN: true,
    LOCAL_SOLANA_GENESIS: await provider.connection.getGenesisHash(),
    SOLANA_SIGNER: nodeSigner(stranger),
    JOURNAL: {
      async get(key) {
        return journal.get(key);
      },
      async put(key, value) {
        journal.set(key, value);
      },
      async transaction(fn) {
        return fn(this);
      },
    },
  };
  const authorization = {
    plan: {
      family: "solana",
      request: {
        projectId: config.projectId,
        network: config.network,
        period,
        snapshotSha256: "a".repeat(64),
      },
      deployment: config,
      allocationRoot: root,
      totalGrossBase: total,
      frozenAt,
      entries,
      messageHex: Buffer.from(signed).toString("hex"),
    },
    signatureHex: Buffer.from(
      await nodeSigner(authority).signMessage(signed),
    ).toString("hex"),
  };
  return { total, config, journal, environment, authorization };
}

// An admitted month blocks the owner's direct commits until every leaf settles. A leaf
// whose source the owner consumed before admission can never commit, so anyone releases
// its reserve to free balance; each leaf settles once, by commit or by release.
test("monthly outstanding blocks direct commits; a consumed leaf releases once and the rest commit", async () => {
  await freshProject("monthly-release", 100_000_000n);
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
  await program.methods
    .setMonthlyCommitment(bn(100_000_000), true)
    .accountsStrict({ owner: payer.publicKey, project })
    .rpc();
  const shifted = new Date(((await chainTime()) - 259_200) * 1000);
  const open = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  );
  const period = `${open.getUTCFullYear()}-${String(open.getUTCMonth() + 1).padStart(2, "0")}`;
  const n = Number(period.replace("-", ""));
  const month = pda(
    seed("month"),
    key(project),
    Buffer.from(new Uint32Array([n]).buffer),
  );
  // Each source digest equals the one `commit` derives from the same name.
  const entries = ["leaf-a", "leaf-b", "leaf-c"].map((name, i) => ({
    githubUserId: String(601 + i),
    grossMicro: String((3 - i) * 10_000_000),
    sourceDigest: Buffer.from(hash(`source:${name}`)).toString("hex"),
  }));
  // The owner consumes leaf B's source before the month is admitted.
  const consumedTransaction = await commit("leaf-b", 999, 1);
  // The executor reads only finalized accounts, including this newly created project.
  await provider.connection.confirmTransaction(
    consumedTransaction,
    "finalized",
  );
  const consumedAt = (
    await program.account.obligation.fetch(obligation("leaf-b"))
  ).committedAt.toNumber();
  while ((await chainTime()) <= consumedAt) await sleep(500);
  const frozenAt = String(await chainTime());
  const { total, config, journal, environment, authorization } =
    await monthlyExecutor(
      stranger,
      period,
      entries,
      frozenAt,
      "monthly-release",
    );
  const freezeConfig = {
    ...config,
    mint: config.asset,
    rpcUrl: provider.connection.rpcEndpoint,
  };
  await assert.rejects(
    freezeSolanaMonthly(freezeConfig, authorization.plan),
    /already consumed/,
  );
  const observedFreeze = await freezeSolanaMonthly(freezeConfig, {
    ...authorization.plan,
    entries: entries.filter((_, index) => index !== 1),
  });
  assert.ok(
    Number(observedFreeze) > 0 && Number(observedFreeze) <= (await chainTime()),
  );
  await assert.rejects(
    submitSolanaMonthly(environment, {
      ...authorization,
      signatureHex: "00".repeat(64),
    }),
    /Invalid monthly authority/,
  );
  assert.equal(journal.size, 0);
  const notAdmitted = await submitSolanaMonthly(
    environment,
    authorization,
    false,
  );
  assert.equal(notAdmitted.notAdmitted, true);
  assert.equal(journal.size, 0);
  const originalFetch = globalThis.fetch;
  let lostReply = false;
  let submitted;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (
      !lostReply &&
      typeof init?.body === "string" &&
      JSON.parse(init.body).method === "sendTransaction"
    ) {
      lostReply = true;
      throw new Error("Test: accepted broadcast response lost");
    }
    return response;
  };
  try {
    submitted = await submitSolanaMonthly(environment, authorization);
  } catch (error) {
    // The accepted transaction may not be visible on the immediate status read.
    assert.ok(error instanceof Error);
    assert.equal(error.constructor.name, "SolanaRpcUnavailable");
    assert.equal(error.message, "RPC failure");
    assert.equal(
      error.cause?.message,
      "Test: accepted broadcast response lost",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(lostReply, true);
  const rootAttempt = [...journal.values()][0];
  assert.ok(rootAttempt?.transactionId);
  submitted ??= await submitSolanaMonthly(environment, authorization);
  assert.equal(submitted.transactionId, rootAttempt.transactionId);
  assert.equal(submitted.alreadyCommitted, false);
  assert.equal(
    (await submitSolanaMonthly(environment, authorization)).transactionId,
    submitted.transactionId,
  );
  await provider.connection.confirmTransaction(
    submitted.transactionId,
    "finalized",
  );
  // Once funded, even opt-out and admission-disabled dispatch must settle valid leaves.
  const disabled = await program.methods
    .setMonthlyCommitment(bn(0), false)
    .accountsStrict({ owner: payer.publicKey, project })
    .rpc();
  await provider.connection.confirmTransaction(disabled, "finalized");
  const executeLeaf = async () => {
    const result = await submitSolanaMonthly(environment, authorization, false);
    assert.equal(result.alreadyCommitted, false);
    await provider.connection.confirmTransaction(
      result.transactionId,
      "finalized",
    );
    return result;
  };
  const leaf = (index, method) => {
    const entry = entries[index],
      digest = Buffer.from(entry.sourceDigest, "hex"),
      award = Buffer.from(
        solanaAwardId(project.toBase58(), entry.sourceDigest),
        "hex",
      ),
      proof = solanaAllocationProof(entries, index).map((node) => ({
        hash: [...Buffer.from(node.hash, "hex")],
        total: bn(node.total),
      })),
      shared = {
        payer: stranger.publicKey,
        project,
        month,
        origin: pda(seed("origin"), key(project), digest),
        monthlySource: pda(seed("monthly-source"), key(project), digest),
        settled: pda(seed("settled"), key(month), digest),
        systemProgram: SystemProgram.programId,
      },
      tail = [bn(entry.githubUserId), bn(entry.grossMicro), index, 3, proof];
    return (
      method === "commit"
        ? program.methods
            .commitMonthlyAward(n, [...award], [...digest], ...tail)
            .accountsStrict({
              ...shared,
              vault,
              obligation: pda(seed("award"), key(project), award),
            })
        : program.methods
            .releaseMonthlyAward(n, [...digest], ...tail)
            .accountsStrict({
              ...shared,
              obligation:
                index === 1 ? pda(seed("award"), key(project), award) : null,
            })
    )
      .signers([stranger])
      .rpc();
  };
  const read = () => program.account.project.fetch(project);
  let state = await read();
  assert.equal(state.monthlyOutstanding.toString(), "60000000");
  assert.equal(state.reserved.toString(), "60000001");
  // The owner cannot consume an admitted leaf's source by hand.
  await assert.rejects(commit("leaf-c", 999, 1), /MonthlyOutstanding/);
  await assert.rejects(commit("unrelated", 999, 1), /MonthlyOutstanding/);
  // A leaf that can still commit cannot be released.
  await assert.rejects(leaf(0, "release"), /AwardCommittable/);
  await executeLeaf();
  // A committed leaf has settled: it cannot also be released.
  await assert.rejects(leaf(0, "release"), /already in use/);
  // Leaf B can never commit; anyone returns its reserve to free balance, once.
  await assert.rejects(leaf(1, "commit"), /already in use/);
  const before = await read();
  await executeLeaf();
  state = await read();
  assert.equal(
    state.reserved.toNumber(),
    before.reserved.toNumber() - 20_000_000,
  );
  assert.equal(state.monthlyOutstanding.toString(), "10000000");
  let recorded = await program.account.monthlyAllocation.fetch(month);
  assert.equal(recorded.released.toString(), "20000000");
  assert.equal(recorded.committed.toString(), "50000000");
  await assert.rejects(leaf(1, "release"), /already in use/);
  await assert.rejects(leaf(2, "release"), /AwardCommittable/);
  await executeLeaf();
  assert.deepEqual(
    await submitSolanaMonthly(environment, authorization, false),
    { transactionId: null, alreadyCommitted: true },
  );
  recorded = await program.account.monthlyAllocation.fetch(month);
  assert.equal(recorded.committed.toString(), total);
  assert.equal(recorded.released.toString(), "20000000");
  state = await read();
  assert.equal(state.monthlyOutstanding.toString(), "0");
  // Settled: direct commits work again, and the released gross is free to withdraw.
  await commit("after-month", 999, 1);
  state = await read();
  assert.equal(state.reserved.toString(), "40000002");
  const free = 100_000_000n - 40_000_002n;
  await assert.rejects(withdraw(free + 1n), /InsufficientFreeBalance/);
  const withdrawn = await withdraw(free);
  await provider.connection.confirmTransaction(withdrawn, "finalized");
  const totals = await readVaultTotals({
    rpcUrl: provider.connection.rpcEndpoint,
    network: "solana:localnet",
    projectPda: project.toBase58(),
    programId: program.programId.toBase58(),
  });
  assert.equal(totals.freeBalance, "0");
  // ceil(59,999,998 / 50) = 1,200,000.
  assert.equal(totals.accruedFees, String((free + 49n) / 50n));
  assert.equal(
    BigInt(totals.totalDeposited),
    [
      totals.freeBalance,
      totals.reserved,
      totals.totalPaid,
      totals.totalPayoutFees,
      totals.totalGrossWithdrawn,
    ].reduce((sum, value) => sum + BigInt(value), 0n),
  );
  // The vault holds exactly the reserves and the unclaimed fees.
  assert.equal(
    await balance(vault),
    BigInt(totals.reserved) + BigInt(totals.accruedFees),
  );
  assert.equal(
    (
      await program.account.project.fetch(project, "finalized")
    ).monthlyOutstanding.toString(),
    "0",
  );
});

// The monthly gate tests share a funded payer that is neither owner nor attester, the one
// recordable period, and entries whose source digests equal the ones `commit` derives.
async function monthlyPeriod() {
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
  const shifted = new Date(((await chainTime()) - 259_200) * 1000);
  const open = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  );
  const period = `${open.getUTCFullYear()}-${String(open.getUTCMonth() + 1).padStart(2, "0")}`;
  return { stranger, period, n: Number(period.replace("-", "")) };
}
const entriesOf = (names, actor) =>
  names.map((name, i) => ({
    githubUserId: String(actor + i),
    grossMicro: String((names.length - i) * 10_000_000),
    sourceDigest: sourceDigest(name),
  }));
const awardAt = (entry) =>
  pda(
    seed("award"),
    key(project),
    Buffer.from(solanaAwardId(project.toBase58(), entry.sourceDigest), "hex"),
  );
const monthAt = (n) =>
  pda(seed("month"), key(project), Buffer.from(new Uint32Array([n]).buffer));
// Retain the removed instruction bytes only to prove that expiry cannot bypass
// funded-source protection on either a current or a past-window month.
const expireAt = (projectKey, n) =>
  sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      new TransactionInstruction({
        programId: program.programId,
        keys: [
          { pubkey: projectKey, isSigner: false, isWritable: true },
          {
            pubkey: pda(
              seed("month"),
              key(projectKey),
              Buffer.from(new Uint32Array([n]).buffer),
            ),
            isSigner: false,
            isWritable: true,
          },
        ],
        data: Buffer.concat([
          Buffer.from(hash("global:expire_month")).subarray(0, 8),
          Buffer.from(new Uint32Array([n]).buffer),
        ]),
      }),
    ),
    [payer],
  );
// Waits until the validator clock is past `time` and returns the new clock.
async function after(time) {
  while ((await chainTime()) <= time) await sleep(500);
  return chainTime();
}

// Enables the monthly path and admits `entries` as frozen at `frozenAt`. `tree` is the
// adapter's allocation tree unless a test builds one the adapter refuses.
const monthlyAdmission = (stranger, period, n) =>
  async function admit(
    entries,
    frozenAt,
    tree = {
      root: solanaAllocationRoot(entries),
      total: solanaAllocationTotal(entries),
      proof: (index) => solanaAllocationProof(entries, index),
    },
  ) {
    await program.methods
      .setMonthlyCommitment(bn(100_000_000), true)
      .accountsStrict({ owner: payer.publicKey, project })
      .rpc();
    const { root, total } = tree;
    const signature = await program.methods
      .commitMonthly(n, [...Buffer.from(root, "hex")], bn(total), bn(frozenAt))
      .accountsStrict({
        payer: stranger.publicKey,
        project,
        vault,
        month: monthAt(n),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        Ed25519Program.createInstructionWithPrivateKey({
          privateKey: authority.secretKey,
          message: solanaMonthlyMessage(
            program.programId.toBase58(),
            project.toBase58(),
            period,
            root,
            total,
            String(frozenAt),
            Buffer.from(network).toString("hex"),
          ),
        }),
      ])
      .signers([stranger])
      .rpc();
    // `release` names the obligation a release passes: the leaf's own award by default.
    const leaf = (index, method, release = awardAt(entries[index])) => {
      const entry = entries[index],
        digest = Buffer.from(entry.sourceDigest, "hex"),
        award = Buffer.from(
          solanaAwardId(project.toBase58(), entry.sourceDigest),
          "hex",
        ),
        proof = tree.proof(index).map((node) => ({
          hash: [...Buffer.from(node.hash, "hex")],
          total: bn(node.total),
        })),
        shared = {
          payer: stranger.publicKey,
          project,
          month: monthAt(n),
          origin: pda(seed("origin"), key(project), digest),
          settled: pda(seed("settled"), key(monthAt(n)), digest),
          monthlySource: pda(seed("monthly-source"), key(project), digest),
          systemProgram: SystemProgram.programId,
        },
        tail = [
          bn(entry.githubUserId),
          bn(entry.grossMicro),
          index,
          entries.length,
          proof,
        ];
      return (
        method === "commit"
          ? program.methods
              .commitMonthlyAward(n, [...award], [...digest], ...tail)
              .accountsStrict({ ...shared, vault, obligation: awardAt(entry) })
          : program.methods
              .releaseMonthlyAward(n, [...digest], ...tail)
              .accountsStrict({ ...shared, obligation: release })
      )
        .signers([stranger])
        .rpc();
    };
    return { total, leaf, signature };
  };

// An admitted month blocks the owner's direct commits while any of its gross is
// outstanding. The attester signs when it froze the allocation: a leaf whose source the
// owner consumed by hand before the freeze can never commit, so anyone releases its reserve
// to free balance. After the freeze only an award that already pays the leaf's actor its
// gross releases, so removing or shrinking an award never becomes a refund. Each leaf
// settles once.
test("monthly gate blocks direct commits; a source consumed before the freeze, or by the same award, releases once", async () => {
  const { stranger, period, n } = await monthlyPeriod();
  const ownerCommit = (name, gross = 1) => commit(name, 999, gross);
  const month = () => monthAt(n);
  const admit = monthlyAdmission(stranger, period, n);
  const expire = () => expireAt(project, n);
  const read = () => program.account.project.fetch(project);

  await freshProject("monthly-freeze", 100_000_000n);
  const entries = entriesOf(["leaf-a", "leaf-b", "leaf-c"], 601);
  // The owner consumes leaf B's source by hand; the attester freezes later.
  await ownerCommit("leaf-b");
  const consumed = (await program.account.obligation.fetch(awardAt(entries[1])))
    .committedAt;
  const frozenAt = await after(consumed.toNumber());
  const { total, leaf } = await admit(entries, frozenAt);
  let recorded = await program.account.monthlyAllocation.fetch(month());
  assert.equal(recorded.frozenAt.toNumber(), frozenAt);
  assert.equal(recorded.expired, false);
  let state = await read();
  assert.equal(state.monthlyOutstanding.toString(), "60000000");
  assert.equal(state.reserved.toString(), "60000001");
  // The owner cannot consume an admitted leaf's source, or any other, by hand.
  await assert.rejects(ownerCommit("leaf-c"), /MonthlyOutstanding/);
  await assert.rejects(ownerCommit("unrelated"), /MonthlyOutstanding/);
  // The removed expiry selector cannot bypass a funded reservation.
  await assert.rejects(expire(), /InstructionFallbackNotFound/);
  // A leaf that can still commit has no origin, so it cannot be released.
  await assert.rejects(leaf(0, "release", null), /AwardCommittable/);
  await leaf(0, "commit");
  // A committed leaf has settled: it cannot also be released.
  await assert.rejects(leaf(0, "release"), /already in use/);
  // Leaf B can never commit. A release must name the obligation its origin records.
  await assert.rejects(leaf(1, "commit"), /already in use/);
  await assert.rejects(leaf(1, "release", null), /AwardCommittable/);
  await assert.rejects(
    leaf(1, "release", awardAt(entries[0])),
    /AwardCommittable/,
  );
  // Anyone returns its reserve to free balance, once.
  const before = await read();
  await leaf(1, "release");
  state = await read();
  assert.equal(
    state.reserved.toNumber(),
    before.reserved.toNumber() - 20_000_000,
  );
  assert.equal(state.monthlyOutstanding.toString(), "10000000");
  recorded = await program.account.monthlyAllocation.fetch(month());
  assert.equal(recorded.released.toString(), "20000000");
  assert.equal(recorded.committed.toString(), "50000000");
  await assert.rejects(leaf(1, "release"), /already in use/);
  await assert.rejects(leaf(2, "release", null), /AwardCommittable/);
  await leaf(2, "commit");
  recorded = await program.account.monthlyAllocation.fetch(month());
  assert.equal(recorded.committed.toString(), total);
  assert.equal(recorded.released.toString(), "20000000");
  state = await read();
  assert.equal(state.monthlyOutstanding.toString(), "0");
  // Settled: direct commits work again, and the released gross is free to withdraw.
  await ownerCommit("after-month");
  state = await read();
  assert.equal(state.reserved.toString(), "40000002");
  const free = 100_000_000n - 40_000_002n;
  await assert.rejects(withdraw(free + 1n), /InsufficientFreeBalance/);
  const withdrawn = await withdraw(free);
  await provider.connection.confirmTransaction(withdrawn, "finalized");
  const totals = await readVaultTotals({
    rpcUrl: provider.connection.rpcEndpoint,
    network: "solana:localnet",
    projectPda: project.toBase58(),
    programId: program.programId.toBase58(),
  });
  assert.equal(totals.freeBalance, "0");
  // ceil(59,999,998 / 50) = 1,200,000.
  assert.equal(totals.accruedFees, String((free + 49n) / 50n));
  assert.equal(
    BigInt(totals.totalDeposited),
    [
      totals.freeBalance,
      totals.reserved,
      totals.totalPaid,
      totals.totalPayoutFees,
      totals.totalGrossWithdrawn,
    ].reduce((sum, value) => sum + BigInt(value), 0n),
  );
  // The vault holds exactly the reserves and the unclaimed fees.
  assert.equal(
    await balance(vault),
    BigInt(totals.reserved) + BigInt(totals.accruedFees),
  );
  assert.equal(
    (
      await program.account.project.fetch(project, "finalized")
    ).monthlyOutstanding.toString(),
    "0",
  );

  // The attester froze the allocation, then the owner committed each source by hand
  // before admission. The same award (actor and gross) is counted once and releases. A
  // smaller award to the same actor, or one to another actor, never releases, so it can
  // never become a refund to the owner; its gross stays reserved and outstanding.
  await freshProject("monthly-after-freeze", 120_000_000n);
  const afterFreeze = entriesOf(
    ["after-same", "after-smaller", "after-other"],
    701,
  );
  const lateFrozenAt = await chainTime();
  await after(lateFrozenAt);
  await commit("after-same", 701, 30_000_000);
  await commit("after-smaller", 702, 20_000_000 - 1);
  await commit("after-other", 999, 10_000_000);
  const lateMonth = await admit(afterFreeze, lateFrozenAt);
  assert.ok(
    (
      await program.account.obligation.fetch(awardAt(afterFreeze[0]))
    ).committedAt.toNumber() > lateFrozenAt,
  );
  state = await read();
  assert.equal(state.reserved.toString(), String(60_000_000 - 1 + 60_000_000));
  for (const index of [0, 1, 2])
    await assert.rejects(lateMonth.leaf(index, "commit"), /already in use/);
  await lateMonth.leaf(0, "release");
  await assert.rejects(lateMonth.leaf(1, "release"), /AwardCommittable/);
  await assert.rejects(lateMonth.leaf(2, "release"), /AwardCommittable/);
  state = await read();
  assert.equal(state.reserved.toString(), String(90_000_000 - 1));
  assert.equal(state.monthlyOutstanding.toString(), "30000000");
  await assert.rejects(ownerCommit("blocked"), /MonthlyOutstanding/);
  await assert.rejects(expire(), /InstructionFallbackNotFound/);
});

// Historical clock state is preloaded; all refusal, reservation and payment
// instructions below execute against the actual compiled program.
test("past-window funded leaves preserve their recipient and remain payable", async () => {
  const projectKey = expiredProject;
  const sourceBytes = Buffer.from(EXPIRED_SOURCE, "hex");
  const fundedId = Buffer.from(
    solanaAwardId(projectKey.toBase58(), EXPIRED_SOURCE),
    "hex",
  );
  const vaultKey = pda(seed("vault"), key(projectKey));
  const monthKey = pda(
    seed("month"),
    key(projectKey),
    Buffer.from(new Uint32Array([EXPIRED_PERIOD]).buffer),
  );
  const originKey = pda(seed("origin"), key(projectKey), sourceBytes);
  const obligationKey = pda(seed("award"), key(projectKey), fundedId);
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: expiredOwner.publicKey,
        lamports: 1_000_000_000,
      }),
    ),
    [payer],
  );
  const ownerCommit = (source, id) =>
    program.methods
      .commit([...id], [...source], bn(999), bn(EXPIRED_GROSS))
      .accountsStrict({
        owner: expiredOwner.publicKey,
        project: projectKey,
        vault: vaultKey,
        origin: pda(seed("origin"), key(projectKey), source),
        obligation: pda(seed("award"), key(projectKey), id),
        systemProgram: SystemProgram.programId,
      })
      .signers([expiredOwner])
      .rpc();
  await assert.rejects(
    expireAt(projectKey, EXPIRED_PERIOD),
    /InstructionFallbackNotFound/,
  );
  await assert.rejects(
    ownerCommit(sourceBytes, fundedId),
    /MonthlyOutstanding/,
  );
  let state = await program.account.project.fetch(projectKey);
  assert.equal(state.reserved.toString(), String(EXPIRED_GROSS));
  assert.equal(state.monthlyOutstanding.toString(), String(EXPIRED_GROSS));
  // The fixture's owner has already opted out; this still preserves the funded leaf.
  assert.equal(state.monthlyEnabled, false);
  const committed = await program.methods
    .commitMonthlyAward(
      EXPIRED_PERIOD,
      [...fundedId],
      [...sourceBytes],
      bn(EXPIRED_ACTOR),
      bn(EXPIRED_GROSS),
      0,
      1,
      [],
    )
    .accountsStrict({
      payer: payer.publicKey,
      project: projectKey,
      vault: vaultKey,
      month: monthKey,
      origin: originKey,
      obligation: obligationKey,
      settled: pda(seed("settled"), key(monthKey), sourceBytes),
      monthlySource: pda(seed("monthly-source"), key(projectKey), sourceBytes),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await provider.connection.confirmTransaction(committed, "finalized");
  state = await program.account.project.fetch(projectKey, "finalized");
  assert.equal(state.monthlyOutstanding.toString(), "0");
  assert.equal(state.reserved.toString(), String(EXPIRED_GROSS));
  const original = await program.account.obligation.fetch(
    obligationKey,
    "finalized",
  );
  assert.equal(original.actorId.toString(), String(EXPIRED_ACTOR));
  const other = Buffer.from(
    hash("unrelated owner source after leaf completion"),
  );
  await ownerCommit(
    other,
    Buffer.from(
      solanaAwardId(projectKey.toBase58(), other.toString("hex")),
      "hex",
    ),
  );
  const wallet = Keypair.generate();
  const recipientAccount = await createAccount(
    provider.connection,
    payer,
    state.mint,
    wallet.publicKey,
  );
  const bound = pda(seed("wallet"), key(projectKey), actorSeed(EXPIRED_ACTOR));
  await program.methods
    .bindWallet(
      bn(EXPIRED_ACTOR),
      state.network,
      bn(0),
      hash("past-window funded binding"),
      expiry(),
    )
    .accountsStrict({
      payer: payer.publicKey,
      identityAuthority: configIdentity.publicKey,
      destination: wallet.publicKey,
      project: projectKey,
      binding: bound,
      systemProgram: SystemProgram.programId,
    })
    .signers([configIdentity, wallet])
    .rpc();
  const paid = await program.methods
    .pay(bn(1))
    .accountsStrict({
      project: projectKey,
      obligation: obligationKey,
      binding: bound,
      mint: state.mint,
      vault: vaultKey,
      destination: recipientAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      veto: pda(
        seed("veto"),
        key(projectKey),
        actorSeed(EXPIRED_ACTOR),
        actorSeed(1),
      ),
    })
    .rpc();
  await provider.connection.confirmTransaction(paid, "finalized");
  assert.equal(
    (await getAccount(provider.connection, recipientAccount, "finalized"))
      .amount,
    980_000n,
  );
  assert.equal(
    (await program.account.obligation.fetch(obligationKey, "finalized")).paid,
    true,
  );
});

// A release needs no award when the leaf can never commit: an actor-0 leaf releases with
// no origin or obligation. A source another month already committed releases only for
// the same actor and at most that award's gross; anything else stays reserved. The
// earlier month and its monthly-source markers are preloaded (see monthly-preload.mjs);
// the attester refuses to freeze a marked source.
test("an actor-0 leaf releases once; a source another month committed releases only for the same actor and gross", async () => {
  const { stranger, period, n } = await monthlyPeriod();
  await freshProject("monthly-cross", 50_000_000n);
  assert.ok(project.equals(crossProject));
  const earlier = await program.account.monthlyAllocation.fetch(
    monthAt(EARLIER_PERIOD),
  );
  assert.equal(earlier.committed.toString(), earlier.total.toString());
  // The owner's commits write each source's origin and obligation for actor 901 and
  // 5 USDC, as the earlier month's commit_monthly_award did, after the attester froze.
  const frozenAt = await chainTime();
  await after(frozenAt);
  for (const name of CROSS_SOURCES)
    await commit(name, CROSS_ACTOR, CROSS_GROSS);
  const leaves = [
    [0, 10_000_000, sourceDigest("actor-zero")],
    [CROSS_ACTOR, CROSS_GROSS, sourceDigest(CROSS_SOURCES[0])],
    [CROSS_ACTOR, CROSS_GROSS + 1_000_000, sourceDigest(CROSS_SOURCES[1])],
    [CROSS_ACTOR + 1, CROSS_GROSS, sourceDigest(CROSS_SOURCES[2])],
  ];
  const entries = leaves.map(([actor, gross, digest]) => ({
    githubUserId: String(actor),
    grossMicro: String(gross),
    sourceDigest: digest,
  }));
  const { leaf } = await monthlyAdmission(stranger, period, n)(
    entries,
    frozenAt,
    allocationTree(leaves),
  );
  const read = () => program.account.project.fetch(project);
  let state = await read();
  assert.equal(state.reserved.toString(), "41000000");
  assert.equal(state.monthlyOutstanding.toString(), "26000000");
  // An actor-0 leaf can never commit; anyone releases it, once, with no award.
  await assert.rejects(leaf(0, "commit"), /InvalidAmount/);
  await leaf(0, "release", null);
  state = await read();
  assert.equal(state.reserved.toString(), "31000000");
  let recorded = await program.account.monthlyAllocation.fetch(monthAt(n));
  assert.equal(recorded.released.toString(), "10000000");
  await assert.rejects(leaf(0, "release", null), /already in use/);
  // The same actor at the committed gross releases: the source already pays it.
  // Vault totals read only finalized state.
  await provider.connection.confirmTransaction(
    await leaf(1, "release"),
    "finalized",
  );
  // A larger gross or another actor stays reserved.
  await assert.rejects(leaf(2, "release"), /AwardCommittable/);
  await assert.rejects(leaf(3, "release"), /AwardCommittable/);
  state = await read();
  assert.equal(state.reserved.toString(), "26000000");
  assert.equal(state.monthlyOutstanding.toString(), "11000000");
  recorded = await program.account.monthlyAllocation.fetch(monthAt(n));
  assert.equal(recorded.released.toString(), "15000000");
  assert.equal(recorded.committed.toString(), "15000000");
  const totals = await readVaultTotals({
    rpcUrl: provider.connection.rpcEndpoint,
    network: "solana:localnet",
    projectPda: project.toBase58(),
    programId: program.programId.toBase58(),
  });
  assert.equal(totals.freeBalance, "24000000");
});

// Regression for red-team pass 2: the attester freezes, then the owner commits one award
// by hand with its own actor, gross and source (what the Awards page builds), and anyone
// admits the published authorization. The identical award is counted once: every leaf
// settles, the vault reserves exactly what is owed, and the owner's commits work again.
test("an identical hand commit after the freeze is counted once and the month completes", async () => {
  const { stranger, period } = await monthlyPeriod();
  await freshProject("monthly-identical", 100_000_000n);
  const enabled = await program.methods
    .setMonthlyCommitment(bn(100_000_000), true)
    .accountsStrict({ owner: payer.publicKey, project })
    .rpc();
  await provider.connection.confirmTransaction(enabled, "finalized");
  const entries = entriesOf(["identical-a", "identical-b"], 801);
  const freezeConfig = {
    ...executorConfig("identical"),
    mint: mint.toBase58(),
    rpcUrl: provider.connection.rpcEndpoint,
  };
  const { environment, authorization } = await monthlyExecutor(
    stranger,
    period,
    entries,
    await freezeSolanaMonthly(freezeConfig, { family: "solana", entries }),
    "identical",
  );
  const frozenAt = Number(authorization.plan.frozenAt);
  await after(frozenAt);
  await provider.connection.confirmTransaction(
    await commit("identical-b", 802, 10_000_000),
    "finalized",
  );
  // The attester now accepts the identical existing award too.
  await freezeSolanaMonthly(freezeConfig, authorization.plan);
  // Only the identical award: a leaf smaller than the existing award, or for
  // another actor, is refused, as EVM commitMonthly reverts for it.
  for (const leaf of [
    { ...entries[1], grossMicro: "9000000" },
    { ...entries[1], githubUserId: "803" },
  ])
    await assert.rejects(
      freezeSolanaMonthly(freezeConfig, { family: "solana", entries: [leaf] }),
      /already consumed/,
    );
  const admitted = await submitSolanaMonthly(environment, authorization);
  await provider.connection.confirmTransaction(
    admitted.transactionId,
    "finalized",
  );
  let state = await program.account.project.fetch(project);
  // Admission reserves the whole total, the identical award included.
  assert.equal(state.reserved.toString(), "40000000");
  assert.equal(state.monthlyOutstanding.toString(), "30000000");
  const settled = await submitSolanaMonthly(
    environment,
    authorization,
    false,
    16,
  );
  for (const transaction of settled.transactionIds)
    await provider.connection.confirmTransaction(transaction, "finalized");
  assert.deepEqual(
    await submitSolanaMonthly(environment, authorization, false, 16),
    { transactionId: null, alreadyCommitted: true },
  );
  const recorded = await program.account.monthlyAllocation.fetch(
    monthAt(Number(period.replace("-", ""))),
  );
  assert.equal(recorded.committed.toString(), "30000000");
  assert.equal(recorded.released.toString(), "10000000");
  state = await program.account.project.fetch(project);
  // Reserved is exactly the two awards owed: A's monthly award and B's hand award.
  assert.equal(state.reserved.toString(), "30000000");
  assert.equal(state.monthlyOutstanding.toString(), "0");
  await provider.connection.confirmTransaction(
    await commit("identical-after", 999, 1),
    "finalized",
  );
  const totals = await readVaultTotals({
    rpcUrl: provider.connection.rpcEndpoint,
    network: "solana:localnet",
    projectPda: project.toBase58(),
    programId: program.programId.toBase58(),
  });
  assert.equal(totals.reserved, "30000001");
  assert.equal(
    BigInt(totals.totalDeposited),
    [
      totals.freeBalance,
      totals.reserved,
      totals.totalPaid,
      totals.totalPayoutFees,
      totals.totalGrossWithdrawn,
    ].reduce((sum, value) => sum + BigInt(value), 0n),
  );
  assert.equal(
    await balance(vault),
    BigInt(totals.reserved) +
      BigInt(totals.accruedFees) +
      BigInt(totals.freeBalance),
  );
});

// Complete retained allocation evidence, read through the actual adapter from finalized
// validator state. The inspector has no signer; only the existing primitive is exercised below.
test("whole-reserve inspection proves only an authenticated wrong sum", async () => {
  await ensureConfig(program);
  mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
  source = await createAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey,
  );
  const { stranger, period, n } = await monthlyPeriod();
  const admit = monthlyAdmission(stranger, period, n);
  const config = async () => ({
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: await provider.connection.getGenesisHash(),
    programId: program.programId.toBase58(),
    projectPda: project.toBase58(),
    projectId: "local-monthly-inspection",
    network: "solana:localnet",
    networkDomain: Buffer.from(network).toString("hex"),
    vault: vault.toBase58(),
    mint: mint.toBase58(),
    owner: payer.publicKey.toBase58(),
    identityAuthority: authority.publicKey.toBase58(),
    feeRecipient: feeOwner.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: String(DELAY),
    rotationDelaySeconds: String(ROTATION_DELAY),
  });
  const finalized = async (signature) => {
    const receipt = await provider.connection.confirmTransaction(
      signature,
      "finalized",
    );
    assert.equal(receipt.value.err, null);
  };
  const accounts = async () =>
    (
      await provider.connection.getMultipleAccountsInfo(
        [project, monthAt(n)],
        "finalized",
      )
    ).map((a) => a.data.toString("hex"));
  // Every inspector call goes through actual HTTP; controlled negative responses never
  // replace successful state or relax the classifier. A write method is always refused.
  const inspect = async (settings, capture, fault = null) => {
    const original = globalThis.fetch;
    let blocks = 0;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      assert.ok(
        [
          "getMultipleAccounts",
          "getBlock",
          "getGenesisHash",
          "getAccountInfo",
        ].includes(body.method),
      );
      if (fault === "provider")
        throw new Error("controlled provider unavailable");
      const response = await original(url, init);
      if (
        fault === "canonical" &&
        body.method === "getBlock" &&
        ++blocks === 2
      ) {
        const changed = await response.json();
        changed.result.blockhash = Keypair.generate().publicKey.toBase58();
        return Response.json(changed);
      }
      return response;
    };
    try {
      return await inspectSolanaMonthlyWrongSum(settings, period, capture);
    } finally {
      globalThis.fetch = original;
    }
  };

  await freshProject("inspection-healthy", 100_000_000n);
  const healthy = entriesOf(
    ["inspection-healthy-a", "inspection-healthy-b"],
    741,
  );
  const healthyMonth = await admit(healthy, await chainTime());
  await finalized(healthyMonth.signature);
  let settings = await config();
  const beforeHealthy = await accounts();
  assert.deepEqual(await inspect(settings, { entries: healthy }), {
    status: "held",
    reason: "no-wrong-sum-fault",
  });
  assert.deepEqual(await accounts(), beforeHealthy);
  await healthyMonth.leaf(0, "commit");
  await healthyMonth.leaf(1, "commit");

  await freshProject("inspection-wrong-sum", 100_000_000n);
  const entries = entriesOf(["inspection-wrong-a", "inspection-wrong-b"], 751);
  const total = BigInt(solanaAllocationTotal(entries)) + 1n;
  const tree = {
    root: solanaAllocationRoot(entries),
    total: total.toString(),
    proof: (index) => solanaAllocationProof(entries, index),
  };
  const wrong = await admit(entries, await chainTime(), tree);
  await finalized(wrong.signature);
  settings = await config();
  const beforeWrong = await accounts();
  assert.deepEqual(await inspect(settings, null), {
    status: "held",
    reason: "allocation-unavailable",
  });
  assert.deepEqual(
    await inspect(settings, { entries: [...entries].reverse() }),
    { status: "held", reason: "allocation-mismatch" },
  );
  await assert.rejects(inspect(settings, { entries }, "provider"), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.constructor.name, "SolanaRpcUnavailable");
    assert.equal(error.message, "RPC failure");
    assert.equal(error.cause?.message, "controlled provider unavailable");
    return true;
  });
  await assert.rejects(
    inspect({ ...settings, codeSha256: "0".repeat(64) }, { entries }),
    /program bytes/,
  );
  await assert.rejects(
    inspect(settings, { entries }, "canonical"),
    /evidence changed/,
  );
  const evidence = await inspect(settings, { entries });
  assert.equal(evidence.status, "provably-unsettleable");
  assert.equal(evidence.fault, "authenticated-sum-mismatch");
  assert.equal(evidence.computedTotal, "30000000");
  assert.equal(evidence.storedTotal, "30000001");
  assert.equal(evidence.expectedUnsettled, evidence.storedTotal);
  assert.equal(evidence.identityAuthority, authority.publicKey.toBase58());
  assert.equal(evidence.retainedCount, 2);
  assert.equal(
    evidence.entriesSha256,
    createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  );
  assert.deepEqual(
    await accounts(),
    beforeWrong,
    "all inspections are read-only",
  );
  for (const index of [0, 1])
    await assert.rejects(wrong.leaf(index, "commit"), /InvalidAllocationProof/);
  await assert.rejects(
    commit("wrong-sum-blocked", 999, 1),
    /MonthlyOutstanding/,
  );
  // The existing unsigned owner planner consumes fresh evidence and a caller attestation.
  const u64 = (value) => bn(value).toArrayLike(Buffer, "le", 8);
  const releaseMessage = Buffer.concat([
    Buffer.from("slop-monthly-release-v1"),
    key(program.programId),
    key(project),
    Buffer.from(new Uint32Array([n]).buffer),
    Buffer.from(evidence.allocationRoot, "hex"),
    u64(total),
    u64(evidence.expectedUnsettled),
    u64(evidence.releasedGross),
    Buffer.from(network),
  ]);
  const attest = async (signer) =>
    Buffer.from(await nodeSigner(signer).signMessage(releaseMessage)).toString(
      "hex",
    );
  const releaseInput = {
    deployment: { ...settings, asset: settings.mint },
    operation: "release-monthly-wrong-sum",
    period,
    capture: { entries },
    attestation: await attest(authority),
  };
  const runtime = {
    rpcUrl: settings.rpcUrl,
    expectedGenesis: settings.genesisHash,
  };
  await assert.rejects(
    ownerPlan({ ...releaseInput, attestation: await attest(payer) }, runtime),
    /authority mismatch/,
  );
  await assert.rejects(
    ownerPlan({ ...releaseInput, capture: null }, runtime),
    /allocation-unavailable/,
  );
  // Run the private attester service on the same actual finalized validator state.
  // SQLite stores the retained publication; only this fixture creates the bad historical total.
  const database = new DatabaseSync(":memory:");
  database.exec(
    "CREATE TABLE monthly_payment_runs(project_id TEXT,period TEXT,snapshot_sha256 TEXT,network TEXT,vault TEXT,obligations_created_at TEXT); CREATE TABLE monthly_payment_authorizations(project_id TEXT,period TEXT,network TEXT,authorization TEXT); CREATE TABLE monthly_payment_authorization_attempts(project_id TEXT,period TEXT,network TEXT,authorization TEXT);",
  );
  const record = {
    ...settings,
    network: "solana-devnet",
    asset: settings.mint,
  };
  delete record.rpcUrl;
  const request = {
    projectId: settings.projectId,
    period,
    network: "solana-devnet",
    manifestSha256: "a".repeat(64),
  };
  const savedProject = {
    id: settings.projectId,
    revision: 1,
    manifestSha256: request.manifestSha256,
    manifest: { escrow: { deployments: [record] } },
  };
  database
    .prepare("INSERT INTO monthly_payment_runs VALUES(?,?,?,?,?,?)")
    .run(
      settings.projectId,
      period,
      "c".repeat(64),
      request.network,
      settings.vault,
      "2026-12-04T00:00:00Z",
    );
  const retained = {
    plan: {
      request: {
        projectId: request.projectId,
        period,
        network: request.network,
        snapshotSha256: "c".repeat(64),
      },
      deployment: record,
      family: "solana",
      entries,
    },
    signatureHex: releaseInput.attestation,
  };
  database
    .prepare("INSERT INTO monthly_payment_authorizations VALUES(?,?,?,?)")
    .run(request.projectId, period, request.network, JSON.stringify(retained));
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => database.prepare(sql).get(...args) ?? null,
          };
        },
      };
    },
  };
  const memory = new Map();
  const journal = {
    get: async (key) => memory.get(key),
    put: async (key, value) => memory.set(key, value),
  };
  let signing = authority,
    signs = 0;
  const service = {
    db,
    journal,
    getProject: async () => savedProject,
    pinned: [{ projectId: request.projectId, ...record, chain: "solana" }],
    family: "solana",
    evm: async () => {
      throw new Error("Wrong family");
    },
    solana: async () => settings,
    sign: async (text) => {
      signs++;
      return Buffer.from(
        await nodeSigner(signing).signMessage(Buffer.from(text, "hex")),
      ).toString("hex");
    },
  };
  const servicePlan = await prepareMonthlyReserveRelease(service, request);
  assert.equal(servicePlan.status, "ready");
  assert.equal(servicePlan.family, "solana");
  assert.equal(
    (await prepareMonthlyReserveRelease(service, request)).status,
    "ready",
  );
  assert.equal(
    signs,
    1,
    "retry reuses its attestation after fresh evidence checks",
  );
  const originalPlan = await ownerPlan(releaseInput, runtime);
  assert.equal(originalPlan.requiredSigner, payer.publicKey.toBase58());
  assert.equal(originalPlan.evidence.expectedUnsettled, "30000001");
  assert.deepEqual(
    await accounts(),
    beforeWrong,
    "owner preparation cannot release",
  );
  const originalTransaction = Transaction.from(
    Buffer.from(originalPlan.transactionBase64, "base64"),
  );
  assert.equal(originalTransaction.signatures.length, 1);
  assert.equal(originalTransaction.signatures[0].signature, null);
  assert.equal(originalTransaction.instructions.length, 2);
  // An authority change invalidates both the earlier plan and its supplied attestation.
  await rotation.propose(nextAuthority.publicKey);
  await rotation.confirm();
  await sleep((ROTATION_DELAY + 2) * 1000);
  await finalized(await rotation.execute());
  await assert.rejects(ownerPlan(releaseInput, runtime), /authority mismatch/);
  assert.notEqual(
    (await provider.connection.simulateTransaction(originalTransaction)).value
      .err,
    null,
  );
  const currentInput = {
    ...releaseInput,
    attestation: await attest(nextAuthority),
  };
  signing = nextAuthority;
  const currentServicePlan = await prepareMonthlyReserveRelease(
    service,
    request,
  );
  assert.equal(currentServicePlan.status, "ready");
  assert.equal(
    currentServicePlan.prepared.evidence.identityAuthority,
    nextAuthority.publicKey.toBase58(),
  );
  assert.equal(
    signs,
    2,
    "authority rotation needs the current authority attestation",
  );
  const plan = await ownerPlan(currentInput, runtime);
  assert.equal(
    plan.evidence.identityAuthority,
    nextAuthority.publicKey.toBase58(),
  );
  const transaction = Transaction.from(
    Buffer.from(currentServicePlan.prepared.transaction, "base64"),
  );
  transaction.sign(payer);
  const released = await provider.connection.sendRawTransaction(
    transaction.serialize(),
  );
  await provider.connection.confirmTransaction(released, "finalized");
  assert.equal(
    (
      await checkMonthlyReserveRelease(service, {
        ...request,
        planId: currentServicePlan.planId,
        transactionId: released,
      })
    ).status,
    "finalized",
  );
  assert.equal(
    (await prepareMonthlyReserveRelease(service, request)).status,
    "held",
  );
  assert.equal(signs, 2, "a released reserve cannot sign again");
  database.close();
  const state = await program.account.project.fetch(project, "finalized");
  assert.equal(state.reserved.toString(), "0");
  assert.equal(state.monthlyOutstanding.toString(), "0");
  const month = await program.account.monthlyAllocation.fetch(
    monthAt(n),
    "finalized",
  );
  assert.equal(month.committed.toString(), total.toString());
  assert.equal(month.released.toString(), total.toString());
  assert.deepEqual(await inspect(settings, { entries }), {
    status: "held",
    reason: "prior-reserve-transition",
  });
  await assert.rejects(
    ownerPlan(currentInput, runtime),
    /prior-reserve-transition/,
  );
  await commit("inspection-manual-after", 999, 1);

  // Deliberate post-freeze smaller/different-actor consumption is never a wrong-sum fault.
  await freshProject("inspection-deliberate-hold", 100_000_000n);
  const held = entriesOf(["inspection-smaller", "inspection-other"], 761);
  const frozen = await chainTime();
  await after(frozen);
  await commit("inspection-smaller", 761, 19_999_999);
  await commit("inspection-other", 999, 10_000_000);
  const heldMonth = await admit(held, frozen);
  await finalized(heldMonth.signature);
  settings = await config();
  const beforeHeld = await accounts();
  assert.deepEqual(await inspect(settings, { entries: held }), {
    status: "held",
    reason: "no-wrong-sum-fault",
  });
  for (const index of [0, 1]) {
    await assert.rejects(heldMonth.leaf(index, "commit"), /already in use/);
    await assert.rejects(heldMonth.leaf(index, "release"), /AwardCommittable/);
  }
  assert.deepEqual(await accounts(), beforeHeld);
});

// Primitive accounting control only, not a qualified duplicate-source classification:
// the signed tree repeats a source, so its second copy can never
// settle or be released per leaf. Only the owner, with a fresh identity-authority
// signature over the month's exact unsettled gross, returns that part to free balance.
// The settleable leaves stay reserved and still commit; the period stays recorded.
test("the owner releases a month's unsettleable gross only with a fresh attestation", async () => {
  const { stranger, period, n } = await monthlyPeriod();
  await freshProject("monthly-unsettleable", 100_000_000n);
  const [a, b] = entriesOf(["unsettle-a", "unsettle-b"], 731);
  const entries = [
    a,
    b,
    {
      githubUserId: "733",
      grossMicro: "5000000",
      sourceDigest: a.sourceDigest,
    },
  ];
  const tree = allocationTree(
    entries.map((e) => [e.githubUserId, e.grossMicro, e.sourceDigest]),
  );
  const admit = monthlyAdmission(stranger, period, n);
  const { leaf } = await admit(entries, await chainTime(), tree);
  const read = () => program.account.project.fetch(project);
  const month = () => program.account.monthlyAllocation.fetch(monthAt(n));
  const u64 = (x) => bn(x).toArrayLike(Buffer, "le", 8);
  const release = (unsettled, released, signer = authority, owner = payer) =>
    program.methods
      .releaseMonthlyReserve(n, bn(unsettled), bn(released))
      .accountsStrict({
        owner: owner.publicKey,
        project,
        month: monthAt(n),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .preInstructions([
        Ed25519Program.createInstructionWithPrivateKey({
          privateKey: signer.secretKey,
          message: Buffer.concat([
            Buffer.from("slop-monthly-release-v1"),
            key(program.programId),
            key(project),
            Buffer.from(new Uint32Array([n]).buffer),
            Buffer.from(tree.root, "hex"),
            u64(tree.total),
            u64(unsettled),
            u64(released),
            Buffer.from(network),
          ]),
        }),
      ])
      .signers(owner === payer ? [] : [owner])
      .rpc();
  let state = await read();
  assert.equal(state.monthlyOutstanding.toString(), "35000000");
  assert.equal(state.reserved.toString(), "35000000");
  await assert.rejects(commit("blocked", 999, 1), /MonthlyOutstanding/);
  // Only the owner, only the project's identity authority, only this exact state.
  await assert.rejects(
    release(35_000_000, 5_000_000, authority, stranger),
    /ConstraintHasOne|has one/,
  );
  await assert.rejects(
    release(35_000_000, 5_000_000, nextAuthority),
    /InvalidAttestation/,
  );
  await assert.rejects(release(30_000_000, 5_000_000), /MonthlyReserveChanged/);
  await assert.rejects(release(35_000_000, 35_000_001), /InvalidAmount/);
  await assert.rejects(release(35_000_000, 0), /InvalidAmount/);
  // Release only the repeated copy's gross before any leaf settles.
  await release(35_000_000, 5_000_000);
  state = await read();
  assert.equal(state.monthlyOutstanding.toString(), "30000000");
  assert.equal(state.reserved.toString(), "30000000");
  let recorded = await month();
  assert.equal(recorded.released.toString(), "5000000");
  assert.equal(recorded.committed.toString(), "5000000");
  await assert.rejects(release(35_000_000, 5_000_000), /MonthlyReserveChanged/);
  // The settleable leaves still commit with their original terms.
  await leaf(0, "commit");
  await leaf(1, "commit");
  await assert.rejects(leaf(2, "commit"), /already in use/);
  state = await read();
  assert.equal(state.monthlyOutstanding.toString(), "0");
  assert.equal(state.reserved.toString(), "30000000");
  recorded = await month();
  assert.equal(recorded.committed.toString(), recorded.total.toString());
  const award = await program.account.obligation.fetch(awardAt(a));
  assert.equal(award.gross.toString(), a.grossMicro);
  assert.equal(award.actorId.toString(), a.githubUserId);
  // Nothing is left to release, and direct commits work again.
  await assert.rejects(release(0, 1), /InvalidAmount/);
  await commit("after-release", 999, 1);
});

// The vault totals fail closed when the vault token account holds less than the
// counters owe. The program never allows that, so test-e2e.sh preloads such a vault.
test("vault totals refuse a vault holding less than free, reserved and accrued fees", async () => {
  await assert.rejects(
    readVaultTotals({
      rpcUrl: provider.connection.rpcEndpoint,
      network: "solana:localnet",
      projectPda: shortProject.toBase58(),
      programId: program.programId.toBase58(),
    }),
    /Vault balance is below free, reserved and accrued fees/,
  );
});

async function verifyClosedPayout(changedPreOwner) {
  await ensureConfig(program);
  const closingRecipient = Keypair.generate();
  const priorOwner = Keypair.generate();
  const closingMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
  );
  const closingSource = await createAccount(
    provider.connection,
    payer,
    closingMint,
    payer.publicKey,
  );
  const closingDestination = await createAccount(
    provider.connection,
    payer,
    closingMint,
    closingRecipient.publicKey,
  );
  await mintTo(
    provider.connection,
    payer,
    closingMint,
    closingSource,
    payer,
    20_000_000n,
  );
  const closingProject = pda(
    seed("project"),
    key(payer.publicKey),
    Buffer.from(hash(`closed-account:${changedPreOwner}:${RUN}`)),
    purposeSeed(),
  );
  const closingVault = pda(seed("vault"), key(closingProject));
  const closingActor = 401;
  const closingSourceDigest = Buffer.from(hash("source:closed-account"));
  const closingAward = Buffer.from(
    solanaAwardId(
      closingProject.toBase58(),
      closingSourceDigest.toString("hex"),
    ),
    "hex",
  );
  const closingBinding = pda(
    seed("wallet"),
    key(closingProject),
    actorSeed(closingActor),
  );
  const closingObligation = pda(
    seed("award"),
    key(closingProject),
    closingAward,
  );
  const closingVeto = pda(
    seed("veto"),
    key(closingProject),
    actorSeed(closingActor),
    actorSeed(1),
  );
  await program.methods
    .initialize(
      hash(`closed-account:${changedPreOwner}:${RUN}`),
      network,
      authority.publicKey,
      feeOwner.publicKey,
      bn(DELAY),
      bn(ROTATION_DELAY),
      ORDINARY,
    )
    .accountsStrict({
      owner: payer.publicKey,
      project: closingProject,
      mint: closingMint,
      vault: closingVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  await program.methods
    .deposit(bn(20_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project: closingProject,
      mint: closingMint,
      source: closingSource,
      vault: closingVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await program.methods
    .commit(
      [...closingAward],
      closingSourceDigest,
      bn(closingActor),
      bn(10_000_000),
    )
    .accountsStrict({
      owner: payer.publicKey,
      project: closingProject,
      vault: closingVault,
      obligation: closingObligation,
      origin: pda(seed("origin"), key(closingProject), closingSourceDigest),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await activate();
  await program.methods
    .bindWallet(
      bn(closingActor),
      network,
      bn(0),
      hash(`claim:${closingActor}:0`),
      expiry(),
    )
    .accountsStrict({
      payer: payer.publicKey,
      identityAuthority: authority.publicKey,
      destination: closingRecipient.publicKey,
      project: closingProject,
      binding: closingBinding,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority, closingRecipient])
    .rpc();
  await activate();
  if (changedPreOwner)
    await setAuthority(
      provider.connection,
      payer,
      closingDestination,
      closingRecipient,
      AuthorityType.AccountOwner,
      priorOwner.publicKey,
    );
  const signature = await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      ...(changedPreOwner
        ? [
            createSetAuthorityInstruction(
              closingDestination,
              priorOwner.publicKey,
              AuthorityType.AccountOwner,
              closingRecipient.publicKey,
            ),
          ]
        : []),
      await program.methods
        .pay(bn(1))
        .accountsStrict({
          project: closingProject,
          obligation: closingObligation,
          binding: closingBinding,
          mint: closingMint,
          vault: closingVault,
          destination: closingDestination,
          tokenProgram: TOKEN_PROGRAM_ID,
          veto: closingVeto,
        })
        .instruction(),
      createTransferInstruction(
        closingDestination,
        closingSource,
        closingRecipient.publicKey,
        9_800_000n,
      ),
      createCloseAccountInstruction(
        closingDestination,
        payer.publicKey,
        closingRecipient.publicKey,
      ),
    ),
    [payer, closingRecipient, ...(changedPreOwner ? [priorOwner] : [])],
  );
  await provider.connection.confirmTransaction(signature, "finalized");
  const transaction = await parsedTransaction(signature);
  const destinationIndex =
    transaction.transaction.message.accountKeys.findIndex(
      (entry) => entry.pubkey === closingDestination.toBase58(),
    );
  assert.ok(destinationIndex >= 0);
  assert.equal(
    transaction.meta.postTokenBalances.find(
      (entry) => entry.accountIndex === destinationIndex,
    ),
    undefined,
  );
  assert.equal(
    transaction.meta.preTokenBalances.find(
      (entry) => entry.accountIndex === destinationIndex,
    )?.owner,
    (changedPreOwner ? priorOwner : closingRecipient).publicKey.toBase58(),
  );
  const [payment] = escrowInvocations(
    transaction,
    program.programId.toBase58(),
  );
  const adapter = solanaPaymentAdapter({
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: await provider.connection.getGenesisHash(),
    programId: program.programId.toBase58(),
    projectPda: closingProject.toBase58(),
    projectId: "local-closed-account",
    network: "solana:localnet",
    networkDomain: Buffer.from(network).toString("hex"),
    vault: closingVault.toBase58(),
    mint: closingMint.toBase58(),
    owner: payer.publicKey.toBase58(),
    identityAuthority: authority.publicKey.toBase58(),
    feeRecipient: feeOwner.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: String(DELAY),
    rotationDelaySeconds: String(ROTATION_DELAY),
  });
  const verified = adapter.verifyFinalized({
    transactionId: signature,
    eventIndex: payment.index,
    kind: "paid",
    obligationId: closingAward.toString("hex"),
  });
  if (changedPreOwner)
    await assert.rejects(verified, /Payout account balance missing/);
  else
    assert.equal(
      (await verified).destination,
      closingRecipient.publicKey.toBase58(),
    );
}
for (const changedPreOwner of [false, true])
  test(`payment verification ${changedPreOwner ? "refuses a different pre-owner on a closed payout account" : "handles a destination token account closed in the payout transaction"}`, () =>
    verifyClosedPayout(changedPreOwner));
