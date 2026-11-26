// The submission-fee Worker against the real migrations and a small chain
// that behaves like the SubmissionDeposits contract: deposits are read,
// judged and marked paid; what Slopbot's row says is due is sent once.
import { describe, expect, test } from "bun:test";
import { reportDepositItem } from "../../src/lib/security-report-deposit.mjs";
import {
  STANDING_DEPOSIT_LEDGER,
  standingDepositItem,
} from "../../src/lib/standing-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
  submissionFeeItem,
} from "../../src/lib/submission-fee.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { D1BuybackStore } from "../fee-converter/buyback-store";
import {
  type NetworkConfig,
  parseConfig,
  parseSolanaConfig,
  type SubmissionFeeConfig,
} from "./config";
import {
  type ChainDeposit,
  type ChainEvent,
  type FeeChain,
  failureReason,
  GasBudgetError,
  labelled,
  MAX_BATCH,
  type NetworkDependencies,
  PARKED_RECHECK_MS,
  PayoutFailedError,
  type ProbeResult,
  runNetwork,
  SendConflictError,
  type SendEntry,
  SendRevertedError,
  type SendRow,
  type SendStatus,
} from "./core";
import { type Env, runDeposits, runRates } from "./index";
import { D1FeeStore, type SubmissionFeeD1Database } from "./store";

// Slopbot's table (migration 0141), from the shared interface. `IF NOT
// EXISTS` keeps these tests valid once that migration is in the repository.
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

const NETWORK = "base-mainnet";
const USDC = (SUBMISSION_FEE_TOKENS[NETWORK].usdc as string).toLowerCase();
const FEE_WALLET = SUBMISSION_FEE_KEPT_TO[NETWORK].toLowerCase();
const CONTRACT = `0x${"c".repeat(40)}`;
const RESOLVER = `0x${"5".repeat(40)}`;
const PAYER = `0x${"a".repeat(40)}`;
const REPOSITORY = 4242;
const START = "2026-12-01T00:00:00.000Z";

const network: NetworkConfig = {
  network: NETWORK,
  chainId: 8453,
  contract: CONTRACT,
  startBlock: 100,
  rpcUrl: "http://localhost.invalid",
  confirmations: 3,
  scanPageBlocks: 50,
  gas: { perTransactionWei: "1000", perDayWei: "2500" },
};

/** The contract and its chain, as far as the Worker can observe them. */
class Chain implements FeeChain {
  id = 8453;
  latest = 100;
  finalized = 100;
  events_: ChainEvent[] = [];
  records = new Map<number, ChainDeposit>();
  receipts = new Map<string, { block: number; ok: boolean }>();
  mempool = new Set<string>();
  signed: { txId: string; rawTx: string; entries: SendEntry[] }[] = [];
  broadcasts: string[] = [];
  key: string | null = RESOLVER;
  finalizedNonce = 0;
  nonce = 0;
  failBroadcast = false;
  gasCost = "400";
  transfersProven = true;
  eventReads: [number, number][] = [];
  /** Deposits whose payout the token refuses (a blacklisted payer, say). */
  unpayable = new Set<number>();
  /** False for an endpoint that returns a revert without its data. */
  namesFailure = true;
  /** The loaded key is not the contract's resolver. */
  notResolver = false;
  simulations = 0;

  private push(event: Record<string, unknown>, block: number) {
    this.events_.push({
      txHash: `0x${(this.events_.length + 1).toString(16).padStart(64, "0")}`,
      blockNumber: block,
      blockHash: `0x${block.toString(16).padStart(64, "0")}`,
      logIndex: this.events_.length,
      ...event,
    } as ChainEvent);
  }
  /** A deposit included at `block`; the head moves to at least that block. */
  pay(
    id: number,
    pull: number,
    block: number,
    overrides: Partial<ChainDeposit> = {},
  ) {
    const record: ChainDeposit = {
      payer: PAYER,
      token: USDC,
      amount: "2000000",
      keptTo: FEE_WALLET,
      item: submissionFeeItem(REPOSITORY, pull),
      state: 1,
      ...overrides,
    };
    this.records.set(id, record);
    this.push({ kind: "deposited", depositId: id, ...record }, block);
    this.latest = Math.max(this.latest, block);
  }
  /** Includes a broadcast transaction at `block`, as the contract would. */
  mine(rawTx: string, block: number, ok = true) {
    const tx = this.signed.find((entry) => entry.rawTx === rawTx);
    if (!tx || !this.mempool.delete(rawTx)) throw new Error("not in mempool");
    const allOpen = tx.entries.every(
      (entry) => this.records.get(entry.id)?.state === 1,
    );
    const success = ok && allOpen;
    this.receipts.set(tx.txId, { block, ok: success });
    this.nonce += 1;
    if (success)
      for (const entry of tx.entries) {
        const record = this.records.get(entry.id) as ChainDeposit;
        record.state = entry.refund ? 2 : 3;
        this.events_.push({
          kind: "resolved",
          depositId: entry.id,
          refunded: entry.refund,
          txHash: tx.txId,
          blockNumber: block,
          blockHash: `0x${block.toString(16).padStart(64, "0")}`,
          logIndex: this.events_.length,
        });
      }
    this.latest = Math.max(this.latest, block);
  }
  /** A resolution the Worker did not send (the resolver role used by hand). */
  resolveByHand(id: number, refunded: boolean, block: number) {
    (this.records.get(id) as ChainDeposit).state = refunded ? 2 : 3;
    this.push({ kind: "resolved", depositId: id, refunded }, block);
    this.latest = Math.max(this.latest, block);
  }
  reclaim(id: number, block: number) {
    (this.records.get(id) as ChainDeposit).state = 4;
    this.push({ kind: "reclaimed", depositId: id }, block);
    this.latest = Math.max(this.latest, block);
  }
  /** Removes a deposit's unfinalized event, as a reorganisation would. */
  reorgOut(id: number) {
    this.events_ = this.events_.filter(
      (event) => !(event.kind === "deposited" && event.depositId === id),
    );
    this.records.delete(id);
  }

  chainId = async () => this.id;
  heads = async () => ({ latest: this.latest, finalized: this.finalized });
  async events(from: number, to: number) {
    this.eventReads.push([from, to]);
    return this.events_
      .filter((event) => event.blockNumber >= from && event.blockNumber <= to)
      .sort(
        (left, right) =>
          left.blockNumber - right.blockNumber ||
          left.logIndex - right.logIndex,
      );
  }
  async blockTime(block: number, hash: string) {
    if (hash !== `0x${block.toString(16).padStart(64, "0")}`)
      throw new Error("block unavailable");
    return new Date(Date.parse(START) + block * 2000).toISOString();
  }
  async assertResolvedTransfer(
    event: Extract<ChainEvent, { kind: "resolved" }>,
    transfer: { token: string; recipient: string; amount: string },
  ) {
    const record = this.records.get(event.depositId) as ChainDeposit;
    if (
      !this.transfersProven ||
      transfer.token !== record.token ||
      transfer.amount !== record.amount ||
      transfer.recipient !== (event.refunded ? record.payer : record.keptTo)
    )
      throw new Error("transfer not proven");
  }
  async deposit(id: number) {
    return (
      this.records.get(id) ?? {
        payer: `0x${"0".repeat(40)}`,
        token: `0x${"0".repeat(40)}`,
        amount: "0",
        keptTo: `0x${"0".repeat(40)}`,
        item: `0x${"0".repeat(64)}`,
        state: 0,
      }
    );
  }
  address = () => this.key;
  /** The contract's own simulation: the first deposit it cannot settle. */
  private simulate(entries: readonly SendEntry[]) {
    this.simulations += 1;
    if (this.notResolver) throw new SendRevertedError("NotResolver");
    for (const entry of entries) {
      if (this.records.get(entry.id)?.state !== 1)
        throw new SendRevertedError("NotOpen");
      if (this.unpayable.has(entry.id)) {
        if (this.namesFailure) throw new PayoutFailedError(entry.id);
        throw new SendRevertedError("execution reverted");
      }
    }
  }
  async probe(entry: SendEntry): Promise<ProbeResult> {
    try {
      this.simulate([entry]);
      return "ok";
    } catch (error) {
      if (error instanceof PayoutFailedError) return "payout_failed";
      if (error instanceof SendRevertedError) return "reverted";
      throw error;
    }
  }
  async prepare(
    entries: readonly SendEntry[],
    authorize: (wei: string) => Promise<void>,
  ) {
    if (!this.key) throw new Error("no key");
    this.simulate(entries);
    if (BigInt(this.gasCost) > BigInt(network.gas.perTransactionWei))
      throw new GasBudgetError("over the transaction limit");
    await authorize(this.gasCost);
    const txId = `0x${(0xf000 + this.signed.length).toString(16).padStart(64, "0")}`;
    const rawTx = `0x02${(this.signed.length + 1).toString(16).padStart(8, "0")}`;
    this.signed.push({ txId, rawTx, entries: [...entries] });
    return {
      txId,
      rawTx,
      evmNonce: this.nonce,
      maximumNativeWei: this.gasCost,
    };
  }
  async broadcast(rawTx: string) {
    this.broadcasts.push(rawTx);
    if (this.failBroadcast) throw new Error("provider said no");
    this.mempool.add(rawTx);
  }
  async status(send: SendRow): Promise<SendStatus> {
    const receipt = this.receipts.get(send.txId as string);
    if (receipt) {
      if (receipt.block > this.finalized) return { kind: "pending" };
      return receipt.ok
        ? { kind: "finalized", blockNumber: receipt.block }
        : { kind: "failed", reason: "resolve transaction reverted" };
    }
    if (this.mempool.has(send.rawTx as string)) return { kind: "pending" };
    if (this.finalizedNonce > (send.evmNonce as number))
      return {
        kind: "failed",
        reason: "nonce used by another finalized transaction",
      };
    return { kind: "rebroadcast" };
  }
}

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(ITEMS);
  const chain = new Chain();
  const clock = { at: Date.parse("2026-12-01T12:00:00.000Z") };
  const logs: Record<string, unknown>[] = [];
  let ids = 0;
  const store = new D1FeeStore(db as unknown as SubmissionFeeD1Database);
  const deps = (mode: "dry_run" | "live" = "live"): NetworkDependencies => ({
    mode,
    network,
    terms: {},
    store,
    chain,
    now: () => new Date(clock.at),
    randomId: () => {
      ids += 1;
      return `test${String(ids).padStart(8, "0")}`;
    },
    log: (event) => logs.push(event),
  });
  const ask = (pull: number, stableMinor = "2000000") =>
    sqlite
      .query(
        "INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at) VALUES (?, ?, 'acme', ?, ?, ?)",
      )
      .run(
        REPOSITORY,
        pull,
        submissionFeeItem(REPOSITORY, pull),
        stableMinor,
        START,
      );
  const decide = (pull: number, outcome: string | null) =>
    sqlite
      .query(
        "UPDATE submission_fee_items SET outcome = ? WHERE repository_id = ? AND pull_number = ?",
      )
      .run(outcome, REPOSITORY, pull);
  const item = (pull: number) =>
    sqlite
      .query(
        "SELECT paid_at, paid_network, paid_deposit_id, outcome, outcome_at FROM submission_fee_items WHERE repository_id = ? AND pull_number = ?",
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
      .query("SELECT * FROM submission_fee_sends ORDER BY rowid")
      .all() as Record<string, unknown>[];
  const parked = () =>
    sqlite
      .query(
        "SELECT deposit_id, refund, reason, checks, released_at FROM submission_fee_parked ORDER BY deposit_id",
      )
      .all() as Record<string, unknown>[];
  const cursor = () =>
    (
      sqlite
        .query(
          "SELECT next_block FROM submission_fee_cursors WHERE network = ?",
        )
        .get(NETWORK) as { next_block: number } | null
    )?.next_block ?? null;
  return {
    db,
    sqlite,
    chain,
    clock,
    logs,
    store,
    deps,
    ask,
    decide,
    item,
    deposit,
    sends,
    parked,
    cursor,
    run: (mode: "dry_run" | "live" = "live") => runNetwork(deps(mode)),
  };
}

