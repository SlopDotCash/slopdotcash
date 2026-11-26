/** A seeded random campaign against the real program on a local validator. After every step,
 * for each mint: the vault's balance equals the ledger's open total equals the sum of the
 * open deposits of a plain model; the program's Deposit accounts are exactly the model's
 * open deposits; every open deposit's record still names its payer, kept
 * wallet and amount; every settled deposit's record is gone; and every wallet holds exactly
 * what the model says, so no token reached anyone but a deposit's payer or its kept wallet.
 * Counterpart of contracts/evm/test/SubmissionDepositsInvariant.t.sol.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  addresses,
  ata,
  balance,
  chainTime,
  deposit,
  fixtureKey,
  fund,
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
  SHORT_DELAY,
  tokens,
  waitForChainTime,
} from "./submission-deposits.mjs";

const STEPS = Number(
  process.env.SLOP_SUBMISSION_DEPOSITS_INVARIANT_STEPS ?? 240,
);
const SEED = Number(
  process.env.SLOP_SUBMISSION_DEPOSITS_INVARIANT_SEED ?? 20261120,
);
const START = 1_000_000_000n;
const owner = fixtureKey("owner");
const resolver = fixtureKey("resolver");

/** mulberry32: a small deterministic generator, so a failing campaign can be replayed. */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test(`the vault always equals the open deposits (${STEPS} steps, seed ${SEED})`, async () => {
  const random = generator(SEED);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const payers = [];
  for (let index = 0; index < 3; index++)
    payers.push(await fund(Keypair.generate()));
  const keptWallets = [
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
  ];
  const stranger = await fund(Keypair.generate());
  const mints = [await newMint(6), await newMint(9)];
  // Model: token balance of every wallet per mint, and the deposits by id.
  const held = new Map();
  const walletOf = new Map();
  const key = (mint, wallet) => {
    const name = `${mint.toBase58()}:${wallet.toBase58()}`;
    walletOf.set(name, wallet);
    return name;
  };
  for (const mint of mints) {
    await openVault(mint);
    for (const payer of payers) {
      await tokens(mint, payer.publicKey, START);
      held.set(key(mint, payer.publicKey), START);
    }
    for (const wallet of [
      ...keptWallets,
      stranger.publicKey,
      resolver.publicKey,
    ]) {
      await tokens(mint, wallet);
      held.set(key(mint, wallet), 0n);
    }
  }
  const deposits = new Map();
  const tally = new Map();
  const reached = {
    add: (outcome) => tally.set(outcome, (tally.get(outcome) ?? 0) + 1),
    has: (outcome) => tally.has(outcome),
  };
  let paused = false;
  const open = () =>
    [...deposits.values()].filter((entry) => entry.state === "open");
  const move = (mint, wallet, change) =>
    held.set(key(mint, wallet), held.get(key(mint, wallet)) + change);

  async function check(step) {
    for (const mint of mints) {
      const expected = open()
        .filter((entry) => entry.mint.equals(mint))
        .reduce((sum, entry) => sum + entry.amount, 0n);
      const where = `step ${step}, mint ${mint.toBase58()}`;
      assert.equal(await balance(addresses.vault(mint)), expected, where);
      assert.equal(
        (await readLedger(mint)).openTotal.toString(),
        expected.toString(),
        where,
      );
      for (const [name, amount] of held)
        if (name.startsWith(mint.toBase58()))
          assert.equal(
            await balance(ata(walletOf.get(name), mint)),
            amount,
            `${where}, wallet ${name}`,
          );
    }
    const config = await readConfig();
    assert.equal(config.depositsPaused, paused, `step ${step}`);
    // A reader's scan sees exactly the model's open deposits, by their stored ids.
    assert.deepEqual(
      (await openDeposits()).map(({ record }) => record.id.toString()).sort(),
      open()
        .map((entry) => entry.id.toString())
        .sort(),
      `step ${step}`,
    );
    for (const entry of deposits.values()) {
      const record = await readDeposit(entry.id);
      if (entry.state !== "open") {
        assert.equal(record, null, `step ${step}, deposit ${entry.id}`);
        continue;
      }
      assert.equal(record.payer.toBase58(), entry.payer.publicKey.toBase58());
      assert.equal(record.keptTo.toBase58(), entry.keptTo.toBase58());
      assert.equal(record.mint.toBase58(), entry.mint.toBase58());
      assert.equal(record.amount.toString(), entry.amount.toString());
      assert.equal(record.depositedAt.toNumber(), entry.depositedAt);
    }
  }

  for (let step = 1; step <= STEPS; step++) {
    const roll = random();
    const candidates = open();
    // A paused deployment resumes sooner, so the campaign does not sit refusing deposits.
    if (roll >= (paused ? 0.7 : 0.94)) {
      paused = !paused;
      await pauseDeposits(owner, paused);
      reached.add(paused ? "pause" : "resume");
    } else if (roll < 0.34 || candidates.length === 0) {
      const from = pick(payers);
      const mint = pick(mints);
      const amount = BigInt(1 + Math.floor(random() * 5_000_000));
      const keptTo = pick(keptWallets);
      if (paused) {
        await refuses(
          deposit({ from, mint, amount, keptTo }),
          /DepositsArePaused/,
        );
        reached.add("deposit refused while paused");
      } else {
        const { id } = await deposit({ from, mint, amount, keptTo });
        const record = await readDeposit(id);
        deposits.set(id, {
          id,
          payer: from,
          mint,
          amount,
          keptTo,
          depositedAt: record.depositedAt.toNumber(),
          state: "open",
        });
        move(mint, from.publicKey, -amount);
        reached.add("deposit");
      }
    } else if (roll < 0.52) {
      const entry = pick(candidates);
      await resolve({ resolver, id: entry.id, refund: true });
      entry.state = "refunded";
      move(entry.mint, entry.payer.publicKey, entry.amount);
      reached.add("refund");
    } else if (roll < 0.7) {
      const entry = pick(candidates);
      await resolve({ resolver, id: entry.id, refund: false });
      entry.state = "kept";
      move(entry.mint, entry.keptTo, entry.amount);
      reached.add("kept");
    } else if (roll < 0.84) {
      // The oldest open deposit. The cluster clock only moves forward, so a deposit seen as
      // reachable stays so; one more than two seconds short is certainly refused. Half of
      // the early ones are waited out, so the campaign reaches both outcomes.
      const entry = candidates.reduce((oldest, next) =>
        next.depositedAt < oldest.depositedAt ? next : oldest,
      );
      const due = entry.depositedAt + SHORT_DELAY;
      const early = (await chainTime()) < due - 2;
      if (early && random() < 0.5) {
        await refuses(
          reclaim({ from: entry.payer, id: entry.id }),
          /ReclaimTooEarly/,
        );
        reached.add("reclaim refused early");
      } else {
        await waitForChainTime(due);
        await reclaim({ from: entry.payer, id: entry.id });
        entry.state = "reclaimed";
        move(entry.mint, entry.payer.publicKey, entry.amount);
        reached.add("reclaim");
      }
    } else {
      const entry = pick(candidates);
      const refund = random() < 0.5;
      const attack = pick([
        "stranger resolves",
        "resolver redirects",
        "stranger reclaims",
      ]);
      if (attack === "stranger resolves")
        await refuses(
          resolve({ resolver: stranger, id: entry.id, refund }),
          /NotResolver/,
        );
      else if (attack === "resolver redirects")
        await refuses(
          resolve({
            resolver,
            id: entry.id,
            refund,
            accounts: { destination: ata(resolver.publicKey, entry.mint) },
          }),
          /WrongDestination/,
        );
      else
        await refuses(
          reclaim({
            from: stranger,
            id: entry.id,
            destination: ata(stranger.publicKey, entry.mint),
          }),
          /NotPayer/,
        );
      reached.add(attack);
    }
    await check(step);
  }

  // Leave the deployment unpaused and empty for anything that runs after this suite.
  if (paused) {
    paused = false;
    await pauseDeposits(owner, false);
  }
  for (const entry of open()) {
    await resolve({ resolver, id: entry.id, refund: true });
    entry.state = "refunded";
    move(entry.mint, entry.payer.publicKey, entry.amount);
  }
  await check("final");
  for (const mint of mints) {
    let total = 0n;
    for (const [name, amount] of held)
      if (name.startsWith(mint.toBase58())) total += amount;
    assert.equal(total, 3n * START, "no token was created or lost");
  }
  process.stdout.write(
    `  campaign: ${[...tally].map(([outcome, count]) => `${outcome} ${count}`).join(", ")}\n`,
  );
  // The campaign must have exercised every outcome, or it proved less than its name says.
  for (const outcome of [
    "deposit",
    "refund",
    "kept",
    "reclaim",
    "reclaim refused early",
    "deposit refused while paused",
    "stranger resolves",
    "resolver redirects",
    "stranger reclaims",
    "pause",
    "resume",
  ])
    assert.ok(reached.has(outcome), `the campaign never reached: ${outcome}`);
});
