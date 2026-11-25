// The submission-fee Worker's Solana ledger against the real migrations and
// a small cluster that behaves like the `slop-submission-deposits` program:
// open deposits are read from accounts, judged and marked paid; what
// Slopbot's row says is due is sent once; a settlement is recorded from the
// transaction that closed the record.
import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaAssociatedTokenAddress,
  solanaBase58,
  solanaBase64Bytes,
} from "../../contracts/solana/adapter";
import {
  resolveInstruction,
  SUBMISSION_DEPOSITS_IDL,
  submissionDepositAddress,
} from "../../contracts/solana/submission-deposits";
import { message as legacyMessage } from "../../contracts/solana/transactions";
import {
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_SOLANA_DEPOSIT_BYTES,
  SUBMISSION_FEE_SOLANA_SWITCHED_ON,
  SUBMISSION_FEE_START_BLOCKS,
  submissionFeeItem,
} from "../../src/lib/submission-fee.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { parseSolanaConfig, type SolanaFeeConfig } from "./config";
import { PayoutFailedError } from "./core";
import { FakeSolana, fakeAddress } from "./fixtures/solana-fake";
import { type Env, runDeposits } from "./index";
import {
  createSolanaFeeChain,
  SOLANA_MAX_BATCH,
  SOLANA_REQUESTS_PER_RUN,
  SOLANA_TRANSACTION_BYTES,
} from "./solana";
import { SOLANA_OPEN_ALERT, SOLANA_STEP_REQUESTS } from "./solana-core";
import type { SubmissionFeeD1Database } from "./store";

const ITEMS = `CREATE TABLE IF NOT EXISTS submission_fee_items (
  repository_id INTEGER NOT NULL,
  pull_number INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  item TEXT NOT NULL,
  stable_minor TEXT NOT NULL,
  asked_at TEXT NOT NULL,
  paid_at TEXT,
  paid_network TEXT,
  paid_deposit_id INTEGER,
  outcome TEXT,
  outcome_at TEXT,
  PRIMARY KEY (repository_id, pull_number)
)`;

const NETWORK = "solana-mainnet";
const REPOSITORY = 4242;
const SEED = "07".repeat(32);
const RESOLVER = solanaBase58(
  ed25519.getPublicKey(Uint8Array.from({ length: 32 }, () => 7)),
);
const PAYER = fakeAddress(11);
const OTHER = fakeAddress(12);
const idl = SUBMISSION_DEPOSITS_IDL;

function setup(
  mode: "dry_run" | "live" = "live",
  limits: { perDay?: string } = {},
) {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(ITEMS);
  const chain = new FakeSolana(idl);
  chain.resolver = RESOLVER;
  const genesisHash = chain.genesis;
  const clock = { at: Date.parse("2026-12-01T12:00:00.000Z") };
  const logs: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  const env: Env = {
    SUBMISSION_FEE_DB: db as unknown as SubmissionFeeD1Database,
    SUBMISSION_FEE_MODE: "off",
    SUBMISSION_FEE_SOLANA_MODE: mode,
    SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_TX: "10000",
    SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_DAY: limits.perDay ?? "12000",
    RPC_URL_SUBMISSION_FEE_SOLANA: "https://solana.invalid/key",
    SUBMISSION_FEE_SOLANA_RESOLVER_SEED: SEED,
  };
  const solanaConfig = (): SolanaFeeConfig =>
    parseSolanaConfig(env, {
      network: NETWORK,
      programId: chain.programId,
      startSlot: 1000,
      mint: chain.mint,
      feeWallet: chain.feeWallet,
      genesisHash,
    });
  const run = (options: { requests?: number } = {}) =>
    runDeposits(env, () => new Date(clock.at), {
      solanaConfig,
      solanaChain: (network, seed) =>
        createSolanaFeeChain({
          network,
          seed,
          fetch: chain.fetch,
          idl,
          ...options,
        }),
      log: (event) => logs.push(event),
      onError: (error) => errors.push(error),
    });
  const ledger = async (options: { requests?: number } = {}) => {
    const result = await run(options);
    if (result.status !== "ran") throw new Error(result.status);
    expect(result.networks).toHaveLength(1);
    return result.networks[0] as Record<string, unknown>;
  };
  const ask = (pull: number, stableMinor = "2000000") =>
    sqlite
      .query(
        "INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at) VALUES (?, ?, 'acme', ?, ?, '2026-12-01T00:00:00.000Z')",
      )
      .run(REPOSITORY, pull, submissionFeeItem(REPOSITORY, pull), stableMinor);
  const decide = (pull: number, outcome: string | null) =>
    sqlite
      .query(
        "UPDATE submission_fee_items SET outcome = ? WHERE repository_id = ? AND pull_number = ?",
      )
      .run(outcome, REPOSITORY, pull);
  const item = (pull: number) =>
    sqlite
      .query(
        "SELECT * FROM submission_fee_items WHERE repository_id = ? AND pull_number = ?",
      )
      .get(REPOSITORY, pull) as Record<string, unknown>;
  const deposit = (id: number) =>
    sqlite
      .query(
        "SELECT * FROM submission_fee_deposits WHERE network = ? AND deposit_id = ?",
      )
      .get(NETWORK, id) as Record<string, unknown> | null;
  const sends = () =>
    sqlite
      .query("SELECT * FROM submission_fee_solana_sends ORDER BY rowid")
      .all() as Record<string, unknown>[];
  const searches = () =>
    sqlite
      .query(
        "SELECT * FROM submission_fee_solana_settlements ORDER BY deposit_id",
      )
      .all() as Record<string, unknown>[];
  const count = (where = "1 = 1") =>
    (
      sqlite
        .query(
          `SELECT COUNT(*) AS n FROM submission_fee_deposits WHERE ${where}`,
        )
        .get() as { n: number }
    ).n;
  const pay = (
    pull: number,
    overrides: Parameters<FakeSolana["pay"]>[0] | object = {},
  ) =>
    chain.pay({
      payer: PAYER,
      item: submissionFeeItem(REPOSITORY, pull),
      ...overrides,
    });
  const later = (ms: number) => {
    clock.at += ms;
  };
  return {
    sqlite,
    chain,
    env,
    logs,
    errors,
    run,
    ledger,
    ask,
    decide,
    item,
    deposit,
    sends,
    searches,
    count,
    pay,
    later,
  };
}

