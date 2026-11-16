import { expect, test } from "bun:test";
import { handlePaymentsApi } from "../backend/payments/handler";
import type { CycleIndex } from "../src/lib/cycle-index";
import type { PublicVaultPayment } from "../src/lib/payments/contracts";
import { payoutPointAwards } from "../src/lib/payout-points";
import { appendPointAwards, emptyPointsJournal } from "../src/lib/points";
import { sqliteD1 } from "../tests/sqlite-d1";
import { loadVaultPayouts } from "./vault-payout-points";

const actor = { id: "MDQ6VXNlcjEyMw==", login: "contributor" };
const indexedAt = "2026-11-16T08:01:00.000Z";
const emptyCycles: CycleIndex = {
  schemaVersion: "1",
  generatedAt: indexedAt,
  cycles: [],
};
const payment: PublicVaultPayment = {
  id: "base-mainnet:payment:0",
  projectId: "asi",
  network: "base-mainnet",
  chain: "base",
  assetAddress: `0x${"d".repeat(40)}`,
  assetDecimals: 6,
  netBase: "9800",
  contributionMonth: "2026-10",
  transactionId: `0x${"b".repeat(64)}`,
  indexedAt,
};

test("a finalized ordinary D1 month earns recognition without a Git-backed cycle", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    const source = "a".repeat(64),
      transaction = `0x${"b".repeat(64)}`,
      vault = `0x${"c".repeat(40)}`,
      asset = `0x${"d".repeat(40)}`;
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES('award','asi','123','base-mainnet','base',?,?,6,'10000','200',?,'reserved',?,?)",
      )
      .run(vault, asset, source, indexedAt, transaction);
    const evidence = {
      kind: "paid",
      transactionId: transaction,
      eventIndex: 0,
      obligationId: "award",
      projectId: "asi",
      network: "base-mainnet",
      chain: "base",
      vault,
      githubUserId: "123",
      sourceDigest: source,
      grossMicro: "10000",
      feeMicro: "200",
      netMicro: "9800",
      assetAddress: asset,
      assetDecimals: 6,
    };
    sqlite
      .query(
        "INSERT INTO payment_events VALUES('base-mainnet',?,0,'block','paid','award',?,?)",
      )
      .run(transaction, JSON.stringify(evidence), indexedAt);
    const read = () =>
      handlePaymentsApi(
        new Request(
          "https://slop.cash/api/v1/payments/actors/123/vault-payments",
        ),
        { db, tier: "production" },
      );
    // An event without the canonical paid obligation is still unreconciled.
    expect((await (await read()).json()).payments).toEqual([]);
    sqlite.query("UPDATE payment_obligations SET state='paid'").run();
    const unproven = await (await read()).json();
    expect(unproven.payments[0].contributionMonth).toBeNull();
    expect(
      payoutPointAwards(emptyCycles, [{ actor, payments: unproven.payments }]),
    ).toEqual([]);
    sqlite
      .query(
        "INSERT INTO monthly_reward_bases VALUES('asi','2026-10','{}',?,?, '10000',1,?)",
      )
      .run("e".repeat(64), "f".repeat(64), indexedAt);
    sqlite
      .query(
        "INSERT INTO monthly_payment_runs VALUES('asi','2026-10','owner','123',0,'{}',?,'base-mainnet',?,'10000',?,?)",
      )
      .run("1".repeat(64), vault, indexedAt, indexedAt);
    sqlite
      .query(
        "INSERT INTO monthly_payment_obligations VALUES('asi','2026-10','123','contributor','10000','200',?,'base-mainnet',?,?)",
      )
      .run(source, vault, indexedAt);
    const response = await handlePaymentsApi(
      new Request(
        "https://slop.cash/api/v1/payments/actors/123/vault-payments",
      ),
      { db, tier: "production" },
    );
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.payments).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("githubUserId");
    const awards = payoutPointAwards(emptyCycles, [
      { actor, payments: page.payments },
    ]);
    expect(awards).toHaveLength(1);
    expect(awards[0]).toMatchObject({
      actor,
      projectId: "asi",
      category: "payout-received",
      amount: 25,
      occurredAt: indexedAt,
      sourceId: `payout:2026-10:${actor.id}`,
      provisional: false,
    });
    const journal = appendPointAwards(
      emptyPointsJournal(indexedAt),
      awards,
      "2".repeat(64),
      "verified-payout-v1",
      indexedAt,
    );
    const repeated = payoutPointAwards(
      emptyCycles,
      [{ actor, payments: page.payments }],
      journal.revisions.map((revision) => revision.award),
    );
    expect(
      appendPointAwards(
        journal,
        repeated,
        "3".repeat(64),
        "verified-payout-v1",
        indexedAt,
      ),
    ).toEqual(journal);
    // Private/closed membership never becomes new recognition.
    for (const closed of [null, indexedAt]) {
      sqlite
        .query(
          "INSERT OR REPLACE INTO points_members(actor_id,github_id,login,joined_at,public,closed_at) VALUES(?, '123','contributor',?,0,?)",
        )
        .run(actor.id, indexedAt, closed);
      const hidden = await handlePaymentsApi(
        new Request(
          "https://slop.cash/api/v1/payments/actors/123/vault-payments",
        ),
        { db, tier: "production" },
      );
      expect((await hidden.json()).payments).toEqual([]);
    }
  } finally {
    sqlite.close();
  }
});

