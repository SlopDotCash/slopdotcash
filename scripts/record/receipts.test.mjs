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
  groupKey,
  loadReceipts,
  ownerId,
  payment,
  receiptsFrom,
  TEAM_IDS,
  walk,
} from "./receipts.mjs";

const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
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
      rewardAsset: { address: "0xAbC0000000000000000000000000000000000001", symbol: "SLOP" },
    },
  ],
]);

const base = (rows, who, extra = {}) => {
  const payments = rows.map(payment);
  assert.ok(payments.every(Boolean));
  return receiptsFrom(payments, projects, who, {}, {}, { ...extra });
};

const rpc = {
  solana: { rpc: "https://api.mainnet-beta.solana.com", kind: "solana" },
  base: { rpc: "https://mainnet.base.org", kind: "evm" },
};

const finalRpc = async () => ({ value: [{ err: null, confirmationStatus: "finalized" }] });

function site({ outside = true } = {}) {
  const mine = [raw({ id: "hand" }), raw({ id: "feed-oct", contributionMonth: "2026-10", netBase: "382439023" })];
  const theirs = outside ? [raw({ id: "feed-oct-out", contributionMonth: "2026-10", netBase: "107560976", transactionId: TX_B, indexedAt: "2026-11-20T08:00:00.000Z" })] : [];
  const pays = [...mine, ...theirs];
  const net = pays.reduce((sum, p) => sum + BigInt(p.netBase), 0n);
  const fees = pays.reduce((sum, p) => sum + feeOn(BigInt(p.netBase)), 0n);
  const routes = new Map([
    [
      "https://slop.cash/api/v1/payments/vault-payments",
      () => ({ payments: pays, through: 9, next: null }),
    ],
    ["https://slop.cash/api/v1/projects", () => ({ projects: [...projects.values()] })],
    [
      "https://slop.cash/api/v1/payments/received",
      () => ({
        contributors: [
          { githubId: SHAW, vaultPayments: mine.length },
          { githubId: OUTSIDER, vaultPayments: theirs.length },
        ],
      }),
    ],
    [
      `https://slop.cash/api/v1/payments/actors/${SHAW}/vault-payments`,
      () => ({ payments: mine, through: 9, next: null }),
    ],
    [
      `https://slop.cash/api/v1/payments/actors/${OUTSIDER}/vault-payments`,
      () => ({ payments: theirs, through: 9, next: null }),
    ],
    [
      "https://slop.cash/api/v1/payments/projects/feed/totals",
      () => ({
        assets: [
          {
            network: "solana-mainnet",
            asset: USDC_SOL,
            totalNetPaidBase: String(net),
            payoutFeesPaidBase: String(fees),
            reservedNetBase: "0",
          },
        ],
      }),
    ],
    ["https://slop.cash/api/v1/merge-activity", () => ({})],
  ]);
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    const found = routes.get(url);
    if (!found) throw new Error(`404 ${url}`);
    return found();
  };
  return { calls, fetchJson };
}

test("amounts round half to even", () => {
  assert.equal(amount(100500n, 6), "0.10");
  assert.equal(amount(101500n, 6), "0.10");
  assert.equal(amount(102500n, 6), "0.10");
  assert.equal(amount(103500n, 6), "0.10");
  assert.equal(amount(104500n, 6), "0.10");
  assert.equal(amount(105500n, 6), "0.11");
  assert.equal(amount(107500n, 6), "0.11");
});

test("the fee is 2% of the gross award", () => {
  assert.equal(feeOn(1000000n), 20409n);
  assert.equal(feeOn(9800n), 200n);
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
  assert.equal(ownerId(projects.get("feed")), "246782978");
  assert.equal(ownerId(projects.get("solo")), "777");
});

test("a known stablecoin wins over the project token", () => {
  assert.deepEqual(assetOf(null, "solana-mainnet", USDC_SOL), { symbol: "USDC", stable: true });
  assert.deepEqual(assetOf(null, "base-mainnet", USDC_BASE), { symbol: "USDC", stable: true });
  assert.deepEqual(assetOf(null, "robinhood-mainnet", USDG.toUpperCase().replace("0X", "0x")), {
    symbol: "USDG",
    stable: true,
  });
  assert.deepEqual(
    assetOf(projects.get("solo"), "base-mainnet", "0xabc0000000000000000000000000000000000001"),
    { symbol: "SLOP", stable: false },
  );
  assert.equal(assetOf(projects.get("solo"), "base-mainnet", "0x0000000000000000000000000000000000000002"), null);
});