describe("the Solana switch", () => {
  test("ships off, with no program published and nothing offered", () => {
    expect(SUBMISSION_FEE_CONTRACTS[NETWORK]).toBeNull();
    expect(SUBMISSION_FEE_START_BLOCKS[NETWORK]).toBeNull();
    expect(SUBMISSION_FEE_SOLANA_SWITCHED_ON).toBe(false);
    for (const file of ["wrangler.toml"]) {
      const text = require("node:fs").readFileSync(
        `${import.meta.dir}/${file}`,
        "utf8",
      ) as string;
      // The page offers Solana exactly while the Worker settles it.
      expect(/^SUBMISSION_FEE_SOLANA_MODE = "live"$/mu.test(text)).toBe(
        SUBMISSION_FEE_SOLANA_SWITCHED_ON,
      );
      expect(text).toMatch(/^SUBMISSION_FEE_SOLANA_MODE = "off"$/mu);
    }
  });

  test("off reads nothing, whatever else is set", async () => {
    const t = setup();
    t.env.SUBMISSION_FEE_SOLANA_MODE = "off";
    expect(await t.run()).toEqual({ status: "off" });
    expect(t.chain.calls).toEqual([]);
  });

  test("a switched-on ledger with no published program reads nothing", async () => {
    const t = setup();
    const result = await runDeposits(t.env, undefined, {
      log: (event) => t.logs.push(event),
    });
    expect(result).toEqual({
      status: "ran",
      mode: "off",
      solanaMode: "live",
      unset: [NETWORK],
      networks: [],
    });
    expect(t.chain.calls).toEqual([]);
  });

  test("a program id without a start slot, or an http endpoint, is refused", () => {
    const t = setup();
    const deployment = {
      network: NETWORK,
      programId: t.chain.programId,
      startSlot: null,
    };
    expect(() => parseSolanaConfig(t.env, deployment)).toThrow(TypeError);
    t.env.RPC_URL_SUBMISSION_FEE_SOLANA = "http://solana.invalid";
    expect(() =>
      parseSolanaConfig(t.env, { ...deployment, startSlot: 5 }),
    ).toThrow("https");
    // The EVM mode does not switch Solana on.
    expect(
      parseSolanaConfig({ SUBMISSION_FEE_MODE: "live" }, deployment),
    ).toEqual({ mode: "off", ledger: null });
  });

  test("live without the resolver seed is an error and signs nothing", async () => {
    const t = setup();
    t.env.SUBMISSION_FEE_SOLANA_RESOLVER_SEED = "";
    const result = await t.ledger();
    expect(result.error).toBe("submission_fee_invalid_input");
    expect(t.chain.calls).toEqual([]);
  });

  test("another cluster is refused before anything is read", async () => {
    const t = setup();
    t.pay(1);
    (t.chain as { genesis: string }).genesis = fakeAddress(1);
    const result = await t.ledger();
    expect(result.status).toBe("chain_mismatch");
    expect(t.chain.calls).toEqual(["getGenesisHash"]);
    expect(t.deposit(1)).toBeNull();
  });
});

describe("reading deposits", () => {
  test("an open deposit is recorded with its record address and pays its pull request", async () => {
    const t = setup();
    t.ask(7);
    const made = t.pay(7);
    const result = await t.ledger();
    expect(result).toMatchObject({
      status: "ran",
      recorded: 1,
      judged: 1,
      paid: 1,
      finalizedThrough: 1,
      send: "none",
    });
    expect(t.deposit(1)).toMatchObject({
      payer: PAYER,
      token: t.chain.mint,
      amount: "2000000",
      kept_to: t.chain.feeWallet,
      tx_hash: made.signature,
      deposit_account: made.account,
      accepted: 1,
      state: "open",
    });
    expect(t.deposit(1)?.finalized_at).not.toBeNull();
    expect(t.item(7)).toMatchObject({
      paid_network: NETWORK,
      paid_deposit_id: 1,
    });
    // Every read named finalized commitment.
    expect(t.chain.calls).toContain("getProgramAccounts");
    // A second run records nothing again.
    expect(await t.ledger()).toMatchObject({ recorded: 0, judged: 0, paid: 0 });
  });

  test("a deposit whose kept wallet is not the fee wallet is never fetched or recorded", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7, { keptTo: OTHER });
    expect(await t.ledger()).toMatchObject({
      open: 0,
      recorded: 0,
      finalizedThrough: 1,
    });
    expect(t.deposit(1)).toBeNull();
    expect(t.item(7).paid_deposit_id).toBeNull();
  });

  test("a deposit of another mint is never fetched, recorded or resolved", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7, { mint: fakeAddress(99) });
    expect(await t.ledger()).toMatchObject({ open: 0, recorded: 0 });
    expect(t.deposit(1)).toBeNull();
    t.later(48 * 3600_000);
    expect(await t.ledger()).toMatchObject({ send: "none" });
    expect(t.sends()).toEqual([]);
    expect(t.chain.calls).not.toContain("sendTransaction");
  });

  test("the endpoint filters the listing and returns ids only", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    const asked: unknown[][] = [];
    t.chain.onCall = (method, params) => {
      if (method === "getProgramAccounts") asked.push(params);
    };
    await t.ledger();
    expect(asked).toHaveLength(1);
    expect(asked[0][1]).toMatchObject({
      commitment: "finalized",
      dataSlice: { offset: 8, length: 8 },
      filters: [
        { dataSize: SUBMISSION_FEE_SOLANA_DEPOSIT_BYTES },
        { memcmp: { offset: 0 } },
        { memcmp: { offset: 56, bytes: t.chain.mint } },
        { memcmp: { offset: 88, bytes: t.chain.feeWallet } },
      ],
    });
  });

  test("a deposit below the fee is recorded, refused and never resolved or tracked", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7, { amount: 1n });
    await t.ledger();
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "amount_below_due",
      state: "open",
    });
    t.later(48 * 3600_000);
    const before = t.chain.calls.length;
    expect(await t.ledger()).toMatchObject({ send: "none", searching: 0 });
    // Nothing is read for it again: the listing, and no more.
    expect(t.chain.calls.slice(before)).toEqual([
      "getGenesisHash",
      "getAccountInfo",
      "getProgramAccounts",
    ]);
    expect(t.sends()).toEqual([]);
    // Its payer takes it back; the Worker does not follow that either.
    t.chain.reclaim(t.deposit(1)?.deposit_account as string);
    expect(await t.ledger()).toMatchObject({ resolved: 0, searching: 0 });
  });

  test("a deposit settled before it was ever recorded is passed over, and the cursor moves on", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    const first = t.pay(7);
    t.chain.reclaim(first.account);
    t.pay(8);
    const result = await t.ledger();
    expect(result).toMatchObject({ recorded: 1, finalizedThrough: 2 });
    expect(t.deposit(1)).toBeNull();
    expect(t.deposit(2)).toMatchObject({ accepted: 1 });
  });

  test("a failed listing is reported, leaves the cursor where it was, and the next run records", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    t.chain.failMethod = "getProgramAccounts";
    const failed = await t.ledger();
    expect(failed).toMatchObject({
      error: "submission_fee_operation_failed",
      steps: { list: "chain.listing/SolanaFeeRpcError:status-503" },
    });
    expect(t.deposit(1)).toBeNull();
    t.chain.failMethod = null;
    const next = await t.ledger();
    expect(next).toMatchObject({ recorded: 1, paid: 1 });
    expect(next.error).toBeUndefined();
  });

  test("a failed listing does not stop what is already due from being sent", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    t.chain.failMethod = "getProgramAccounts";
    const result = await t.ledger();
    expect(result).toMatchObject({
      send: "sent",
      steps: { list: "chain.listing/SolanaFeeRpcError:status-503" },
    });
    expect(t.sends()).toMatchObject([{ state: "submitted" }]);
  });
});

