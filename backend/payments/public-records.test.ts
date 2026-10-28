import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { handlePaymentsApi } from "./handler";

const when = "2026-12-05T12:00:00.000Z";
const asset = `0x${"2".repeat(40)}`;
const vault = `0x${"3".repeat(40)}`;

function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  function payment(
    n: number,
    {
      state = "paid",
      actor = "123",
      privateBounty = false,
      corrupt = false,
      pad = 0,
    } = {},
  ) {
    const id = `award-${n}`;
    const digest = n.toString(16).padStart(64, "0");
    const transaction = `0x${digest}`;
    const prefix = privateBounty ? "security_" : "";
    sqlite
      .query(`INSERT INTO ${prefix}payment_obligations
      (id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,
       gross_base,fee_base,source_digest,state,created_at,paid_transaction)
      VALUES(?,'project',?,'base-mainnet','base',?,?,6,'10000','200',?,?,?,?)`)
      .run(
        id,
        actor,
        vault,
        asset,
        digest,
        state,
        when,
        state === "paid" ? transaction : null,
      );
    const evidence = {
      kind: state === "paid" ? "paid" : "reserved",
      transactionId: transaction,
      eventIndex: 0,
      obligationId: id,
      projectId: "project",
      network: "base-mainnet",
      chain: "base",
      vault,
      githubUserId: actor,
      sourceDigest: digest,
      grossMicro: "10000",
      feeMicro: "200",
      netMicro: corrupt ? "9700" : "9800",
      assetAddress: asset,
      assetDecimals: 6,
      ...(pad ? { padding: "x".repeat(pad) } : {}),
    };
    sqlite
      .query(
        `INSERT INTO ${prefix}payment_events VALUES(?,?,0,'finalized-block',?,?,?,?)`,
      )
      .run(
        "base-mainnet",
        transaction,
        evidence.kind,
        id,
        JSON.stringify(evidence),
        when,
      );
    return { id, digest, transaction };
  }
  async function read(path = "vault-payments") {
    const response = await handlePaymentsApi(
      new Request(`https://slop.cash/api/v1/payments/${path}`),
      { db: database },
    );
    return { status: response.status, body: await response.json() };
  }
  return { sqlite, database, payment, read };
}

test("public vault payments retain the recorded work month and net asset amount without exposing private or unpaid records", async () => {
  const f = fixture();
  try {
    const paid = f.payment(1);
    f.payment(2, { state: "reserved" });
    f.payment(3, { privateBounty: true });
    f.sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public,closed_at) VALUES('closed','999','closed',?,0,?)",
      )
      .run(when, when);
    f.payment(4, { actor: "999" });
    f.sqlite
      .query(
        "INSERT INTO monthly_reward_bases VALUES('project','2026-11','{}',?,?, '10000',1,?)",
      )
      .run("a".repeat(64), "b".repeat(64), when);
    f.sqlite
      .query(
        "INSERT INTO monthly_payment_runs VALUES('project','2026-11','automatic',NULL,0,'{}',?,'base-mainnet',?,'10000',?,?)",
      )
      .run("c".repeat(64), vault, when, when);
    f.sqlite
      .query(
        "INSERT INTO monthly_payment_obligations VALUES('project','2026-11','123','contributor','10000','200',?,'base-mainnet',?,?)",
      )
      .run(paid.digest, vault, when);
    const result = await f.read();
    expect(result.status).toBe(200);
    expect(result.body.total).toBe(1);
    expect(result.body.payments).toEqual([
      {
        id: `base-mainnet:${paid.transaction}:0`,
        projectId: "project",
        network: "base-mainnet",
        chain: "base",
        contributionMonth: "2026-11",
        assetAddress: asset,
        assetDecimals: 6,
        netBase: "9800",
        transactionId: paid.transaction,
        indexedAt: when,
      },
    ]);
    expect(JSON.stringify(result.body)).not.toContain("githubUserId");
    expect((await f.read("actors/999/vault-payments")).status).toBe(404);
    expect((await f.read("actors/123/vault-payments")).body.payments).toEqual(
      result.body.payments,
    );
    expect(
      (await f.read("projects/unpaid/vault-payments")).body.payments,
    ).toEqual([]);
  } finally {
    f.sqlite.close();
  }
});

