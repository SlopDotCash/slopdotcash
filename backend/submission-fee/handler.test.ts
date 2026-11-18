// The two public reads of the submission fee, against the real migrations.
import { expect, test } from "bun:test";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_TOKENS,
  submissionFeeItem,
} from "../../src/lib/submission-fee.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handleSubmissionFeeApi } from "./handler";

// Slopbot's table (migration 0141), from the shared interface.
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
const NOW = "2026-12-05T12:00:00.000Z";

function harness(items = true) {
  const { db, sqlite } = sqliteD1();
  if (items) sqlite.exec(ITEMS);
  const get = async (path: string, method = "GET") => {
    const response = await handleSubmissionFeeApi(
      new Request(`https://slop.cash${path}`, { method }),
      { db: db as never, now: () => new Date(NOW) },
    );
    return response
      ? {
          status: response.status,
          cache: response.headers.get("cache-control"),
          body: method === "HEAD" ? null : await response.json(),
        }
      : null;
  };
  const rate = (effectiveAt: string, slopPerUsd: string) =>
    sqlite
      .query("INSERT INTO submission_fee_rates VALUES (?, ?, 'test', ?)")
      .run(effectiveAt, slopPerUsd, effectiveAt);
  return { sqlite, get, rate };
}

test("other paths are not this handler's", async () => {
  const { get } = harness();
  expect(await get("/api/v1/submission-fees/rate")).toBe(null);
  expect(await get("/api/v1/merge-activity")).toBe(null);
});

test("the rate is null until one is in force, then names it and its start", async () => {
  const { get, rate } = harness();
  expect(await get("/api/v1/submission-fee/rate")).toEqual({
    status: 200,
    cache: "public, max-age=60",
    body: {
      schema: "slop-submission-fee-rate-v1",
      slopShareBps: 5000,
      rate: null,
      previous: null,
    },
  });
  // A rate that takes effect at the next hour is not in force yet.
  rate("2026-12-05T13:00:00.000Z", "90");
  expect((await get("/api/v1/submission-fee/rate"))?.body.rate).toBe(null);
  rate("2026-11-20T00:00:00.000Z", "75");
  expect((await get("/api/v1/submission-fee/rate/"))?.body).toMatchObject({
    rate: { effectiveAt: "2026-11-20T00:00:00.000Z", slopPerUsd: "75" },
    previous: null,
  });
});

test("the previous rate is shown only during its 48 hours", async () => {
  const { get, rate } = harness();
  rate("2026-11-20T00:00:00.000Z", "75");
  rate("2026-12-04T00:00:00.000Z", "100");
  expect((await get("/api/v1/submission-fee/rate"))?.body).toMatchObject({
    rate: { effectiveAt: "2026-12-04T00:00:00.000Z", slopPerUsd: "100" },
    previous: {
      effectiveAt: "2026-11-20T00:00:00.000Z",
      slopPerUsd: "75",
      acceptedUntil: "2026-12-06T00:00:00.000Z",
    },
  });
  rate("2026-12-03T11:00:00.000Z", "80");
  rate("2026-12-03T12:00:00.000Z", "85");
  // The newest is still the 4 December one; its predecessor is now the 85.
  expect(
    (await get("/api/v1/submission-fee/rate"))?.body.previous.slopPerUsd,
  ).toBe("85");
});