describe("settling deposits", () => {
  test("dry_run records what it would send and loads no key", async () => {
    const t = setup("dry_run");
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    expect(await t.ledger()).toMatchObject({ send: "recorded" });
    expect(t.sends()).toMatchObject([
      {
        mode: "dry_run",
        state: "recorded",
        program: t.chain.programId,
        deposits: '[{"id":1,"refund":true}]',
        resolver: null,
        tx_id: null,
      },
    ]);
    expect(await t.ledger()).toMatchObject({ send: "unchanged" });
    for (const method of [
      "sendTransaction",
      "simulateTransaction",
      "getLatestBlockhash",
    ])
      expect(t.chain.calls).not.toContain(method);
  });

  test("a merge sends the refund to the payer's token account, once", async () => {
    const t = setup();
    t.ask(7);
    const made = t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    expect(await t.ledger()).toMatchObject({ send: "sent" });
    const [send] = t.sends();
    expect(send).toMatchObject({
      mode: "live",
      state: "submitted",
      resolver: RESOLVER,
      maximum_lamports: "5000",
    });
    expect(t.chain.broadcasts).toEqual([send.tx_id as string]);
    // Unsettled: the next run waits and signs nothing more.
    expect(await t.ledger()).toMatchObject({ send: "in_flight" });
    expect(t.sends()).toHaveLength(1);
    t.chain.land(send.tx_id as string);
    const settled = await t.ledger();
    expect(settled).toMatchObject({ resolved: 1, send: "none" });
    expect(t.sends()[0]).toMatchObject({ state: "finalized" });
    expect(t.deposit(1)).toMatchObject({
      state: "refunded",
      resolve_tx: send.tx_id,
    });
    expect(t.item(7).outcome).toBe("refunded");
    expect(
      t.chain.balance(solanaAssociatedTokenAddress(t.chain.mint, PAYER)),
    ).toBe(2_000_000n);
    expect(t.chain.accounts.has(made.account)).toBe(false);
    expect(await t.ledger()).toMatchObject({ resolved: 0, send: "none" });
    expect(t.sends()).toHaveLength(1);
  });

  test("a kept fee reaches the fee wallet's token account and is recorded from the transaction", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "kept_due");
    await t.ledger();
    t.chain.land(t.sends()[0].tx_id as string);
    await t.ledger();
    expect(t.deposit(1)).toMatchObject({ state: "kept", accepted: 1 });
    expect(t.item(7).outcome).toBe("kept");
    expect(
      t.chain.balance(
        solanaAssociatedTokenAddress(t.chain.mint, t.chain.feeWallet),
      ),
    ).toBe(2_000_000n);
  });

  test("a settlement the transaction does not prove is not recorded", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "kept_due");
    await t.ledger();
    const signature = t.sends()[0].tx_id as string;
    t.chain.land(signature);
    // The receipt now claims the fee wallet's account did not rise.
    const meta = (
      (t.chain.landed.get(signature) as { json: unknown }).json as {
        meta: Record<string, unknown>;
      }
    ).meta;
    meta.postTokenBalances = meta.preTokenBalances;
    const result = await t.ledger();
    // The one deposit is set aside with a fixed reason; the run goes on.
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ resolved: 0, searching: 1 });
    expect(t.logs).toContainEqual({
      event: "submission_fee_solana_set_aside",
      network: NETWORK,
      depositId: 1,
      step: "own_settlement",
      reason: "proof_failed",
    });
    expect(t.deposit(1)).toMatchObject({ state: "kept_due" });
    expect(t.item(7).outcome).toBe("kept_due");
    expect(t.searches()).toMatchObject([
      { deposit_id: 1, reason: "proof_failed", done_at: null },
    ]);
  });

  test("a payer's own reclaim is recorded as reclaimed and the pull request as refunded", async () => {
    const t = setup();
    t.ask(7);
    const made = t.pay(7);
    await t.ledger();
    const signature = t.chain.reclaim(made.account);
    expect(await t.ledger()).toMatchObject({ resolved: 1 });
    expect(t.deposit(1)).toMatchObject({
      state: "reclaimed",
      resolve_tx: signature,
    });
    expect(t.item(7).outcome).toBe("refunded");
  });

  test("a refund whose payer has no token account is parked; the next deposit is still refunded", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    t.pay(7, { payer: OTHER, tokenAccount: false });
    t.pay(8);
    await t.ledger();
    t.decide(7, "refund_due");
    t.decide(8, "refund_due");
    expect(await t.ledger()).toMatchObject({ send: "sent", parked: 1 });
    expect(t.sends()[0].deposits).toBe('[{"id":2,"refund":true}]');
    expect(t.logs).toContainEqual({
      event: "submission_fee_parked",
      network: NETWORK,
      depositId: 1,
      refund: true,
      reason: "payout_failed",
    });
    // The Worker never creates the payer's token account.
    expect(
      t.chain.accounts.has(solanaAssociatedTokenAddress(t.chain.mint, OTHER)),
    ).toBe(false);
    t.chain.land(t.sends()[0].tx_id as string);
    await t.ledger();
    // A day later the payer has made the account: the refund goes out.
    t.chain.tokenAccount(OTHER, t.chain.mint);
    t.later(25 * 3600_000);
    expect(await t.ledger()).toMatchObject({ released: 1, send: "sent" });
    t.chain.land(t.sends()[1].tx_id as string);
    await t.ledger();
    expect(t.deposit(1)).toMatchObject({ state: "refunded" });
  });

  test("a frozen token account, or one handed to another owner, is not paid", async () => {
    for (const change of ["frozen", "owner"] as const) {
      const t = setup();
      t.ask(7);
      t.pay(7);
      await t.ledger();
      t.decide(7, "refund_due");
      if (change === "frozen") t.chain.tokenAccount(PAYER, t.chain.mint, 2);
      else t.chain.tokenAccount(PAYER, t.chain.mint, 1, OTHER);
      expect(await t.ledger()).toMatchObject({ send: "parked", parked: 1 });
      expect(t.sends()).toEqual([]);
    }
  });

  test("a key that is not the program's resolver signs nothing and parks nothing", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    t.chain.resolver = OTHER;
    expect(await t.ledger()).toMatchObject({
      send: "resolver_differs",
      parked: 0,
    });
    expect(t.sends()).toEqual([]);
    expect(t.chain.calls).not.toContain("simulateTransaction");
  });

  test("a transaction whose blockhash expired is failed and its deposit sent again", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    await t.ledger();
    const first = t.sends()[0];
    // Still inside its lifetime and unknown to the node: the same bytes go out again.
    t.chain.mempool.clear();
    expect(await t.ledger()).toMatchObject({ send: "in_flight" });
    expect(t.chain.broadcasts).toEqual([first.tx_id, first.tx_id] as string[]);
    t.chain.mempool.clear();
    t.chain.height = (first.last_valid_block_height as number) + 1;
    expect(await t.ledger()).toMatchObject({ send: "sent" });
    expect(t.sends()).toMatchObject([
      {
        state: "failed",
        reason: "blockhash expired before the transaction landed",
      },
      { state: "submitted" },
    ]);
    expect(t.sends()[1].tx_id).not.toBe(first.tx_id);
  });

  test("the day's lamport limit stops signing", async () => {
    const t = setup();
    for (const pull of [7, 8, 9]) {
      t.ask(pull);
      t.pay(pull);
    }
    await t.ledger();
    for (const pull of [7, 8, 9]) {
      t.decide(pull, "refund_due");
      const result = await t.ledger();
      if (pull === 9) {
        // Two sends of 5,000 lamports are inside 12,000; a third is not.
        expect(result).toMatchObject({ send: "gas_budget" });
        break;
      }
      expect(result).toMatchObject({ send: "sent" });
      t.chain.land(t.sends().at(-1)?.tx_id as string);
      await t.ledger();
    }
    expect(t.sends()).toHaveLength(2);
  });

  test("the EVM send table and the EVM mode are untouched", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    const result = await t.run();
    expect(result).toMatchObject({ mode: "off", solanaMode: "live" });
    expect(
      t.sqlite.query("SELECT COUNT(*) AS n FROM submission_fee_sends").get(),
    ).toEqual({ n: 0 });
  });
});

