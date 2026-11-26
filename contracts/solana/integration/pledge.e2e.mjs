import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  createAccount,
  createMint,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Ed25519Program,
  Keypair,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  readSolanaMonthPledges,
  readVaultTotals,
  solanaAllocationRoot,
  solanaAwardId,
  solanaMonthlyMessage,
  solanaPledgeMonthsInstructions,
} from "../.local/adapter.mjs";
import { listProjects, migratePlan } from "../scripts/config-plan.mjs";
import {
  configAddress,
  configFees,
  configIdentity,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";
import { legacyMint } from "./legacy-project.mjs";
import {
  LAPSED_PERIOD,
  LAPSED_PLEDGE,
  OPEN_PLEDGE,
  openPeriodAt,
  PLEDGE_DEPOSIT,
  PLEDGE_NETWORK,
  PRE_PLEDGE_DEPOSIT,
  pledgeAddress,
  pledgeNetProject,
  pledgeOffProject,
  prePledgeProject,
  vaultAddress,
} from "./pledge-preload.mjs";

const { AnchorProvider, Program, BN, EventParser, BorshCoder } = anchor;
const provider = AnchorProvider.env();
const connection = provider.connection;
// Anchor otherwise fetches a processed blockhash for confirmed preflight.
const confirmedRpc = {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
};
const payer = provider.wallet.payer;
const idl = JSON.parse(readFileSync("target/idl/slop_escrow.json"));
const program = new Program(idl, provider);
const events = new EventParser(program.programId, new BorshCoder(idl));
const bn = (value) => new BN(String(value));
const sha = (value) => createHash("sha256").update(value).digest();
const pda = (...seeds) =>
  anchor.web3.PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
const pledgeAt = (project, period) => pledgeAddress(project, period)[0];
const monthAt = (project, period) =>
  pda(Buffer.from("month"), project.toBuffer(), u32(period));
const addMonths = (period, months) => {
  const index = Math.floor(period / 100) * 12 + (period % 100) - 1 + months;
  return Math.floor(index / 12) * 100 + (index % 12) + 1;
};
const chainTime = async () =>
  connection.getBlockTime(await connection.getSlot("confirmed"));
/** The UTC period containing the validator clock, as the program computes it. */
const currentPeriod = async () => {
  const now = new Date((await chainTime()) * 1000);
  return now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
};
const fetchProject = (project) =>
  program.account.project.fetch(project, "confirmed");
const fetchPledge = (project, period) =>
  program.account.monthPledge.fetchNullable(
    pledgeAt(project, period),
    "confirmed",
  );
async function eventsOf(signature) {
  await connection.confirmTransaction(signature, "confirmed");
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  // Anchor's parser keeps the IDL's PascalCase event names; compare in camelCase.
  return [...events.parseLogs(tx.meta.logMessages)].map((e) => ({
    ...e,
    name: e.name[0].toLowerCase() + e.name.slice(1),
  }));
}
const pledge = (project, period, amount, owner = payer) =>
  program.methods
    .pledgeMonth(period, bn(amount))
    .accountsStrict({
      owner: owner.publicKey,
      project,
      monthPledge: pledgeAt(project, period),
      systemProgram: SystemProgram.programId,
    })
    .signers(owner === payer ? [] : [owner])
    .rpc(confirmedRpc);
const expire = (project, period) =>
  program.methods
    .expirePledge(period)
    .accountsStrict({
      project,
      monthPledge: pledgeAt(project, period),
      month: monthAt(project, period),
    })
    .rpc(confirmedRpc);
const closePledge = (project, period, owner = payer) =>
  program.methods
    .closeMonthPledge(period)
    .accountsStrict({
      owner: owner.publicKey,
      project,
      monthPledge: pledgeAt(project, period),
    })
    .signers(owner === payer ? [] : [owner])
    .rpc(confirmedRpc);
const setMonthly = (project, cap, enabled) =>
  program.methods
    .setMonthlyCommitment(bn(cap), enabled)
    .accountsStrict({ owner: payer.publicKey, project })
    .rpc(confirmedRpc);
let ownerTokens;
async function ownerTokenAccount() {
  ownerTokens ??= await createAccount(
    connection,
    payer,
    legacyMint.publicKey,
    payer.publicKey,
    Keypair.generate(),
  );
  return ownerTokens;
}
const withdraw = async (project, gross) =>
  program.methods
    .withdraw(bn(gross))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint: legacyMint.publicKey,
      vault: vaultAddress(project),
      destination: await ownerTokenAccount(),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc(confirmedRpc);
function handCommit(project, name, gross) {
  const source = sha(`pledge-hand:${name}`);
  const award = Buffer.from(
    solanaAwardId(project.toBase58(), source.toString("hex")),
    "hex",
  );
  return program.methods
    .commit([...award], [...source], bn(77), bn(gross))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      vault: vaultAddress(project),
      origin: pda(Buffer.from("origin"), project.toBuffer(), source),
      obligation: pda(Buffer.from("award"), project.toBuffer(), award),
      systemProgram: SystemProgram.programId,
    })
    .rpc(confirmedRpc);
}
/**
 * The signed commit_monthly for `period` with one leaf of `total`. `pledge` is the pledge
 * period to name, null to pass the program ID ("none"), or "omit" to leave the trailing
 * optional account off entirely, as callers from before pledges do.
 */
