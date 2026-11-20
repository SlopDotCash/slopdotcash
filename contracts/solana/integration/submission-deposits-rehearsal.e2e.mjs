/** Rehearsal of a mainnet deployment on a local validator: the thirty-day delay, a mint at
 * the mainnet USDC address (local bytes: classic SPL, six decimals, a freeze authority), the
 * real fee wallet address as the kept wallet, the item hash the site computes, the reads the
 * Worker will make, and removal of the upgrade authority. Local funds and fixture keys only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { freezeAccount, mintTo, thawAccount } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { submissionFeeItem } from "../../../src/lib/submission-fee.mjs";
import {
  initializePlan,
  RECLAIM_DELAY_SECONDS,
  status,
  vaultPlan,
} from "../scripts/submission-deposits-plan.mjs";
import {
  addresses,
  ata,
  BPF_UPGRADEABLE_LOADER,
  balance,
  chainTime,
  context,
  deposit,
  fixtureKey,
  fund,
  initialize,
  PRODUCTION_DELAY,
  PROGRAM_PATH,
  programId,
  readConfig,
  readDeposit,
  readLedger,
  reclaim,
  refuses,
  resolve,
  tokens,
} from "./submission-deposits.mjs";
import {
  AGED_AMOUNT,
  AGED_EARLY,
  AGED_REACHED,
  agedKept,
  agedMint,
  agedPayer,
  FEE_WALLET,
  USDC_MINT,
  usdcAuthority,
} from "./submission-deposits-preload.mjs";

const { connection, payer } = context;
const owner = fixtureKey("owner");
const resolver = fixtureKey("resolver");
const contributor = Keypair.generate();
const FEE = 2_000_000n; // 2.00 USDC
const note = (line) => console.log(`  rehearsal: ${line}`);
const discriminator = (kind, name) =>
  createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
// What the owner writes into the runbook's reviewed input file.
const reviewed = {
  programId: programId.toBase58(),
  upgradeAuthority: payer.publicKey.toBase58(),
  codeSha256: createHash("sha256")
    .update(readFileSync(PROGRAM_PATH))
    .digest("hex"),
  owner: owner.publicKey.toBase58(),
  resolver: resolver.publicKey.toBase58(),
  mint: USDC_MINT.toBase58(),
  payer: payer.publicKey.toBase58(),
};
const runtime = async () => ({
  rpcUrl: connection.rpcEndpoint,
  expectedGenesis: await connection.getGenesisHash(),
  recentBlockhash: (await connection.getLatestBlockhash("finalized")).blockhash,
});
/** Signs a plan's unsigned transaction as its one required signer would, and sends it. */
async function signAndSend(plan, signer) {
  assert.equal(plan.format, "solana-unsigned-legacy-transaction-v1");
  assert.equal(plan.requiredSigner, signer.publicKey.toBase58());
  const transaction = Transaction.from(
    Buffer.from(plan.transactionBase64, "base64"),
  );
  assert.equal(transaction.instructions.length, 1);
  assert.equal(
    transaction.instructions[0].programId.toBase58(),
    programId.toBase58(),
  );
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
  );
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, "finalized");
  return signature;
}

test("fixtures", async () => {
  for (const key of [owner, resolver, contributor, agedPayer, usdcAuthority])
    await fund(key);
  const mint = await connection.getParsedAccountInfo(USDC_MINT);
  assert.equal(mint.value.data.parsed.info.decimals, 6);
  assert.ok(mint.value.data.parsed.info.freezeAuthority);
  await tokens(USDC_MINT, contributor.publicKey);
  await mintTo(
    connection,
    payer,
    USDC_MINT,
    ata(contributor.publicKey, USDC_MINT),
    usdcAuthority,
    10n * FEE,
  );
});

test("the runbook's plan builds the one initialize transaction and refuses a wrong cluster, build, authority or roles", async () => {
  const at = await runtime();
  assert.equal(RECLAIM_DELAY_SECONDS, PRODUCTION_DELAY);
  await assert.rejects(
    initializePlan(reviewed, {
      ...at,
      expectedGenesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    }),
    /Wrong cluster genesis/,
  );
  await assert.rejects(
    initializePlan({ ...reviewed, codeSha256: "0".repeat(64) }, at),
    /Reviewed program digest mismatch/,
  );
  await assert.rejects(
    initializePlan(
      { ...reviewed, upgradeAuthority: owner.publicKey.toBase58() },
      at,
    ),
    /Upgrade authority mismatch/,
  );
  await assert.rejects(
    initializePlan({ ...reviewed, programId: USDC_MINT.toBase58() }, at),
    /IDL program identity mismatch/,
  );
  await assert.rejects(
    initializePlan({ ...reviewed, resolver: reviewed.owner }, at),
    /nonzero and distinct/,
  );
  const plan = await initializePlan(reviewed, at);
  assert.equal(plan.config, addresses.config().toBase58());
  assert.equal(plan.reclaimDelaySeconds, 2_592_000);
  assert.equal(plan.owner, reviewed.owner);
  assert.equal(plan.resolver, reviewed.resolver);
  await signAndSend(plan, payer);
  const config = await readConfig();
  assert.equal(config.reclaimDelay.toNumber(), 2_592_000);
  assert.equal(config.owner.toBase58(), reviewed.owner);
  assert.equal(config.resolver.toBase58(), reviewed.resolver);
  await assert.rejects(
    initializePlan(reviewed, await runtime()),
    /Config already exists/,
  );
  note(
    `program ${programId.toBase58()}, config ${addresses.config().toBase58()}`,
  );
});