describe("the resolve transaction", () => {
  test("a full batch of refunds to different payers fits one transaction", () => {
    const programId = fakeAddress(200);
    const mint = fakeAddress(201);
    const build = (count: number) =>
      legacyMessage(
        RESOLVER,
        fakeAddress(77),
        Array.from({ length: count }, (_, index) => {
          const payer = fakeAddress(20 + index);
          return resolveInstruction(
            {
              programId,
              resolver: RESOLVER,
              deposit: submissionDepositAddress(programId, payer, 1n),
              record: { id: index + 1, payer, mint, keptTo: fakeAddress(202) },
              refund: true,
            },
            idl,
          );
        }),
      ).length + 65;
    expect(build(SOLANA_MAX_BATCH)).toBeLessThanOrEqual(
      SOLANA_TRANSACTION_BYTES,
    );
    // The measured ceiling for refunds, each with three accounts of its own.
    expect(build(7)).toBe(1201);
    expect(build(8)).toBeGreaterThan(SOLANA_TRANSACTION_BYTES);
  });

  test("the signed bytes carry only resolve instructions to the table's program", async () => {
    const t = setup();
    t.ask(7);
    const made = t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    await t.ledger();
    const wire = solanaBase64Bytes(t.sends()[0].raw_tx as string);
    const expected = legacyMessage(RESOLVER, t.chain.blockhash(), [
      resolveInstruction(
        {
          programId: t.chain.programId,
          resolver: RESOLVER,
          deposit: made.account,
          record: {
            id: 1,
            payer: PAYER,
            mint: t.chain.mint,
            keptTo: t.chain.feeWallet,
          },
          refund: true,
        },
        idl,
      ),
    ]);
    expect([...wire.slice(65)]).toEqual([...expected]);
  });
});