/** A deposit for `pull`, read, accepted and finalized. */
async function paidAndFinal(
  t: ReturnType<typeof setup>,
  id: number,
  pull: number,
) {
  t.ask(pull);
  const block = t.chain.latest + 1;
  t.chain.pay(id, pull, block);
  t.chain.latest = block + 10;
  t.chain.finalized = block + 10;
  await t.run();
  expect(t.deposit(id)).toMatchObject({ accepted: 1, state: "open" });
}

describe("reading deposits", () => {
  test("a confirmed deposit marks its pull request paid before it is finalized", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110);
    // Two blocks on top: one short of the confirmation count.
    t.chain.latest = 112;
    expect(await t.run()).toMatchObject({ recorded: 0, paid: 0 });
    expect(t.deposit(1)).toBe(null);
    t.chain.latest = 113;
    expect(await t.run()).toMatchObject({ recorded: 1, judged: 1, paid: 1 });
    expect(t.deposit(1)).toMatchObject({
      item: submissionFeeItem(REPOSITORY, 7),
      repository_id: REPOSITORY,
      pull_number: 7,
      payer: PAYER,
      token: USDC,
      amount: "2000000",
      kept_to: FEE_WALLET,
      block_number: 110,
      finalized_at: null,
      accepted: 1,
      state: "open",
    });
    expect(t.item(7)).toMatchObject({
      paid_at: "2026-12-01T12:00:00.000Z",
      paid_network: NETWORK,
      paid_deposit_id: 1,
      outcome: null,
    });
  });

  test("finalization keeps the judgement and moves the cursor past the block", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110);
    t.chain.latest = 113;
    await t.run();
    expect(t.cursor()).toBe(101);
    t.clock.at += 60_000;
    t.chain.finalized = 113;
    await t.run();
    expect(t.cursor()).toBe(114);
    expect(t.deposit(1)).toMatchObject({
      accepted: 1,
      finalized_at: "2026-12-01T12:01:00.000Z",
    });
    // The time it was first seen paid does not move.
    expect(t.item(7).paid_at).toBe("2026-12-01T12:00:00.000Z");
  });

  test("a deposit reorganised away stops paying its pull request", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110);
    t.chain.latest = 113;
    await t.run();
    expect(t.item(7).paid_deposit_id).toBe(1);
    t.chain.reorgOut(1);
    await t.run();
    expect(t.deposit(1)).toBe(null);
    expect(t.item(7)).toMatchObject({
      paid_at: null,
      paid_network: null,
      paid_deposit_id: null,
    });
  });

  test("a deposit id that returns with other contents is judged again", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    t.chain.pay(1, 7, 110);
    t.chain.latest = 113;
    await t.run();
    // After a reorganisation deposit 1 is another payer's, short, for #8.
    t.chain.reorgOut(1);
    t.chain.pay(1, 8, 111, { amount: "1999999" });
    t.chain.latest = 120;
    t.chain.finalized = 120;
    await t.run();
    expect(t.item(7).paid_deposit_id).toBe(null);
    expect(t.item(8).paid_deposit_id).toBe(null);
    expect(t.deposit(1)).toMatchObject({
      pull_number: 8,
      amount: "1999999",
      accepted: 0,
      reject_reason: "amount_below_due",
    });
  });

  test("pages are read oldest first, bounded, and the cursor never moves back", async () => {
    const t = setup();
    t.chain.latest = 1000;
    t.chain.finalized = 1000;
    await t.run();
    // Ten pages of fifty blocks from the start block.
    expect(t.chain.eventReads).toHaveLength(10);
    expect(t.chain.eventReads[0]).toEqual([100, 149]);
    expect(t.chain.eventReads[9]).toEqual([550, 599]);
    expect(t.cursor()).toBe(600);
    // An older overlapping run writes its page late.
    await t.store.writeFinalizedPage({
      network: NETWORK,
      from: 100,
      to: 149,
      deposits: [],
      resolutions: [],
      finalizedAt: START,
    });
    expect(t.cursor()).toBe(600);
    await t.run();
    expect(t.cursor()).toBe(1001);
  });

  test("another chain behind the endpoint reads nothing", async () => {
    const t = setup();
    t.chain.id = 1;
    t.chain.pay(1, 7, 110);
    t.chain.latest = 200;
    t.chain.finalized = 200;
    expect(await t.run()).toMatchObject({ status: "chain_mismatch" });
    expect(t.cursor()).toBe(null);
    expect(t.deposit(1)).toBe(null);
  });
});

describe("judging deposits", () => {
  test("a short deposit is refused, never marks paid, and is refunded once final", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110, { amount: "1999999" });
    t.chain.latest = 113;
    expect(await t.run()).toMatchObject({ judged: 1, paid: 0, send: "none" });
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "amount_below_due",
      state: "open",
    });
    expect(t.item(7).paid_deposit_id).toBe(null);
    expect(t.chain.signed).toHaveLength(0);
    t.chain.finalized = 113;
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.deposit(1)?.state).toBe("refund_due");
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
  });

  test("wrong terms are refused even when Slopbot's row says to keep", async () => {
    const t = setup();
    t.ask(7);
    // The right amount, but a kept fee would go to the payer's own address.
    t.chain.pay(1, 7, 110, { keptTo: PAYER });
    t.chain.latest = 120;
    t.chain.finalized = 120;
    await t.run();
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "wrong_kept_to",
    });
    t.sqlite.exec(
      `UPDATE submission_fee_items SET paid_network = '${NETWORK}', paid_deposit_id = 1, outcome = 'kept_due'`,
    );
    t.clock.at += 300_000;
    await t.run();
    // Every signed entry for a refused deposit is a refund.
    expect(t.chain.signed.map((tx) => tx.entries)).toEqual([
      [{ id: 1, refund: true }],
    ]);
  });

  test("a deposit for a pull request nobody asked a fee for waits a day, then is refunded", async () => {
    const t = setup();
    t.chain.pay(1, 99, 110);
    t.chain.latest = 120;
    t.chain.finalized = 120;
    expect(await t.run()).toMatchObject({ judged: 0, send: "none" });
    expect(t.deposit(1)).toMatchObject({ accepted: null, state: "open" });
    t.clock.at += 24 * 60 * 60 * 1000 - 1;
    expect(await t.run()).toMatchObject({ judged: 0, send: "none" });
    t.clock.at += 1;
    expect(await t.run()).toMatchObject({ judged: 1, send: "sent" });
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "unknown_item",
      repository_id: null,
    });
  });

  test("the request arriving inside that day makes the deposit count", async () => {
    const t = setup();
    t.chain.pay(1, 99, 110);
    t.chain.latest = 120;
    t.chain.finalized = 120;
    await t.run();
    t.ask(99);
    t.clock.at += 60 * 60 * 1000;
    expect(await t.run()).toMatchObject({ paid: 1 });
    expect(t.item(99).paid_deposit_id).toBe(1);
  });

  test("another token is refused at once, without waiting for a request", async () => {
    const t = setup();
    t.chain.pay(1, 99, 110, { token: `0x${"9".repeat(40)}` });
    t.chain.latest = 113;
    await t.run();
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "token_not_accepted",
    });
  });

  test("a deposit of another token is never resolved: no call, no gas, no batch", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110, { token: `0x${"9".repeat(40)}` });
    t.chain.pay(2, 99, 111, { token: `0x${"9".repeat(40)}` });
    t.chain.latest = 130;
    t.chain.finalized = 130;
    // Whatever the pull request's row says, and however long it waits.
    t.decide(7, "refund_due");
    for (let run = 0; run < 3; run += 1) {
      expect(await t.run()).toMatchObject({ send: "none", parked: 0 });
      t.clock.at += 40 * 24 * 60 * 60 * 1000;
    }
    expect(t.chain.simulations).toBe(0);
    expect(t.chain.signed).toEqual([]);
    expect(t.sends()).toEqual([]);
    expect(t.parked()).toEqual([]);
    for (const id of [1, 2])
      expect(t.deposit(id)).toMatchObject({
        accepted: 0,
        reject_reason: "token_not_accepted",
        state: "open",
      });
    expect(t.item(7).paid_at).toBe(null);
    // Its payer takes it back from the contract after 30 days.
    t.chain.reclaim(1, 140);
    t.chain.latest = 150;
    t.chain.finalized = 150;
    await t.run();
    expect(t.deposit(1)).toMatchObject({ state: "reclaimed", accepted: 0 });
  });

  test("a dry run does not list a deposit of another token", async () => {
    const t = setup();
    t.chain.pay(1, 99, 110, { token: `0x${"9".repeat(40)}` });
    t.chain.latest = 130;
    t.chain.finalized = 130;
    expect(await t.run("dry_run")).toMatchObject({ send: "none" });
    expect(t.sends()).toEqual([]);
  });

  test("only the first of two deposits pays a pull request; the second is refunded", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110);
    t.chain.pay(2, 7, 110, { payer: `0x${"b".repeat(40)}` });
    t.chain.latest = 120;
    t.chain.finalized = 120;
    await t.run();
    expect(t.item(7).paid_deposit_id).toBe(1);
    expect(t.deposit(1)?.accepted).toBe(1);
    // The second waits one run, then reads the row the first one paid.
    await t.run();
    expect(t.deposit(2)).toMatchObject({
      accepted: 0,
      reject_reason: "item_already_paid",
    });
    await t.run();
    expect(t.chain.signed.at(-1)?.entries).toEqual([{ id: 2, refund: true }]);
  });

  test("a run that died between marking paid and recording the judgement recovers", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110);
    t.chain.latest = 113;
    const real = t.store.setJudgement.bind(t.store);
    t.store.setJudgement = async () => {
      throw new Error("died");
    };
    await expect(t.run()).rejects.toThrow("died");
    expect(t.item(7).paid_deposit_id).toBe(1);
    expect(t.deposit(1)?.accepted).toBe(null);
    t.store.setJudgement = real;
    await t.run();
    expect(t.deposit(1)?.accepted).toBe(1);
    expect(t.item(7).paid_at).toBe("2026-12-01T12:00:00.000Z");
  });
});

