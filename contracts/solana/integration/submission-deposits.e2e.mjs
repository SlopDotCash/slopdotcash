/** Every instruction of the submission deposit program, with its refusals, on a local
 * validator whose reclaim delay is six seconds. Mirrors contracts/evm/test/SubmissionDeposits.t.sol.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthorityType,
  closeAccount,
  createAccount,
  createMint,
  freezeAccount,
  setAuthority,
  TOKEN_2022_PROGRAM_ID,
  thawAccount,
  transfer,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  acceptOwnership,
  addresses,
  ata,
  BN,
  balance,
  chainTime,
  context,
  deposit,
  depositAt,
  depositCall,
  events,
  exists,
  fixtureKey,
  freshNonce,
  fund,
  idl,
  initialize,
  lamports,
  landed,
  newMint,
  openDeposits,
  openVault,
  pauseDeposits,
  readConfig,
  readDeposit,
  readLedger,
  reclaim,
  refuses,
  resolve,
  resolveCall,
  SHORT_DELAY,
  setResolver,
  snapshot,
  TOKEN_PROGRAM_ID,
  tokens,
  transferOwnership,
  u64,
  waitForChainTime,
} from "./submission-deposits.mjs";

const { connection, payer, provider } = context;
const owner = fixtureKey("owner");
const resolver = fixtureKey("resolver");
const kept = fixtureKey("kept-wallet").publicKey;
const stranger = Keypair.generate();
const alice = Keypair.generate();
const bob = Keypair.generate();
const FEE = 2_000_000n;
let mint;
let keptAccount;
/** Deposits the early tests leave open; the last test settles them. */
const leftOpen = [];

test("fixtures", async () => {
  for (const key of [owner, resolver, stranger, alice, bob]) await fund(key);
});

test("only the upgrade authority initializes, once, with distinct roles and a bounded delay", async () => {
  const good = {
    owner: owner.publicKey,
    resolver: resolver.publicKey,
    delay: SHORT_DELAY,
  };
  await refuses(
    initialize({ ...good, authority: stranger }),
    /NotUpgradeAuthority/,
  );
  for (const bad of [
    { owner: PublicKey.default },
    { resolver: PublicKey.default },
    { resolver: owner.publicKey },
    { delay: 0 },
    { delay: -1 },
    { delay: 365 * 86_400 + 1 },
  ])
    await refuses(initialize({ ...good, ...bad }), /InvalidInput/);
  assert.equal(await exists(addresses.config()), false);
  // The largest delay a deployment may fix is accepted in simulation and changes nothing.
  const largest = await context.program.methods
    .initialize(owner.publicKey, resolver.publicKey, new BN(365 * 86_400))
    .accountsStrict({
      authority: payer.publicKey,
      config: addresses.config(),
      program: context.program.programId,
      programData: addresses.programData(),
      systemProgram: SystemProgram.programId,
    })
    .simulate();
  assert.ok(largest);
  assert.equal(await exists(addresses.config()), false);
  const signature = await initialize(good);
  const config = await readConfig();
  assert.equal(config.owner.toBase58(), owner.publicKey.toBase58());
  assert.equal(config.resolver.toBase58(), resolver.publicKey.toBase58());
  assert.equal(config.pendingOwner.toBase58(), PublicKey.default.toBase58());
  assert.equal(config.reclaimDelay.toNumber(), SHORT_DELAY);
  assert.equal(config.depositCount.toNumber(), 0);
  assert.equal(config.depositsPaused, false);
  const [initialized] = await events(signature);
  assert.equal(initialized.name, "initialized");
  assert.equal(initialized.data.reclaimDelay.toNumber(), SHORT_DELAY);
  // A second call cannot replace the roles or the delay, whoever signs.
  await refuses(
    initialize({ ...good, owner: stranger.publicKey }),
    /already in use/,
  );
  assert.equal(
    (await readConfig()).owner.toBase58(),
    owner.publicKey.toBase58(),
  );
});

test("the program offers exactly its nine instructions and no way to move tokens otherwise", () => {
  assert.deepEqual(idl.instructions.map((entry) => entry.name).sort(), [
    "accept_ownership",
    "deposit",
    "initialize",
    "open_vault",
    "pause_deposits",
    "reclaim",
    "resolve",
    "set_resolver",
    "transfer_ownership",
  ]);
});