describe("a record address used again", () => {
  test("each deposit keeps its own id, creating transaction and outcome", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    const first = t.pay(7, { nonce: 5n });
    await t.ledger();
    t.decide(7, "refund_due");
    await t.ledger();
    const refund = t.sends()[0].tx_id as string;
    t.chain.land(refund);
    // Before the Worker runs again the payer deposits with the same nonce:
    // the same address now holds deposit 2.
    const second = t.pay(8, { nonce: 5n });
    expect(second.account).toBe(first.account);
    expect(second.id).toBe(2);
    const result = await t.ledger();
    expect(result).toMatchObject({ recorded: 1, resolved: 1, paid: 1 });
    expect(t.deposit(1)).toMatchObject({
      state: "refunded",
      tx_hash: first.signature,
      resolve_tx: refund,
      deposit_account: first.account,
    });
    expect(t.deposit(2)).toMatchObject({
      state: "open",
      tx_hash: second.signature,
      deposit_account: first.account,
      accepted: 1,
    });
    expect(t.item(7).outcome).toBe("refunded");
    expect(t.item(8)).toMatchObject({ paid_deposit_id: 2, outcome: null });
    // The second deposit is kept. Its outcome is the first settlement after
    // its own creation, not the earlier refund on the same address.
    t.decide(8, "kept_due");
    expect(await t.ledger()).toMatchObject({ send: "sent" });
    const kept = t.sends()[1].tx_id as string;
    expect(t.sends()[1].deposits).toBe('[{"id":2,"refund":false}]');
    t.chain.land(kept);
    // And the address is used a third time before the next run.
    t.ask(9);
    const third = t.pay(9, { nonce: 5n });
    expect(third.account).toBe(first.account);
    await t.ledger();
    expect(t.deposit(2)).toMatchObject({ state: "kept", resolve_tx: kept });
    expect(t.deposit(1)).toMatchObject({
      state: "refunded",
      resolve_tx: refund,
    });
    expect(t.deposit(3)).toMatchObject({
      state: "open",
      tx_hash: third.signature,
    });
    expect(t.item(8).outcome).toBe("kept");
    expect(
      t.chain.balance(
        solanaAssociatedTokenAddress(t.chain.mint, t.chain.feeWallet),
      ),
    ).toBe(2_000_000n);
  });

  test("a due deposit whose address now holds another deposit is not sent for", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    const first = t.pay(7, { nonce: 5n });
    await t.ledger();
    // The payer reclaims by hand and deposits again with the same nonce
    // while the first deposit's refund is due.
    t.decide(7, "refund_due");
    const reclaimed = t.chain.reclaim(first.account);
    t.pay(8, { nonce: 5n });
    const result = await t.ledger();
    expect(result).toMatchObject({ resolved: 1, send: "none" });
    expect(t.deposit(1)).toMatchObject({
      state: "reclaimed",
      resolve_tx: reclaimed,
    });
    expect(t.deposit(2)).toMatchObject({ state: "open" });
    expect(t.sends()).toEqual([]);
  });
});

describe("a record address that changes hands between the read and the signature", () => {
  /** The interface with `expected_id` on `resolve`, whichever the committed one is. */
  const expectingId = (() => {
    const copy = structuredClone(SUBMISSION_DEPOSITS_IDL);
    const resolve = copy.instructions.find((entry) => entry.name === "resolve");
    if (resolve && !resolve.args.some((arg) => arg.name === "expected_id"))
      resolve.args.push({ name: "expected_id", type: "u64" });
    return copy;
  })();

  test("the record is read again before signing; a newer deposit there is never resolved in the old one's place", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    const first = t.pay(7, { nonce: 5n });
    await t.ledger();
    t.decide(7, "refund_due");
    // After the run's scan and the send step's own read, and right before
    // the record is read again for signing, the payer reclaims deposit 1 and
    // deposits again with the same nonce: the address now holds deposit 2.
    let reads = 0;
    t.chain.onCall = (method, params) => {
      if (method !== "getAccountInfo" || params[0] !== first.account) return;
      reads += 1;
      if (reads !== 2) return;
      t.chain.reclaim(first.account);
      t.pay(8, { nonce: 5n });
    };
    const result = await t.ledger();
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(result).toMatchObject({ parked: 0 });
    expect(result.send).not.toBe("sent");
    // Nothing was built, signed or sent for either deposit.
    expect(t.sends()).toEqual([]);
    expect(t.chain.calls).not.toContain("sendTransaction");
    expect(t.chain.calls).not.toContain("simulateTransaction");
    t.chain.onCall = null;
    // The next run records what happened to each, by id.
    await t.ledger();
    expect(t.deposit(1)).toMatchObject({ state: "reclaimed" });
    expect(t.deposit(2)).toMatchObject({ state: "open", accepted: 1 });
    expect(t.item(8)).toMatchObject({ paid_deposit_id: 2, outcome: null });
    expect(t.sends()).toEqual([]);
  });

  test("a resolve names the id the Worker recorded, and the program refuses it for any other deposit", async () => {
    const chain = new FakeSolana(expectingId);
    chain.resolver = RESOLVER;
    const made = chain.pay({
      payer: PAYER,
      item: submissionFeeItem(REPOSITORY, 7),
      nonce: 5n,
    });
    const network = parseSolanaConfig(
      {
        SUBMISSION_FEE_SOLANA_MODE: "live",
        SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_TX: "10000",
        SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_DAY: "12000",
        RPC_URL_SUBMISSION_FEE_SOLANA: "https://solana.invalid/key",
      },
      {
        network: NETWORK,
        programId: chain.programId,
        startSlot: 1000,
        mint: chain.mint,
        feeWallet: chain.feeWallet,
        genesisHash: chain.genesis,
      },
    ).ledger;
    if (!network) throw new Error("no ledger");
    const client = createSolanaFeeChain({
      network,
      seed: SEED,
      fetch: chain.fetch,
      idl: expectingId,
    });
    client.track(1, made.account);
    const prepared = await client.prepare(
      [{ id: 1, refund: true }],
      async () => {},
    );
    const data = solanaBase64Bytes(prepared.rawTx);
    // The last eight bytes of the one instruction are the expected id, 1.
    expect(
      new DataView(data.buffer, data.byteOffset).getBigUint64(
        data.length - 8,
        true,
      ),
    ).toBe(1n);
    // The signed bytes land after the address changed hands: the program
    // refuses them, and deposit 2 stays open.
    chain.reclaim(made.account);
    chain.pay({
      payer: PAYER,
      item: submissionFeeItem(REPOSITORY, 8),
      nonce: 5n,
    });
    await client.broadcast(prepared.rawTx);
    chain.land(prepared.txId);
    expect(chain.landed.get(prepared.txId)?.failed).toBe(true);
    expect(chain.accounts.has(made.account)).toBe(true);
    expect(await client.deposit(1)).toMatchObject({ closed: true });
  });
});