describe("sending what is due", () => {
  test("nothing is sent while the pull request is undecided", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.sends()).toHaveLength(0);
    expect(t.chain.signed).toHaveLength(0);
  });

  test("a merge's refund is recorded before it is broadcast, then confirmed from the chain", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.deposit(1)?.state).toBe("refund_due");
    const [row] = t.sends();
    expect(row).toMatchObject({
      network: NETWORK,
      mode: "live",
      contract: CONTRACT,
      deposits: '[{"id":1,"refund":true}]',
      resolver: RESOLVER,
      tx_id: t.chain.signed[0].txId,
      raw_tx: t.chain.signed[0].rawTx,
      state: "submitted",
      maximum_native_wei: "400",
    });
    // Still in flight: the next run signs nothing.
    expect(await t.run()).toMatchObject({ send: "in_flight" });
    expect(t.chain.signed).toHaveLength(1);
    t.chain.mine(t.chain.signed[0].rawTx, 140);
    t.chain.latest = 145;
    expect(await t.run()).toMatchObject({ send: "in_flight" });
    t.chain.finalized = 145;
    t.clock.at += 600_000;
    expect(await t.run()).toMatchObject({ resolved: 1, send: "none" });
    expect(t.sends()[0]).toMatchObject({
      state: "finalized",
      block_number: 140,
    });
    expect(t.deposit(1)).toMatchObject({
      state: "refunded",
      resolve_tx: t.chain.signed[0].txId,
    });
    expect(t.item(7)).toMatchObject({ outcome: "refunded" });
    expect(t.item(7).outcome_at).toBe(t.deposit(1)?.resolved_at);
    // Settled: later runs send nothing more.
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.chain.signed).toHaveLength(1);
  });

  test("a fee is kept only when the row that this deposit paid says kept_due", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "kept_due");
    await t.run();
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: false }]);
    t.chain.mine(t.chain.signed[0].rawTx, 140);
    t.chain.latest = 150;
    t.chain.finalized = 150;
    await t.run();
    expect(t.deposit(1)?.state).toBe("kept");
    expect(t.item(7).outcome).toBe("kept");
  });

  test("an unfinalized deposit is never sent for, whatever is due", async () => {
    const t = setup();
    t.ask(7);
    t.chain.pay(1, 7, 110);
    t.chain.latest = 113;
    await t.run();
    t.decide(7, "refund_due");
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.deposit(1)).toMatchObject({ state: "open", finalized_at: null });
    expect(t.chain.signed).toHaveLength(0);
  });

  test("a run that dies after recording resends the same bytes and never signs again", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    t.chain.failBroadcast = true;
    expect(await t.run()).toMatchObject({ send: "in_flight" });
    expect(t.sends()[0]).toMatchObject({
      state: "unknown",
      reason: "submission_fee_operation_failed",
    });
    // The provider recovers; the stored bytes go out unchanged.
    t.chain.failBroadcast = false;
    expect(await t.run()).toMatchObject({ send: "in_flight" });
    expect(t.chain.signed).toHaveLength(1);
    expect(t.chain.broadcasts).toEqual([
      t.chain.signed[0].rawTx,
      t.chain.signed[0].rawTx,
    ]);
    expect(t.sends()).toHaveLength(1);
    expect(t.sends()[0].state).toBe("submitted");
  });

  test("a second signer loses to the row already recorded and broadcasts nothing", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    await paidAndFinal(t, 2, 8);
    t.decide(7, "refund_due");
    t.decide(8, "refund_due");
    // Two runs prepare at once; the first to record wins.
    const first = t.deps();
    const realInsert = t.store.insertSend.bind(t.store);
    let raced = false;
    t.store.insertSend = async (row, limits) => {
      if (!raced) {
        raced = true;
        await realInsert(
          { ...row, id: "sfs_other000001", txId: `0x${"e".repeat(64)}` },
          limits,
        );
      }
      return realInsert(row, limits);
    };
    expect(await runNetwork(first)).toMatchObject({ send: "in_flight" });
    expect(t.chain.broadcasts).toHaveLength(0);
    expect(t.sends()).toHaveLength(1);
    expect(t.sends()[0].id).toBe("sfs_other000001");
  });

  test("a reverted send is final, and the deposit is sent for again", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    await t.run();
    t.chain.mine(t.chain.signed[0].rawTx, 140, false);
    t.chain.latest = 150;
    t.chain.finalized = 150;
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.sends().map((row) => row.state)).toEqual(["failed", "submitted"]);
    expect(t.sends()[0].reason).toBe("resolve transaction reverted");
    expect(t.chain.signed).toHaveLength(2);
  });

  test("a send whose nonce another transaction used can never land and is closed", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    await t.run();
    t.chain.mempool.clear();
    t.chain.finalizedNonce = 1;
    t.chain.nonce = 1;
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.sends()[0]).toMatchObject({
      state: "failed",
      reason: "nonce used by another finalized transaction",
    });
    expect(t.sends()[1]).toMatchObject({ state: "submitted", evm_nonce: 1 });
  });

  test("a deposit already resolved on chain is left to the event scan", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    // The payer reclaimed it; the event is not finalized yet.
    t.chain.reclaim(1, 135);
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.chain.signed).toHaveLength(0);
    t.chain.finalized = 135;
    await t.run();
    expect(t.deposit(1)?.state).toBe("reclaimed");
    expect(t.item(7).outcome).toBe("refunded");
  });

  test("a stored deposit that differs from the contract's record stops the network", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "kept_due");
    (t.chain.records.get(1) as ChainDeposit).keptTo = PAYER;
    await expect(t.run()).rejects.toThrow("differs from the contract");
    expect(t.chain.signed).toHaveLength(0);
  });

  test("a Resolved event without its proven transfer is not recorded", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "kept_due");
    await t.run();
    t.chain.mine(t.chain.signed[0].rawTx, 140);
    t.chain.latest = 150;
    t.chain.finalized = 150;
    t.chain.transfersProven = false;
    const before = t.cursor();
    await expect(t.run()).rejects.toThrow("transfer not proven");
    expect(t.cursor()).toBe(before);
    expect(t.deposit(1)?.state).toBe("kept_due");
    expect(t.item(7).outcome).toBe("kept_due");
  });

  test("a Resolved event of another token is recorded without a transfer proof", async () => {
    const t = setup();
    t.chain.pay(1, 99, 110, { token: `0x${"9".repeat(40)}` });
    t.chain.latest = 120;
    t.chain.finalized = 120;
    await t.run();
    expect(t.chain.signed).toEqual([]);
    // The Worker never resolves it. If the resolver role is ever used by
    // hand to refund one, the event is recorded as it stands: that token may
    // emit no Transfer event, and the scan must not stop on it.
    t.chain.resolveByHand(1, true, 130);
    t.chain.latest = 140;
    t.chain.finalized = 140;
    t.chain.transfersProven = false;
    await t.run();
    expect(t.deposit(1)).toMatchObject({ state: "refunded", accepted: 0 });
  });

  test("a deposit that can never be paid out does not hold up the ones behind it", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    await paidAndFinal(t, 2, 8);
    await paidAndFinal(t, 3, 9);
    t.decide(7, "refund_due");
    t.decide(8, "refund_due");
    t.decide(9, "kept_due");
    // The token refuses the refund of deposit 1 (its payer is blacklisted).
    t.chain.unpayable.add(1);
    expect(await t.run()).toMatchObject({ send: "sent", parked: 1 });
    const rest = [
      { id: 2, refund: true },
      { id: 3, refund: false },
    ];
    expect(t.chain.signed.map((tx) => tx.entries)).toEqual([rest]);
    expect(JSON.parse(t.sends()[0].deposits as string)).toEqual(rest);
    expect(t.parked()).toEqual([
      {
        deposit_id: 1,
        refund: 1,
        reason: "payout_failed",
        checks: 1,
        released_at: null,
      },
    ]);
    expect(t.logs).toContainEqual({
      event: "submission_fee_parked",
      network: NETWORK,
      depositId: 1,
      refund: true,
      reason: "payout_failed",
    });
    // What is due stays on the row; the deposit is open on chain.
    expect(t.deposit(1)).toMatchObject({ state: "refund_due", accepted: 1 });
    t.chain.mine(t.chain.signed[0].rawTx, t.chain.latest + 1);
    t.chain.latest += 20;
    t.chain.finalized = t.chain.latest;
    const simulated = t.chain.simulations;
    for (let run = 0; run < 3; run += 1)
      expect(await t.run()).toMatchObject({ send: "none", parked: 0 });
    // Inside a day the parked deposit costs no further call.
    expect(t.chain.simulations).toBe(simulated);
    expect(t.chain.signed).toHaveLength(1);
    expect(t.deposit(2)).toMatchObject({ state: "refunded" });
    expect(t.deposit(3)).toMatchObject({ state: "kept" });
  });

  test("a failed batch that names no deposit is tried one deposit at a time", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    await paidAndFinal(t, 2, 8);
    await paidAndFinal(t, 3, 9);
    for (const pull of [7, 8, 9]) t.decide(pull, "refund_due");
    t.chain.unpayable.add(2);
    // An endpoint that returns the revert without the contract's error.
    t.chain.namesFailure = false;
    expect(await t.run()).toMatchObject({ send: "sent", parked: 1 });
    expect(t.chain.signed.map((tx) => tx.entries)).toEqual([
      [
        { id: 1, refund: true },
        { id: 3, refund: true },
      ],
    ]);
    expect(t.parked()).toMatchObject([
      { deposit_id: 2, reason: "reverted_alone", released_at: null },
    ]);
  });

  test("a revert that no single deposit explains parks nothing", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    await paidAndFinal(t, 2, 8);
    t.decide(7, "refund_due");
    t.decide(8, "refund_due");
    // The loaded key is not the contract's resolver: every call reverts.
    t.chain.notResolver = true;
    for (let run = 0; run < 2; run += 1)
      expect(await t.run()).toMatchObject({ send: "reverted", parked: 0 });
    expect(t.parked()).toEqual([]);
    expect(t.chain.signed).toEqual([]);
    expect(t.logs).toContainEqual({
      event: "submission_fee_send_reverted",
      network: NETWORK,
      deposits: [
        { id: 1, refund: true },
        { id: 2, refund: true },
      ],
    });
    // Once the key is the resolver, both are sent.
    t.chain.notResolver = false;
    expect(await t.run()).toMatchObject({ send: "sent", parked: 0 });
    expect(t.chain.signed[0].entries).toHaveLength(2);
  });

  test("unnamed failures alone are not parked until another deposit goes through", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    t.chain.unpayable.add(1);
    t.chain.namesFailure = false;
    expect(await t.run()).toMatchObject({ send: "reverted", parked: 0 });
    expect(t.parked()).toEqual([]);
    // A payable deposit joins the queue behind it and is not held up.
    await paidAndFinal(t, 2, 8);
    t.decide(8, "refund_due");
    expect(await t.run()).toMatchObject({ send: "sent", parked: 1 });
    expect(t.chain.signed.map((tx) => tx.entries)).toEqual([
      [{ id: 2, refund: true }],
    ]);
  });

  test("when every deposit of the batch is parked, nothing is signed", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    await paidAndFinal(t, 2, 8);
    t.decide(7, "refund_due");
    t.decide(8, "refund_due");
    t.chain.unpayable.add(1).add(2);
    expect(await t.run()).toMatchObject({ send: "parked", parked: 2 });
    expect(t.chain.signed).toEqual([]);
    expect(t.sends()).toEqual([]);
    expect(await t.run()).toMatchObject({ send: "none", parked: 0 });
  });

  test("a send that reverts on chain parks the deposit at the next run and sends the rest", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    await paidAndFinal(t, 2, 8);
    t.decide(7, "refund_due");
    t.decide(8, "refund_due");
    expect(await t.run()).toMatchObject({ send: "sent", parked: 0 });
    // The payer of deposit 1 is blacklisted after the simulation passed.
    t.chain.unpayable.add(1);
    t.chain.mine(t.chain.signed[0].rawTx, t.chain.latest + 1, false);
    t.chain.latest += 20;
    t.chain.finalized = t.chain.latest;
    expect(await t.run()).toMatchObject({ send: "sent", parked: 1 });
    expect(t.sends().map((row) => row.state)).toEqual(["failed", "submitted"]);
    expect(t.chain.signed[1].entries).toEqual([{ id: 2, refund: true }]);
  });

  test("a parked deposit is simulated again after a day and returns when it can be paid", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    t.chain.unpayable.add(1);
    expect(await t.run()).toMatchObject({ send: "parked", parked: 1 });
    t.clock.at += PARKED_RECHECK_MS;
    expect(await t.run()).toMatchObject({ send: "none", released: 0 });
    expect(t.parked()).toMatchObject([{ checks: 2, released_at: null }]);
    // The payer is taken off the blacklist.
    t.chain.unpayable.clear();
    expect(await t.run()).toMatchObject({ send: "none", released: 0 });
    t.clock.at += PARKED_RECHECK_MS;
    expect(await t.run()).toMatchObject({ send: "sent", released: 1 });
    expect(t.chain.signed.map((tx) => tx.entries)).toEqual([
      [{ id: 1, refund: true }],
    ]);
    expect(t.parked()).toMatchObject([{ checks: 3 }]);
    expect(t.parked()[0].released_at).not.toBe(null);
    expect(t.logs).toContainEqual({
      event: "submission_fee_unparked",
      network: NETWORK,
      depositId: 1,
      reason: "payout_would_succeed",
    });
  });

  test("a parked deposit its payer reclaims is recorded and leaves the parked list", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    t.chain.unpayable.add(1);
    await t.run();
    t.chain.reclaim(1, t.chain.latest + 1);
    t.chain.latest += 20;
    t.chain.finalized = t.chain.latest;
    await t.run();
    expect(t.deposit(1)).toMatchObject({ state: "reclaimed" });
    t.clock.at += PARKED_RECHECK_MS;
    const simulated = t.chain.simulations;
    expect(await t.run()).toMatchObject({ send: "none", released: 1 });
    // Its on-chain state was enough; nothing was simulated.
    expect(t.chain.simulations).toBe(simulated);
    expect(t.parked()[0].released_at).not.toBe(null);
  });

  test("a deposit parked again after its release keeps one row", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    t.chain.unpayable.add(1);
    await t.run();
    t.chain.unpayable.clear();
    t.clock.at += PARKED_RECHECK_MS;
    // Released, then refused again before the send is signed.
    t.chain.gasCost = "5000";
    expect(await t.run()).toMatchObject({ send: "gas_budget", released: 1 });
    t.chain.gasCost = "400";
    t.chain.unpayable.add(1);
    expect(await t.run()).toMatchObject({ send: "parked", parked: 1 });
    expect(t.parked()).toMatchObject([
      { deposit_id: 1, checks: 3, released_at: null },
    ]);
  });

  test("one transaction carries at most twenty deposits, oldest first", async () => {
    const t = setup();
    for (let id = 1; id <= MAX_BATCH + 3; id += 1) {
      t.ask(id);
      t.chain.pay(id, id, 110);
    }
    t.chain.latest = 120;
    t.chain.finalized = 120;
    await t.run();
    for (let id = 1; id <= MAX_BATCH + 3; id += 1) t.decide(id, "refund_due");
    await t.run();
    expect(t.chain.signed[0].entries.map((entry) => entry.id)).toEqual(
      Array.from({ length: MAX_BATCH }, (_, index) => index + 1),
    );
  });

  test("the native fee limits stop a send before it is signed", async () => {
    const t = setup();
    for (let id = 1; id <= 8; id += 1) await paidAndFinal(t, id, id);
    // Over the per-transaction limit: nothing is signed.
    t.decide(1, "refund_due");
    t.chain.gasCost = "1001";
    expect(await t.run()).toMatchObject({ send: "gas_budget" });
    expect(t.chain.signed).toHaveLength(0);
    expect(t.sends()).toHaveLength(0);
    // 1000 a send against 2500 a day: two go out, the third waits.
    t.chain.gasCost = "1000";
    const settle = () => {
      const block = t.chain.latest + 5;
      t.chain.mine(t.chain.signed.at(-1)?.rawTx as string, block);
      t.chain.finalized = block;
    };
    expect(await t.run()).toMatchObject({ send: "sent" });
    settle();
    t.decide(2, "refund_due");
    expect(await t.run()).toMatchObject({ send: "sent" });
    settle();
    t.decide(3, "refund_due");
    expect(await t.run()).toMatchObject({ send: "gas_budget" });
    expect(t.chain.signed).toHaveLength(2);
    // The next UTC day has its own limit.
    t.clock.at = Date.parse("2026-12-02T00:00:01.000Z");
    expect(await t.run()).toMatchObject({ send: "sent" });
  });

  test("without a key nothing is signed in live mode", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    t.chain.key = null;
    expect(await t.run()).toMatchObject({ send: "no_resolver_key" });
    expect(t.sends()).toHaveLength(0);
  });
});