test("the USDC vault opens through the plan and the fee wallet's USDC account is the kept destination", async () => {
  // An account that is not a mint has no vault.
  await assert.rejects(
    vaultPlan(
      { ...reviewed, mint: ata(contributor.publicKey, USDC_MINT).toBase58() },
      await runtime(),
    ),
    /not a classic SPL Token mint/,
  );
  const plan = await vaultPlan(reviewed, await runtime());
  assert.equal(plan.decimals, 6);
  assert.equal(plan.freezeAuthority, usdcAuthority.publicKey.toBase58());
  assert.equal(plan.vault, addresses.vault(USDC_MINT).toBase58());
  await signAndSend(plan, payer);
  await assert.rejects(vaultPlan(reviewed, await runtime()), /already open/);
  // Anyone can create the associated token account of any wallet; no key of the fee wallet
  // is used. On mainnet this account must exist before a fee can be kept.
  const keptAccount = await tokens(USDC_MINT, FEE_WALLET);
  assert.equal(keptAccount.toBase58(), ata(FEE_WALLET, USDC_MINT).toBase58());
  note(`USDC vault ${addresses.vault(USDC_MINT).toBase58()}`);
  note(`fee wallet USDC account ${keptAccount.toBase58()}`);
});

test("a 2 USDC fee for a pull request is refunded in full on a merge", async () => {
  const item = Buffer.from(
    submissionFeeItem(1_234_567_890, 4321).slice(2),
    "hex",
  );
  const account = ata(contributor.publicKey, USDC_MINT);
  const { id } = await deposit({
    from: contributor,
    mint: USDC_MINT,
    amount: FEE,
    keptTo: FEE_WALLET,
    item,
  });
  const record = await readDeposit(id);
  assert.equal(
    `0x${Buffer.from(record.item).toString("hex")}`,
    submissionFeeItem(1_234_567_890, 4321),
  );
  assert.equal(await balance(account), 9n * FEE);
  await resolve({ resolver, id, refund: true });
  assert.equal(await balance(account), 10n * FEE);
  assert.equal(await balance(ata(FEE_WALLET, USDC_MINT)), 0n);
});

test("a kept fee reaches the fee wallet's USDC account and nothing else", async () => {
  const { id } = await deposit({
    from: contributor,
    mint: USDC_MINT,
    amount: FEE,
    keptTo: FEE_WALLET,
  });
  await resolve({ resolver, id, refund: false });
  assert.equal(await balance(ata(FEE_WALLET, USDC_MINT)), FEE);
  assert.equal(await balance(ata(contributor.publicKey, USDC_MINT)), 9n * FEE);
  assert.equal(await balance(addresses.vault(USDC_MINT)), 0n);
  assert.equal((await readLedger(USDC_MINT)).openTotal.toNumber(), 0);
});

test("a payer the issuer has frozen cannot be refunded; the deposit can still be kept", async () => {
  const account = ata(contributor.publicKey, USDC_MINT);
  const { id } = await deposit({
    from: contributor,
    mint: USDC_MINT,
    amount: FEE,
    keptTo: FEE_WALLET,
  });
  await freezeAccount(connection, payer, account, USDC_MINT, usdcAuthority);
  await refuses(
    resolve({ resolver, id, refund: true }),
    /frozen|custom program error: 0x11\b/i,
  );
  assert.ok(await readDeposit(id));
  await resolve({ resolver, id, refund: false });
  assert.equal(await balance(ata(FEE_WALLET, USDC_MINT)), 2n * FEE);
  await thawAccount(connection, payer, account, USDC_MINT, usdcAuthority);
});