test("anyone opens the vault of a classic mint, once; other token programs are refused", async () => {
  mint = await newMint(6);
  const before = await lamports(stranger.publicKey);
  const signature = await openVault(mint, { funder: stranger });
  assert.ok((await lamports(stranger.publicKey)) < before);
  const ledger = await readLedger(mint);
  assert.equal(ledger.mint.toBase58(), mint.toBase58());
  assert.equal(ledger.openTotal.toNumber(), 0);
  const vault = await connection.getParsedAccountInfo(addresses.vault(mint));
  assert.equal(vault.value.owner.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(vault.value.data.parsed.info.mint, mint.toBase58());
  assert.equal(
    vault.value.data.parsed.info.owner,
    addresses.ledger(mint).toBase58(),
  );
  assert.equal(vault.value.data.parsed.info.tokenAmount.amount, "0");
  assert.equal(vault.value.data.parsed.info.delegate, undefined);
  assert.equal(vault.value.data.parsed.info.closeAuthority, undefined);
  const [opened] = await events(signature);
  assert.equal(opened.name, "vaultOpened");
  assert.equal(opened.data.vault.toBase58(), addresses.vault(mint).toBase58());
  await refuses(openVault(mint), /already in use/);

  const modern = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6,
    Keypair.generate(),
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  await refuses(openVault(modern), /AccountOwnedByWrongProgram/);
  // A classic mint cannot be opened through the Token-2022 program either.
  const other = await newMint(6);
  await refuses(
    openVault(other, { accounts: { tokenProgram: TOKEN_2022_PROGRAM_ID } }),
    /InvalidProgramId/,
  );
  // A token account is not a mint.
  const notAMint = await tokens(mint, stranger.publicKey);
  await refuses(
    openVault(notAMint),
    /InvalidAccountData|AccountDidNotDeserialize|invalid account data/i,
  );
  // A vault address derived for another mint is refused.
  await refuses(
    openVault(other, { accounts: { vault: addresses.vault(mint) } }),
    /ConstraintSeeds/,
  );
});

test("a deposit records every field, moves exactly the amount and emits", async () => {
  keptAccount = await tokens(mint, kept);
  const source = await tokens(mint, alice.publicKey, 10n * FEE);
  const item = Buffer.from(
    "5c0f3a7d1e9b42866a1d0c3b9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
    "hex",
  );
  const sol = await lamports(alice.publicKey);
  const before = await chainTime();
  const nonce = 0xfeed_0000_0000_0001n;
  const { id, signature, address } = await deposit({
    from: alice,
    mint,
    amount: FEE,
    keptTo: kept,
    item,
    nonce,
  });
  assert.equal(id, 1n);
  // The record sits at the address of (payer, nonce), whatever the count was.
  assert.equal(
    address.toBase58(),
    PublicKey.findProgramAddressSync(
      [Buffer.from("deposit"), alice.publicKey.toBuffer(), u64(nonce)],
      context.program.programId,
    )[0].toBase58(),
  );
  const record = await readDeposit(id);
  assert.equal(record.id.toString(), "1");
  assert.equal(record.nonce.toString(), nonce.toString());
  assert.equal(record.payer.toBase58(), alice.publicKey.toBase58());
  assert.equal(record.mint.toBase58(), mint.toBase58());
  assert.equal(record.keptTo.toBase58(), kept.toBase58());
  assert.deepEqual(Buffer.from(record.item), item);
  assert.equal(record.amount.toString(), FEE.toString());
  assert.ok(record.depositedAt.toNumber() >= before);
  assert.ok(record.depositedAt.toNumber() <= (await chainTime()));
  assert.equal((await readConfig()).depositCount.toNumber(), 1);
  assert.equal((await readLedger(mint)).openTotal.toString(), FEE.toString());
  assert.equal(await balance(addresses.vault(mint)), FEE);
  assert.equal(await balance(source), 9n * FEE);
  // The payer paid the rent of the 169-byte record and nothing else.
  const info = await connection.getAccountInfo(depositAt(id));
  assert.equal(info.data.length, 169);
  assert.equal(info.owner.toBase58(), context.program.programId.toBase58());
  assert.equal(
    info.lamports,
    await connection.getMinimumBalanceForRentExemption(169),
  );
  assert.equal(sol - (await lamports(alice.publicKey)), info.lamports);
  const [deposited] = await events(signature);
  assert.equal(deposited.name, "deposited");
  assert.equal(deposited.data.id.toString(), "1");
  assert.equal(deposited.data.nonce.toString(), nonce.toString());
  assert.equal(deposited.data.amount.toString(), FEE.toString());
  assert.equal(deposited.data.keptTo.toBase58(), kept.toBase58());
  assert.deepEqual(Buffer.from(deposited.data.item), item);
  // An id never used has no account, and a reader's scan finds exactly this deposit.
  assert.equal(await readDeposit(2n), null);
  const scanned = await openDeposits();
  assert.equal(scanned.length, 1);
  assert.equal(scanned[0].address.toBase58(), address.toBase58());
  assert.equal(scanned[0].record.id.toString(), "1");
});

test("a deposit refuses a zero amount and an unusable kept wallet", async () => {
  const good = { from: alice, mint, amount: FEE, keptTo: kept };
  const before = await snapshot(mint, [ata(alice.publicKey, mint)]);
  await refuses(deposit({ ...good, amount: 0n }), /InvalidInput/);
  for (const keptTo of [
    PublicKey.default,
    addresses.config(),
    addresses.ledger(mint),
    addresses.vault(mint),
  ])
    await refuses(deposit({ ...good, keptTo }), /InvalidInput/);
  assert.equal(await snapshot(mint, [ata(alice.publicKey, mint)]), before);
});

test("a deposit refuses a wrong source, mint, vault or record address, and a balance that is short", async () => {
  const good = { from: alice, mint, amount: FEE, keptTo: kept };
  const before = await snapshot(mint, [ata(alice.publicKey, mint)]);
  // More than the payer holds: the token program refuses, nothing is recorded.
  await refuses(
    deposit({ ...good, amount: 1_000n * FEE }),
    /insufficient funds|custom program error: 0x1\b/,
  );
  // Somebody else's token account.
  const bobs = await tokens(mint, bob.publicKey, FEE);
  await refuses(
    deposit({ ...good, accounts: { source: bobs } }),
    /ConstraintTokenOwner/,
  );
  // A token account of another mint, and another mint's vault and ledger.
  const other = await newMint(6);
  await openVault(other);
  const otherSource = await tokens(other, alice.publicKey, FEE);
  await refuses(
    deposit({ ...good, accounts: { source: otherSource } }),
    /ConstraintTokenMint/,
  );
  await refuses(
    deposit({ ...good, accounts: { vault: addresses.vault(other) } }),
    /ConstraintSeeds/,
  );
  await refuses(
    deposit({ ...good, accounts: { ledger: addresses.ledger(other) } }),
    /ConstraintHasOne|ConstraintSeeds/,
  );
  // The payer's own token account in place of the vault.
  await refuses(
    deposit({ ...good, accounts: { vault: ata(alice.publicKey, mint) } }),
    /ConstraintSeeds/,
  );
  // A record address that is not the one of (signing payer, nonce argument): derived from
  // somebody else's key, from another nonce, or from the count as the first design did.
  const nonce = freshNonce();
  for (const wrong of [
    addresses.deposit(bob.publicKey, nonce),
    addresses.deposit(alice.publicKey, nonce + 1n),
    PublicKey.findProgramAddressSync(
      [Buffer.from("deposit"), u64(2n)],
      context.program.programId,
    )[0],
  ])
    await refuses(
      deposit({ ...good, nonce, accounts: { deposit: wrong } }),
      /ConstraintSeeds/,
    );
  // Bob cannot take alice's address either: he signs, so the program derives his own.
  await refuses(
    deposit({
      ...good,
      from: bob,
      nonce,
      accounts: { deposit: addresses.deposit(alice.publicKey, nonce) },
    }),
    /ConstraintSeeds/,
  );
  assert.equal(await exists(addresses.deposit(alice.publicKey, nonce)), false);
  // A mint whose vault nobody opened.
  const unopened = await newMint(6);
  await tokens(unopened, alice.publicKey, FEE);
  await refuses(deposit({ ...good, mint: unopened }), /AccountNotInitialized/);
  // A frozen source cannot pay.
  await freezeAccount(
    connection,
    payer,
    ata(alice.publicKey, mint),
    mint,
    payer,
  );
  await refuses(deposit(good), /frozen|custom program error: 0x11\b/i);
  await thawAccount(connection, payer, ata(alice.publicKey, mint), mint, payer);
  // The payer must sign: the cluster rejects a deposit for alice that only a stranger signed.
  const unsigned = await (await depositCall(good)).transaction();
  unsigned.feePayer = stranger.publicKey;
  unsigned.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  unsigned.partialSign(stranger);
  await refuses(
    connection.sendRawTransaction(
      unsigned.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    ),
    /signature verification fail/i,
  );
  assert.equal(await snapshot(mint, [ata(alice.publicKey, mint)]), before);
});

test("ids count up in landing order and an item may be paid more than once", async () => {
  const good = { from: alice, mint, amount: FEE, keptTo: kept };
  const second = await deposit(good);
  const third = await deposit(good);
  assert.equal(second.id, 2n);
  assert.equal(third.id, 3n);
  assert.deepEqual(
    Buffer.from((await readDeposit(2n)).item),
    Buffer.from((await readDeposit(3n)).item),
  );
  leftOpen.push(3n);
  assert.equal((await readConfig()).depositCount.toString(), "3");
});

test("two payers who build against the same state both land", async () => {
  await tokens(mint, bob.publicKey, 6n * FEE);
  await tokens(mint, stranger.publicKey, 6n * FEE);
  const good = { mint, amount: FEE, keptTo: kept };
  const count = BigInt((await readConfig()).depositCount.toString());
  const open = BigInt((await readLedger(mint)).openTotal.toString());
  // Both transactions are built and signed before either is sent.
  const { blockhash } = await connection.getLatestBlockhash();
  const built = [];
  for (const from of [stranger, bob]) {
    const nonce = freshNonce();
    const transaction = await (
      await depositCall({ ...good, from, nonce })
    ).transaction();
    transaction.feePayer = from.publicKey;
    transaction.recentBlockhash = blockhash;
    transaction.sign(from);
    built.push({ from, nonce, raw: transaction.serialize() });
  }
  const signatures = await Promise.all(
    built.map(({ raw }) => connection.sendRawTransaction(raw)),
  );
  const latest = await connection.getLatestBlockhash();
  const ids = [];
  for (const [index, signature] of signatures.entries()) {
    const result = await connection.confirmTransaction(
      { signature, ...latest },
      "confirmed",
    );
    assert.equal(result.value.err, null);
    ids.push((await landed({ ...built[index], signature })).id);
  }
  // Each took the next number in the order it landed; neither failed.
  assert.deepEqual(
    ids.toSorted((left, right) => Number(left - right)),
    [count + 1n, count + 2n],
  );
  assert.equal(
    (await readConfig()).depositCount.toString(),
    (count + 2n).toString(),
  );
  assert.equal(
    (await readLedger(mint)).openTotal.toString(),
    (open + 2n * FEE).toString(),
  );
  for (const [index, id] of ids.entries()) {
    const record = await readDeposit(id);
    assert.equal(
      record.payer.toBase58(),
      built[index].from.publicKey.toBase58(),
    );
    assert.equal(record.nonce.toString(), built[index].nonce.toString());
  }
  leftOpen.push(...ids);
});

test("deposits that land in between do not invalidate a signed deposit", async () => {
  const good = { mint, amount: FEE, keptTo: kept };
  // Alice signs now.
  const nonce = freshNonce();
  const transaction = await (
    await depositCall({ ...good, from: alice, nonce })
  ).transaction();
  transaction.feePayer = alice.publicKey;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;
  transaction.sign(alice);
  const before = BigInt((await readConfig()).depositCount.toString());
  // A third party lands deposits first, some of a throwaway mint, as a griefer would.
  const throwaway = await newMint(0);
  await openVault(throwaway);
  await tokens(throwaway, stranger.publicKey, 3n);
  const between = [
    await deposit({ ...good, from: stranger }),
    await deposit({ ...good, from: stranger, mint: throwaway, amount: 1n }),
    await deposit({ ...good, from: stranger, mint: throwaway, amount: 1n }),
  ];
  assert.deepEqual(
    between.map(({ id }) => id),
    [before + 1n, before + 2n, before + 3n],
  );
  // Alice's transaction, signed against the earlier count, still lands.
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
  );
  const latest = await connection.getLatestBlockhash();
  const result = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  assert.equal(result.value.err, null);
  const mine = await landed({ from: alice, nonce, signature });
  assert.equal(mine.id, before + 4n);
  assert.equal(
    (await readDeposit(mine.id)).payer.toBase58(),
    alice.publicKey.toBase58(),
  );
  for (const { id } of between.slice(1))
    await resolve({ resolver, id, refund: true });
  leftOpen.push(between[0].id, mine.id);
});