async function commitMonthly(project, period, total, pledge) {
  const entries = [
    {
      githubUserId: "501",
      grossMicro: String(total),
      sourceDigest: sha(`pledge-monthly:${project}:${period}`).toString("hex"),
    },
  ];
  const root = solanaAllocationRoot(entries);
  const frozenAt = await chainTime();
  const label = `${Math.floor(period / 100)}-${String(period % 100).padStart(2, "0")}`;
  const message = solanaMonthlyMessage(
    program.programId.toBase58(),
    project.toBase58(),
    label,
    root,
    String(total),
    String(frozenAt),
    PLEDGE_NETWORK.toString("hex"),
  );
  const instruction = await program.methods
    .commitMonthly(
      period,
      [...Buffer.from(root, "hex")],
      bn(total),
      bn(frozenAt),
    )
    .accountsStrict({
      payer: payer.publicKey,
      project,
      vault: vaultAddress(project),
      month: monthAt(project, period),
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
      monthPledge:
        pledge === null || pledge === "omit" ? null : pledgeAt(project, pledge),
    })
    .instruction();
  if (pledge === "omit") {
    assert.equal(
      instruction.keys.at(-1).pubkey.equals(program.programId),
      true,
    );
    instruction.keys.pop();
  }
  return sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      Ed25519Program.createInstructionWithPrivateKey({
        privateKey: configIdentity.secretKey,
        message,
      }),
      instruction,
    ),
    [payer],
    { commitment: "confirmed" },
  );
}
const money = (value) => BigInt(value.toString());
const free = async (project) => {
  const p = await fetchProject(project);
  return (
    money(p.deposited) -
    money(p.paid) -
    money(p.payoutFees) -
    money(p.withdrawnGross) -
    money(p.reserved)
  );
};