test("a month paid to an outside contributor gets a receipt with every figure", () => {
  const got = base([raw({ contributionMonth: "2026-10" }), raw({ contributionMonth: "2026-10" })], {
    "feed-oct": OUTSIDER,
  });
  assert.deepEqual(got, [
    {
      projectId: "feed",
      month: "2026-10",
      network: "solana-mainnet",
      asset: USDC_SOL,
      anchor: "feed-2026-10",
      total: "490.00",
      fee: "10.00",
      feeExact: false,
      own: { payments: 0, total: "0.00" },
      team: { payments: 0, total: "0.00" },
      txs: [TX_A],
      recipients: [OUTSIDER],
      merged: null,
      publishedAt: "2026-12-04T12:00:00.000Z",
    },
  ]);
});

test("two receipts for one project month take different anchors", () => {
  const got = base(
    [
      raw({ contributionMonth: "2026-10", assetAddress: USDC_BASE, network: "base-mainnet" }),
      raw({ contributionMonth: "2026-10", assetAddress: USDC_SOL, network: "solana-mainnet" }),
    ],
    { "feed-oct": OUTSIDER },
  );
  assert.equal(got.length, 2);
  assert.equal(got[0].anchor, "feed-2026-10");
  assert.equal(got[1].anchor, "feed-2026-10-solana");
});

test("a published month keeps its anchor, its first publication and its merge figures", () => {
  const first = base([raw({ contributionMonth: "2026-10" })], { "feed-oct": OUTSIDER });
  const second = base([raw({ contributionMonth: "2026-10" })], { "feed-oct": OUTSIDER }, { previous: first });
  assert.equal(first[0].anchor, "feed-2026-10");
  assert.equal(first[0].publishedAt, "2026-12-04T12:00:00.000Z");
  assert.equal(second[0].anchor, "feed-2026-10");
  assert.equal(second[0].publishedAt, "2026-12-04T12:00:00.000Z");
});

test("a month paid only to the team gets no receipt", () => {
  const got = base([raw({ contributionMonth: "2026-10" })], { "feed-oct": SHAW });
  assert.deepEqual(got, []);
});

test("walk follows the frozen boundary", async () => {
  const pages = [
    { payments: [raw()], through: 0, next: "https://slop.cash/api/v1/payments/vault-payments?page=2" },
    { payments: [raw({ id: "second" })], through: 0, next: null },
  ];
  let calls = 0;
  const out = await walk(async () => pages[calls++], "https://slop.cash/api/v1/payments/vault-payments");
  assert.equal(out.length, 2);
});

test("chainFinal reads finality from the chain", async () => {
  const got = await chainFinal(finalRpc, "solana-mainnet", TX_A);
  assert.equal(got, true);
});

test("today: payments went to a team account only, so no receipt and no chain call", async () => {
  const { calls, fetchJson } = site({ outside: false });
  let rpcCalls = 0;
  const rpc = async () => {
    rpcCalls++;
    return { value: [{ err: null, confirmationStatus: "finalized" }] };
  };
  const got = await loadReceipts(fetchJson, rpc, { now: NOW });
  assert.deepEqual(got.items, []);
  assert.equal(rpcCalls, 0);
  assert.ok(!calls.some((u) => u.endsWith("/totals")));
});

test("the first outside recipient publishes the month", async () => {
  const { fetchJson } = site();
  const got = await loadReceipts(fetchJson, finalRpc, { now: NOW });
  const [r] = got.items;
  assert.equal(got.items.length, 1);
  assert.equal(r.anchor, "feed-2026-10");
  assert.deepEqual(r.recipients, [OUTSIDER]);
  assert.equal(r.total, "107.56");
  assert.equal(r.fee, "2.20");
  assert.equal(r.feeExact, true);
  assert.deepEqual(r.own, { payments: 1, total: "382.44" });
  assert.deepEqual(got.confirmed, [`solana-mainnet:${TX_A}`, `solana-mainnet:${TX_B}`]);
  const throwingRpc = async () => {
    throw new Error("chain down");
  };
  const kept = await loadReceipts(fetchJson, throwingRpc, { previous: got, now: new Date("2026-12-04T13:00:00Z") });
  assert.equal(kept.items.length, 1);
  assert.equal(kept.items[0].publishedAt, "2026-12-04T12:00:00.000Z");
});

test("an unconfirmed transaction publishes nothing; an unreadable record throws", async () => {
  const { fetchJson } = site();
  const rpc = async () => ({ value: [null] });
  const got = await loadReceipts(fetchJson, rpc, { now: NOW });
  assert.deepEqual(got.items, []);
  await assert.rejects(loadReceipts(async () => { throw new Error("down"); }, finalRpc, { now: NOW }), /unreadable/);
});