test("a nonce is refused while its deposit is open, and nobody can occupy another payer's address", async () => {
  const good = { from: bob, mint, amount: FEE, keptTo: kept };
  const nonce = freshNonce();
  const address = addresses.deposit(bob.publicKey, nonce);
  // A stranger sends lamports to the address bob is about to use. It stays a system
  // account nobody but the program can assign, and bob's deposit lands all the same.
  await fund({ publicKey: address }, 3_000_000);
  const first = await deposit({ ...good, nonce });
  assert.equal(first.address.toBase58(), address.toBase58());
  const record = await readDeposit(first.id);
  assert.equal(record.payer.toBase58(), bob.publicKey.toBase58());
  // The same payer and nonce again: the record exists, so nothing is taken or counted.
  const before = await snapshot(mint, [ata(bob.publicKey, mint)]);
  await refuses(deposit({ ...good, nonce }), /already in use/);
  await refuses(
    deposit({ ...good, nonce, amount: 2n * FEE, item: Buffer.alloc(32, 1) }),
    /already in use/,
  );
  assert.equal(await snapshot(mint, [ata(bob.publicKey, mint)]), before);
  // The same nonce under another payer is another address, and is free.
  const other = await deposit({ ...good, from: stranger, nonce });
  assert.notEqual(other.address.toBase58(), address.toBase58());
  // Once settled the record is gone and its rent, with the stranger's lamports, is bob's.
  const sol = await lamports(bob.publicKey);
  const held = await lamports(address);
  assert.ok(held >= 3_000_000);
  await resolve({ resolver, id: first.id, refund: true });
  assert.equal(await lamports(bob.publicKey), sol + held);
  assert.equal(await exists(address), false);
  // The address is free again. A later deposit there is a new deposit with a new id, and
  // the old id stays settled: a reader goes by the stored id, never by the address alone.
  const again = await deposit({ ...good, nonce });
  assert.equal(again.address.toBase58(), address.toBase58());
  assert.ok(again.id > other.id);
  assert.equal(await readDeposit(first.id), null);
  assert.equal(
    (await openDeposits({ id: again.id }))[0].address.toBase58(),
    address.toBase58(),
  );
  assert.deepEqual(await openDeposits({ id: first.id }), []);
  leftOpen.push(other.id, again.id);
});

