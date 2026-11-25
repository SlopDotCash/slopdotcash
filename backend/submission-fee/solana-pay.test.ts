// The Solana way to pay: the page's rules against the route that prepares
// the payer's transaction, the real migrations and a small cluster. It lives
// here so the unit shards run it.
import { afterEach, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaAssociatedTokenAddress,
  solanaBase58,
  solanaBase64Bytes,
} from "../../contracts/solana/adapter";
import {
  SUBMISSION_DEPOSITS_IDL,
  submissionDepositAddress,
} from "../../contracts/solana/submission-deposits";
import {
  solanaFeeMessage,
  solanaReclaimMessage,
} from "../../src/lib/solana-fee-deposit";
import {
  SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
  submissionFeeItem,
  submissionFeeOptions,
} from "../../src/lib/submission-fee.mjs";
import {
  FeeRecordError,
  type FeeTables,
  PUBLISHED_FEE_TABLES,
  publishedSolanaWay,
  readFeeItem,
} from "../../src/lib/submission-fee-page";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  FakeSolana,
  fakeAddress,
} from "../../workers/submission-fee/solana-fake";
import { handleSubmissionFeeApi } from "./handler";

const NOW = "2026-12-05T12:00:00.000Z";
const REPOSITORY = "4242";
const PULL = 7;
const ITEM = submissionFeeItem(REPOSITORY, PULL);
const NETWORK = "solana-mainnet";
const idl = SUBMISSION_DEPOSITS_IDL;
const seed = Uint8Array.from({ length: 32 }, () => 3);
const WALLET = solanaBase58(ed25519.getPublicKey(seed));
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function harness() {
  const { db, sqlite } = sqliteD1();
  const chain = new FakeSolana(idl);
  globalThis.fetch = chain.fetch;
  const clock = { now: NOW };
  const tables: FeeTables = {
    ...PUBLISHED_FEE_TABLES,
    contracts: { ...PUBLISHED_FEE_TABLES.contracts, [NETWORK]: chain.programId },
    tokens: { ...PUBLISHED_FEE_TABLES.tokens, [NETWORK]: { usdc: chain.mint } },
    keptTo: { ...PUBLISHED_FEE_TABLES.keptTo, [NETWORK]: chain.feeWallet },
    solanaOn: true,
  };
  const offered = { on: true };
  const post = async (body: Record<string, unknown>) => {
    const response = await handleSubmissionFeeApi(
      new Request("https://slop.cash/api/v1/submission-fee/solana", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryId: REPOSITORY,
          pullNumber: PULL,
          wallet: WALLET,
          ...body,
        }),
      }),
      {
        db: db as never,
        now: () => new Date(clock.now),
        solana: () =>
          offered.on
            ? {
                network: NETWORK,
                programId: chain.programId,
                mint: chain.mint,
                feeWallet: chain.feeWallet,
                rpcUrl: "https://solana.invalid/key",
                idl,
              }
            : null,
      },
    );
    return {
      status: response?.status,
      body: (await response?.json()) as Record<string, unknown>,
    };
  };
  sqlite
    .query(
      "INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at) VALUES (?, ?, 'acme', ?, '2000000', ?)",
    )
    .run(Number(REPOSITORY), PULL, ITEM, NOW);
  // The payer holds 5 USDC in their associated account.
  const account = chain.tokenAccount(WALLET, chain.mint);
  new DataView(
    (chain.accounts.get(account) as { data: Uint8Array }).data.buffer,
  ).setBigUint64(64, 5_000_000n, true);
  const way = publishedSolanaWay("2000000", tables);
  if (!way) throw new Error("no way");
  return { sqlite, chain, clock, tables, offered, post, way };
}

