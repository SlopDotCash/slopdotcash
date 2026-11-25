// spec/frontend/recordPages.md, "The receipts rule"
//
// The receipts rule, checked against the same figures as the retired record
// site: amounts round half to even, the fee is 2% of the gross award, and a
// month paid to an outside contributor gets one receipt with every figure.

import test from "node:test";
import assert from "node:assert/strict";
import {
  amount,
  assetOf,
  chainFinal,
  feeOn,
  ownerId,
  payment,
  receiptsFrom,
  TEAM_IDS,
  walk,
} from "./receipts.mjs";

const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TX_A = "A".repeat(88);
const TX_B = "B".repeat(88);
const EVM_TX = `0x${"ab".repeat(32)}`;
const NOW = new Date("2026-12-04T12:00:00Z");
const OUTSIDER = "555001";
const OUTSIDER2 = "555002";
const SHAW = TEAM_IDS[0];

const raw = (over = {}) => ({
  id: `solana-mainnet:${TX_A}:1`,
  projectId: "feed",
  network: "solana-mainnet",
  contributionMonth: "2026-11",
  assetAddress: USDC_SOL,
  assetDecimals: 6,
  netBase: "245000000",
  transactionId: TX_A,
  indexedAt: "2026-12-04T08:00:00.000Z",
  ...over,
});

const projects = new Map([
  [
    "feed",
    {
      id: "feed",
      name: "Feed",
      steward: { github: { type: "Organization", actorId: "246782978", login: "feedforagents" } },
    },
  ],
  [
    "solo",
    {
      id: "solo",
      name: "Solo",
      steward: { github: { type: "User", actorId: "777", login: "solo-owner" } },
      rewardAsset: { address: "0x0000000000000000000000000000000000000001", symbol: "SLOP" },
    },
  ],
]);

const base = (rows, who, extra = {}) => {
  const payments = rows.map(payment);
  assert.ok(payments.every(Boolean));
  const totals = new Map();
  for (const p of payments) {
    const key = `${p.projectId}|${p.network}|${p.asset}`;
    const entry = totals.get(key) ?? { paid: 0n, fees: 0n, reserved: 0n };
    entry.paid += p.net;
    entry.fees += feeOn(p.net);
    totals.set(key, entry);
  }
  return {
    payments,
    recipients: new Map(Object.entries(who)),
    projects,
    totals,
    confirmed: new Set(payments.map((p) => `${p.network}:${p.tx}`)),
    now: NOW,
    ...extra,
  };
};

test("amounts round half to even", () => {
  assert.equal(amount(382439023n, 6), "382.44");
  assert.equal(amount(245000000n, 6), "245");
  assert.equal(amount(1234500000n, 6), "1,234.50");
  assert.equal(amount(1005000n, 6), "1");
  assert.equal(amount(1015000n, 6), "1.02");
  assert.equal(amount(530000n * 10n ** 18n, 18), "530,000");
});

test("the fee is 2% of the gross award", () => {
  assert.equal(feeOn(382439023n), 7804879n); // Feed, October 2026 payoutFeesPaidBase
  assert.equal(feeOn(150256329n), 3066456n); // The Network, October 2026 payoutFeesPaidBase
  assert.equal(feeOn(9800000n), 200000n); // a 1 USDC qualification transfer
});

test("payments with a bad id, a bad month, a bad decimal or a zero net are dropped", () => {
  assert.ok(payment(raw()));
  assert.equal(payment(raw({ netBase: "-5" })), null);
  assert.equal(payment(raw({ netBase: "0" })), null);
  assert.equal(payment(raw({ projectId: "Bad Id" })), null);
  assert.equal(payment(raw({ contributionMonth: "2026-13" })), null);
  assert.equal(payment(raw({ assetDecimals: 99 })), null);
  assert.equal(payment(raw({ indexedAt: "yesterday" })), null);
  assert.equal(payment(raw({ contributionMonth: null })).month, null);
});

test("only a user steward is an owner", () => {
  assert.equal(ownerId(projects.get("feed")), null);
  assert.equal(ownerId(projects.get("solo")), "777");
  assert.equal(ownerId(undefined), null);
});

test("a known stablecoin wins over the project token", () => {
  assert.deepEqual(assetOf(null, "solana-mainnet", USDC_SOL), { symbol: "USDC", stable: true });
  assert.deepEqual(
    assetOf(projects.get("solo"), "base-mainnet", "0x0000000000000000000000000000000000000001"),
    { symbol: "SLOP", stable: false },
  );
  assert.equal(assetOf(projects.get("solo"), "base-mainnet", "0x0000000000000000000000000000000000000002"), null);
});