describe("dry run", () => {
  test("reads, judges and records the list it would send, and signs nothing", async () => {
    const t = setup();
    t.ask(7);
    t.ask(8);
    t.chain.pay(1, 7, 110);
    t.chain.pay(2, 8, 110, { amount: "5" });
    t.chain.latest = 120;
    t.chain.finalized = 120;
    expect(await t.run("dry_run")).toMatchObject({ paid: 1, send: "recorded" });
    expect(t.item(7).paid_deposit_id).toBe(1);
    expect(t.sends()).toHaveLength(1);
    expect(t.sends()[0]).toMatchObject({
      mode: "dry_run",
      state: "recorded",
      deposits: '[{"id":2,"refund":true}]',
      resolver: null,
      tx_id: null,
      raw_tx: null,
    });
    // The same list is not recorded twice; a changed list is.
    expect(await t.run("dry_run")).toMatchObject({ send: "unchanged" });
    t.decide(7, "kept_due");
    expect(await t.run("dry_run")).toMatchObject({ send: "recorded" });
    expect(t.sends()[1].deposits).toBe(
      '[{"id":1,"refund":false},{"id":2,"refund":true}]',
    );
    expect(t.chain.signed).toHaveLength(0);
    expect(t.chain.broadcasts).toHaveLength(0);
    // The deposits are still open on the contract.
    expect(t.chain.records.get(2)?.state).toBe(1);
  });
});

describe("the journal's own rules", () => {
  test("a signed send keeps its bytes, and a settled one cannot change", async () => {
    const t = setup();
    await paidAndFinal(t, 1, 7);
    t.decide(7, "refund_due");
    await t.run();
    expect(() =>
      t.sqlite.exec("UPDATE submission_fee_sends SET raw_tx = '0x02ffffffff'"),
    ).toThrow("immutable");
    expect(() => t.sqlite.exec("DELETE FROM submission_fee_sends")).toThrow(
      "permanent",
    );
    t.chain.mine(t.chain.signed[0].rawTx, 140);
    t.chain.latest = 150;
    t.chain.finalized = 150;
    await t.run();
    expect(() =>
      t.sqlite.exec("UPDATE submission_fee_sends SET state = 'submitted'"),
    ).toThrow("final");
    // A live row cannot exist without its signed bytes.
    expect(() =>
      t.sqlite.exec(
        `INSERT INTO submission_fee_sends (id, network, mode, contract, deposits, state, created_at, updated_at)
         VALUES ('sfs_nobytes00001', 'x', 'live', '${CONTRACT}', '[{"id":1,"refund":true}]', 'submitted', 'a', 'a')`,
      ),
    ).toThrow();
  });
});

const env = (mode: string, db: unknown): Env => ({
  SUBMISSION_FEE_MODE: mode,
  SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI: "1000",
  SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI: "2500",
  SUBMISSION_FEE_DB: db as SubmissionFeeD1Database,
});
const local = (config: SubmissionFeeConfig): SubmissionFeeConfig => ({
  ...config,
  networks: [network],
  unset: [],
});

describe("a failed step is named without its message", () => {
  test("the reason carries the step and error classes, never text or a URL", async () => {
    class HttpRequestError extends Error {
      status = 429;
      url = "https://rpc.example/secret-key";
    }
    const cause = Object.assign(
      new Error("rate limited at https://rpc.example/secret-key"),
      {
        name: "RpcRequestError",
        code: -32011,
      },
    );
    const chain = labelled(
      {
        async events() {
          throw new HttpRequestError(
            "POST https://rpc.example/secret-key failed",
            {
              cause,
            },
          );
        },
        heads() {
          return 7;
        },
      },
      "chain",
    );
    expect(chain.heads()).toBe(7);
    let caught: unknown;
    try {
      await chain.events();
    } catch (error) {
      caught = error;
    }
    const reason = failureReason(caught);
    expect(reason).toBe(
      "chain.events/Error:status-429/RpcRequestError:code--32011",
    );
    expect(reason).not.toContain("secret");
    expect(reason).not.toContain("http");
    // An error from outside a labelled object still gets a bounded reason.
    expect(failureReason(new TypeError("x"))).toBe("unlabelled/TypeError");
    expect(failureReason("text")).toBe("unlabelled");
    expect(
      failureReason(
        Object.assign(new Error("m"), { name: "bad name <script>" }),
      ),
    ).toBe("unlabelled/Error");
  });
});

describe("the switch", () => {
  test("off does nothing, even with nothing else configured", async () => {
    const t = setup();
    t.chain.pay(1, 7, 110);
    t.chain.latest = 200;
    t.chain.finalized = 200;
    const off = { SUBMISSION_FEE_DB: t.db } as unknown as Env;
    expect(await runDeposits(off)).toEqual({ status: "off" });
    expect(await runRates(off)).toBe(null);
    expect(
      await runDeposits(env("off", t.db), undefined, {
        config: local,
        chain: () => t.chain,
        log: () => {},
      }),
    ).toEqual({ status: "off" });
    expect(t.chain.eventReads).toHaveLength(0);
    expect(t.cursor()).toBe(null);
  });

  test("with the contract addresses still unset it reads nothing and says so", async () => {
    const t = setup();
    let chains = 0;
    const unpublished = (config: SubmissionFeeConfig): SubmissionFeeConfig => ({
      ...config,
      networks: [],
      unset: ["base-mainnet", "robinhood-mainnet"],
    });
    const result = await runDeposits(env("dry_run", t.db), undefined, {
      config: unpublished,
      chain: () => {
        chains += 1;
        return t.chain;
      },
    });
    expect(result).toEqual({
      status: "ran",
      mode: "dry_run",
      unset: ["base-mainnet", "robinhood-mainnet"],
      networks: [],
    });
    expect(chains).toBe(0);
    // Live with no deployed contract needs no key and does nothing either.
    expect(
      await runDeposits(env("live", t.db), undefined, { config: unpublished }),
    ).toMatchObject({
      status: "ran",
      networks: [],
    });
  });

  test("without Slopbot's table nothing is read", async () => {
    const { db, sqlite } = sqliteD1();
    const hasItems = sqlite
      .query("SELECT 1 FROM sqlite_master WHERE name = 'submission_fee_items'")
      .get();
    // Once migration 0141 is in the repository this case no longer applies.
    if (hasItems) return;
    const chain = new Chain();
    expect(
      await runDeposits(env("dry_run", db), undefined, {
        config: local,
        chain: () => chain,
      }),
    ).toEqual({ status: "items_table_missing", unset: [] });
    expect(chain.eventReads).toHaveLength(0);
  });

  test("dry_run never asks for the key; live refuses to start without one", async () => {
    const t = setup();
    const keys: (string | undefined)[] = [];
    const chain = (_: NetworkConfig, key?: string) => {
      keys.push(key);
      return t.chain;
    };
    const withKey = {
      ...env("dry_run", t.db),
      SUBMISSION_FEE_RESOLVER_KEY: `0x${"1".repeat(64)}`,
    };
    await runDeposits(withKey, undefined, { config: local, chain });
    expect(keys).toEqual([undefined]);
    await expect(
      runDeposits(env("live", t.db), undefined, { config: local, chain }),
    ).rejects.toThrow("SUBMISSION_FEE_RESOLVER_KEY");
    await runDeposits({ ...withKey, SUBMISSION_FEE_MODE: "live" }, undefined, {
      config: local,
      chain,
    });
    expect(keys).toEqual([undefined, `0x${"1".repeat(64)}`]);
  });

  test("one network failing does not stop the other", async () => {
    const t = setup();
    const other = new Chain();
    other.id = 4663;
    other.heads = async () => {
      throw new Error("endpoint down");
    };
    const result = await runDeposits(env("dry_run", t.db), undefined, {
      config: (config) => ({
        ...config,
        unset: [],
        networks: [
          { ...network, network: "robinhood-mainnet", chainId: 4663 },
          network,
        ],
      }),
      chain: (config) => (config.chainId === 4663 ? other : t.chain),
    });
    expect(result).toMatchObject({
      status: "ran",
      networks: [
        {
          network: "robinhood-mainnet",
          error: "submission_fee_operation_failed",
        },
        { network: NETWORK, status: "ran" },
      ],
    });
  });

  test("a Solana configuration error fails the Solana ledger only", async () => {
    const t = setup();
    // The Solana ledger is switched on with no endpoint and no lamport
    // limits: its own configuration cannot be read.
    const result = await runDeposits(
      { ...env("dry_run", t.db), SUBMISSION_FEE_SOLANA_MODE: "live" },
      undefined,
      {
        config: local,
        chain: () => t.chain,
        solanaConfig: () =>
          parseSolanaConfig(
            { SUBMISSION_FEE_SOLANA_MODE: "live" },
            {
              network: "solana-mainnet",
              programId: "11111111111111111111111111111111",
              startSlot: 1,
            },
          ),
      },
    );
    expect(result).toMatchObject({
      status: "ran",
      mode: "dry_run",
      networks: [
        { network: NETWORK, status: "ran" },
        {
          network: "solana-mainnet",
          error: "submission_fee_invalid_input",
          reason: "config.solana/TypeError",
        },
      ],
    });
    // With the EVM ledgers off, the same error is still reported, not thrown.
    expect(
      await runDeposits(
        { ...env("off", t.db), SUBMISSION_FEE_SOLANA_MODE: "dry_run" },
        undefined,
        {
          solanaConfig: () => {
            throw new TypeError("lamports");
          },
        },
      ),
    ).toMatchObject({
      status: "ran",
      mode: "off",
      networks: [
        { network: "solana-mainnet", error: "submission_fee_invalid_input" },
      ],
    });
  });

  test("a mode outside the three is refused", async () => {
    const t = setup();
    await expect(runDeposits(env("on", t.db))).rejects.toThrow(
      "SUBMISSION_FEE_MODE",
    );
  });
});