// Owner decision of 15 November 2026: a pledge holds free funds to a month. It stops
// withdrawals and hand commits below it, survives the owner turning monthly off or cutting
// the cap, commits with the month and closes, and lapses only after the month's window.
test("a month pledge holds funds through every owner route until the month commits", async () => {
  await ensureConfig(program);
  const project = pledgeOffProject;
  const open = openPeriodAt(await chainTime());
  const current = await currentPeriod();
  assert.equal(money((await fetchProject(project)).pledgedOpen), 3_000_000n);
  assert.equal(await free(project), PLEDGE_DEPOSIT);

  // Withdrawals leave the open pledges in the vault.
  await assert.rejects(withdraw(project, 7_000_001), /PledgedFunds/);
  await withdraw(project, 1_000_000);
  assert.equal(await free(project), 9_000_000n);
  // So do the owner's hand commits.
  await assert.rejects(
    handCommit(project, "too-much", 6_000_001),
    /PledgedFunds/,
  );
  await handCommit(project, "fits", 1_000_000);
  assert.equal(await free(project), 8_000_000n);

  // A pledge lapses only once its month's window has closed and only once.
  await assert.rejects(expire(project, open), /PledgeNotLapsed/);
  const lapsed = await eventsOf(await expire(project, LAPSED_PERIOD));
  assert.deepEqual(
    lapsed.map((e) => [
      e.name,
      e.data.period,
      money(e.data.amount),
      e.data.reserved,
    ]),
    [["pledgeClosed", LAPSED_PERIOD, LAPSED_PLEDGE, false]],
  );
  assert.equal(money((await fetchProject(project)).pledgedOpen), OPEN_PLEDGE);
  await assert.rejects(expire(project, LAPSED_PERIOD), /PledgeNotLapsed/);

  // Live pledges: the current month up to 11 ahead, raise only, never above free funds.
  const pledged = await eventsOf(await pledge(project, current, 6_000_000));
  assert.deepEqual(
    pledged.map((e) => [e.name, e.data.period, money(e.data.amount)]),
    [["monthPledged", current, 6_000_000n]],
  );
  assert.equal(money((await fetchProject(project)).pledgedOpen), 8_000_000n);
  await assert.rejects(pledge(project, current, 5_999_999), /PledgeTooLow/);
  assert.deepEqual(
    await eventsOf(await pledge(project, current, 6_000_000)),
    [],
  );
  assert.equal(money((await fetchProject(project)).pledgedOpen), 8_000_000n);
  await assert.rejects(
    pledge(project, addMonths(current, 1), 1),
    /InsufficientFreeBalance/,
  );
  await assert.rejects(
    pledge(project, addMonths(current, -1), 1),
    /PledgePeriodClosed/,
  );
  await assert.rejects(
    pledge(project, addMonths(current, 12), 1),
    /PledgePeriodClosed/,
  );
  await assert.rejects(pledge(project, 202613, 1), /InvalidPeriod/);
  await assert.rejects(pledge(project, current, 0), /InvalidAmount/);
  const stranger = Keypair.generate();
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: stranger.publicKey,
        lamports: 100_000_000,
      }),
    ),
    [payer],
  );
  await assert.rejects(
    pledge(project, current, 7_000_000, stranger),
    /ConstraintHasOne|has one/,
  );
  await assert.rejects(withdraw(project, 1), /PledgedFunds/);

  // The off-chain routes: the monthly switch off and a cut cap stop only unpledged months.
  await setMonthly(project, 100, false);
  await assert.rejects(
    commitMonthly(project, open, 1_500_000, null),
    /MonthlyDisabled/,
  );
  await assert.rejects(
    commitMonthly(project, open, 1_500_000, "omit"),
    /MonthlyDisabled/,
  );
  await assert.rejects(
    commitMonthly(project, open, 2_000_001, open),
    /MonthlyCapExceeded/,
  );
  // Another month's pledge does not unlock this month.
  await assert.rejects(
    commitMonthly(project, open, 1_500_000, current),
    /ConstraintSeeds|seeds constraint/,
  );
  // With the switch off the pledge alone is the limit, whatever the cap says.
  await setMonthly(project, 5_000_000, false);
  await assert.rejects(
    commitMonthly(project, open, 2_000_001, open),
    /MonthlyCapExceeded/,
  );
  // With monthly on and a cap above the pledge, a month still never takes funds another
  // month's open pledge holds: 8 - 3.000001 < 8 - 2.
  await setMonthly(project, 5_000_000, true);
  await assert.rejects(
    commitMonthly(project, open, 3_000_001, open),
    /PledgedFunds/,
  );
  await setMonthly(project, 1, false);
  const committed = await eventsOf(
    await commitMonthly(project, open, 1_500_000, open),
  );
  assert.deepEqual(
    committed.map((e) => e.name),
    ["monthlyCommitted", "pledgeClosed"],
  );
  assert.equal(money(committed[1].data.amount), OPEN_PLEDGE);
  assert.equal(committed[1].data.reserved, true);
  const after = await fetchProject(project);
  assert.equal(money(after.pledgedOpen), 6_000_000n);
  assert.equal(money(after.monthlyOutstanding), 1_500_000n);
  assert.equal((await fetchPledge(project, open)).open, false);
  // The unreserved half million of the closed pledge is the owner's again.
  assert.equal(await free(project), 6_500_000n);
  await assert.rejects(withdraw(project, 500_001), /PledgedFunds/);
  await withdraw(project, 500_000);
  // A closed pledge never closes again; the current month's has not lapsed.
  await assert.rejects(expire(project, open), /PledgeNotLapsed/);
  await assert.rejects(expire(project, current), /PledgeNotLapsed/);
  assert.equal(money((await fetchProject(project)).pledgedOpen), 6_000_000n);

  // A closed pledge's rent goes back to the owner, and only the owner closes it. An open
  // pledge stays, and a closed period is past, so it can never be pledged again.
  await assert.rejects(closePledge(project, current), /PledgeOpen/);
  await assert.rejects(
    closePledge(project, open, stranger),
    /ConstraintHasOne|has one/,
  );
  const rent = await connection.getBalance(
    pledgeAt(project, open),
    "confirmed",
  );
  const before = await connection.getBalance(payer.publicKey, "confirmed");
  const signature = await closePledge(project, open);
  const { fee } = (
    await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    })
  ).meta;
  assert.ok(rent > 0);
  assert.equal(
    await connection.getBalance(payer.publicKey, "confirmed"),
    before + rent - fee,
  );
  assert.equal(await fetchPledge(project, open), null);
  await assert.rejects(pledge(project, open, 1), /PledgePeriodClosed/);
  await assert.rejects(
    closePledge(project, open),
    /AccountNotInitialized|not initialized/,
  );
  await closePledge(project, LAPSED_PERIOD);
  assert.equal(await fetchPledge(project, LAPSED_PERIOD), null);
  assert.equal(money((await fetchProject(project)).pledgedOpen), 6_000_000n);
});