test("a month paid to an outside contributor gets a receipt with every figure", () => {
  const second = raw({
    id: `solana-mainnet:${TX_B}:1`,
    transactionId: TX_B,
    netBase: "49000000",
    indexedAt: "2026-12-04T08:05:00.000Z",
  });
  const mine = raw({ id: "own", netBase: "98000000" });
  const r = receiptsFrom(
    base([raw(), second, mine], {
      [raw().id]: { actor: OUTSIDER, login: "alice" },
      [second.id]: { actor: OUTSIDER2, login: "bob" },
      own: { actor: SHAW, login: "lalalune" },
    }, {
      merges: new Map([
        ["feed", [{ repository: "feedforagents/feed", mergedOutsideLast30Days: 12, medianHoursToMerge: 5.26 }]],
      ]),
    }),
  );
  assert.equal(r.length, 1);
  const [receipt] = r;
  assert.equal(receipt.anchor, "feed-2026-11");
  assert.equal(receipt.url, "https://slop.cash/receipts#feed-2026-11");
  assert.equal(receipt.project, "Feed");
  assert.equal(receipt.asset, "USDC");
  assert.equal(receipt.networkName, "Solana");
  assert.equal(receipt.stable, true);
  assert.equal(receipt.contributors, 2);
  assert.equal(receipt.total, "294");
  assert.equal(receipt.fee, "6");
  assert.equal(receipt.feeExact, true);
  assert.deepEqual(
    receipt.recipients.map((x) => [x.login, x.received]),
    [
      ["alice", "245"],
      ["bob", "49"],
    ],
  );
  assert.deepEqual(receipt.recipients[0].transactions, [{ id: TX_A, url: `https://explorer.solana.com/tx/${TX_A}` }]);
  assert.deepEqual(receipt.own, { payments: 1, total: "98" });
  assert.equal(receipt.privateRecords, false);
  assert.equal(receipt.reserved, null);
  assert.equal(receipt.firstSentAt, "2026-12-04T08:00:00.000Z");
  assert.equal(receipt.lastSentAt, "2026-12-04T08:05:00.000Z");
  assert.equal(receipt.publishedAt, NOW.toISOString());
  assert.deepEqual(receipt.merges, {
    windowDays: 30,
    asOf: NOW.toISOString(),
    repositories: [{ repository: "feedforagents/feed", mergedOutside: 12, medianHours: 5.3 }],
  });
});

test("two receipts for one project month take different anchors", () => {
  const onBase = raw({
    id: `base-mainnet:${EVM_TX}:1`,
    network: "base-mainnet",
    assetAddress: USDC_BASE,
    netBase: "10000000",
    transactionId: EVM_TX,
    indexedAt: "2026-12-04T08:10:00.000Z",
  });
  const r = receiptsFrom(
    base([raw(), onBase], {
      [raw().id]: { actor: OUTSIDER, login: "alice" },
      [onBase.id]: { actor: OUTSIDER2, login: "bob" },
    }),
  );
  assert.deepEqual(
    r.map((x) => x.anchor),
    ["feed-2026-11", "feed-2026-11-base-mainnet"],
  );
});

test("a published month keeps its anchor, its first publication and its merge figures", () => {
  const previous = [
    {
      anchor: "feed-2026-11",
      url: "https://old.example/#feed-2026-11",
      projectId: "feed",
      project: "Feed",
      month: "2026-11",
      network: "solana-mainnet",
      assetAddress: USDC_SOL,
      asset: "USDC",
      stable: true,
      publishedAt: "2026-11-30T00:00:00.000Z",
      merges: {
        windowDays: 30,
        asOf: "2026-11-30T00:00:00.000Z",
        repositories: [{ repository: "feedforagents/feed", mergedOutside: 12, medianHours: 5.3 }],
      },
      privateRecords: false,
      reserved: null,
    },
  ];
  const r = receiptsFrom(base([raw()], { [raw().id]: { actor: OUTSIDER, login: "alice" } }, { previous }));
  assert.equal(r.length, 1);
  assert.equal(r[0].anchor, "feed-2026-11");
  assert.equal(r[0].publishedAt, "2026-11-30T00:00:00.000Z");
  assert.deepEqual(r[0].merges, previous[0].merges);
});

test("a month paid only to the team gets no receipt", () => {
  const mine = raw({ id: "own", netBase: "98000000" });
  const r = receiptsFrom(base([mine], { own: { actor: SHAW, login: "lalalune" } }));
  assert.deepEqual(r, []);
});

test("walk follows the frozen boundary", async () => {
  const pages = new Map([
    ["https://example.test/payments", { payments: [{ id: "a" }], through: 10, next: 5 }],
    ["https://example.test/payments?after=5&through=10", { payments: [{ id: "b" }], through: 10, next: null }],
  ]);
  const fetchJson = async (url) => pages.get(url);
  assert.deepEqual(await walk(fetchJson, "https://example.test/payments"), [{ id: "a" }, { id: "b" }]);
  assert.equal(
    await walk(async () => ({ payments: [{ id: "a" }], through: 1, next: "x" }), "https://example.test/payments"),
    null,
  );
  assert.equal(
    await walk(async () => { throw new Error("down"); }, "https://example.test/payments"),
    null,
  );
});

test("chainFinal reads finality from the chain", async () => {
  const evm = async (url, method) => {
    if (method === "eth_getTransactionReceipt") return { status: "0x1", blockNumber: "0x10" };
    if (method === "eth_getBlockByNumber") return { number: "0x10" };
    throw new Error(`unexpected ${method}`);
  };
  assert.equal(await chainFinal(evm, "ethereum", EVM_TX), true);
  const unfinal = async (url, method) => {
    if (method === "eth_getTransactionReceipt") return { status: "0x1", blockNumber: "0x11" };
    if (method === "eth_getBlockByNumber") return { number: "0x10" };
    throw new Error(`unexpected ${method}`);
  };
  assert.equal(await chainFinal(unfinal, "ethereum", EVM_TX), false);
  const solana = async () => ({ value: [{ err: null, confirmationStatus: "finalized" }] });
  assert.equal(await chainFinal(solana, "solana-mainnet", TX_A), true);
  const errored = async () => ({
    value: [{ err: { InstructionError: [0, "custom"] }, confirmationStatus: "finalized" }],
  });
  assert.equal(await chainFinal(errored, "solana-mainnet", TX_A), false);
  assert.equal(await chainFinal(evm, "ethereum", "not-a-transaction"), false);
});