// Anyone can name any address in a transaction for the base fee, and anyone
// can deposit any mint. Neither may stop the ledger or another deposit.
describe("transactions that merely name a record address", () => {
  test("3,500 of them on a new deposit do not stop it being recorded and paid", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    const made = t.pay(7);
    t.chain.junk(made.account, 3500, true);
    t.pay(8);
    const result = await t.ledger();
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ recorded: 2, paid: 2 });
    expect(Number(result.requests)).toBeLessThan(SOLANA_REQUESTS_PER_RUN);
    // The creating transaction is behind the first page: the row names the
    // record's address in its place.
    expect(t.deposit(1)).toMatchObject({
      tx_hash: made.account,
      deposit_account: made.account,
      accepted: 1,
    });
    expect(t.item(7)).toMatchObject({ paid_deposit_id: 1 });
    // One page of signatures was read for it, and no more.
    expect(
      t.chain.calls.filter((call) => call === "getSignaturesForAddress"),
    ).toHaveLength(2);
  });

  test("ones in the very second of the deposit are not mistaken for its creation", async () => {
    const t = setup();
    t.ask(7);
    const made = t.pay(7);
    t.chain.junk(made.account, 10);
    expect(await t.ledger()).toMatchObject({ recorded: 1, paid: 1 });
    expect(t.deposit(1)).toMatchObject({ tx_hash: made.account });
    // Two transactions were read for it, not ten.
    expect(
      t.chain.calls.filter((call) => call === "getTransaction"),
    ).toHaveLength(2);
  });

  test("the Worker's own refund is recorded from its own transaction whatever names the address", async () => {
    const t = setup();
    t.ask(7);
    const made = t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    await t.ledger();
    const signature = t.sends()[0].tx_id as string;
    t.chain.junk(made.account, 2000, true);
    t.chain.land(signature);
    t.chain.junk(made.account, 5000, true);
    const before = t.chain.calls.length;
    const result = await t.ledger();
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ resolved: 1, searching: 0 });
    expect(t.deposit(1)).toMatchObject({
      state: "refunded",
      resolve_tx: signature,
    });
    expect(t.item(7).outcome).toBe("refunded");
    // The address's own history was not read at all.
    expect(t.chain.calls.slice(before)).not.toContain(
      "getSignaturesForAddress",
    );
  });

  test("40 of them before a payer's reclaim and 30 after delay only that deposit's record", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    const made = t.pay(7);
    await t.ledger();
    t.chain.junk(made.account, 40, true);
    const reclaimed = t.chain.reclaim(made.account);
    t.chain.junk(made.account, 30, true);
    // Another contributor pays and is refunded while the search goes on.
    t.pay(8, { payer: OTHER });
    const first = await t.ledger();
    expect(first.error).toBeUndefined();
    expect(first).toMatchObject({ recorded: 1, paid: 1, searching: 1 });
    expect(Number(first.requests)).toBeLessThan(SOLANA_REQUESTS_PER_RUN);
    expect(t.deposit(1)).toMatchObject({ state: "open" });
    expect(t.searches()).toMatchObject([{ deposit_id: 1, done_at: null }]);
    expect(t.searches()[0].before_tx).not.toBeNull();
    // Whatever names the address after the record was seen gone is passed
    // over without being read.
    t.chain.junk(made.account, 1500, true);
    t.decide(8, "refund_due");
    const second = await t.ledger();
    expect(second.error).toBeUndefined();
    expect(second).toMatchObject({ send: "sent" });
    t.chain.land(t.sends()[0].tx_id as string);
    // The search continues where it stopped, a bounded number of reads a run.
    let runs = 2;
    while (t.deposit(1)?.state === "open") {
      const result = await t.ledger();
      expect(result.error).toBeUndefined();
      expect(Number(result.requests)).toBeLessThan(SOLANA_REQUESTS_PER_RUN);
      runs += 1;
      if (runs > 10) throw new Error("the search does not end");
    }
    expect(runs).toBeGreaterThan(2);
    expect(t.deposit(1)).toMatchObject({
      state: "reclaimed",
      resolve_tx: reclaimed,
    });
    expect(t.item(7).outcome).toBe("refunded");
    expect(t.deposit(2)).toMatchObject({ state: "refunded" });
    expect(t.searches()[0].done_at).not.toBeNull();
    // 71 transactions lie between the two slots; none of the 1,500 was read.
    expect(
      t.chain.calls.filter((call) => call === "getTransaction").length,
    ).toBeLessThan(90);
  });

  test("a deposit reclaimed before it was ever judged is still followed to its outcome", async () => {
    const t = setup();
    // Nobody asked a fee for pull request 7 yet: the deposit waits unjudged.
    const made = t.pay(7);
    expect(await t.ledger()).toMatchObject({ recorded: 1, judged: 0 });
    expect(t.deposit(1)).toMatchObject({ accepted: null, state: "open" });
    const reclaimed = t.chain.reclaim(made.account);
    expect(await t.ledger()).toMatchObject({ resolved: 1 });
    expect(t.deposit(1)).toMatchObject({
      state: "reclaimed",
      resolve_tx: reclaimed,
    });
  });

  test("a settlement is never taken from before the slot the record was last seen open at", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    // The same payer and nonce twice: the first deposit is reclaimed before
    // the Worker ever sees the address.
    const first = t.pay(7, { nonce: 9n });
    t.chain.reclaim(first.account);
    const second = t.pay(8, { nonce: 9n });
    expect(second.account).toBe(first.account);
    await t.ledger();
    expect(t.deposit(2)).toMatchObject({ accepted: 1, state: "open" });
    const reclaimed = t.chain.reclaim(second.account);
    await t.ledger();
    expect(t.deposit(2)).toMatchObject({
      state: "reclaimed",
      resolve_tx: reclaimed,
    });
  });
});