test("only the resolver resolves", async () => {
  const before = await snapshot(mint);
  for (const signer of [stranger, owner, alice])
    for (const refund of [true, false])
      await refuses(
        resolve({ resolver: signer, id: 1n, refund }),
        /NotResolver/,
      );
  assert.equal(await snapshot(mint), before);
  assert.ok(await readDeposit(1n));
});

test("a refund goes only to the payer's associated token account", async () => {
  const id = 1n;
  const aliceAccount = ata(alice.publicKey, mint);
  const before = await snapshot(mint, [aliceAccount, keptAccount]);
  const good = { resolver, id, refund: true };
  // The resolver's own account, the kept account, the vault, and another mint's account.
  const resolverAccount = await tokens(mint, resolver.publicKey);
  for (const destination of [
    resolverAccount,
    keptAccount,
    addresses.vault(mint),
  ])
    await refuses(
      resolve({ ...good, accounts: { destination } }),
      /WrongDestination/,
    );
  const other = await newMint(6);
  await refuses(
    resolve({
      ...good,
      accounts: { destination: await tokens(other, alice.publicKey) },
    }),
    /ConstraintTokenMint/,
  );
  // A second token account that alice owns is still not the one a refund may use.
  const spare = await createAccount(
    connection,
    payer,
    mint,
    alice.publicKey,
    Keypair.generate(),
  );
  await refuses(
    resolve({ ...good, accounts: { destination: spare } }),
    /WrongDestination/,
  );
  // The rent of the record may go to nobody but the payer.
  for (const rentTo of [resolver.publicKey, stranger.publicKey, kept])
    await refuses(
      resolve({ ...good, accounts: { payer: rentTo } }),
      /ConstraintHasOne/,
    );
  // Another mint's ledger and vault cannot stand in.
  await openVault(other);
  await refuses(
    resolve({ ...good, accounts: { mint: other } }),
    /ConstraintHasOne|ConstraintSeeds|ConstraintTokenMint/,
  );
  await refuses(
    resolve({ ...good, accounts: { vault: addresses.vault(other) } }),
    /ConstraintSeeds/,
  );
  await refuses(
    resolve({ ...good, accounts: { ledger: addresses.ledger(other) } }),
    /ConstraintHasOne|ConstraintSeeds/,
  );
  assert.equal(await snapshot(mint, [aliceAccount, keptAccount]), before);

  const rent = await lamports(depositAt(id));
  const sol = await lamports(alice.publicKey);
  const resolverSol = await lamports(resolver.publicKey);
  const held = await balance(aliceAccount);
  const vaulted = await balance(addresses.vault(mint));
  const signature = await resolve(good);
  assert.equal(await readDeposit(id), null);
  assert.equal(await exists(depositAt(id)), false);
  assert.equal(await balance(aliceAccount), held + FEE);
  assert.equal(await balance(keptAccount), 0n);
  assert.equal(await balance(resolverAccount), 0n);
  assert.equal(await balance(addresses.vault(mint)), vaulted - FEE);
  assert.equal(
    (await readLedger(mint)).openTotal.toString(),
    (vaulted - FEE).toString(),
  );
  // The record's rent returned to the payer, not to the resolver.
  assert.equal((await lamports(alice.publicKey)) - sol, rent);
  assert.equal(await lamports(resolver.publicKey), resolverSol);
  const [resolved] = await events(signature);
  assert.equal(resolved.name, "resolved");
  assert.equal(resolved.data.id.toString(), "1");
  assert.equal(resolved.data.refunded, true);
});