test("Solana is listed only once the program is published and switched on, and the page checks it exactly", () => {
  const { tables, chain } = harness();
  const options = (terms: Parameters<typeof submissionFeeOptions>[3]) =>
    submissionFeeOptions("2000000", [], NOW, terms);
  // The published tables: no program, nothing offered.
  expect(options({}).some((entry) => entry.network === NETWORK)).toBe(false);
  expect(publishedSolanaWay("2000000")).toBeNull();
  // A program without the switch, and the switch without a program.
  expect(
    options({ ...tables, solanaOn: false }).some(
      (entry) => entry.network === NETWORK,
    ),
  ).toBe(false);
  expect(
    options({ solanaOn: true }).some((entry) => entry.network === NETWORK),
  ).toBe(false);
  const listed = options(tables);
  const solana = listed.find((entry) => entry.network === NETWORK);
  expect(solana).toEqual({
    network: NETWORK,
    chainId: null,
    contract: chain.programId,
    token: chain.mint,
    symbol: "USDC",
    decimals: 6,
    amount: "2000000",
    minimumAccepted: "2000000",
    keptTo: chain.feeWallet,
  });
  const record = (due: unknown[]) => ({
    schema: "slop-submission-fee-item-v1",
    repositoryId: Number(REPOSITORY),
    pullNumber: PULL,
    projectId: "acme",
    item: ITEM,
    stableMinor: "2000000",
    askedAt: NOW,
    due,
    paid: null,
    outcome: null,
    outcomeAt: null,
    resolveTransaction: null,
  });
  const read = (due: unknown[], with_: FeeTables = tables) =>
    readFeeItem(record(due), REPOSITORY, PULL, with_, null);
  expect(read(listed).solana).toMatchObject({
    programId: chain.programId,
    token: chain.mint,
    keptTo: chain.feeWallet,
    amount: "2000000",
  });
  // Every EVM way is still there, and SLOP is unaffected.
  expect(read(listed).due.map((entry) => entry.network)).toEqual([
    "base-mainnet",
    "robinhood-mainnet",
  ]);
  // A page that does not offer Solana leaves the entry out.
  expect(read(listed, PUBLISHED_FEE_TABLES).solana).toBeNull();
  // Any field that differs from the tables refuses the whole record.
  for (const change of [
    { contract: fakeAddress(1) },
    { token: fakeAddress(1) },
    { keptTo: fakeAddress(1) },
    { keptTo: (solana?.keptTo as string).toLowerCase() },
    { amount: "1000000" },
    { minimumAccepted: "1" },
    { chainId: 1 },
    { symbol: "USDT" },
  ])
    expect(() =>
      read(
        listed.map((entry) =>
          entry.network === NETWORK ? { ...entry, ...change } : entry,
        ),
      ),
    ).toThrow(FeeRecordError);
  expect(() => read([...listed, solana])).toThrow(FeeRecordError);
});

test("a recorded Solana payment is read with its base58 mint and signatures", () => {
  const { tables, chain } = harness();
  const signature = "5".repeat(88);
  const body = {
    schema: "slop-submission-fee-item-v1",
    repositoryId: Number(REPOSITORY),
    pullNumber: PULL,
    item: ITEM,
    stableMinor: "2000000",
    askedAt: NOW,
    due: [],
    paid: {
      at: NOW,
      network: NETWORK,
      depositId: 3,
      token: chain.mint,
      amount: "2000000",
      transaction: signature,
      finalized: true,
    },
    outcome: "refunded",
    outcomeAt: NOW,
    resolveTransaction: signature,
  };
  expect(readFeeItem(body, REPOSITORY, PULL, tables, null).paid).toMatchObject({
    network: NETWORK,
    symbol: "USDC",
    decimals: 6,
    transaction: signature,
  });
  expect(() =>
    readFeeItem(
      { ...body, paid: { ...body.paid, token: fakeAddress(1) } },
      REPOSITORY,
      PULL,
      tables,
      null,
    ),
  ).toThrow(FeeRecordError);
  expect(() =>
    readFeeItem(
      { ...body, paid: { ...body.paid, transaction: `0x${"d".repeat(64)}` } },
      REPOSITORY,
      PULL,
      tables,
      null,
    ),
  ).toThrow(FeeRecordError);
});