describe("the SLOP rate job", () => {
  const SCALE = 10n ** 18n;
  function rates() {
    const t = setup();
    const price = { scaled: (75n * SCALE) as bigint | null, block: 1000 };
    const at = (iso: string) => {
      t.clock.at = Date.parse(iso);
    };
    const run = () =>
      runRates(env("dry_run", t.db), () => new Date(t.clock.at), {
        readPrice: async () => {
          if (price.scaled === null) throw new Error("pool unreadable");
          price.block += 1;
          return { scaled: price.scaled, blockNumber: price.block };
        },
        log: (event) => t.logs.push(event),
      });
    const hours = async (from: string, count: number) => {
      let last = null;
      for (let hour = 0; hour < count; hour += 1) {
        at(new Date(Date.parse(from) + hour * 3_600_000).toISOString());
        last = await run();
      }
      return last;
    };
    const stored = () =>
      t.sqlite
        .query(
          "SELECT effective_at, slop_per_usd, source FROM submission_fee_rates ORDER BY effective_at",
        )
        .all() as {
        effective_at: string;
        slop_per_usd: string;
        source: string;
      }[];
    const samples = () =>
      (
        t.sqlite
          .query("SELECT COUNT(*) AS n FROM submission_fee_price_samples")
          .get() as { n: number }
      ).n;
    return { t, price, at, run, hours, stored, samples };
  }

  test("the first rate is set after a full day of hourly readings, from the next hour", async () => {
    const r = rates();
    expect(await r.hours("2026-12-01T00:07:00.000Z", 23)).toMatchObject({
      sample: "stored",
      rate: null,
    });
    expect(r.stored()).toHaveLength(0);
    r.at("2026-12-01T23:07:00.000Z");
    expect(await r.run()).toMatchObject({
      rate: {
        slopPerUsd: "75",
        effectiveAt: "2026-12-02T00:00:00.000Z",
        reason: "first",
      },
    });
    expect(r.stored()).toEqual([
      {
        effective_at: "2026-12-02T00:00:00.000Z",
        slop_per_usd: "75",
        source: "uniswap-v4-stateview:robinhood-mainnet:slop-usdg:first",
      },
    ]);
  });

  test("one reading an hour: a second run in the hour stores and sets nothing", async () => {
    const r = rates();
    await r.hours("2026-12-01T00:07:00.000Z", 24);
    r.at("2026-12-01T23:40:00.000Z");
    expect(await r.run()).toMatchObject({ sample: "already_read", rate: null });
    expect(r.samples()).toBe(24);
    expect(r.stored()).toHaveLength(1);
  });

  test("the rate is reset after seven days from the seven-day average", async () => {
    const r = rates();
    await r.hours("2026-12-01T00:07:00.000Z", 24);
    // The price moves a little: inside the band, so nothing changes early.
    r.price.scaled = 80n * SCALE;
    await r.hours("2026-12-02T00:07:00.000Z", 7 * 24 - 1);
    expect(r.stored()).toHaveLength(1);
    r.at("2026-12-09T00:07:00.000Z");
    const result = await r.run();
    expect(result?.rate).toMatchObject({
      effectiveAt: "2026-12-09T01:00:00.000Z",
      reason: "weekly",
    });
    // Every reading of the last seven days was 80; the day at 75 is older.
    expect(result?.rate?.slopPerUsd).toBe("80");
    expect(r.stored()).toHaveLength(2);
  });

  test("a sharp move resets it early from the 24-hour average", async () => {
    const r = rates();
    await r.hours("2026-12-01T00:07:00.000Z", 24);
    // SLOP halves: 75 SLOP is now worth a quarter of the stablecoin fee.
    r.price.scaled = 150n * SCALE;
    const last = await r.hours("2026-12-02T00:07:00.000Z", 24);
    const [, second] = r.stored();
    expect(second.source).toEndWith(":drift");
    // It fires in the first hour whose 24-hour average leaves the band:
    // sixteen readings at the new price against nine at the old one.
    expect(second.effective_at).toBe("2026-12-02T16:00:00.000Z");
    expect(second.slop_per_usd).toBe("110.294118");
    expect(last?.sample).toBe("stored");
    // The new rate is inside the band again, so it is not replaced hourly.
    expect(r.stored()).toHaveLength(2);
  });

  test("an unreadable pool stores nothing and keeps the last rate", async () => {
    const r = rates();
    await r.hours("2026-12-01T00:07:00.000Z", 24);
    r.price.scaled = null;
    const result = await r.hours("2026-12-02T00:07:00.000Z", 24 * 9);
    expect(result).toEqual({
      sampled: false,
      sample: "source_unavailable",
      rate: null,
    });
    expect(r.samples()).toBe(24);
    expect(r.stored()).toHaveLength(1);
    expect(r.t.logs.at(-1)).toEqual({
      event: "submission_fee_price_unavailable",
    });
  });

  test("stored rates and readings cannot be rewritten", async () => {
    const r = rates();
    await r.hours("2026-12-01T00:07:00.000Z", 24);
    for (const table of [
      "submission_fee_rates",
      "submission_fee_price_samples",
    ]) {
      expect(() =>
        r.t.sqlite.exec(`UPDATE ${table} SET slop_per_usd = '1'`),
      ).toThrow("immutable");
      expect(() => r.t.sqlite.exec(`DELETE FROM ${table}`)).toThrow(
        "permanent",
      );
    }
  });
});

describe("SLOP deposits on Robinhood Chain", () => {
  test("count at the stored rate and are burned, not sent to the fee wallet, when kept", async () => {
    const t = setup();
    const rc: NetworkConfig = {
      ...network,
      network: "robinhood-mainnet",
      chainId: 4663,
    };
    const slop = (
      SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop as string
    ).toLowerCase();
    t.chain.id = 4663;
    t.sqlite.exec(
      "INSERT INTO submission_fee_rates VALUES ('2026-11-30T00:00:00.000Z', '75', 'test', 'x')",
    );
    t.ask(7);
    t.ask(8);
    const whole = (count: string) => `${count}${"0".repeat(18)}`;
    t.chain.pay(1, 7, 110, {
      token: slop,
      amount: whole("75"),
      keptTo: SUBMISSION_FEE_BURN.toLowerCase(),
    });
    // The right amount of SLOP, but a kept fee would reach the fee wallet.
    t.chain.pay(2, 8, 110, {
      token: slop,
      amount: whole("75"),
      keptTo: FEE_WALLET,
    });
    t.chain.latest = 120;
    const deps = { ...t.deps(), network: rc };
    await runNetwork(deps);
    const row = (id: number) =>
      t.sqlite
        .query(
          "SELECT accepted, reject_reason FROM submission_fee_deposits WHERE network = 'robinhood-mainnet' AND deposit_id = ?",
        )
        .get(id);
    expect(row(1)).toEqual({ accepted: 1, reject_reason: null });
    expect(row(2)).toEqual({ accepted: 0, reject_reason: "wrong_kept_to" });
    t.decide(7, "kept_due");
    t.chain.finalized = 120;
    await runNetwork(deps);
    expect(t.chain.signed[0].entries).toEqual([
      { id: 1, refund: false },
      { id: 2, refund: true },
    ]);
  });
});