test("a kept deposit goes only to the kept wallet's associated token account", async () => {
  const id = 2n;
  const aliceAccount = ata(alice.publicKey, mint);
  const before = await snapshot(mint, [aliceAccount, keptAccount]);
  const good = { resolver, id, refund: false };
  const resolverAccount = ata(resolver.publicKey, mint);
  for (const destination of [
    resolverAccount,
    aliceAccount,
    addresses.vault(mint),
  ])
    await refuses(
      resolve({ ...good, accounts: { destination } }),
      /WrongDestination/,
    );
  // A token account the kept wallet owns that is not its associated one.
  const keptWallet = fixtureKey("kept-wallet");
  const spare = await createAccount(
    connection,
    payer,
    mint,
    keptWallet.publicKey,
    Keypair.generate(),
  );
  await refuses(
    resolve({ ...good, accounts: { destination: spare } }),
    /WrongDestination/,
  );
  await refuses(
    resolve({ ...good, accounts: { payer: kept } }),
    /ConstraintHasOne/,
  );
  assert.equal(await snapshot(mint, [aliceAccount, keptAccount]), before);

  const rent = await lamports(depositAt(id));
  const sol = await lamports(alice.publicKey);
  const keptSol = await lamports(kept);
  const held = await balance(aliceAccount);
  const vaulted = await balance(addresses.vault(mint));
  const signature = await resolve(good);
  assert.equal(await readDeposit(id), null);
  assert.equal(await balance(keptAccount), FEE);
  assert.equal(await balance(aliceAccount), held);
  assert.equal(await balance(addresses.vault(mint)), vaulted - FEE);
  assert.equal(
    (await readLedger(mint)).openTotal.toString(),
    (vaulted - FEE).toString(),
  );
  // Even when the fee is kept, the rent of the record goes back to the payer.
  assert.equal((await lamports(alice.publicKey)) - sol, rent);
  assert.equal(await lamports(kept), keptSol);
  const [resolved] = await events(signature);
  assert.equal(resolved.data.id.toString(), "2");
  assert.equal(resolved.data.refunded, false);
});