test("the route is not found while Solana is not offered, and by default", async () => {
  const t = harness();
  t.offered.on = false;
  expect((await t.post({ step: "review", nonce: "1" })).status).toBe(404);
  expect(t.chain.calls).toEqual([]);
  const response = await handleSubmissionFeeApi(
    new Request("https://slop.cash/api/v1/submission-fee/solana", {
      method: "POST",
      body: "{}",
    }),
    { db: {} as never },
  );
  expect(response?.status).toBe(404);
});

test("review prepares exactly the deposit the page builds from the tables", async () => {
  const t = harness();
  const { status, body } = await t.post({ step: "review", nonce: "41" });
  expect(status).toBe(200);
  const plan = body.plan as Record<string, unknown>;
  expect(plan).toMatchObject({
    wallet: WALLET,
    nonce: "41",
    amount: "2000000",
    rentLamports: SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
    networkFeeLamports: "5000",
  });
  const expected = solanaFeeMessage(
    t.way,
    {
      wallet: WALLET,
      item: ITEM,
      nonce: 41n,
      blockhash: plan.blockhash as string,
    },
    idl,
  );
  const wire = solanaBase64Bytes(plan.transaction as string);
  expect([...wire.slice(65)]).toEqual([...expected]);
  expect(wire.slice(1, 65).every((byte) => byte === 0)).toBe(true);
  // Nothing in the request names an address but the payer's own wallet.
  for (const extra of [
    { programId: fakeAddress(1) },
    { keptTo: fakeAddress(1) },
    { item: `0x${"1".repeat(64)}` },
    { amount: "1" },
  ]) {
    const again = await t.post({ step: "review", nonce: "41", ...extra });
    expect(
      (again.body.plan as Record<string, unknown>).transaction,
    ).toBe(plan.transaction);
  }
});

test("review refuses before the wallet is asked", async () => {
  const t = harness();
  const refused = async (nonce = "1") =>
    (await t.post({ step: "review", nonce })).body;
  t.chain.paused = true;
  expect((await refused()).message).toContain("paused");
  t.chain.paused = false;
  // The fee wallet has no USDC account: a kept fee would have nowhere to go.
  t.chain.tokenAccount(t.chain.feeWallet, t.chain.mint, 0);
  expect((await refused()).message).toContain("not available");
  t.chain.tokenAccount(t.chain.feeWallet, t.chain.mint);
  const mine = solanaAssociatedTokenAddress(t.chain.mint, WALLET);
  const held = t.chain.accounts.get(mine);
  t.chain.accounts.delete(mine);
  expect((await refused()).message).toContain("no USDC account");
  t.chain.tokenAccount(WALLET, t.chain.mint);
  expect((await refused()).message).toContain("enough USDC");
  if (held) t.chain.accounts.set(mine, held);
  // This wallet already used this nonce.
  t.chain.accounts.set(
    submissionDepositAddress(t.chain.programId, WALLET, 9n),
    { owner: t.chain.programId, data: new Uint8Array(8) },
  );
  expect(await t.post({ step: "review", nonce: "9" })).toMatchObject({
    status: 409,
    body: { error: "nonce_used" },
  });
  expect((await t.post({ step: "review", nonce: "10" })).status).toBe(200);
  t.sqlite
    .query("UPDATE submission_fee_items SET paid_at = ?, paid_network = 'base-mainnet', paid_deposit_id = 1")
    .run(NOW);
  expect((await refused("11")).error).toBe("fee_already_paid");
  expect(
    (await t.post({ step: "review", nonce: "1", pullNumber: 99 })).status,
  ).toBe(404);
  expect((await t.post({ step: "review", nonce: "-1" })).status).toBe(400);
  expect(
    (await t.post({ step: "review", nonce: "1", wallet: "0xabc" })).status,
  ).toBe(400);
});