test("recognition is once per immutable recipient/project/month across transfers, networks and node-ID forms", () => {
  const currentActor = { ...actor, id: "U_kgDOAAAAew", login: "renamed" };
  const awards = payoutPointAwards(emptyCycles, [
    {
      actor,
      payments: [
        payment,
        {
          ...payment,
          id: "second",
          network: "robinhood-mainnet",
          chain: "robinhood",
          netBase: "999999999999",
        },
      ],
    },
    {
      actor: currentActor,
      payments: [
        payment,
        { ...payment, id: "other-month", contributionMonth: "2026-09" },
        { ...payment, id: "other-project", projectId: "eliza" },
      ],
    },
  ]);
  expect(
    awards.map((a) => [a.projectId, a.sourceId.split(":")[1], a.amount]),
  ).toEqual([
    ["asi", "2026-10", 25],
    ["asi", "2026-09", 25],
    ["eliza", "2026-10", 25],
  ]);
  const old = { ...awards[0], occurredAt: "2026-11-01T00:00:00.000Z" };
  for (const amount of [25, 0]) {
    const prior = { ...old, amount };
    expect(
      payoutPointAwards(
        emptyCycles,
        [{ actor: currentActor, payments: [payment] }],
        [prior],
      ),
    ).toEqual([]);
    expect(prior).toEqual({ ...old, amount });
  }
});

test("testnet, zero and unproven-month payments do not earn recognition; invalid evidence refuses", () => {
  expect(
    payoutPointAwards(emptyCycles, [
      {
        actor,
        payments: [
          { ...payment, network: "base-sepolia" },
          { ...payment, netBase: "0" },
          { ...payment, contributionMonth: null },
        ],
      },
    ]),
  ).toEqual([]);
  expect(() =>
    payoutPointAwards(emptyCycles, [
      { actor, payments: [{ ...payment, netBase: "-1" }] },
    ]),
  ).toThrow("Invalid public payout evidence");
  expect(() =>
    payoutPointAwards(emptyCycles, [
      { actor: { ...actor, id: "unverified" }, payments: [payment] },
    ]),
  ).toThrow("Payout actor identity");
});

test("the reader uses only known immutable actor IDs and consumes every frozen page", async () => {
  const urls: string[] = [];
  const request = async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const second = new URL(url).searchParams.has("after");
    return Response.json({
      payments: second
        ? [{ ...payment, id: "101" }]
        : Array.from({ length: 100 }, (_, i) => ({
            ...payment,
            id: String(i + 1),
          })),
      through: 101,
      total: 101,
      next: second ? null : 100,
    });
  };
  const rows = await loadVaultPayouts(
    [
      actor,
      { ...actor, id: "U_kgDOAAAAew" },
      { id: "BOT_not-a-user", login: "bot" },
    ],
    "https://slop.cash",
    request,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].payments).toHaveLength(101);
  expect(urls).toEqual([
    "https://slop.cash/api/v1/payments/actors/123/vault-payments",
    "https://slop.cash/api/v1/payments/actors/123/vault-payments?after=100&through=101",
  ]);
});

test("missing, duplicate, moving or unavailable payment history cannot silently grant or erase recognition", async () => {
  for (const fault of [
    "missing",
    "duplicate",
    "moving",
    "unavailable",
    "malformed",
  ]) {
    let calls = 0;
    const request = async () => {
      calls++;
      if (fault === "unavailable")
        return new Response("Unavailable", { status: 503 });
      if (fault === "malformed")
        return Response.json({
          payments: [{ ...payment, netBase: "-1" }],
          through: 1,
          total: 1,
          next: null,
        });
      const second = calls === 2;
      return Response.json({
        payments: [
          {
            ...payment,
            id: second && fault !== "duplicate" ? "second" : "first",
          },
        ],
        through: second && fault === "moving" ? 3 : 2,
        total: 2,
        next: second || fault === "missing" ? null : 1,
      });
    };
    await expect(
      loadVaultPayouts([actor], "https://slop.cash", request),
    ).rejects.toThrow();
  }
});