test("an unpaid pull request lists each way to pay what was asked", async () => {
  const { sqlite, get, rate } = harness();
  rate("2026-11-20T00:00:00.000Z", "75");
  sqlite.exec(
    `INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at)
     VALUES (4242, 7, 'acme', '${submissionFeeItem(4242, 7)}', '3000000', '2026-12-05T10:00:00.000Z')`,
  );
  const response = await get("/api/v1/submission-fee/items/4242/7");
  expect(response?.status).toBe(200);
  expect(response?.body).toEqual({
    schema: "slop-submission-fee-item-v1",
    repositoryId: 4242,
    pullNumber: 7,
    projectId: "acme",
    item: submissionFeeItem(4242, 7),
    stableMinor: "3000000",
    askedAt: "2026-12-05T10:00:00.000Z",
    due: [
      {
        network: "base-mainnet",
        chainId: 8453,
        contract: null,
        token: SUBMISSION_FEE_TOKENS["base-mainnet"].usdc,
        symbol: "USDC",
        decimals: 6,
        amount: "3000000",
        minimumAccepted: "3000000",
        keptTo: SUBMISSION_FEE_KEPT_TO["base-mainnet"],
      },
      {
        network: "robinhood-mainnet",
        chainId: 4663,
        contract: null,
        token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].usdg,
        symbol: "USDG",
        decimals: 6,
        amount: "3000000",
        minimumAccepted: "3000000",
        keptTo: SUBMISSION_FEE_KEPT_TO["robinhood-mainnet"],
      },
      {
        network: "robinhood-mainnet",
        chainId: 4663,
        contract: null,
        token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop,
        symbol: "SLOP",
        decimals: 18,
        // 1.50 at 75 SLOP a dollar: 112.5, which becomes 110.
        amount: "110000000000000000000",
        minimumAccepted: "110000000000000000000",
        keptTo: SUBMISSION_FEE_BURN,
      },
    ],
    paid: null,
    outcome: null,
    outcomeAt: null,
    resolveTransaction: null,
  });
});

test("a paid pull request shows its deposit and outcome, and nothing more is due", async () => {
  const { sqlite, get } = harness();
  sqlite.exec(
    `INSERT INTO submission_fee_items VALUES (4242, 7, 'acme', '${submissionFeeItem(4242, 7)}', '2000000',
       '2026-12-01T10:00:00.000Z', '2026-12-01T11:00:00.000Z', 'base-mainnet', 3, 'refunded', '2026-12-04T00:00:00.000Z');
     INSERT INTO submission_fee_deposits (network, deposit_id, item, payer, token, amount, kept_to, tx_hash,
       block_number, block_time, finalized_at, accepted, state, resolve_tx, resolved_at)
     VALUES ('base-mainnet', 3, '${submissionFeeItem(4242, 7)}', '0xpayer', '0xusdc', '2000000', '0xfee', '0xdeposit',
       10, '2026-12-01T10:59:00.000Z', '2026-12-01T11:20:00.000Z', 1, 'refunded', '0xresolve', '2026-12-04T00:00:00.000Z')`,
  );
  expect(
    (await get("/api/v1/submission-fee/items/4242/7"))?.body,
  ).toMatchObject({
    due: [],
    paid: {
      at: "2026-12-01T11:00:00.000Z",
      network: "base-mainnet",
      depositId: 3,
      token: "0xusdc",
      amount: "2000000",
      transaction: "0xdeposit",
      finalized: true,
    },
    outcome: "refunded",
    outcomeAt: "2026-12-04T00:00:00.000Z",
    resolveTransaction: "0xresolve",
  });
});

test("a pull request no fee was asked for, a malformed path and a write are refused", async () => {
  const { get } = harness();
  for (const path of [
    "/api/v1/submission-fee/items/4242/8",
    "/api/v1/submission-fee/items/4242",
    "/api/v1/submission-fee/items/0/7",
    "/api/v1/submission-fee/items/4242/7x",
    "/api/v1/submission-fee/items/4242/7/extra",
    "/api/v1/submission-fee/items/4242/-7",
    "/api/v1/submission-fee",
    "/api/v1/submission-fee/deposits",
  ])
    expect(await get(path)).toMatchObject({
      status: 404,
      body: { error: "not_found" },
    });
  expect(await get("/api/v1/submission-fee/rate", "POST")).toMatchObject({
    status: 405,
  });
  expect((await get("/api/v1/submission-fee/rate", "HEAD"))?.status).toBe(200);
});

test("before Slopbot's table exists every item is unknown and the rate still answers", async () => {
  const { sqlite, get } = harness(false);
  const present = sqlite
    .query("SELECT 1 FROM sqlite_master WHERE name = 'submission_fee_items'")
    .get();
  // Once migration 0141 is in the repository this case no longer applies.
  if (present) return;
  expect((await get("/api/v1/submission-fee/items/4242/7"))?.status).toBe(404);
  expect((await get("/api/v1/submission-fee/rate"))?.status).toBe(200);
});
