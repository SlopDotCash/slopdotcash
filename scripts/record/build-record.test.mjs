// spec/frontend/recordPages.md, "The record stage never fails a release"
//
// The record rebuild, checked with a stub network: without the switch it
// writes nothing and reads nothing, a failed build writes the previous
// record unchanged, a build past its deadline keeps the previous record, a
// published receipt stays and every receipt links to this site, and only a
// record with the fields the pages read is carried forward. A fresh builder
// writes the new record, and its new receipt is followed by the previous
// receipts, relinked to this site.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describe,
  isRecord,
  keepPublished,
  PREVIOUS_RECORDS,
  RECORD_FILE,
  runRecordBuild,
} from "./build-record.mjs";
import { PAY_API, PROJECTS_URL } from "./receipts.mjs";

const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const previous = {
  builtAt: "2026-11-23T08:12:00.000Z",
  sources: {
    projects: ["feed"],
    disclosures: [],
    cycles: [],
  },
  money: { pools: [], settlements: [] },
  months: [],
  projects: [],
  receipts: {
    builtAt: "2026-11-23T08:12:00.000Z",
    items: [{ anchor: "feed-2026-10", url: "https://old.example/#feed-2026-10" }],
    confirmed: [],
  },
};

const json = (value, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
});
const fetchFrom = (answers, other = () => { throw new Error("offline"); }) => {
  const seen = [];
  const impl = async (url) => {
    seen.push(String(url));
    if (answers.has(String(url))) return answers.get(String(url))();
    return other(url);
  };
  return { impl, seen };
};
const withRoot = async (run) => {
  const root = await mkdtemp(join(tmpdir(), "record-build-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};
const recordAt = async (root) => JSON.parse(await readFile(join(root, RECORD_FILE), "utf8"));
const exists = async (root) => {
  try {
    await readFile(join(root, RECORD_FILE), "utf8");
    return true;
  } catch {
    return false;
  }
};

test("without the switch the build writes nothing and reads nothing", async () => {
  await withRoot(async (root) => {
    const { impl, seen } = fetchFrom(new Map());
    const result = await runRecordBuild({ root, env: {}, fetchImpl: impl });
    assert.deepEqual(result, { outcome: "skipped", reason: "SLOP_RECORD_BUILD is not 1" });
    assert.deepEqual(seen, []);
    assert.equal(await exists(root), false);
  });
});

test("a failed build writes the previous record unchanged", async () => {
  await withRoot(async (root) => {
    const { impl } = fetchFrom(new Map([[PREVIOUS_RECORDS[0], () => json(previous)]]));
    const result = await runRecordBuild({ root, env: { SLOP_RECORD_BUILD: "1" }, fetchImpl: impl });
    assert.equal(result.outcome, "previous");
    assert.deepEqual(await recordAt(root), previous);
  });
});

test("with no previous record a failed build writes nothing", async () => {
  await withRoot(async (root) => {
    const { impl } = fetchFrom(new Map());
    const result = await runRecordBuild({ root, env: { SLOP_RECORD_BUILD: "1" }, fetchImpl: impl });
    assert.equal(result.outcome, "none");
    assert.equal(await exists(root), false);
  });
});

test("a build past its deadline writes the previous record", async () => {
  await withRoot(async (root) => {
    const { impl } = fetchFrom(new Map([[PREVIOUS_RECORDS[0], () => json(previous)]]));
    const result = await runRecordBuild({
      root,
      env: { SLOP_RECORD_BUILD: "1" },
      fetchImpl: impl,
      deadlineMs: 50,
      buildFresh: () => new Promise(() => {}),
    });
    assert.equal(result.outcome, "previous");
    assert.match(result.reason, /deadline/);
    assert.deepEqual(await recordAt(root), previous);
  });
});

test("the retired site's snapshot is the previous record when this site has none", async () => {
  await withRoot(async (root) => {
    const { impl } = fetchFrom(new Map([
      [PREVIOUS_RECORDS[0], () => json({ error: "not found" }, 404)],
      [PREVIOUS_RECORDS[1], () => json(previous)],
    ]));
    const result = await runRecordBuild({ root, env: { SLOP_RECORD_BUILD: "1" }, fetchImpl: impl });
    assert.equal(result.outcome, "previous");
    assert.deepEqual(await recordAt(root), previous);
  });
});

test("a published receipt stays, and every receipt links to this site", () => {
  assert.deepEqual(
    keepPublished(
      [
        { anchor: "feed-2026-10", url: "https://old.example/#feed-2026-10" },
        { anchor: "gone-2026-10", url: "https://old.example/#gone-2026-10" },
      ],
      [{ anchor: "feed-2026-10", total: "107.56", url: "x" }],
      "https://slop.cash/receipts",
    ),
    [
      { anchor: "feed-2026-10", total: "107.56", url: "https://slop.cash/receipts#feed-2026-10" },
      { anchor: "gone-2026-10", url: "https://slop.cash/receipts#gone-2026-10" },
    ],
  );
});

test("only a record with the fields the pages read is carried forward", () => {
  assert.equal(isRecord(previous), true);
  assert.equal(isRecord({ builtAt: "x" }), false);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([]), false);
});

test("a fresh builder writes the new record with its new receipt", async () => {
  const payment = {
    id: `solana-mainnet:${"A".repeat(88)}:1`,
    projectId: "feed",
    network: "solana-mainnet",
    contributionMonth: "2026-11",
    assetAddress: USDC_SOL,
    assetDecimals: 6,
    netBase: "245000000",
    transactionId: "A".repeat(88),
    indexedAt: "2026-12-04T08:00:00.000Z",
  };
  const fresh = {
    ...previous,
    builtAt: "2026-11-26T00:00:00.000Z",
    months: [{ month: "2026-11", counts: { merged: 1 } }],
  };
  await withRoot(async (root) => {
    const answers = new Map([
      [PREVIOUS_RECORDS[0], () => json(previous)],
      [PROJECTS_URL, () => json({ projects: [{ id: "feed", name: "Feed", steward: { github: { type: "Organization", actorId: "246782978" } } }] })],
      [PAY_API, () => json({ payments: [payment], through: 1, next: null })],
      [`${PAY_API}/received`, () => json({ contributors: [{ githubUserId: "555001", login: "alice", vaultPayments: 1 }] })],
      [`${PAY_API}/actors/555001/vault-payments`, () => json({ payments: [{ id: payment.id }], through: 1, next: null })],
      [`${PAY_API}/projects/feed/totals`, () => json({ assets: [{ network: "solana-mainnet", assetAddress: USDC_SOL, totalNetPaidBase: "245000000", payoutFeesPaidBase: "5000000", reservedNetBase: "0" }] })],
    ]);
    const { impl } = fetchFrom(answers);
    const fetchImpl = async (url, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body);
        if (body.method === "getSignatureStatuses") {
          return json({ result: { value: [{ err: null, confirmationStatus: "finalized" }] } });
        }
        throw new Error(`unexpected rpc ${body.method}`);
      }
      return impl(url, init);
    };
    const result = await runRecordBuild({
      root,
      env: { SLOP_RECORD_BUILD: "1" },
      fetchImpl,
      now: new Date("2026-12-04T12:00:00Z"),
      buildFresh: async () => ({ ...fresh }),
    });
    assert.equal(result.outcome, "built");
    assert.equal(
      describe({ outcome: "built", builtAt: "2026-11-26T00:00:00.000Z", receipts: 2, leaderboard: "live" }),
      "record: built 2026-11-26T00:00:00.000Z, 2 receipts, live leaderboard",
    );
    const written = await recordAt(root);
    assert.equal(written.builtAt, "2026-11-26T00:00:00.000Z");
    assert.deepEqual(
      written.receipts.items.map((item) => item.anchor),
      ["feed-2026-11", "feed-2026-10"],
    );
    assert.equal(written.receipts.items[0].total, "245");
    assert.equal(written.receipts.items[1].url, "https://slop.cash/receipts#feed-2026-10");
  });
});
