// The receipts rule (ported with receipts.mjs from the retired record site).
import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const TX_A =
  "5XRgBiXJqmhcf3w1TuRq4vg5jSvFzMsFfc54M4pWxyiAQVv1WSyCid7kdWFpTK1kgYddNLAFn4CLinNZRxRdyWdC";
const TX_B =
  "2MkrDm7WEVGcywDPxsur9nWYYD2nanKJ6LXHGzG3tXEiX2aUyPexcQXEcPcQwrVTYqSSwEkqgu7NXbtwrFdaaG21";
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
      steward: {
        github: {
          type: "Organization",
          actorId: "246782978",
          login: "feedforagents",
        },
      },
    },
  ],
  [
    "solo",
    {
      id: "solo",
      name: "Solo",
      steward: {
        github: { type: "User", actorId: "777", login: "solo-owner" },
      },
      rewardAsset: {
        address: "0xAbC0000000000000000000000000000000000001",
        symbol: "SOLO",
      },
    },
  ],
]);
const base = (rows, who, extra = {}) => {
  const payments = rows.map(payment);
  assert.ok(payments.every(Boolean));
  const totals = new Map([
    [
      `feed|solana-mainnet|${USDC_SOL}`,
      {
        paid: payments.reduce((s, p) => s + p.net, 0n),
        fees: payments.reduce((s, p) => s + feeOn(p.net), 0n),
        reserved: 0n,
      },
    ],
  ]);
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

test("amounts print as the loop prints them", () => {
  assert.equal(amount(382439023n, 6), "382.44");
  assert.equal(amount(245000000n, 6), "245");
  assert.equal(amount(1234500000n, 6), "1,234.50");
  assert.equal(amount(1005000n, 6), "1"); // a tie goes to the even cent, as Decimal does
  assert.equal(amount(1015000n, 6), "1.02");
  assert.equal(amount(530000n * 10n ** 18n, 18), "530,000");
});

test("the fee on a payment is 2% of the gross award, as the live record shows", () => {
  assert.equal(feeOn(382439023n), 7804879n); // Feed, October 2026: payoutFeesPaidBase
  assert.equal(feeOn(150256329n), 3066456n); // The Network, October 2026
  assert.equal(feeOn(980000n), 20000n); // the 1 USDC qualification transfer
});

test("a payment with a field that is not what it must be is dropped", () => {
  assert.ok(payment(raw()));
  assert.equal(payment(raw({ netBase: "-5" })), null);
  assert.equal(payment(raw({ netBase: "0" })), null);
  assert.equal(payment(raw({ projectId: "Bad Id" })), null);
  assert.equal(payment(raw({ contributionMonth: "2026-13" })), null);
  assert.equal(payment(raw({ assetDecimals: 99 })), null);
  assert.equal(payment(raw({ indexedAt: "yesterday" })), null);
  assert.equal(payment(raw({ contributionMonth: null })).month, null);
});

test("only a person can be a project owner; an organisation has no owner account", () => {
  assert.equal(ownerId(projects.get("feed")), null);
  assert.equal(ownerId(projects.get("solo")), "777");
  assert.equal(ownerId(undefined), null);
});

test("assets: stablecoins by address, else the project token, else unknown", () => {
  assert.deepEqual(assetOf(null, "solana-mainnet", USDC_SOL), {
    symbol: "USDC",
    stable: true,
  });
  assert.deepEqual(
    assetOf(null, "robinhood-mainnet", USDG.toUpperCase().replace("0X", "0x")),
    { symbol: "USDG", stable: true },
  );
  assert.deepEqual(
    assetOf(
      projects.get("solo"),
      "base-mainnet",
      "0xabc0000000000000000000000000000000000001",
    ),
    { symbol: "SOLO", stable: false },
  );
  assert.equal(assetOf(projects.get("feed"), "base-mainnet", "0xdead"), null);
});

test("a month paid to an outside contributor gets a receipt with every figure", () => {
  const second = raw({
    id: `solana-mainnet:${TX_B}:1`,
    transactionId: TX_B,
    netBase: "49000000",
    indexedAt: "2026-12-04T08:05:00.000Z",
  });
  const mine = raw({ id: "own", netBase: "98000000" });
  const got = receiptsFrom(
    base(
      [raw(), second, mine],
      {
        [raw().id]: { actor: OUTSIDER, login: "alice" },
        [second.id]: { actor: OUTSIDER2, login: "bob" },
        own: { actor: SHAW, login: "lalalune" },
      },
      {
        merges: new Map([
          [
            "feed",
            [
              {
                repository: "feedforagents/feed",
                mergedOutsideLast30Days: 12,
                medianHoursToMerge: 5.26,
              },
            ],
          ],
        ]),
      },
    ),
  );
  assert.equal(got.length, 1);
  const r = got[0];
  assert.equal(r.anchor, "feed-2026-11");
  assert.equal(r.url, "https://slop.cash/receipts#feed-2026-11");
  assert.equal(r.project, "Feed");
  assert.equal(r.asset, "USDC");
  assert.equal(r.networkName, "Solana");
  assert.equal(r.stable, true);
  assert.equal(r.contributors, 2);
  assert.equal(r.total, "294"); // 245 + 49, the team payment left out
  assert.equal(r.fee, "6"); // 5 + 1
  assert.equal(r.feeExact, true);
  assert.deepEqual(
    r.recipients.map((p) => [p.login, p.received]),
    [
      ["alice", "245"],
      ["bob", "49"],
    ],
  );
  assert.equal(
    r.recipients[0].transactions[0].url,
    `https://explorer.solana.com/tx/${TX_A}`,
  );
  assert.deepEqual(r.own, { payments: 1, total: "98" });
  assert.equal(r.privateRecords, false);
  assert.equal(r.reserved, null);
  assert.equal(r.publishedAt, NOW.toISOString());
  assert.deepEqual(r.merges.repositories, [
    { repository: "feedforagents/feed", mergedOutside: 12, medianHours: 5.3 },
  ]);
  assert.doesNotThrow(() => JSON.stringify(got)); // no BigInt reaches the snapshot
});

test("no receipt: team only, owner only, hand award, unknown network", () => {
  assert.deepEqual(
    receiptsFrom(
      base([raw()], { [raw().id]: { actor: SHAW, login: "lalalune" } }),
    ),
    [],
  );
  const solo = raw({
    projectId: "solo",
    network: "base-mainnet",
    assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    transactionId: EVM_TX,
  });
  const input = base([solo], {
    [solo.id]: { actor: "777", login: "solo-owner" },
  });
  input.totals.set(
    "solo|base-mainnet|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    { paid: 245000000n, fees: 5000000n, reserved: 0n },
  );
  assert.deepEqual(receiptsFrom(input), []);
  assert.deepEqual(
    receiptsFrom(
      base([raw({ contributionMonth: null })], {
        [raw().id]: { actor: OUTSIDER, login: "alice" },
      }),
    ),
    [],
  );
  assert.deepEqual(
    receiptsFrom(
      base([raw({ network: "base-sepolia" })], {
        [raw().id]: { actor: OUTSIDER, login: "alice" },
      }),
    ),
    [],
  );
});

test("a new month waits for every bar the loop waits for", () => {
  const who = { [raw().id]: { actor: OUTSIDER, login: "alice" } };
  const other = raw({ id: "other", transactionId: TX_B });
  // a recipient the site has not named
  assert.deepEqual(receiptsFrom(base([raw(), other], who)), []);
  // a transaction this build has not seen final
  const unconfirmed = base([raw()], who);
  unconfirmed.confirmed = new Set();
  assert.deepEqual(receiptsFrom(unconfirmed), []);
  // the project's public totals unread
  const noTotals = base([raw()], who);
  noTotals.totals = new Map();
  assert.deepEqual(receiptsFrom(noTotals), []);
  // the newest payment is under half an hour old
  assert.deepEqual(
    receiptsFrom(base([raw({ indexedAt: "2026-12-04T11:45:00.000Z" })], who)),
    [],
  );
  assert.equal(
    receiptsFrom(base([raw({ indexedAt: "2026-12-04T11:29:00.000Z" })], who))
      .length,
    1,
  );
  // an asset nobody can name
  const odd = base(
    [
      raw({
        network: "base-mainnet",
        assetAddress: "0xdead",
        transactionId: EVM_TX,
      }),
    ],
    who,
  );
  odd.totals.set("feed|base-mainnet|0xdead", {
    paid: 245000000n,
    fees: 5000000n,
    reserved: 0n,
  });
  assert.deepEqual(receiptsFrom(odd), []);
});

test("a published receipt stays, keeps its date and merge figures, and takes late payments", () => {
  const who = { [raw().id]: { actor: OUTSIDER, login: "alice" } };
  const first = receiptsFrom(
    base([raw()], who, {
      merges: new Map([
        [
          "feed",
          [
            {
              repository: "feedforagents/feed",
              mergedOutsideLast30Days: 3,
              medianHoursToMerge: 2,
            },
          ],
        ],
      ]),
    }),
  );
  const late = raw({
    id: "late",
    transactionId: TX_B,
    netBase: "10000000",
    indexedAt: "2026-12-09T09:00:00.000Z",
  });
  const unnamed = raw({
    id: "unnamed",
    transactionId: EVM_TX,
    indexedAt: "2026-12-09T09:59:00.000Z",
  });
  const later = base(
    [raw(), late, unnamed],
    { ...who, late: { actor: OUTSIDER2, login: "bob" } },
    {
      previous: first,
      now: new Date("2026-12-09T10:00:00Z"),
      merges: new Map(),
    },
  );
  later.confirmed = new Set([
    `solana-mainnet:${TX_A}`,
    `solana-mainnet:${TX_B}`,
  ]);
  const again = receiptsFrom(later);
  assert.equal(again.length, 1);
  assert.equal(again[0].contributors, 2);
  assert.equal(again[0].total, "255");
  assert.equal(again[0].publishedAt, first[0].publishedAt);
  assert.deepEqual(again[0].merges, first[0].merges);
  assert.equal(again[0].anchor, "feed-2026-11");
  // a late payment not yet final on chain is not counted yet
  later.confirmed = new Set([`solana-mainnet:${TX_A}`]);
  assert.equal(receiptsFrom(later)[0].total, "245");
});

test("private recipients and reserved awards are said, and make the fee an estimate", () => {
  const input = base([raw()], {
    [raw().id]: { actor: OUTSIDER, login: "alice" },
  });
  input.totals.set(`feed|solana-mainnet|${USDC_SOL}`, {
    paid: 300000000n,
    fees: 6122449n,
    reserved: 107560976n,
  });
  const r = receiptsFrom(input)[0];
  assert.equal(r.privateRecords, true);
  assert.equal(r.feeExact, false);
  assert.equal(r.reserved, "107.56");
});

test("two assets in one project month get two receipts with two anchors", () => {
  const g = raw({
    id: "g",
    network: "robinhood-mainnet",
    assetAddress: USDG,
    transactionId: EVM_TX,
    indexedAt: "2026-12-04T09:00:00.000Z",
  });
  const input = base([raw(), g], {
    [raw().id]: { actor: OUTSIDER, login: "alice" },
    g: { actor: OUTSIDER, login: "alice" },
  });
  input.totals.set(`feed|robinhood-mainnet|${USDG}`, {
    paid: 245000000n,
    fees: 5000000n,
    reserved: 0n,
  });
  assert.deepEqual(
    receiptsFrom(input).map((r) => r.anchor),
    ["feed-2026-11", "feed-2026-11-robinhood-mainnet"],
  );
});

test("walk follows pages under the first boundary and fails closed", async () => {
  const pages = {
    "": { payments: [{ id: "a" }], through: 9, next: 3 },
    "?after=3&through=9": { payments: [{ id: "b" }], through: 9, next: null },
  };
  assert.deepEqual(await walk(async (u) => pages[u.slice(1)], "u"), [
    { id: "a" },
    { id: "b" },
  ]);
  assert.equal(await walk(async () => ({ payments: "no" }), "u"), null);
  assert.equal(
    await walk(async () => {
      throw new Error("down");
    }, "u"),
    null,
  );
});

test("chainFinal: only a successful, final transaction on a known network", async () => {
  const sol = (status) => async () => ({ value: [status] });
  assert.equal(
    await chainFinal(
      sol({ err: null, confirmationStatus: "finalized" }),
      "solana-mainnet",
      TX_A,
    ),
    true,
  );
  assert.equal(
    await chainFinal(
      sol({ err: null, confirmationStatus: "confirmed" }),
      "solana-mainnet",
      TX_A,
    ),
    false,
  );
  assert.equal(
    await chainFinal(
      sol({ err: { x: 1 }, confirmationStatus: "finalized" }),
      "solana-mainnet",
      TX_A,
    ),
    false,
  );
  assert.equal(await chainFinal(sol(null), "solana-mainnet", TX_A), false);
  const evm = (status, block, final) => async (_u, m) =>
    m === "eth_getTransactionReceipt"
      ? { status, blockNumber: block }
      : { number: final };
  assert.equal(
    await chainFinal(evm("0x1", "0x10", "0x10"), "base-mainnet", EVM_TX),
    true,
  );
  assert.equal(
    await chainFinal(evm("0x1", "0x11", "0x10"), "base-mainnet", EVM_TX),
    false,
  );
  assert.equal(
    await chainFinal(evm("0x0", "0x10", "0x10"), "base-mainnet", EVM_TX),
    false,
  );
  assert.equal(
    await chainFinal(evm("0x1", "0x10", "0x10"), "base-mainnet", "not-a-hash"),
    false,
  );
  assert.equal(
    await chainFinal(evm("0x1", "0x10", "0x10"), "unknown-net", EVM_TX),
    false,
  );
  assert.equal(
    await chainFinal(
      async () => {
        throw new Error("rpc down");
      },
      "base-mainnet",
      EVM_TX,
    ),
    false,
  );
});

// A stand-in for the site: the three live payments of 17 Nov 2026 (all to a team account)
// plus, when asked, one outside recipient.
function site({ outside = false } = {}) {
  const pays = [
    raw({
      id: "hand",
      projectId: "slopdotcash",
      network: "base-mainnet",
      contributionMonth: null,
      assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      netBase: "980000",
      transactionId: EVM_TX,
      indexedAt: "2026-10-27T09:46:01.080Z",
    }),
    raw({
      id: "feed-oct",
      contributionMonth: "2026-10",
      netBase: "382439023",
      indexedAt: "2026-11-16T08:10:16.913Z",
    }),
  ];
  const mine = [pays[0], pays[1]];
  const theirs = [];
  if (outside) {
    const p = raw({
      id: "feed-oct-out",
      contributionMonth: "2026-10",
      netBase: "107560976",
      transactionId: TX_B,
      indexedAt: "2026-11-20T08:00:00.000Z",
    });
    pays.push(p);
    theirs.push(p);
  }
  const net = pays
    .filter((p) => p.projectId === "feed")
    .reduce((s, p) => s + BigInt(p.netBase), 0n);
  const fees = pays
    .filter((p) => p.projectId === "feed")
    .reduce((s, p) => s + feeOn(BigInt(p.netBase)), 0n);
  const routes = {
    "https://slop.cash/api/v1/payments/vault-payments": {
      payments: pays,
      through: 9,
      next: null,
    },
    "https://slop.cash/api/v1/projects": { projects: [...projects.values()] },
    "https://slop.cash/api/v1/payments/received": {
      contributors: [
        { githubUserId: SHAW, login: "lalalune", vaultPayments: mine.length },
        {
          githubUserId: OUTSIDER,
          login: "symbaiex",
          vaultPayments: theirs.length,
        },
      ],
    },
    [`https://slop.cash/api/v1/payments/actors/${SHAW}/vault-payments`]: {
      payments: mine,
      through: 9,
      next: null,
    },
    [`https://slop.cash/api/v1/payments/actors/${OUTSIDER}/vault-payments`]: {
      payments: theirs,
      through: 9,
      next: null,
    },
    "https://slop.cash/api/v1/payments/projects/feed/totals": {
      assets: [
        {
          network: "solana-mainnet",
          assetAddress: USDC_SOL,
          totalNetPaidBase: String(net),
          payoutFeesPaidBase: String(fees),
          reservedNetBase: "0",
        },
      ],
    },
    "https://slop.cash/api/v1/merge-activity": {
      schema: "slop-merge-activity-v1",
      projects: [
        {
          projectId: "feed",
          repositories: [
            {
              repository: "feedforagents/feed",
              mergedOutsideLast30Days: 4,
              medianHoursToMerge: 30,
            },
          ],
        },
      ],
    },
  };
  const calls = [];
  const fetchJson = async (u) => {
    calls.push(u);
    if (!(u in routes)) throw new Error(`404 ${u}`);
    return routes[u];
  };
  return { fetchJson, calls };
}
const finalRpc = async () => ({
  value: [{ err: null, confirmationStatus: "finalized" }],
});

test("today: payments went to a team account only, so there is no receipt and no chain call", async () => {
  const { fetchJson, calls } = site();
  let rpcCalls = 0;
  const got = await loadReceipts(
    fetchJson,
    async () => {
      rpcCalls++;
      return null;
    },
    { now: NOW },
  );
  assert.deepEqual(got.items, []);
  assert.equal(rpcCalls, 0);
  assert.ok(!calls.some((u) => u.endsWith("/totals")));
});

test("the first outside recipient publishes the month, and the next build keeps it", async () => {
  const { fetchJson } = site({ outside: true });
  const got = await loadReceipts(fetchJson, finalRpc, { now: NOW });
  assert.equal(got.items.length, 1);
  const r = got.items[0];
  assert.equal(r.anchor, "feed-2026-10");
  assert.deepEqual(
    r.recipients.map((p) => [p.login, p.received]),
    [["symbaiex", "107.56"]],
  );
  assert.equal(r.total, "107.56");
  assert.equal(r.fee, "2.20");
  assert.equal(r.feeExact, true);
  assert.deepEqual(r.own, { payments: 1, total: "382.44" });
  // every named payment of a counted month is checked on chain, the team's included, as in the loop
  assert.deepEqual(got.confirmed, [
    `solana-mainnet:${TX_B}`,
    `solana-mainnet:${TX_A}`,
  ]);
  // next build: the chain is down, but the transaction was already confirmed
  const again = await loadReceipts(
    fetchJson,
    async () => {
      throw new Error("rpc down");
    },
    { previous: got, now: new Date("2026-12-05T00:00:00Z") },
  );
  assert.equal(again.items.length, 1);
  assert.equal(again.items[0].publishedAt, r.publishedAt);
});

test("an unconfirmed transaction publishes nothing; an unreadable record throws", async () => {
  const { fetchJson } = site({ outside: true });
  assert.deepEqual(
    (
      await loadReceipts(fetchJson, async () => ({ value: [null] }), {
        now: NOW,
      })
    ).items,
    [],
  );
  await assert.rejects(
    loadReceipts(
      async () => {
        throw new Error("down");
      },
      finalRpc,
      { now: NOW },
    ),
    /unreadable/,
  );
});

test("the receipts page and the rule file keep to the wording rules", () => {
  for (const f of [
    "../../src/ReceiptsPage.tsx",
    "./receipts.mjs",
    "../../src/RecordPage.tsx",
  ]) {
    const text = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/[\u2014\u2013]/.test(text), `${f} has a long dash`);
    assert.ok(
      !/\b(earn(ed|s|ing)?|owed|guarantee[ds]?)\b/i.test(text),
      `${f} uses a barred word`,
    );
  }
  const page = readFileSync(
    new URL("../../src/ReceiptsPage.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    page.includes(
      "The first receipt appears here when a project pays an outside contributor.",
    ),
  );
  assert.equal(groupKey("a", "b", "c", "d"), "a|b|c|d");
});