test("check reads only the finalized transaction that is the reviewed message", async () => {
  const t = harness();
  const plan = (await t.post({ step: "review", nonce: "41" })).body
    .plan as Record<string, string>;
  const body = solanaBase64Bytes(plan.transaction).slice(65);
  const signature = ed25519.sign(body, seed);
  const wire = Uint8Array.from([1, ...signature, ...body]);
  const transactionId = solanaBase58(signature);
  const check = (overrides: Record<string, unknown> = {}) =>
    t.post({
      step: "check",
      nonce: "41",
      blockhash: plan.blockhash,
      transactionId,
      ...overrides,
    });
  expect((await check()).body).toEqual({ status: "pending" });
  t.chain.landWallet(wire);
  expect((await check()).body).toEqual({ status: "finalized" });
  // The same signature is not a deposit with another nonce.
  expect((await check({ nonce: "42" })).status).toBe(422);
  const failed = harness();
  const other = (await failed.post({ step: "review", nonce: "41" })).body
    .plan as Record<string, string>;
  const otherBody = solanaBase64Bytes(other.transaction).slice(65);
  const otherSignature = ed25519.sign(otherBody, seed);
  failed.chain.landWallet(
    Uint8Array.from([1, ...otherSignature, ...otherBody]),
    true,
  );
  expect(
    (
      await failed.post({
        step: "check",
        nonce: "41",
        blockhash: other.blockhash,
        transactionId: solanaBase58(otherSignature),
      })
    ).body,
  ).toEqual({ status: "failed" });
});

test("a payer takes back a recorded deposit only after the program's delay, into their own account", async () => {
  const t = harness();
  const made = t.chain.pay({ payer: WALLET, item: ITEM });
  t.sqlite
    .query(
      `INSERT INTO submission_fee_deposits
         (network, deposit_id, item, payer, token, amount, kept_to, tx_hash,
          block_number, block_time, finalized_at, accepted, state, deposit_account)
       VALUES (?, 1, ?, ?, ?, '2000000', ?, ?, 5, ?, ?, 1, 'open', ?)`,
    )
    .run(
      NETWORK,
      ITEM,
      WALLET,
      t.chain.mint,
      t.chain.feeWallet,
      made.signature,
      NOW,
      NOW,
      made.account,
    );
  const early = await t.post({ step: "reclaim-review" });
  expect(early.status).toBe(422);
  expect(early.body.error).toBe("reclaim_too_early");
  // Thirty days and a minute after the deposit's own time on chain.
  t.clock.now = new Date((t.chain.time + 30 * 86_400 + 60) * 1000).toISOString();
  const { status, body } = await t.post({ step: "reclaim-review" });
  expect(status).toBe(200);
  const plan = body.plan as Record<string, string>;
  expect(plan).toMatchObject({
    wallet: WALLET,
    deposit: made.account,
    mint: t.chain.mint,
    amount: "2000000",
  });
  const expected = solanaReclaimMessage(
    t.way,
    { wallet: WALLET, deposit: made.account, blockhash: plan.blockhash },
    idl,
  );
  expect([...solanaBase64Bytes(plan.transaction).slice(65)]).toEqual([
    ...expected,
  ]);
  // Another wallet has no deposit here.
  const stranger = await t.post({
    step: "reclaim-review",
    wallet: fakeAddress(12),
  });
  expect(stranger.body.error).toBe("no_open_deposit");
  const signature = ed25519.sign(expected, seed);
  t.chain.landWallet(Uint8Array.from([1, ...signature, ...expected]));
  expect(
    (
      await t.post({
        step: "reclaim-check",
        deposit: made.account,
        blockhash: plan.blockhash,
        transactionId: solanaBase58(signature),
      })
    ).body,
  ).toEqual({ status: "finalized" });
  expect(
    (
      await t.post({
        step: "reclaim-check",
        deposit: fakeAddress(1),
        blockhash: plan.blockhash,
        transactionId: solanaBase58(signature),
      })
    ).status,
  ).toBe(400);
});