// A caller from before pledges leaves the trailing account off. The month then counts the
// whole open total, and anyone closes the pledge as soon as the month exists.
test("a month committed without its pledge closes that pledge at once", async () => {
  const project = pledgeNetProject;
  const open = openPeriodAt(await chainTime());
  await commitMonthly(project, open, 1_000_000, "omit");
  assert.equal((await fetchPledge(project, open)).open, true);
  assert.equal(money((await fetchProject(project)).pledgedOpen), OPEN_PLEDGE);
  const closed = await eventsOf(await expire(project, open));
  assert.deepEqual(
    closed.map((e) => [e.name, money(e.data.amount), e.data.reserved]),
    [["pledgeClosed", OPEN_PLEDGE, true]],
  );
  assert.equal(money((await fetchProject(project)).pledgedOpen), 0n);
  await assert.rejects(expire(project, open), /PledgeNotLapsed/);
});

test("a bounty project cannot pledge", async () => {
  await ensureConfig(program);
  const mint = await createMint(connection, payer, payer.publicKey, null, 6);
  const id = [...sha(`pledge-bounty${process.env.SLOP_E2E_RUN ?? ""}`)];
  const project = pda(
    Buffer.from("project"),
    payer.publicKey.toBuffer(),
    Buffer.from(id),
    Buffer.from([1]),
  );
  await program.methods
    .initialize(
      id,
      [...PLEDGE_NETWORK],
      configIdentity.publicKey,
      configFees.publicKey,
      bn(0),
      bn(0),
      { bounty: {} },
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault: vaultAddress(project),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc(confirmedRpc);
  await assert.rejects(
    pledge(project, await currentPeriod(), 1),
    /WrongPurpose/,
  );
});

// Live mainnet vaults hold 332-byte projects. After the program upgrade each needs one
// permissionless migrate_project; the migrated project reads no pledges and works as before.
test("migrate_project grows a 332-byte Project, which then pledges through the adapter's instructions", async () => {
  const project = prePledgeProject;
  const runtime = {
    rpcUrl: connection.rpcEndpoint,
    expectedGenesis: await connection.getGenesisHash(),
  };
  const reader = () =>
    readSolanaMonthPledges({
      rpcUrl: connection.rpcEndpoint,
      programId: program.programId.toBase58(),
      projectPda: project.toBase58(),
      periods: [current, ahead],
    });
  const current = await currentPeriod();
  const ahead = addMonths(current, 11);
  const row = async () =>
    (
      await listProjects({ programId: program.programId.toBase58() }, runtime)
    ).projects.find((p) => p.address === project.toBase58());
  assert.equal((await row()).size, 332);
  assert.equal((await row()).migrationRequired, true);
  // The adapter reads its totals and no pledges; the program reads nothing until migrated.
  assert.equal(await reader(), null);
  const totals = await readVaultTotals({
    rpcUrl: connection.rpcEndpoint,
    network: "solana-localnet",
    projectPda: project.toBase58(),
    programId: program.programId.toBase58(),
  });
  assert.equal(totals.freeBalance, String(PRE_PLEDGE_DEPOSIT));
  await assert.rejects(pledge(project, current, 1), /AccountDidNotDeserialize/);
  const block = await connection.getLatestBlockhash("finalized");
  const plan = await migratePlan(
    {
      programId: program.programId.toBase58(),
      payer: payer.publicKey.toBase58(),
      ...expectedDeployment,
    },
    { ...runtime, recentBlockhash: block.blockhash },
  );
  const planned = plan.transactions.find(
    (t) => t.project === project.toBase58(),
  );
  assert.ok(planned);
  const transaction = Transaction.from(
    Buffer.from(planned.transactionBase64, "base64"),
  );
  transaction.sign(payer);
  await connection.confirmTransaction(
    await connection.sendRawTransaction(transaction.serialize()),
    "finalized",
  );
  const info = await connection.getAccountInfo(project, "finalized");
  assert.equal(info.data.length, 340);
  assert.ok(
    info.lamports >= (await connection.getMinimumBalanceForRentExemption(340)),
  );
  const state = await fetchProject(project);
  assert.equal(money(state.pledgedOpen), 0n);
  assert.equal(money(state.deposited), PRE_PLEDGE_DEPOSIT);
  assert.equal(money(state.monthlyCap), 7n);
  assert.equal(state.monthlyEnabled, true);
  assert.equal((await row()).migrationRequired, false);
  assert.equal((await row()).pinned, true);
  await assert.rejects(
    program.methods
      .migrateProject()
      .accountsStrict({
        payer: payer.publicKey,
        project,
        systemProgram: SystemProgram.programId,
      })
      .rpc(confirmedRpc),
    /NotLegacyProject/,
  );
  assert.deepEqual(await reader(), {
    openPledgedGross: 0n,
    pledges: [
      { period: current, amount: 0n, open: false },
      { period: ahead, amount: 0n, open: false },
    ],
  });
  // One transaction pledges the current month and the eleventh month ahead.
  const instructions = solanaPledgeMonthsInstructions(
    {
      programId: program.programId.toBase58(),
      projectPda: project.toBase58(),
      owner: payer.publicKey.toBase58(),
    },
    {
      wallet: payer.publicKey.toBase58(),
      periods: [current, ahead],
      amountMinor: 1_500_000n,
    },
  );
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      ...instructions.map(
        (ix) =>
          new TransactionInstruction({
            programId: new anchor.web3.PublicKey(ix.program),
            keys: ix.accounts.map((a) => ({
              pubkey: new anchor.web3.PublicKey(a.key),
              isSigner: a.key === payer.publicKey.toBase58(),
              isWritable: a.write,
            })),
            data: Buffer.from(ix.data),
          }),
      ),
    ),
    [payer],
    { commitment: "finalized" },
  );
  assert.deepEqual(await reader(), {
    openPledgedGross: 3_000_000n,
    pledges: [
      { period: current, amount: 1_500_000n, open: true },
      { period: ahead, amount: 1_500_000n, open: true },
    ],
  });
  await assert.rejects(withdraw(project, 1_000_001), /PledgedFunds/);
  const destination = await ownerTokenAccount();
  const before = (await getAccount(connection, destination)).amount;
  await withdraw(project, 1_000_000);
  assert.equal(
    (await getAccount(connection, destination)).amount - before,
    980_000n,
  );
});