describe("deposits the Worker never resolves", () => {
  test("600 deposits of a worthless mint, then one honest deposit, which is refunded", async () => {
    const t = setup();
    const worthless = fakeAddress(99);
    for (let index = 0; index < 600; index += 1)
      t.pay(1000 + index, { payer: OTHER, mint: worthless });
    t.ask(7);
    t.pay(7);
    const first = await t.ledger();
    expect(first.error).toBeUndefined();
    expect(first).toMatchObject({ open: 1, recorded: 1, paid: 1 });
    expect(t.count()).toBe(1);
    t.decide(7, "refund_due");
    expect(await t.ledger()).toMatchObject({ send: "sent" });
    t.chain.land(t.sends()[0].tx_id as string);
    const last = await t.ledger();
    expect(last.error).toBeUndefined();
    expect(t.deposit(601)).toMatchObject({ state: "refunded" });
    expect(t.item(7).outcome).toBe("refunded");
  });

  test("600 dust deposits of the accepted mint, then one honest deposit, which is refunded", async () => {
    const t = setup("live", { perDay: "30000" });
    for (let index = 0; index < 600; index += 1)
      t.pay(1000 + index, { payer: OTHER, amount: 1n });
    t.ask(7);
    t.pay(7);
    // One read of records a run: the honest deposit is reached in seven.
    let runs = 0;
    while (t.deposit(601) === null) {
      const result = await t.ledger();
      expect(result.error).toBeUndefined();
      expect(Number(result.requests)).toBeLessThan(SOLANA_REQUESTS_PER_RUN);
      runs += 1;
      if (runs > 7) throw new Error("the honest deposit is never recorded");
    }
    expect(t.item(7)).toMatchObject({ paid_deposit_id: 601 });
    // The deposit that paid a pull request is sent for by itself, at once.
    t.decide(7, "refund_due");
    expect(await t.ledger()).toMatchObject({ send: "sent" });
    expect(t.sends()[0].deposits).toBe('[{"id":601,"refund":true}]');
    t.chain.land(t.sends()[0].tx_id as string);
    await t.ledger();
    expect(t.deposit(601)).toMatchObject({ state: "refunded" });
    // A day on, the deposits for nothing are refused. They are refunded as
    // a courtesy, five to a transaction, until half of the day's network
    // fees is spent; the rest of the day is kept for pull requests.
    t.later(48 * 3600_000);
    for (let run = 0; run < 8; run += 1) {
      const result = await t.ledger();
      expect(result.error).toBeUndefined();
      const last = t.sends().at(-1);
      if (last?.state === "submitted") t.chain.land(last.tx_id as string);
    }
    expect(t.count("accepted = 0 AND reject_reason = 'unknown_item'")).toBe(
      600,
    );
    expect(t.sends()).toHaveLength(4);
    expect(t.count("state = 'refunded'")).toBe(16);
    expect(t.logs).toContainEqual({
      event: "submission_fee_solana_courtesy_refunds_wait",
      network: NETWORK,
    });
    // A pull request's refund still goes out that day.
    t.ask(9);
    t.pay(9);
    await t.ledger();
    t.decide(9, "refund_due");
    expect(await t.ledger()).toMatchObject({ send: "sent" });
    expect(t.sends().at(-1)?.deposits).toBe('[{"id":602,"refund":true}]');
  });

  test("600 deposits below a known pull request's fee are final and never sent for", async () => {
    const t = setup();
    t.ask(5);
    for (let index = 0; index < 600; index += 1)
      t.pay(5, { payer: OTHER, amount: 1n });
    t.ask(7);
    t.pay(7);
    for (let runs = 0; t.deposit(601) === null; runs += 1) {
      if (runs > 7) throw new Error("the honest deposit is never recorded");
      expect((await t.ledger()).error).toBeUndefined();
    }
    expect(t.count("reject_reason = 'amount_below_due'")).toBe(600);
    t.decide(7, "refund_due");
    const result = await t.ledger();
    expect(result).toMatchObject({ send: "sent" });
    expect(t.sends()[0].deposits).toBe('[{"id":601,"refund":true}]');
    t.chain.land(t.sends()[0].tx_id as string);
    const after = await t.ledger();
    expect(after).toMatchObject({ send: "none", resolved: 1 });
    expect(t.deposit(601)).toMatchObject({ state: "refunded" });
    expect(t.sends()).toHaveLength(1);
  });

  test("a count of open records past the threshold is in the log and the result", async () => {
    const t = setup();
    for (let index = 0; index < SOLANA_OPEN_ALERT; index += 1)
      t.pay(1000 + index, { payer: OTHER, amount: 1n });
    const result = await t.ledger();
    expect(result).toMatchObject({ open: SOLANA_OPEN_ALERT, recorded: 100 });
    expect(t.logs).toContainEqual({
      event: "submission_fee_solana_open_high",
      network: NETWORK,
      open: SOLANA_OPEN_ALERT,
    });
  });
});