// A private security report's deposit (operator decision, 21 November 2026):
// SLOP on Robinhood Chain, kept to the burn address, named by the report's
// row in `security_report_deposits`. The backend writes that row and what is
// due; the Worker marks it paid and sends what it says.
describe("report deposits", () => {
  const RC = "robinhood-mainnet";
  const rc: NetworkConfig = { ...network, network: RC, chainId: 4663 };
  const SLOP = (SUBMISSION_FEE_TOKENS[RC].slop as string).toLowerCase();
  const USDG = (SUBMISSION_FEE_TOKENS[RC].usdg as string).toLowerCase();
  const BURN = SUBMISSION_FEE_BURN.toLowerCase();
  const DUE = `395${"0".repeat(18)}`;
  const A = "sc_00000000000000000000000000000a01";
  const B = "sc_00000000000000000000000000000b02";

  function reports() {
    const t = setup();
    t.chain.id = 4663;
    const run = (mode: "dry_run" | "live" = "live") =>
      runNetwork({ ...t.deps(mode), network: rc });
    const askReport = (caseId: string, mode = "asked") =>
      t.sqlite
        .query(
          "INSERT INTO security_report_deposits (case_id, project_id, item, mode, slop_amount, slop_per_usd, asked_at) VALUES (?, 'acme', ?, ?, ?, '78.908929', ?)",
        )
        .run(caseId, reportDepositItem(caseId), mode, DUE, START);
    const decideReport = (caseId: string, outcome: string, reason: string) =>
      t.sqlite
        .query(
          "UPDATE security_report_deposits SET outcome = ?, outcome_reason = ?, outcome_at = ? WHERE case_id = ?",
        )
        .run(outcome, reason, START, caseId);
    const report = (caseId: string) =>
      t.sqlite
        .query(
          "SELECT mode, paid_at, paid_network, paid_deposit_id, outcome, outcome_reason, outcome_at FROM security_report_deposits WHERE case_id = ?",
        )
        .get(caseId) as Record<string, unknown>;
    const payReport = (
      id: number,
      caseId: string,
      block: number,
      overrides: Partial<ChainDeposit> = {},
    ) =>
      // The pull number is unused: the item is the report's.
      t.chain.pay(id, 1, block, {
        item: reportDepositItem(caseId),
        token: SLOP,
        amount: DUE,
        keptTo: BURN,
        ...overrides,
      });
    const deposit = (id: number) =>
      t.sqlite
        .query(
          "SELECT * FROM submission_fee_deposits WHERE network = ? AND deposit_id = ?",
        )
        .get(RC, id) as Record<string, unknown> | null;
    /** Moves the head and the finalized block past everything so far. */
    const finalize = () => {
      t.chain.latest += 20;
      t.chain.finalized = t.chain.latest;
    };
    /** Mines the newest signed send and finalizes it. */
    const settle = () => {
      t.chain.mine(t.chain.signed.at(-1)?.rawTx as string, t.chain.latest + 1);
      finalize();
    };
    return {
      ...t,
      run,
      askReport,
      decideReport,
      report,
      payReport,
      deposit,
      finalize,
      settle,
    };
  }
  /** Report `caseId` paid by deposit `id`, accepted and finalized. */
  async function paidReport(
    t: ReturnType<typeof reports>,
    id: number,
    caseId: string,
  ) {
    t.askReport(caseId);
    t.payReport(id, caseId, t.chain.latest + 1);
    t.finalize();
    await t.run();
    expect(t.deposit(id)).toMatchObject({ accepted: 1, state: "open" });
    expect(t.report(caseId).paid_deposit_id).toBe(id);
  }

  test("a confirmed deposit marks its report paid before it is finalized", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110);
    t.chain.latest = 112;
    expect(await t.run()).toMatchObject({ recorded: 0, paid: 0 });
    expect(t.report(A).paid_at).toBe(null);
    t.chain.latest = 113;
    expect(await t.run()).toMatchObject({ recorded: 1, judged: 1, paid: 1 });
    expect(t.deposit(1)).toMatchObject({
      item: reportDepositItem(A),
      // A report's deposit names no pull request.
      repository_id: null,
      pull_number: null,
      token: SLOP,
      amount: DUE,
      kept_to: BURN,
      finalized_at: null,
      accepted: 1,
      reject_reason: null,
      state: "open",
    });
    expect(t.report(A)).toMatchObject({
      paid_at: "2026-12-01T12:00:00.000Z",
      paid_network: RC,
      paid_deposit_id: 1,
      outcome: null,
    });
    expect(t.logs).toContainEqual({
      event: "submission_fee_report_paid",
      network: RC,
      depositId: 1,
    });
    // Finalization keeps the judgement and the time it was first seen paid.
    t.clock.at += 60_000;
    t.chain.finalized = 113;
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.deposit(1)).toMatchObject({
      accepted: 1,
      finalized_at: "2026-12-01T12:01:00.000Z",
    });
    expect(t.report(A).paid_at).toBe("2026-12-01T12:00:00.000Z");
  });

  test("a deposit reorganised away stops paying its report, which waits again", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110);
    t.chain.latest = 113;
    await t.run();
    expect(t.report(A).paid_deposit_id).toBe(1);
    t.chain.reorgOut(1);
    await t.run();
    expect(t.deposit(1)).toBe(null);
    expect(t.report(A)).toMatchObject({
      paid_at: null,
      paid_network: null,
      paid_deposit_id: null,
      outcome: null,
    });
    // A later deposit pays it.
    t.payReport(2, A, 115);
    t.chain.latest = 118;
    expect(await t.run()).toMatchObject({ paid: 1 });
    expect(t.report(A).paid_deposit_id).toBe(2);
  });

  test("a reorganised deposit found only at finalization also stops paying", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110);
    t.chain.latest = 113;
    await t.run();
    t.chain.reorgOut(1);
    // The next run already sees the block finalized, without the deposit.
    t.chain.latest = 130;
    t.chain.finalized = 130;
    await t.run();
    expect(t.deposit(1)).toBe(null);
    expect(t.report(A).paid_deposit_id).toBe(null);
  });

  test("a deposit id that returns with other contents is judged again", async () => {
    const t = reports();
    t.askReport(A);
    t.askReport(B);
    t.payReport(1, A, 110);
    t.chain.latest = 113;
    await t.run();
    // After a reorganisation deposit 1 is a short one for the other report.
    t.chain.reorgOut(1);
    t.payReport(1, B, 111, { amount: (BigInt(DUE) - 1n).toString() });
    t.finalize();
    await t.run();
    expect(t.report(A).paid_deposit_id).toBe(null);
    expect(t.report(B).paid_deposit_id).toBe(null);
    expect(t.deposit(1)).toMatchObject({
      item: reportDepositItem(B),
      accepted: 0,
      reject_reason: "amount_below_due",
    });
  });

  test("a decided report keeps its paid mark when its unfinalized deposit is reorganised away", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110);
    t.chain.latest = 113;
    await t.run();
    t.decideReport(A, "refund_due", "responded");
    t.chain.reorgOut(1);
    await t.run();
    // The same rule as a pull request's row: only an undecided row is cleared.
    expect(t.report(A)).toMatchObject({
      paid_deposit_id: 1,
      outcome: "refund_due",
    });
    expect(t.chain.signed).toEqual([]);
  });

  test("every deposit that does not meet the terms is refused and refunded, never kept", async () => {
    const t = reports();
    for (const caseId of [A, B]) t.askReport(caseId);
    const short = (BigInt(DUE) - 1n).toString();
    t.payReport(1, A, 110, { amount: short });
    t.payReport(2, A, 110, { keptTo: FEE_WALLET });
    t.payReport(3, A, 110, { token: USDG, amount: "5000000", keptTo: BURN });
    t.payReport(4, B, 110, {
      token: USDG,
      amount: "5000000",
      keptTo: FEE_WALLET,
    });
    t.finalize();
    expect(await t.run()).toMatchObject({ judged: 4, paid: 0, send: "sent" });
    expect(
      [1, 2, 3, 4].map((id) => [
        t.deposit(id)?.accepted,
        t.deposit(id)?.reject_reason,
      ]),
    ).toEqual([
      [0, "amount_below_due"],
      [0, "wrong_kept_to"],
      [0, "report_token_not_slop"],
      [0, "report_token_not_slop"],
    ]);
    for (const caseId of [A, B])
      expect(t.report(caseId)).toMatchObject({ paid_at: null, outcome: null });
    // A row edited to name a refused deposit and say kept changes nothing.
    t.sqlite.exec(
      `UPDATE security_report_deposits SET paid_network = '${RC}', paid_deposit_id = 2, outcome = 'kept_due' WHERE case_id = '${A}'`,
    );
    t.settle();
    await t.run();
    expect(t.chain.signed.flatMap((tx) => tx.entries)).toEqual(
      [1, 2, 3, 4].map((id) => ({ id, refund: true })),
    );
    for (const id of [1, 2, 3, 4])
      expect(t.deposit(id)?.state).toBe("refunded");
  });

  test("on Base a deposit naming a report is refused and refunded", async () => {
    const t = setup();
    t.sqlite
      .query(
        "INSERT INTO security_report_deposits (case_id, project_id, item, mode, slop_amount, slop_per_usd, asked_at) VALUES (?, 'acme', ?, 'asked', ?, '78.908929', ?)",
      )
      .run(A, reportDepositItem(A), DUE, START);
    t.chain.pay(1, 1, 110, { item: reportDepositItem(A), amount: "5000000" });
    t.chain.latest = 130;
    t.chain.finalized = 130;
    expect(await t.run()).toMatchObject({ judged: 1, paid: 0, send: "sent" });
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "report_wrong_network",
      repository_id: null,
    });
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
    expect(
      t.sqlite
        .query("SELECT paid_at FROM security_report_deposits WHERE case_id = ?")
        .get(A),
    ).toEqual({ paid_at: null });
  });

  test("a deposit naming a recorded row waits a day like any unknown item, then is refunded", async () => {
    const t = reports();
    // Record-only mode wrote the row: it asks for nothing.
    t.askReport(A, "recorded");
    t.payReport(1, A, 110);
    t.finalize();
    expect(await t.run()).toMatchObject({ judged: 0, paid: 0, send: "none" });
    expect(t.deposit(1)).toMatchObject({ accepted: null, state: "open" });
    // Even a recorded row edited to say kept is not a reason to keep.
    t.sqlite.exec(
      `UPDATE security_report_deposits SET paid_network = '${RC}', paid_deposit_id = 1, outcome = 'kept_due' WHERE case_id = '${A}'`,
    );
    t.clock.at += 24 * 60 * 60 * 1000;
    expect(await t.run()).toMatchObject({ judged: 1, paid: 0, send: "sent" });
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "unknown_item",
    });
    expect(t.chain.signed.map((tx) => tx.entries)).toEqual([
      [{ id: 1, refund: true }],
    ]);
    expect(t.report(A).mode).toBe("recorded");
  });

  test("a deposit for a report nobody asked a deposit for is refunded after the day", async () => {
    const t = reports();
    t.payReport(1, "sc_no_row_for_this_report", 110);
    t.finalize();
    expect(await t.run()).toMatchObject({ judged: 0, send: "none" });
    t.clock.at += 24 * 60 * 60 * 1000;
    expect(await t.run()).toMatchObject({ judged: 1, send: "sent" });
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
  });

  test("the row arriving inside that day makes the deposit count", async () => {
    const t = reports();
    t.payReport(1, A, 110);
    t.finalize();
    await t.run();
    t.askReport(A);
    t.clock.at += 60 * 60 * 1000;
    expect(await t.run()).toMatchObject({ paid: 1 });
    expect(t.report(A).paid_deposit_id).toBe(1);
  });

  test("a row turned back to recorded while its deposit is being judged is not marked paid", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110);
    t.finalize();
    // The backend withdraws the request between the Worker's read of the
    // row and its write.
    const real = t.store.reportByHash.bind(t.store);
    t.store.reportByHash = async (item) => {
      const row = await real(item);
      t.sqlite.exec(
        `UPDATE security_report_deposits SET mode = 'recorded' WHERE case_id = '${A}'`,
      );
      return row;
    };
    expect(await t.run()).toMatchObject({ judged: 0, paid: 0, send: "none" });
    t.store.reportByHash = real;
    expect(t.report(A)).toMatchObject({ mode: "recorded", paid_at: null });
    expect(t.deposit(1)?.accepted).toBe(null);
    // From then on it is an unknown item: sent back after the day.
    t.clock.at += 24 * 60 * 60 * 1000;
    expect(await t.run()).toMatchObject({ judged: 1, paid: 0, send: "sent" });
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
    expect(t.report(A).paid_at).toBe(null);
  });

  test("another token naming a report is refused at once and never resolved", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110, { token: `0x${"9".repeat(40)}` });
    t.finalize();
    t.decideReport(A, "refund_due", "responded");
    for (let run = 0; run < 3; run += 1) {
      expect(await t.run()).toMatchObject({ send: "none", parked: 0 });
      t.clock.at += 40 * 24 * 60 * 60 * 1000;
    }
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "token_not_accepted",
      state: "open",
    });
    expect(t.chain.simulations).toBe(0);
    expect(t.sends()).toEqual([]);
    expect(t.report(A).paid_at).toBe(null);
  });

  test("only the first of two deposits pays a report; the second is refunded even when the report is kept", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110);
    t.payReport(2, A, 110, { payer: `0x${"b".repeat(40)}` });
    t.finalize();
    await t.run();
    expect(t.report(A).paid_deposit_id).toBe(1);
    await t.run();
    expect(t.deposit(2)).toMatchObject({
      accepted: 0,
      reject_reason: "item_already_paid",
    });
    t.decideReport(A, "kept_due", "spam");
    await t.run();
    t.settle();
    await t.run();
    t.settle();
    await t.run();
    expect(t.chain.signed.flatMap((tx) => tx.entries)).toEqual([
      { id: 2, refund: true },
      { id: 1, refund: false },
    ]);
    expect(t.deposit(1)?.state).toBe("kept");
    expect(t.deposit(2)?.state).toBe("refunded");
  });

  test("a run that died between marking paid and recording the judgement recovers", async () => {
    const t = reports();
    t.askReport(A);
    t.payReport(1, A, 110);
    t.chain.latest = 113;
    const real = t.store.setJudgement.bind(t.store);
    t.store.setJudgement = async () => {
      throw new Error("died");
    };
    await expect(t.run()).rejects.toThrow("died");
    expect(t.report(A).paid_deposit_id).toBe(1);
    expect(t.deposit(1)?.accepted).toBe(null);
    t.store.setJudgement = real;
    t.clock.at += 300_000;
    await t.run();
    expect(t.deposit(1)?.accepted).toBe(1);
    expect(t.report(A).paid_at).toBe("2026-12-01T12:00:00.000Z");
  });

  test("nothing is sent while the report is undecided, or before its deposit is finalized", async () => {
    const t = reports();
    await paidReport(t, 1, A);
    for (let run = 0; run < 2; run += 1)
      expect(await t.run()).toMatchObject({ send: "none" });
    t.askReport(B);
    t.payReport(2, B, t.chain.latest + 1);
    t.chain.latest += 3;
    await t.run();
    expect(t.report(B).paid_deposit_id).toBe(2);
    t.decideReport(B, "kept_due", "spam");
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.deposit(2)).toMatchObject({ state: "open", finalized_at: null });
    expect(t.chain.signed).toEqual([]);
    expect(t.sends()).toEqual([]);
  });

  test("a response sends the deposit back, and the report row gets the final outcome and time", async () => {
    const t = reports();
    await paidReport(t, 1, A);
    t.decideReport(A, "refund_due", "responded");
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.deposit(1)?.state).toBe("refund_due");
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
    // Until the chain's own finalized event, the row keeps what is due.
    expect(t.report(A).outcome).toBe("refund_due");
    t.settle();
    expect(await t.run()).toMatchObject({ resolved: 1, send: "none" });
    expect(t.deposit(1)).toMatchObject({
      state: "refunded",
      resolve_tx: t.chain.signed[0].txId,
    });
    expect(t.report(A)).toMatchObject({
      outcome: "refunded",
      // The backend's reason stays.
      outcome_reason: "responded",
      paid_deposit_id: 1,
    });
    expect(t.report(A).outcome_at).toBe(t.deposit(1)?.resolved_at);
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.chain.signed).toHaveLength(1);
  });

  test("a deposit is kept only when the row it paid says kept_due, and it is burned, not income", async () => {
    const t = reports();
    await paidReport(t, 1, A);
    t.decideReport(A, "kept_due", "duplicate");
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: false }]);
    t.settle();
    await t.run();
    expect(t.deposit(1)).toMatchObject({ state: "kept", kept_to: BURN });
    expect(t.report(A)).toMatchObject({
      outcome: "kept",
      outcome_reason: "duplicate",
    });
    expect(t.report(A).outcome_at).toBe(t.deposit(1)?.resolved_at);
    // The fee converter counts kept fees sent to the fee wallet. This one
    // went to the burn address.
    const income = new D1BuybackStore(t.db as never);
    for (const token of [SLOP, USDG])
      expect(
        await income.feeIncome(
          "robinhood",
          token,
          FEE_WALLET,
          "2026-11-12T00:00:00.000Z",
        ),
      ).toBe(0n);
  });

  test("a reclaim by the payer is recorded as sent back", async () => {
    const t = reports();
    await paidReport(t, 1, A);
    t.decideReport(A, "kept_due", "spam");
    // The payer took it back from the contract first.
    t.chain.reclaim(1, t.chain.latest + 1);
    expect(await t.run()).toMatchObject({ send: "none" });
    expect(t.chain.signed).toEqual([]);
    t.finalize();
    await t.run();
    expect(t.deposit(1)?.state).toBe("reclaimed");
    expect(t.report(A).outcome).toBe("refunded");
  });

  test("a Resolved event without its proven transfer is not recorded", async () => {
    const t = reports();
    await paidReport(t, 1, A);
    t.decideReport(A, "kept_due", "spam");
    await t.run();
    t.settle();
    t.chain.transfersProven = false;
    await expect(t.run()).rejects.toThrow("transfer not proven");
    expect(t.deposit(1)?.state).toBe("kept_due");
    expect(t.report(A).outcome).toBe("kept_due");
  });

  test("a report's deposit and a pull request's fee settle in one batch, each on its own row", async () => {
    const t = reports();
    await paidReport(t, 1, A);
    await paidReport(t, 2, B);
    for (const pull of [7, 8]) t.ask(pull);
    t.chain.pay(3, 7, t.chain.latest + 1, { token: USDG });
    t.chain.pay(4, 8, t.chain.latest + 1, { token: USDG });
    t.finalize();
    expect(await t.run()).toMatchObject({ paid: 2, send: "none" });
    expect(t.deposit(3)).toMatchObject({ repository_id: REPOSITORY });
    t.decideReport(A, "refund_due", "silent");
    t.decideReport(B, "kept_due", "out-of-scope");
    t.decide(7, "kept_due");
    t.decide(8, "refund_due");
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.chain.signed[0].entries).toEqual([
      { id: 1, refund: true },
      { id: 2, refund: false },
      { id: 3, refund: false },
      { id: 4, refund: true },
    ]);
    t.settle();
    expect(await t.run()).toMatchObject({ resolved: 4 });
    expect([1, 2, 3, 4].map((id) => t.deposit(id)?.state)).toEqual([
      "refunded",
      "kept",
      "kept",
      "refunded",
    ]);
    expect(t.report(A).outcome).toBe("refunded");
    expect(t.report(B).outcome).toBe("kept");
    const pulls = t.sqlite
      .query(
        "SELECT pull_number, outcome FROM submission_fee_items ORDER BY pull_number",
      )
      .all();
    expect(pulls).toEqual([
      { pull_number: 7, outcome: "kept" },
      { pull_number: 8, outcome: "refunded" },
    ]);
    // Only the pull request's stablecoin fee is fee income.
    const income = new D1BuybackStore(t.db as never);
    expect(
      await income.feeIncome(
        "robinhood",
        USDG,
        FEE_WALLET,
        "2026-11-12T00:00:00.000Z",
      ),
    ).toBe(2_000_000n);
    expect(
      await income.feeIncome(
        "robinhood",
        SLOP,
        FEE_WALLET,
        "2026-11-12T00:00:00.000Z",
      ),
    ).toBe(0n);
  });

  test("a dry run lists a report's refund and keep and signs nothing", async () => {
    const t = reports();
    t.askReport(A);
    t.askReport(B);
    t.payReport(1, A, 110);
    t.payReport(2, B, 110);
    t.finalize();
    expect(await t.run("dry_run")).toMatchObject({ paid: 2, send: "none" });
    t.decideReport(A, "refund_due", "turned-off");
    t.decideReport(B, "kept_due", "spam");
    expect(await t.run("dry_run")).toMatchObject({ send: "recorded" });
    expect(t.sends()[0]).toMatchObject({
      mode: "dry_run",
      deposits: '[{"id":1,"refund":true},{"id":2,"refund":false}]',
      raw_tx: null,
    });
    expect(t.chain.signed).toEqual([]);
    expect(t.report(B).outcome).toBe("kept_due");
  });

  test("a parked report deposit does not hold up the ones behind it", async () => {
    const t = reports();
    await paidReport(t, 1, A);
    await paidReport(t, 2, B);
    t.decideReport(A, "refund_due", "responded");
    t.decideReport(B, "refund_due", "responded");
    t.chain.unpayable.add(1);
    expect(await t.run()).toMatchObject({ send: "sent", parked: 1 });
    expect(t.chain.signed[0].entries).toEqual([{ id: 2, refund: true }]);
    expect(t.deposit(1)).toMatchObject({ state: "refund_due", accepted: 1 });
    expect(t.report(A).outcome).toBe("refund_due");
  });

  test("without the reports table pull request deposits work as before", async () => {
    const t = setup();
    t.sqlite.exec("DROP TABLE security_report_deposits");
    t.ask(7);
    t.ask(8);
    t.chain.pay(1, 7, 110);
    t.chain.pay(2, 8, 110);
    // A SLOP deposit that names a report: just an unknown item here.
    t.chain.pay(3, 1, 110, { item: reportDepositItem(A) });
    t.chain.latest = 113;
    expect(await t.run()).toMatchObject({ recorded: 3, paid: 2 });
    t.chain.reorgOut(2);
    await t.run();
    expect(t.deposit(2)).toBe(null);
    expect(t.item(8).paid_deposit_id).toBe(null);
    t.chain.latest = 130;
    t.chain.finalized = 130;
    t.decide(7, "kept_due");
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: false }]);
    t.chain.mine(t.chain.signed[0].rawTx, 140);
    t.chain.latest = 150;
    t.chain.finalized = 150;
    expect(await t.run()).toMatchObject({ resolved: 1 });
    expect(t.item(7).outcome).toBe("kept");
    t.clock.at += 24 * 60 * 60 * 1000;
    expect(await t.run()).toMatchObject({ judged: 1, send: "sent" });
    expect(t.deposit(3)).toMatchObject({
      accepted: 0,
      reject_reason: "unknown_item",
    });
    expect(t.chain.signed[1].entries).toEqual([{ id: 3, refund: true }]);
  });
});