test("reclaim opens after thirty days and not an hour before", async () => {
  // A deposit made now cannot be reclaimed.
  const fresh = await deposit({
    from: contributor,
    mint: USDC_MINT,
    amount: FEE,
    keptTo: FEE_WALLET,
  });
  await refuses(
    reclaim({ from: contributor, id: fresh.id }),
    /ReclaimTooEarly/,
  );
  // Two deposits loaded at genesis: one five minutes past thirty days, one an hour short.
  const now = await chainTime();
  const reachedRecord = await readDeposit(AGED_REACHED);
  const earlyRecord = await readDeposit(AGED_EARLY);
  assert.ok(now - reachedRecord.depositedAt.toNumber() >= PRODUCTION_DELAY);
  assert.ok(now - earlyRecord.depositedAt.toNumber() < PRODUCTION_DELAY);
  const account = await tokens(agedMint, agedPayer.publicKey);
  await tokens(agedMint, agedKept);
  await refuses(
    reclaim({ from: agedPayer, id: AGED_EARLY }),
    /ReclaimTooEarly/,
  );
  // Nobody but the payer, even after the thirty days.
  await refuses(
    reclaim({
      from: contributor,
      id: AGED_REACHED,
      destination: await tokens(agedMint, contributor.publicKey),
    }),
    /NotPayer/,
  );
  await reclaim({ from: agedPayer, id: AGED_REACHED });
  assert.equal(await balance(account), AGED_AMOUNT);
  assert.equal(await readDeposit(AGED_REACHED), null);
  assert.equal(await balance(addresses.vault(agedMint)), AGED_AMOUNT);
  assert.equal(
    (await readLedger(agedMint)).openTotal.toString(),
    AGED_AMOUNT.toString(),
  );
  // The resolver can still settle the one that is an hour short.
  await resolve({ resolver, id: AGED_EARLY, refund: false });
  assert.equal(await balance(ata(agedKept, agedMint)), AGED_AMOUNT);
  assert.equal(await balance(addresses.vault(agedMint)), 0n);
});

test("the Worker's reads: finalized accounts by id, and the outcome of a closed deposit from its transaction", async () => {
  const item = Buffer.alloc(32, 3);
  const open = await deposit({
    from: contributor,
    mint: USDC_MINT,
    amount: FEE,
    keptTo: FEE_WALLET,
    item,
  });
  const closed = await deposit({
    from: contributor,
    mint: USDC_MINT,
    amount: FEE,
    keptTo: FEE_WALLET,
  });
  const closing = await resolve({ resolver, id: closed.id, refund: true });
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: closing, ...latest },
    "finalized",
  );

  // 1. Config, decoded by hand from the layout in the interface file.
  const config = await connection.getAccountInfo(
    addresses.config(),
    "finalized",
  );
  assert.equal(config.owner.toBase58(), programId.toBase58());
  assert.deepEqual(
    config.data.subarray(0, 8),
    discriminator("account", "Config"),
  );
  assert.equal(
    new PublicKey(config.data.subarray(8, 40)).toBase58(),
    owner.publicKey.toBase58(),
  );
  assert.equal(
    new PublicKey(config.data.subarray(72, 104)).toBase58(),
    resolver.publicKey.toBase58(),
  );
  assert.equal(config.data.readBigInt64LE(104), BigInt(PRODUCTION_DELAY));
  const count = config.data.readBigUInt64LE(112);
  assert.equal(count, closed.id);
  assert.equal(config.data[120], 0);

  // 2. Every id up to the count, in one read. Present means open; absent means settled.
  const ids = [];
  for (let id = 1n; id <= count; id++) ids.push(id);
  const records = await connection.getMultipleAccountsInfo(
    ids.map((id) => addresses.deposit(id)),
    "finalized",
  );
  const present = ids.filter((_, index) => records[index] !== null);
  assert.deepEqual(present, [open.id - 1n, open.id]);
  const data = records[Number(open.id) - 1].data;
  assert.equal(
    records[Number(open.id) - 1].owner.toBase58(),
    programId.toBase58(),
  );
  assert.equal(data.length, 161);
  assert.deepEqual(data.subarray(0, 8), discriminator("account", "Deposit"));
  assert.equal(data.readBigUInt64LE(8), open.id);
  assert.equal(
    new PublicKey(data.subarray(16, 48)).toBase58(),
    contributor.publicKey.toBase58(),
  );
  assert.equal(
    new PublicKey(data.subarray(48, 80)).toBase58(),
    USDC_MINT.toBase58(),
  );
  assert.equal(
    new PublicKey(data.subarray(80, 112)).toBase58(),
    FEE_WALLET.toBase58(),
  );
  assert.deepEqual(data.subarray(112, 144), item);
  assert.equal(data.readBigUInt64LE(144), FEE);
  const depositedAt = Number(data.readBigInt64LE(152));

  // 3. The creating transaction of the open deposit, and its block time.
  const history = await connection.getSignaturesForAddress(
    addresses.deposit(open.id),
    {},
    "finalized",
  );
  assert.equal(history.at(-1).signature, open.signature);
  assert.ok(Math.abs(history.at(-1).blockTime - depositedAt) <= 2);
  const creating = await connection.getTransaction(open.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  const ours = (transaction) =>
    transaction.transaction.message.compiledInstructions.filter((instruction) =>
      transaction.transaction.message.staticAccountKeys[
        instruction.programIdIndex
      ].equals(programId),
    );
  const [made] = ours(creating);
  const madeData = Buffer.from(made.data);
  assert.deepEqual(madeData.subarray(0, 8), discriminator("global", "deposit"));
  assert.deepEqual(madeData.subarray(8, 40), item);
  assert.equal(madeData.readBigUInt64LE(40), FEE);
  assert.equal(
    new PublicKey(madeData.subarray(48, 80)).toBase58(),
    FEE_WALLET.toBase58(),
  );

  // 4. A settled deposit: the newest transaction on its address says how it ended.
  const [last] = await connection.getSignaturesForAddress(
    addresses.deposit(closed.id),
    { limit: 1 },
    "finalized",
  );
  assert.equal(last.signature, closing);
  assert.equal(last.err, null);
  const ending = await connection.getTransaction(closing, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  const [settled] = ours(ending);
  const settledData = Buffer.from(settled.data);
  assert.deepEqual(
    settledData.subarray(0, 8),
    discriminator("global", "resolve"),
  );
  assert.equal(settledData[8], 1); // refunded
  note(`finalized read of ${count} ids: open ${present.join(", ")}`);

  // 5. The runbook's read-back of the same finalized state.
  const read = await status(reviewed, await runtime());
  assert.equal(read.upgradeable, true);
  assert.deepEqual(read.config, {
    address: addresses.config().toBase58(),
    owner: reviewed.owner,
    pendingOwner: null,
    resolver: reviewed.resolver,
    reclaimDelaySeconds: 2_592_000,
    depositCount: count.toString(),
    depositsPaused: false,
  });
  assert.equal(read.vault.address, addresses.vault(USDC_MINT).toBase58());
  assert.equal(read.vault.openTotal, (2n * FEE).toString());
  assert.equal(read.vault.balance, read.vault.openTotal);
});