test("a deposit settles once", async () => {
  const before = await snapshot(mint, [
    ata(alice.publicKey, mint),
    keptAccount,
  ]);
  for (const id of [1n, 2n]) {
    for (const refund of [true, false])
      await refuses(
        context.program.methods
          .resolve(refund)
          .accountsStrict({
            resolver: resolver.publicKey,
            config: addresses.config(),
            deposit: depositAt(id),
            ledger: addresses.ledger(mint),
            mint,
            vault: addresses.vault(mint),
            destination: refund ? ata(alice.publicKey, mint) : keptAccount,
            payer: alice.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([resolver])
          .rpc(),
        /AccountNotInitialized/,
      );
    await refuses(
      context.program.methods
        .reclaim()
        .accountsStrict({
          payer: alice.publicKey,
          config: addresses.config(),
          deposit: depositAt(id),
          ledger: addresses.ledger(mint),
          mint,
          vault: addresses.vault(mint),
          destination: ata(alice.publicKey, mint),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([alice])
        .rpc(),
      /AccountNotInitialized/,
    );
  }
  // Lamports sent to a closed record's address do not bring the deposit back.
  await fund({ publicKey: depositAt(1n) }, 5_000_000);
  await refuses(
    context.program.methods
      .resolve(true)
      .accountsStrict({
        resolver: resolver.publicKey,
        config: addresses.config(),
        deposit: depositAt(1n),
        ledger: addresses.ledger(mint),
        mint,
        vault: addresses.vault(mint),
        destination: ata(alice.publicKey, mint),
        payer: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([resolver])
      .rpc(),
    /AccountOwnedByWrongProgram|AccountNotInitialized/,
  );
  assert.equal(
    await snapshot(mint, [ata(alice.publicKey, mint), keptAccount]),
    before,
  );
});

test("a frozen or missing payer account blocks only the refund; the deposit can still be kept or refunded later", async () => {
  const carol = await fund(Keypair.generate());
  const carolAccount = await tokens(mint, carol.publicKey, 3n * FEE);
  const frozen = await deposit({
    from: carol,
    mint,
    amount: FEE,
    keptTo: kept,
  });
  const closed = await deposit({
    from: carol,
    mint,
    amount: FEE,
    keptTo: kept,
  });
  const changed = await deposit({
    from: carol,
    mint,
    amount: FEE,
    keptTo: kept,
  });
  const keptBefore = await balance(keptAccount);
  const vaultBefore = await balance(addresses.vault(mint));

  // The issuer freezes the payer's account: the refund fails and the deposit stays open.
  await freezeAccount(connection, payer, carolAccount, mint, payer);
  await refuses(
    resolve({ resolver, id: frozen.id, refund: true }),
    /frozen|custom program error: 0x11\b/i,
  );
  assert.ok(await readDeposit(frozen.id));
  assert.equal(await balance(addresses.vault(mint)), vaultBefore);
  await resolve({ resolver, id: frozen.id, refund: false });
  assert.equal(await balance(keptAccount), keptBefore + FEE);
  await thawAccount(connection, payer, carolAccount, mint, payer);

  // The payer closes their empty account: the refund fails until it exists again.
  await closeAccount(connection, payer, carolAccount, carol.publicKey, carol);
  await refuses(
    resolve({ resolver, id: closed.id, refund: true }),
    /AccountNotInitialized/,
  );
  assert.ok(await readDeposit(closed.id));
  await tokens(mint, carol.publicKey);
  await resolve({ resolver, id: closed.id, refund: true });
  assert.equal(await balance(carolAccount), FEE);

  // The payer hands their associated account to someone else: a refund would no longer
  // reach the payer, so it is refused. The payer can still reclaim to an account they own.
  await setAuthority(
    connection,
    payer,
    carolAccount,
    carol,
    AuthorityType.AccountOwner,
    stranger.publicKey,
  );
  await refuses(
    resolve({ resolver, id: changed.id, refund: true }),
    /WrongDestination/,
  );
  const record = await readDeposit(changed.id);
  await waitForChainTime(record.depositedAt.toNumber() + SHORT_DELAY);
  const spare = await createAccount(
    connection,
    payer,
    mint,
    carol.publicKey,
    Keypair.generate(),
  );
  await reclaim({ from: carol, id: changed.id, destination: spare });
  assert.equal(await balance(spare), FEE);
  assert.equal(await balance(addresses.vault(mint)), vaultBefore - 3n * FEE);
});

test("a frozen kept account blocks only the kept outcome", async () => {
  const dave = await fund(Keypair.generate());
  const daveAccount = await tokens(mint, dave.publicKey, FEE);
  const { id } = await deposit({ from: dave, mint, amount: FEE, keptTo: kept });
  const before = await snapshot(mint, [daveAccount, keptAccount]);
  await freezeAccount(connection, payer, keptAccount, mint, payer);
  await refuses(
    resolve({ resolver, id, refund: false }),
    /frozen|custom program error: 0x11\b/i,
  );
  assert.equal(await snapshot(mint, [daveAccount, keptAccount]), before);
  await resolve({ resolver, id, refund: true });
  assert.equal(await balance(daveAccount), FEE);
  await thawAccount(connection, payer, keptAccount, mint, payer);
});

test("several deposits settle in one transaction, each its own way, or none at all", async () => {
  const erin = await fund(Keypair.generate());
  const erinAccount = await tokens(mint, erin.publicKey, 3n * FEE);
  const ids = [];
  for (let index = 0; index < 3; index++)
    ids.push(
      (await deposit({ from: erin, mint, amount: FEE, keptTo: kept })).id,
    );
  const before = await snapshot(mint, [erinAccount, keptAccount]);
  const batch = async (refunds) => {
    const transaction = new Transaction();
    for (const [index, id] of ids.entries())
      transaction.add(
        await (
          await resolveCall({ resolver, id, refund: refunds[index] })
        ).instruction(),
      );
    return provider.sendAndConfirm(transaction, [resolver]);
  };
  // One payout that cannot succeed takes the whole transaction down with it.
  await freezeAccount(connection, payer, erinAccount, mint, payer);
  await refuses(
    batch([false, false, true]),
    /frozen|custom program error: 0x11\b/i,
  );
  assert.equal(await snapshot(mint, [erinAccount, keptAccount]), before);
  for (const id of ids) assert.ok(await readDeposit(id));
  await thawAccount(connection, payer, erinAccount, mint, payer);
  // The same deposit twice in one transaction: the second instruction finds it settled.
  const twice = new Transaction();
  for (let index = 0; index < 2; index++)
    twice.add(
      await (
        await resolveCall({ resolver, id: ids[0], refund: true })
      ).instruction(),
    );
  await refuses(
    provider.sendAndConfirm(twice, [resolver]),
    /AccountNotInitialized|AccountOwnedByWrongProgram|ConstraintSeeds/,
  );
  assert.equal(await snapshot(mint, [erinAccount, keptAccount]), before);

  const keptBefore = await balance(keptAccount);
  await batch([true, false, true]);
  for (const id of ids) assert.equal(await readDeposit(id), null);
  assert.equal(await balance(erinAccount), 2n * FEE);
  assert.equal(await balance(keptAccount), keptBefore + FEE);
});

test("reclaim: only the payer, only after the delay, only while open, only to the payer's own account", async () => {
  const frank = await fund(Keypair.generate());
  const frankAccount = await tokens(mint, frank.publicKey, 2n * FEE);
  const first = await deposit({ from: frank, mint, amount: FEE, keptTo: kept });
  const record = await readDeposit(first.id);
  const reachable = record.depositedAt.toNumber() + SHORT_DELAY;
  const before = await snapshot(mint, [frankAccount, keptAccount]);
  // Too early, for the payer too.
  await refuses(reclaim({ from: frank, id: first.id }), /ReclaimTooEarly/);
  // Nobody else, early or late: not a stranger, the resolver or the owner.
  for (const signer of [stranger, resolver, owner])
    await refuses(
      reclaim({
        from: signer,
        id: first.id,
        destination: await tokens(mint, signer.publicKey),
      }),
      /NotPayer/,
    );
  await waitForChainTime(reachable);
  for (const signer of [stranger, resolver, owner])
    await refuses(
      reclaim({
        from: signer,
        id: first.id,
        destination: ata(signer.publicKey, mint),
      }),
      /NotPayer/,
    );
  // The payer cannot send it to an account they do not own, the vault included.
  for (const destination of [keptAccount, ata(stranger.publicKey, mint)])
    await refuses(
      reclaim({ from: frank, id: first.id, destination }),
      /ConstraintTokenOwner/,
    );
  await refuses(
    reclaim({ from: frank, id: first.id, destination: addresses.vault(mint) }),
    /ConstraintTokenOwner|WrongDestination/,
  );
  assert.equal(await snapshot(mint, [frankAccount, keptAccount]), before);

  // A deposit made now has its own clock: the older one is reclaimable, this one is not.
  const second = await deposit({
    from: frank,
    mint,
    amount: FEE,
    keptTo: kept,
  });
  await refuses(reclaim({ from: frank, id: second.id }), /ReclaimTooEarly/);
  const rent = await lamports(depositAt(first.id));
  const sol = await lamports(frank.publicKey);
  const signature = await reclaim({ from: frank, id: first.id });
  assert.equal(await readDeposit(first.id), null);
  assert.equal(await balance(frankAccount), FEE);
  // The provider wallet pays the transaction fee, so the payer gains exactly the rent.
  assert.equal((await lamports(frank.publicKey)) - sol, rent);
  const [reclaimed] = await events(signature);
  assert.equal(reclaimed.name, "reclaimed");
  assert.equal(reclaimed.data.id.toString(), first.id.toString());
  await refuses(
    context.program.methods
      .reclaim()
      .accountsStrict({
        payer: frank.publicKey,
        config: addresses.config(),
        deposit: depositAt(first.id),
        ledger: addresses.ledger(mint),
        mint,
        vault: addresses.vault(mint),
        destination: frankAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([frank])
      .rpc(),
    /AccountNotInitialized/,
  );
  // The resolver may still settle a deposit after its delay has passed.
  const late = await readDeposit(second.id);
  await waitForChainTime(late.depositedAt.toNumber() + SHORT_DELAY);
  const keptBefore = await balance(keptAccount);
  await resolve({ resolver, id: second.id, refund: false });
  assert.equal(await balance(keptAccount), keptBefore + FEE);
});

test("pausing stops new deposits only; only the owner pauses; a repeated setting is refused", async () => {
  const gina = await fund(Keypair.generate());
  const ginaAccount = await tokens(mint, gina.publicKey, 3n * FEE);
  const good = { from: gina, mint, amount: FEE, keptTo: kept };
  const first = await deposit(good);
  const second = await deposit(good);
  for (const signer of [stranger, resolver, gina])
    await refuses(pauseDeposits(signer, true), /NotOwner/);
  await refuses(pauseDeposits(owner, false), /InvalidInput/);
  const signature = await pauseDeposits(owner, true);
  const [paused] = await events(signature);
  assert.equal(paused.name, "depositsPaused");
  assert.equal(paused.data.paused, true);
  await refuses(pauseDeposits(owner, true), /InvalidInput/);
  await refuses(deposit(good), /DepositsArePaused/);
  assert.equal(await balance(ginaAccount), FEE);
  // Settlement and reclaim go on while paused.
  await resolve({ resolver, id: first.id, refund: true });
  const record = await readDeposit(second.id);
  await waitForChainTime(record.depositedAt.toNumber() + SHORT_DELAY);
  await reclaim({ from: gina, id: second.id });
  assert.equal(await balance(ginaAccount), 3n * FEE);
  for (const signer of [stranger, resolver])
    await refuses(pauseDeposits(signer, false), /NotOwner/);
  await pauseDeposits(owner, false);
  const third = await deposit(good);
  await resolve({ resolver, id: third.id, refund: true });
});

test("the owner cannot resolve, reclaim, move or redirect a deposit", async () => {
  const hank = await fund(Keypair.generate());
  const hankAccount = await tokens(mint, hank.publicKey, FEE);
  const ownerAccount = await tokens(mint, owner.publicKey);
  const { id } = await deposit({ from: hank, mint, amount: FEE, keptTo: kept });
  const before = await snapshot(mint, [hankAccount, keptAccount, ownerAccount]);
  for (const refund of [true, false]) {
    await refuses(resolve({ resolver: owner, id, refund }), /NotResolver/);
    await refuses(
      resolve({
        resolver: owner,
        id,
        refund,
        accounts: { destination: ownerAccount },
      }),
      /NotResolver/,
    );
  }
  const record = await readDeposit(id);
  await waitForChainTime(record.depositedAt.toNumber() + SHORT_DELAY);
  await refuses(
    reclaim({ from: owner, id, destination: ownerAccount }),
    /NotPayer/,
  );
  // The vault's token authority is a program address. No outside key can sign for it.
  await assert.rejects(
    transfer(
      connection,
      payer,
      addresses.vault(mint),
      ownerAccount,
      owner,
      FEE,
    ),
  );
  assert.equal(
    await snapshot(mint, [hankAccount, keptAccount, ownerAccount]),
    before,
  );
  // Neither the record's payer nor its kept wallet changed under any of it.
  const after = await readDeposit(id);
  assert.equal(after.payer.toBase58(), hank.publicKey.toBase58());
  assert.equal(after.keptTo.toBase58(), kept.toBase58());
  await resolve({ resolver, id, refund: true });
});

test("tokens sent to the vault without a deposit belong to no deposit", async () => {
  const ivan = await fund(Keypair.generate());
  const ivanAccount = await tokens(mint, ivan.publicKey, 4n * FEE);
  const open = (await readLedger(mint)).openTotal.toString();
  const vaultBefore = await balance(addresses.vault(mint));
  await transfer(
    connection,
    payer,
    ivanAccount,
    addresses.vault(mint),
    ivan,
    FEE,
  );
  assert.equal((await readLedger(mint)).openTotal.toString(), open);
  // Deposits beside the stray tokens settle for exactly their own amounts.
  const first = await deposit({ from: ivan, mint, amount: FEE, keptTo: kept });
  const second = await deposit({
    from: ivan,
    mint,
    amount: 2n * FEE,
    keptTo: kept,
  });
  const keptBefore = await balance(keptAccount);
  await resolve({ resolver, id: first.id, refund: true });
  await resolve({ resolver, id: second.id, refund: false });
  assert.equal(await balance(ivanAccount), FEE);
  assert.equal(await balance(keptAccount), keptBefore + 2n * FEE);
  assert.equal((await readLedger(mint)).openTotal.toString(), open);
  // The stray tokens stay. No instruction can take them out.
  assert.equal(await balance(addresses.vault(mint)), vaultBefore + FEE);
});

test("mints of zero and nine decimals and the largest amount round-trip exactly", async () => {
  const jo = await fund(Keypair.generate());
  for (const [decimals, amount] of [
    [0, 3n],
    [9, 123_456_789_012n],
    [6, 2n ** 64n - 1n],
  ]) {
    const some = await newMint(decimals);
    await openVault(some);
    const account = await tokens(some, jo.publicKey, amount);
    const keptHere = await tokens(some, kept);
    const refunded = await deposit({
      from: jo,
      mint: some,
      amount,
      keptTo: kept,
    });
    assert.equal(await balance(addresses.vault(some)), amount);
    assert.equal(
      (await readLedger(some)).openTotal.toString(),
      amount.toString(),
    );
    assert.equal(await balance(account), 0n);
    await resolve({ resolver, id: refunded.id, refund: true });
    assert.equal(await balance(account), amount);
    const held = await deposit({ from: jo, mint: some, amount, keptTo: kept });
    await resolve({ resolver, id: held.id, refund: false });
    assert.equal(await balance(keptHere), amount);
    assert.equal(await balance(addresses.vault(some)), 0n);
    assert.equal((await readLedger(some)).openTotal.toNumber(), 0);
  }
});

test("the resolver is never the owner or the pending owner", async () => {
  const candidate = await fund(Keypair.generate());
  for (const signer of [stranger, resolver, candidate])
    await refuses(setResolver(signer, candidate.publicKey), /NotOwner/);
  for (const next of [PublicKey.default, owner.publicKey, resolver.publicKey])
    await refuses(setResolver(owner, next), /InvalidInput/);
  await refuses(transferOwnership(owner, resolver.publicKey), /InvalidInput/);
  await transferOwnership(owner, candidate.publicKey);
  await refuses(setResolver(owner, candidate.publicKey), /InvalidInput/);
  await transferOwnership(owner, PublicKey.default);
  const config = await readConfig();
  assert.equal(config.resolver.toBase58(), resolver.publicKey.toBase58());
  assert.equal(config.owner.toBase58(), owner.publicKey.toBase58());
});

test("a replaced resolver loses its power at once; the new one has only the two outcomes", async () => {
  const kim = await fund(Keypair.generate());
  const kimAccount = await tokens(mint, kim.publicKey, 2n * FEE);
  const next = await fund(Keypair.generate());
  const nextAccount = await tokens(mint, next.publicKey);
  const first = await deposit({ from: kim, mint, amount: FEE, keptTo: kept });
  const second = await deposit({ from: kim, mint, amount: FEE, keptTo: kept });
  const signature = await setResolver(owner, next.publicKey);
  const [changed] = await events(signature);
  assert.equal(changed.name, "resolverChanged");
  assert.equal(changed.data.previous.toBase58(), resolver.publicKey.toBase58());
  assert.equal(changed.data.next.toBase58(), next.publicKey.toBase58());
  for (const refund of [true, false])
    await refuses(resolve({ resolver, id: first.id, refund }), /NotResolver/);
  await refuses(
    resolve({
      resolver: next,
      id: first.id,
      refund: true,
      accounts: { destination: nextAccount },
    }),
    /WrongDestination/,
  );
  const keptBefore = await balance(keptAccount);
  await resolve({ resolver: next, id: first.id, refund: true });
  await resolve({ resolver: next, id: second.id, refund: false });
  assert.equal(await balance(kimAccount), FEE);
  assert.equal(await balance(keptAccount), keptBefore + FEE);
  assert.equal(await balance(nextAccount), 0n);
  // Put the fixture resolver back for the suites that follow.
  await setResolver(owner, resolver.publicKey);
});

test("ownership moves in two steps and a cancelled handover cannot be accepted", async () => {
  const next = await fund(Keypair.generate());
  for (const signer of [stranger, resolver, next])
    await refuses(transferOwnership(signer, next.publicKey), /NotOwner/);
  // Nothing is pending yet: nobody can accept.
  for (const signer of [stranger, next, owner])
    await refuses(acceptOwnership(signer), /NotPendingOwner/);
  const started = await transferOwnership(owner, next.publicKey);
  const [startedEvent] = await events(started);
  assert.equal(startedEvent.name, "ownershipTransferStarted");
  assert.equal(
    startedEvent.data.pendingOwner.toBase58(),
    next.publicKey.toBase58(),
  );
  // Until accepted, the old owner still acts and the named one does not.
  await refuses(pauseDeposits(next, true), /NotOwner/);
  await pauseDeposits(owner, true);
  await pauseDeposits(owner, false);
  for (const signer of [stranger, resolver, owner])
    await refuses(acceptOwnership(signer), /NotPendingOwner/);
  // Cancel, then the named owner can no longer accept.
  await transferOwnership(owner, PublicKey.default);
  await refuses(acceptOwnership(next), /NotPendingOwner/);
  assert.equal(
    (await readConfig()).owner.toBase58(),
    owner.publicKey.toBase58(),
  );
  // Name again and accept.
  await transferOwnership(owner, next.publicKey);
  const accepted = await acceptOwnership(next);
  const [acceptedEvent] = await events(accepted);
  assert.equal(acceptedEvent.name, "ownershipTransferred");
  assert.equal(
    acceptedEvent.data.previous.toBase58(),
    owner.publicKey.toBase58(),
  );
  assert.equal(acceptedEvent.data.owner.toBase58(), next.publicKey.toBase58());
  const config = await readConfig();
  assert.equal(config.owner.toBase58(), next.publicKey.toBase58());
  assert.equal(config.pendingOwner.toBase58(), PublicKey.default.toBase58());
  for (const call of [
    () => pauseDeposits(owner, true),
    () => setResolver(owner, stranger.publicKey),
    () => transferOwnership(owner, owner.publicKey),
  ])
    await refuses(call(), /NotOwner/);
  await refuses(acceptOwnership(next), /NotPendingOwner/);
  // The new owner still cannot make itself the resolver.
  await refuses(setResolver(next, next.publicKey), /InvalidInput/);
  // Hand ownership back to the fixture owner for the suites that follow.
  await transferOwnership(next, owner.publicKey);
  await acceptOwnership(owner);
  assert.equal(
    (await readConfig()).owner.toBase58(),
    owner.publicKey.toBase58(),
  );
});

test("the delay, the count and every settled deposit are as the suite left them", async () => {
  const config = await readConfig();
  assert.equal(config.reclaimDelay.toNumber(), SHORT_DELAY);
  assert.equal(config.depositsPaused, false);
  assert.equal(config.resolver.toBase58(), resolver.publicKey.toBase58());
  for (const id of leftOpen) await resolve({ resolver, id, refund: true });
  // Every deposit of this suite is settled, so the vault holds only the stray tokens.
  assert.equal((await readLedger(mint)).openTotal.toNumber(), 0);
  assert.equal(await balance(addresses.vault(mint)), FEE);
  // No Deposit account of any payer is left, whatever its address.
  assert.deepEqual(await openDeposits(), []);
  assert.ok(BigInt(config.depositCount.toString()) >= BigInt(leftOpen.length));
});