// The standing deposit (operator decision, 23 November 2026; PRD section 5):
// a second SubmissionDeposits contract on Robinhood Chain, read as its own
// ledger. Its deposits pay rows in `standing_deposits` only; Slopbot decides
// what is due on a row, and the Worker sends what it says.
describe("standing deposits", () => {
  const RC = "robinhood-mainnet";
  const LEDGER = STANDING_DEPOSIT_LEDGER;
  const STANDING_CONTRACT = `0x${"d".repeat(40)}`;
  const standingNet: NetworkConfig = {
    ...network,
    network: LEDGER,
    chain: RC,
    chainId: 4663,
    contract: STANDING_CONTRACT,
  };
  const rc: NetworkConfig = { ...network, network: RC, chainId: 4663 };
  const SLOP = (SUBMISSION_FEE_TOKENS[RC].slop as string).toLowerCase();
  const USDG = (SUBMISSION_FEE_TOKENS[RC].usdg as string).toLowerCase();
  const BURN = SUBMISSION_FEE_BURN.toLowerCase();
  const DUE = `790${"0".repeat(18)}`;
  const ALICE = 9001;
  const BOB = 9002;

  function standing() {
    const t = setup();
    t.chain.id = 4663;
    const run = (mode: "dry_run" | "live" = "live", siblings?: string[]) =>
      runNetwork({ ...t.deps(mode), network: standingNet, siblings });
    const ask = (githubId: number, round = 1, slopAmount = DUE) =>
      t.sqlite
        .query(
          "INSERT INTO standing_deposits (id, github_id, round, item, slop_amount, slop_per_usd, asked_at) VALUES (?, ?, ?, ?, ?, '78.908929', ?)",
        )
        .run(
          `sd_${String(githubId).padStart(8, "0")}_${round}`,
          githubId,
          round,
          standingDepositItem(githubId, round),
          slopAmount,
          START,
        );
    const row = (githubId: number, round = 1) =>
      t.sqlite
        .query(
          "SELECT paid_at, paid_network, paid_deposit_id, cancelled_at, outcome, outcome_reason, outcome_at FROM standing_deposits WHERE github_id = ? AND round = ?",
        )
        .get(githubId, round) as Record<string, unknown>;
    const decide = (
      githubId: number,
      outcome: string,
      reason: string,
      round = 1,
    ) =>
      t.sqlite
        .query(
          "UPDATE standing_deposits SET outcome = ?, outcome_reason = ?, outcome_at = ?, strike_repository_id = ?, strike_pull_number = ? WHERE github_id = ? AND round = ?",
        )
        .run(
          outcome,
          reason,
          START,
          reason === "strike" ? REPOSITORY : null,
          reason === "strike" ? 12 : null,
          githubId,
          round,
        );
    const pay = (
      id: number,
      githubId: number,
      block: number,
      overrides: Partial<ChainDeposit> = {},
      round = 1,
    ) =>
      t.chain.pay(id, 1, block, {
        item: standingDepositItem(githubId, round),
        token: SLOP,
        amount: DUE,
        keptTo: BURN,
        ...overrides,
      });
    const deposit = (id: number, ledger: string = LEDGER) =>
      t.sqlite
        .query(
          "SELECT * FROM submission_fee_deposits WHERE network = ? AND deposit_id = ?",
        )
        .get(ledger, id) as Record<string, unknown> | null;
    const finalize = () => {
      t.chain.latest += 20;
      t.chain.finalized = t.chain.latest;
    };
    const settle = () => {
      t.chain.mine(t.chain.signed.at(-1)?.rawTx as string, t.chain.latest + 1);
      finalize();
    };
    return { ...t, run, ask, row, decide, pay, deposit, finalize, settle };
  }

  test("an accepted deposit marks its row paid, before finality, on the standing ledger only", async () => {
    const t = standing();
    t.ask(ALICE);
    t.pay(1, ALICE, 110);
    t.chain.latest = 113;
    expect(await t.run()).toMatchObject({ recorded: 1, judged: 1, paid: 1 });
    expect(t.deposit(1)).toMatchObject({
      item: standingDepositItem(ALICE, 1),
      repository_id: null,
      pull_number: null,
      accepted: 1,
      state: "open",
      finalized_at: null,
    });
    expect(t.row(ALICE)).toMatchObject({
      paid_at: "2026-12-01T12:00:00.000Z",
      paid_network: LEDGER,
      paid_deposit_id: 1,
      outcome: null,
    });
    expect(t.logs).toContainEqual({
      event: "submission_fee_standing_paid",
      network: LEDGER,
      depositId: 1,
    });
    // Its cursor is its own.
    t.finalize();
    await t.run();
    const cursor = t.sqlite
      .query("SELECT network FROM submission_fee_cursors")
      .all();
    expect(cursor).toEqual([{ network: LEDGER }]);
    expect(t.deposit(1)?.finalized_at).not.toBe(null);
  });

  test("the per pull request contract never pays a standing row", async () => {
    const t = standing();
    t.ask(ALICE);
    t.pay(1, ALICE, 110);
    t.finalize();
    // The same deposit read by the Robinhood Chain fee ledger.
    const fee = () => runNetwork({ ...t.deps(), network: rc });
    expect(await fee()).toMatchObject({ recorded: 1, judged: 0, paid: 0 });
    t.clock.at += 24 * 60 * 60 * 1000;
    expect(await fee()).toMatchObject({ judged: 1, send: "sent" });
    expect(t.deposit(1, RC)).toMatchObject({
      accepted: 0,
      reject_reason: "unknown_item",
    });
    expect(t.row(ALICE).paid_at).toBe(null);
  });

  test("every deposit that does not meet the terms is refused and sent back, never kept", async () => {
    const t = standing();
    for (const id of [ALICE, BOB]) t.ask(id);
    t.ask(3, 1);
    t.sqlite.exec(
      `UPDATE standing_deposits SET cancelled_at = '${START}' WHERE github_id = 3`,
    );
    t.pay(1, ALICE, 110, { token: USDG, amount: "10000000" });
    t.pay(2, ALICE, 110, { keptTo: FEE_WALLET });
    t.pay(3, ALICE, 110, { amount: (BigInt(DUE) - 1n).toString() });
    t.pay(4, 3, 110);
    t.pay(5, BOB, 110);
    t.pay(6, BOB, 110, { payer: `0x${"b".repeat(40)}` });
    t.finalize();
    // A dry run judges and signs nothing.
    await t.run("dry_run");
    const reasons = [1, 2, 3, 4, 5, 6].map((id) => {
      const row = t.deposit(id);
      return [row?.accepted, row?.reject_reason];
    });
    expect(reasons).toEqual([
      [0, "standing_token_not_slop"],
      [0, "wrong_kept_to"],
      [0, "amount_below_due"],
      [0, "standing_cancelled"],
      [1, null],
      [0, "item_already_paid"],
    ]);
    expect(t.row(ALICE).paid_at).toBe(null);
    expect(t.row(3)).toMatchObject({ paid_at: null, cancelled_at: START });
    expect(t.row(BOB).paid_deposit_id).toBe(5);
    // Even a row edited to say kept never keeps a refused deposit.
    t.decide(BOB, "kept_due", "strike");
    t.sqlite.exec(
      `UPDATE standing_deposits SET paid_deposit_id = 6 WHERE github_id = ${BOB}`,
    );
    await t.run();
    expect(t.chain.signed.flatMap((tx) => tx.entries)).toEqual([
      { id: 1, refund: true },
      { id: 2, refund: true },
      { id: 3, refund: true },
      { id: 4, refund: true },
      { id: 6, refund: true },
    ]);
  });

  test("a deposit of another token is refused at once and never resolved", async () => {
    const t = standing();
    t.ask(ALICE);
    t.pay(1, ALICE, 110, { token: `0x${"9".repeat(40)}` });
    t.finalize();
    for (let run = 0; run < 2; run += 1) {
      expect(await t.run()).toMatchObject({ send: "none" });
      t.clock.at += 40 * 24 * 60 * 60 * 1000;
    }
    expect(t.deposit(1)).toMatchObject({
      accepted: 0,
      reject_reason: "token_not_accepted",
    });
    expect(t.chain.simulations).toBe(0);
  });

  test("a deposit for an item no row has waits a day, then is sent back", async () => {
    const t = standing();
    t.pay(1, ALICE, 110);
    t.finalize();
    expect(await t.run()).toMatchObject({ judged: 0, send: "none" });
    t.clock.at += 24 * 60 * 60 * 1000;
    expect(await t.run()).toMatchObject({ judged: 1, send: "sent" });
    expect(t.deposit(1)?.reject_reason).toBe("unknown_item");
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
  });

  test("kept only when the row it paid says kept_due, then the row reads kept", async () => {
    const t = standing();
    t.ask(ALICE);
    t.pay(1, ALICE, 110);
    t.finalize();
    await t.run();
    expect(await t.run()).toMatchObject({ send: "none" });
    t.decide(ALICE, "kept_due", "strike");
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: false }]);
    expect(t.row(ALICE).outcome).toBe("kept_due");
    t.settle();
    expect(await t.run()).toMatchObject({ resolved: 1 });
    expect(t.deposit(1)).toMatchObject({ state: "kept", kept_to: BURN });
    expect(t.row(ALICE)).toMatchObject({
      outcome: "kept",
      outcome_reason: "strike",
    });
    expect(t.row(ALICE).outcome_at).toBe(t.deposit(1)?.resolved_at);
  });

  test("refund_due sends it back, and the row reads refunded with its reason", async () => {
    const t = standing();
    t.ask(ALICE);
    t.pay(1, ALICE, 110);
    t.finalize();
    await t.run();
    t.decide(ALICE, "refund_due", "withdrawn");
    expect(await t.run()).toMatchObject({ send: "sent" });
    expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
    t.settle();
    await t.run();
    expect(t.deposit(1)?.state).toBe("refunded");
    expect(t.row(ALICE)).toMatchObject({
      outcome: "refunded",
      outcome_reason: "withdrawn",
    });
  });

  test("a deposit reorganised away before finality stops paying its row", async () => {
    const t = standing();
    t.ask(ALICE);
    t.pay(1, ALICE, 110);
    t.chain.latest = 113;
    await t.run();
    expect(t.row(ALICE).paid_deposit_id).toBe(1);
    t.chain.reorgOut(1);
    await t.run();
    expect(t.deposit(1)).toBe(null);
    expect(t.row(ALICE)).toMatchObject({
      paid_at: null,
      paid_network: null,
      paid_deposit_id: null,
    });
  });

  describe("one key on one chain", () => {
    test("a ledger waits while its sibling on the same chain has a send in flight", async () => {
      const t = standing();
      // The Robinhood Chain fee ledger has a live send in flight.
      t.sqlite
        .query(
          "INSERT INTO submission_fee_sends (id, network, mode, contract, deposits, resolver, tx_id, raw_tx, evm_nonce, maximum_native_wei, state, created_at, updated_at) VALUES ('sfs_inflight01', ?, 'live', ?, '[{\"id\":1,\"refund\":true}]', ?, ?, '0x02ffffffff', 0, '400', 'submitted', ?, ?)",
        )
        .run(RC, CONTRACT, RESOLVER, `0x${"e".repeat(64)}`, START, START);
      t.ask(ALICE);
      t.pay(1, ALICE, 110);
      t.finalize();
      await t.run("live", [RC]);
      t.decide(ALICE, "refund_due", "withdrawn");
      expect(await t.run("live", [RC])).toMatchObject({
        send: "sibling_in_flight",
      });
      expect(t.chain.signed).toEqual([]);
      // A dry run records the list; nothing is signed either way.
      expect(await t.run("dry_run", [RC])).toMatchObject({ send: "recorded" });
      // Once the sibling's send is settled, this ledger sends.
      t.sqlite.exec(
        "UPDATE submission_fee_sends SET state = 'finalized', block_number = 1, finalized_at = updated_at WHERE id = 'sfs_inflight01'",
      );
      expect(await t.run("live", [RC])).toMatchObject({ send: "sent" });
      expect(t.chain.signed[0].entries).toEqual([{ id: 1, refund: true }]);
    });

    test("the insert itself refuses a send while a sibling holds one, and the day's limit is shared", async () => {
      const t = standing();
      const row = (
        id: string,
        ledger: string,
        tx: string,
        wei = "400",
        state: SendRow["state"] = "submitted",
      ): SendRow => ({
        id,
        network: ledger,
        mode: "live",
        contract: ledger === RC ? CONTRACT : STANDING_CONTRACT,
        deposits: [{ id: 1, refund: true }],
        resolver: RESOLVER,
        txId: `0x${tx.repeat(64)}`,
        rawTx: "0x02ffffffff",
        evmNonce: 0,
        maximumNativeWei: wei,
        state,
        reason: state === "failed" ? "resolve transaction reverted" : null,
        blockNumber: null,
        createdAt: START,
        updatedAt: START,
        finalizedAt: null,
      });
      const limits = network.gas;
      await t.store.insertSend(row("sfs_ledger_a01", RC, "a"), limits, [
        LEDGER,
      ]);
      // A run that read no open sibling before signing still loses here.
      await expect(
        t.store.insertSend(row("sfs_ledger_b01", LEDGER, "b"), limits, [RC]),
      ).rejects.toBeInstanceOf(SendConflictError);
      t.sqlite.exec(
        "UPDATE submission_fee_sends SET state = 'finalized', block_number = 1, finalized_at = updated_at WHERE id = 'sfs_ledger_a01'",
      );
      // 400 spent today on the shared key; 1,000 more stays inside 2,500.
      await expect(
        t.store.assertGasBudget(LEDGER, "1000", limits, new Date(START), [RC]),
      ).resolves.toBeUndefined();
      // A failed send still spent its reserve against the day's limit.
      await t.store.insertSend(
        row("sfs_spent_c01", RC, "c", "1500", "failed"),
        { perTransactionWei: "2000", perDayWei: "5000" },
      );
      await expect(
        t.store.assertGasBudget(LEDGER, "1000", limits, new Date(START), [RC]),
      ).rejects.toBeInstanceOf(GasBudgetError);
      // Without siblings each ledger counts only its own spend, as before.
      await expect(
        t.store.assertGasBudget(LEDGER, "1000", limits, new Date(START)),
      ).resolves.toBeUndefined();
    });

    test("the run names the other ledgers on the same chain as siblings", async () => {
      const t = standing();
      const fee = new Chain();
      fee.id = 4663;
      t.sqlite
        .query(
          "INSERT INTO submission_fee_sends (id, network, mode, contract, deposits, resolver, tx_id, raw_tx, evm_nonce, maximum_native_wei, state, created_at, updated_at) VALUES ('sfs_inflight01', ?, 'live', ?, '[{\"id\":1,\"refund\":true}]', ?, ?, '0x02ffffffff', 0, '400', 'submitted', ?, ?)",
        )
        .run(RC, CONTRACT, RESOLVER, `0x${"e".repeat(64)}`, START, START);
      fee.mempool.add("0x02ffffffff");
      t.ask(ALICE);
      t.pay(1, ALICE, 110);
      t.finalize();
      const three = (config: SubmissionFeeConfig): SubmissionFeeConfig => ({
        ...config,
        unset: [],
        networks: [network, rc, standingNet],
      });
      const live = {
        ...env("live", t.db),
        SUBMISSION_FEE_RESOLVER_KEY: `0x${"1".repeat(64)}`,
      };
      const chainFor = (config: NetworkConfig) =>
        config.network === LEDGER ? t.chain : fee;
      await runDeposits(live, () => new Date(t.clock.at), {
        config: three,
        chain: chainFor,
        log: () => {},
      });
      expect(t.row(ALICE).paid_deposit_id).toBe(1);
      t.decide(ALICE, "refund_due", "withdrawn");
      const result = await runDeposits(live, () => new Date(t.clock.at), {
        config: three,
        chain: chainFor,
        log: () => {},
      });
      expect(result).toMatchObject({
        status: "ran",
        networks: [
          { network: NETWORK },
          { network: RC, send: "in_flight" },
          { network: LEDGER, send: "sibling_in_flight" },
        ],
      });
      expect(t.chain.signed).toEqual([]);
    });
  });
});