test("with the upgrade authority removed the program keeps working and cannot be initialized again", async () => {
  const programData = addresses.programData();
  const before = await connection.getAccountInfo(programData);
  assert.equal(before.data[12], 1);
  assert.equal(
    new PublicKey(before.data.subarray(13, 45)).toBase58(),
    payer.publicKey.toBase58(),
  );
  // The loader's SetAuthority with no new authority: what
  // `solana program set-upgrade-authority <program> --final` sends.
  const instruction = Buffer.alloc(4);
  instruction.writeUInt32LE(4);
  const removal = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      new TransactionInstruction({
        programId: BPF_UPGRADEABLE_LOADER,
        keys: [
          { pubkey: programData, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        data: instruction,
      }),
    ),
    [payer],
  );
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: removal, ...latest },
    "finalized",
  );
  // The read-back now says nobody can replace the code, and the old input is refused.
  const read = await status(
    { ...reviewed, upgradeAuthority: null },
    await runtime(),
  );
  assert.equal(read.upgradeable, false);
  assert.equal(read.config.reclaimDelaySeconds, 2_592_000);
  await assert.rejects(
    status(reviewed, await runtime()),
    /Upgrade authority mismatch/,
  );
  await assert.rejects(
    initializePlan(reviewed, await runtime()),
    /Upgrade authority mismatch/,
  );
  const after = await connection.getAccountInfo(programData);
  assert.equal(after.data[12], 0, "no upgrade authority remains");
  assert.deepEqual(after.data.subarray(45), before.data.subarray(45));
  // The former authority cannot take it back.
  await assert.rejects(
    sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        new TransactionInstruction({
          programId: BPF_UPGRADEABLE_LOADER,
          keys: [
            { pubkey: programData, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: payer.publicKey, isSigner: false, isWritable: false },
          ],
          data: instruction,
        }),
      ),
      [payer],
    ),
  );
  await refuses(
    initialize({
      owner: payer.publicKey,
      resolver: resolver.publicKey,
      delay: 1,
    }),
    /already in use|NotUpgradeAuthority/,
  );
  // Deposits, settlement and owner actions do not depend on the authority.
  const { id } = await deposit({
    from: contributor,
    mint: USDC_MINT,
    amount: FEE,
    keptTo: FEE_WALLET,
  });
  await resolve({ resolver, id, refund: true });
  assert.equal((await readConfig()).reclaimDelay.toNumber(), PRODUCTION_DELAY);
  note("upgrade authority removed; deposit and refund still work");
});