describe("limits of one run", () => {
  test("the request after the last is refused before it is sent, and the run reports it", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    const result = await t.ledger({ requests: 3 });
    expect(t.chain.calls).toHaveLength(3);
    expect(result).toMatchObject({
      requests: 3,
      error: "submission_fee_operation_failed",
      steps: { scan: "chain.records/SolanaFeeBudgetError" },
    });
    // Nothing was half recorded; the next run records it.
    expect(t.deposit(1)).toBeNull();
    expect(await t.ledger()).toMatchObject({ recorded: 1, paid: 1 });
  });

  test("the steps' own limits add up to less than the run's", () => {
    expect(SOLANA_STEP_REQUESTS).toBe(230);
    expect(SOLANA_STEP_REQUESTS).toBeLessThan(SOLANA_REQUESTS_PER_RUN);
  });
});

describe("a send that may or may not have landed", () => {
  test("a node behind the finalized chain cannot fail a send; it stays in flight", async () => {
    const t = setup();
    t.ask(7);
    t.pay(7);
    await t.ledger();
    t.decide(7, "refund_due");
    await t.ledger();
    const first = t.sends()[0];
    // The transaction lands, and the chain moves past its last valid height.
    t.chain.land(first.tx_id as string);
    t.chain.height = (first.last_valid_block_height as number) + 5;
    // The node that answers for signatures is behind: it does not know it.
    t.chain.statusSlot = t.chain.slot - 1;
    expect(await t.ledger()).toMatchObject({ send: "in_flight" });
    expect(t.sends()).toMatchObject([{ state: "submitted" }]);
    expect(t.chain.broadcasts).toHaveLength(1);
    // Once it has caught up, the send is finalized, not failed.
    t.chain.statusSlot = null;
    await t.ledger();
    expect(t.sends()).toMatchObject([{ state: "finalized" }]);
    expect(t.deposit(1)).toMatchObject({ state: "refunded" });
    expect(t.sends()).toHaveLength(1);
  });

  test("an expired send that never landed does not count against the day's lamports", async () => {
    const t = setup();
    for (const pull of [7, 8]) {
      t.ask(pull);
      t.pay(pull);
    }
    await t.ledger();
    t.decide(7, "refund_due");
    // Two sends of 5,000 lamports are inside 12,000; a third would not be.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await t.ledger()).toMatchObject({ send: "sent" });
      if (attempt === 2) break;
      t.chain.mempool.clear();
      t.chain.height =
        (t.sends().at(-1)?.last_valid_block_height as number) + 1;
    }
    expect(t.sends()).toMatchObject([
      { state: "failed" },
      { state: "failed" },
      { state: "submitted" },
    ]);
    t.chain.land(t.sends()[2].tx_id as string);
    await t.ledger();
    t.decide(8, "refund_due");
    expect(await t.ledger()).toMatchObject({ send: "sent" });
    t.chain.land(t.sends()[3].tx_id as string);
    await t.ledger();
    expect(t.sends()).toHaveLength(4);
  });
});

describe("what a resolve may be built for", () => {
  const client = (chain: FakeSolana) => {
    const network = parseSolanaConfig(
      {
        SUBMISSION_FEE_SOLANA_MODE: "live",
        SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_TX: "10000",
        SUBMISSION_FEE_SOLANA_MAX_LAMPORTS_PER_DAY: "12000",
        RPC_URL_SUBMISSION_FEE_SOLANA: "https://solana.invalid/key",
      },
      {
        network: NETWORK,
        programId: chain.programId,
        startSlot: 1000,
        mint: chain.mint,
        feeWallet: chain.feeWallet,
        genesisHash: chain.genesis,
      },
    ).ledger;
    if (!network) throw new Error("no ledger");
    return createSolanaFeeChain({ network, seed: SEED, fetch: chain.fetch });
  };

  test("a kept fee is built only to the fee wallet of the table", async () => {
    const chain = new FakeSolana();
    chain.resolver = RESOLVER;
    chain.tokenAccount(OTHER, chain.mint);
    const made = chain.pay({
      payer: PAYER,
      item: submissionFeeItem(REPOSITORY, 7),
      keptTo: OTHER,
    });
    const solana = client(chain);
    solana.track(1, made.account);
    const failure = await solana
      .prepare([{ id: 1, refund: false }], async () => {})
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PayoutFailedError);
    expect((failure as PayoutFailedError).depositId).toBe(1);
    expect(chain.calls).not.toContain("simulateTransaction");
    // Its refund to the payer is still allowed.
    await solana.prepare([{ id: 1, refund: true }], async () => {});
  });

  test("a deposit of another mint is never built for", async () => {
    const chain = new FakeSolana();
    chain.resolver = RESOLVER;
    const made = chain.pay({
      payer: PAYER,
      item: submissionFeeItem(REPOSITORY, 7),
      mint: fakeAddress(99),
    });
    const solana = client(chain);
    solana.track(1, made.account);
    expect(
      await solana
        .prepare([{ id: 1, refund: true }], async () => {})
        .catch((error: unknown) => error),
    ).toBeInstanceOf(PayoutFailedError);
    expect(chain.calls).not.toContain("simulateTransaction");
  });

  test("an id nobody tracked is looked up, and an unknown one is refused", async () => {
    const chain = new FakeSolana();
    chain.resolver = RESOLVER;
    const made = chain.pay({
      payer: PAYER,
      item: submissionFeeItem(REPOSITORY, 7),
    });
    const solana = client(chain);
    solana.locate(async (id) => (id === 1 ? made.account : null));
    expect(await solana.deposit(1)).toMatchObject({ state: 1, payer: PAYER });
    await expect(solana.deposit(2)).rejects.toThrow(
      "A Solana deposit's record is not known",
    );
  });
});