describe("the standing ledger in the configuration", () => {
  const gas = {
    SUBMISSION_FEE_MODE: "dry_run",
    SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI: "1000",
    SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI: "2500",
  };
  const DEPLOYED = `0x${"D".repeat(40)}`;

  test("the recorded deployment is the third ledger; a missing or half-recorded one leaves the two fee ledgers as before", () => {
    const config = parseConfig(gas);
    expect(config.networks.map((n) => n.network)).toEqual([
      "base-mainnet",
      "robinhood-mainnet",
      STANDING_DEPOSIT_LEDGER,
    ]);
    expect(config.networks[2]).toMatchObject({
      chain: "robinhood-mainnet",
      contract: "0x446604d5c3cc99c60cce3d5c4357bc60f5b45993",
      startBlock: 122128533,
    });
    expect(config.unset).toEqual([]);
    const fees = config.networks.slice(0, 2);
    for (const half of [
      { contract: null, startBlock: null },
      { contract: DEPLOYED, startBlock: null },
      { contract: null, startBlock: 5 },
      { contract: "0x1234", startBlock: 5 },
    ])
      expect(parseConfig(gas, half).networks).toEqual(fees);
  });

  test("once recorded it is a third ledger on the Robinhood Chain tables", () => {
    const before = parseConfig(gas, { contract: null, startBlock: null });
    const config = parseConfig(gas, { contract: DEPLOYED, startBlock: 5 });
    expect(config.networks.slice(0, 2)).toEqual(before.networks);
    const fee = before.networks[1];
    expect(fee).toMatchObject({
      network: "robinhood-mainnet",
      chain: "robinhood-mainnet",
    });
    expect(config.networks[2]).toEqual({
      ...fee,
      network: STANDING_DEPOSIT_LEDGER,
      chain: "robinhood-mainnet",
      contract: DEPLOYED.toLowerCase(),
      startBlock: 5,
    });
    expect(
      parseConfig(
        { ...gas, RPC_URL_SUBMISSION_FEE_ROBINHOOD: "https://rpc.example" },
        { contract: DEPLOYED, startBlock: 5 },
      ).networks[2].rpcUrl,
    ).toBe("https://rpc.example");
  });

  test("the standing contract cannot be a fee contract", () => {
    const fee = parseConfig(gas).networks[1].contract;
    expect(() => parseConfig(gas, { contract: fee, startBlock: 5 })).toThrow(
      "must differ",
    );
  });
});