test("public vault payment pagination freezes the append boundary and never invents a missing work month", async () => {
  const f = fixture();
  try {
    for (let n = 1; n <= 101; n++) f.payment(n);
    const first = await f.read();
    expect(first.status).toBe(200);
    expect(first.body.payments).toHaveLength(100);
    expect(first.body.total).toBe(101);
    f.payment(102);
    const second = await f.read(
      `vault-payments?after=${first.body.next}&through=${first.body.through}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.total).toBe(101);
    expect(second.body.payments).toHaveLength(1);
    expect(second.body.payments[0].transactionId).toBe(
      `0x${(101).toString(16).padStart(64, "0")}`,
    );
    expect(second.body.payments[0].contributionMonth).toBeNull();
    expect(second.body.next).toBeNull();
    expect((await f.read("vault-payments?after=1")).status).toBe(400);
  } finally {
    f.sqlite.close();
  }
});

test("unreconciled finalized evidence and database failures stay unavailable, not an empty payment history", async () => {
  const f = fixture();
  try {
    f.payment(1, { corrupt: true });
    expect(await f.read()).toEqual({
      status: 503,
      body: { error: "payments_unavailable" },
    });
    const response = await handlePaymentsApi(
      new Request("https://slop.cash/api/v1/payments/vault-payments"),
      {
        db: {
          prepare() {
            throw new Error("Database unavailable");
          },
          batch: async () => [],
        },
      },
    );
    expect(response.status).toBe(503);
  } finally {
    f.sqlite.close();
  }
});

test("received totals add every disclosed transfer and finalized USDC vault payment for all time, and keep other assets separate", async () => {
  const f = fixture();
  try {
    const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    f.payment(1); // 9,800 base units of a non-reference token
    // A finalized Base USDC payment counts in dollars.
    const id = "award-usdc";
    const usdVault = `0x${"4".repeat(40)}`;
    const digest = "e".repeat(64);
    const transaction = `0x${digest}`;
    f.sqlite
      .query(`INSERT INTO payment_obligations
      (id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,
       gross_base,fee_base,source_digest,state,created_at,paid_transaction)
      VALUES(?,'usd-project','123','base-mainnet','base',?,?,6,'1000000','20000',?,'paid',?,?)`)
      .run(id, usdVault, usdc, digest, when, transaction);
    f.sqlite
      .query(
        "INSERT INTO payment_events VALUES('base-mainnet',?,0,'finalized-block','paid',?,?,?)",
      )
      .run(
        transaction,
        id,
        JSON.stringify({
          kind: "paid",
          transactionId: transaction,
          eventIndex: 0,
          obligationId: id,
          projectId: "usd-project",
          network: "base-mainnet",
          chain: "base",
          vault: usdVault,
          githubUserId: "123",
          sourceDigest: digest,
          grossMicro: "1000000",
          feeMicro: "20000",
          netMicro: "980000",
          assetAddress: usdc,
          assetDecimals: 6,
        }),
        when,
      );
    for (const [n, actor, login, amount, time] of [
      [1, "123", "first", "2500000", "2026-08-03T00:00:00.000Z"],
      [2, "123", "first", "500000", "2026-09-03T00:00:00.000Z"],
      [3, "456", "second", "7000000", "2026-09-04T00:00:00.000Z"],
    ] as const)
      f.sqlite
        .query(
          `INSERT INTO payment_direct_transfers VALUES('solana-mainnet',?,'project','2026-08',?,?,?,'solana','r',?,?,'b','p',?)`,
        )
        .run(`t${n}`, actor, `node${actor}`, login, amount, time, when);
    f.sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('n123','123','renamed',?,1)",
      )
      .run(when);
    const result = await f.read("received");
    expect(result.status).toBe(200);
    expect(result.body.totals).toEqual({
      usdMicro: "10980000",
      directMicro: "10000000",
      vaultUsdMicro: "980000",
      directTransfers: 3,
      vaultPayments: 2,
      contributors: 2,
    });
    expect(result.body.contributors).toEqual([
      {
        githubUserId: "456",
        login: "second",
        usdMicro: "7000000",
        directMicro: "7000000",
        vaultUsdMicro: "0",
        directTransfers: 1,
        vaultPayments: 0,
        projects: [{ projectId: "project", usdMicro: "7000000" }],
        otherAssets: [],
      },
      {
        githubUserId: "123",
        login: "renamed",
        usdMicro: "3980000",
        directMicro: "3000000",
        vaultUsdMicro: "980000",
        directTransfers: 2,
        vaultPayments: 2,
        projects: [
          { projectId: "project", usdMicro: "3000000" },
          { projectId: "usd-project", usdMicro: "980000" },
        ],
        otherAssets: [
          {
            network: "base-mainnet",
            assetAddress: asset,
            assetDecimals: 6,
            netBase: "9800",
          },
        ],
      },
    ]);
  } finally {
    f.sqlite.close();
  }
});

test("received totals fail closed on corrupt finalized evidence", async () => {
  const f = fixture();
  try {
    f.payment(1, { corrupt: true });
    expect((await f.read("received")).status).toBeGreaterThanOrEqual(500);
  } finally {
    f.sqlite.close();
  }
});

test("received totals read a large ledger in bounded pages under D1's value limit", async () => {
  const f = fixture();
  try {
    const vaultCount = 1_200;
    const directCount = 1_500;
    // Evidence near production size: 1,200 rows would be about 2 MB in one value.
    for (let n = 1; n <= vaultCount; n++) f.payment(n, { pad: 1_400 });
    const insert = f.sqlite.query(
      `INSERT INTO payment_direct_transfers VALUES('solana-mainnet',?,'project','2026-08',?,'node','login','solana','r','1000000','2026-09-01T00:00:00.000Z','b','p',?)`,
    );
    for (let n = 1; n <= directCount; n++)
      insert.run(`t${n}`, String(1000 + (n % 50)), when);
    let largest = 0;
    const measured = new Proxy(f.database, {
      get(target, key, receiver) {
        if (key !== "prepare") return Reflect.get(target, key, receiver);
        return (sql: string) => {
          const statement = target.prepare(sql);
          const wrap = (bound: typeof statement) =>
            new Proxy(bound, {
              get(inner, name, innerReceiver) {
                if (name === "bind")
                  return (...values: unknown[]) => wrap(inner.bind(...values));
                if (name === "first")
                  return async () => {
                    const row = (await inner.first()) as Record<
                      string,
                      unknown
                    > | null;
                    for (const value of Object.values(row ?? {}))
                      if (typeof value === "string")
                        largest = Math.max(largest, value.length);
                    return row;
                  };
                return Reflect.get(inner, name, innerReceiver);
              },
            });
          return wrap(statement);
        };
      },
    });
    const response = await handlePaymentsApi(
      new Request("https://slop.cash/api/v1/payments/received"),
      { db: measured },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totals.vaultPayments).toBe(vaultCount);
    expect(body.totals.directTransfers).toBe(directCount);
    expect(body.totals.directMicro).toBe(String(directCount * 1_000_000));
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThan(500_000);
  } finally {
    f.sqlite.close();
  }
}, 60_000);
