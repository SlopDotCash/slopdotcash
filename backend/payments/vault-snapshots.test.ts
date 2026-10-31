// The vault totals cache: finalized reads stored in D1 and served from it.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import { handlePaymentsApi } from "./handler";
import {
  refreshVaultSnapshots,
  type SnapshotDeployment,
  storeVaultSnapshot,
  type VaultTotals,
} from "./vault-snapshots";

const open = () => sqliteD1(MIGRATIONS).db as unknown as D1Database;

const deployment: SnapshotDeployment = {
  projectId: "acme",
  network: "base-sepolia",
  chain: "base",
  vault: "0x2222222222222222222222222222222222222222",
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
};
const totals = (overrides: Partial<VaultTotals> = {}): VaultTotals => ({
  network: "base-sepolia",
  vault: "0x2222222222222222222222222222222222222222",
  asset: "0x036CBD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
  blockNumber: "1000",
  blockTime: "2026-10-18T10:00:00Z",
  totalDeposited: "500000000",
  totalPaid: "98000000",
  totalPayoutFees: "2000000",
  totalGrossWithdrawn: "0",
  totalWithdrawalFees: "0",
  freeBalance: "300000000",
  reservedPrincipal: "98000000",
  reservedFees: "2000000",
  accruedFees: "2000000",
  reserved: null,
  ...overrides,
});
const observed = "2026-10-18T10:05:00.000Z";

test("chronological and duplicate observations preserve the complete finalized row", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    await storeVaultSnapshot(db, deployment, totals(), observed);
    const initial = sqlite
      .query("SELECT * FROM vault_snapshots")
      .get() as Record<string, unknown>;
    const next = "2026-10-18T10:05:00.001Z";
    expect(await storeVaultSnapshot(db, deployment, totals(), next)).toBe(
      "stored",
    );
    const updated = { ...initial, observed_at: next };
    expect(sqlite.query("SELECT * FROM vault_snapshots").get()).toEqual(
      updated,
    );
    expect(await storeVaultSnapshot(db, deployment, totals(), next)).toBe(
      "stored",
    );
    expect(sqlite.query("SELECT * FROM vault_snapshots").get()).toEqual(
      updated,
    );
  } finally {
    sqlite.close();
  }
});

test("a delayed refresh cannot make the public vault observation stale again", async () => {
  const { db, sqlite } = sqliteD1();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const newer = "2026-10-18T10:05:02.000Z";
  const rpc = { "base-sepolia": "http://rpc.invalid" };
  const delayed = refreshVaultSnapshots(
    db,
    [deployment],
    rpc,
    async () => {
      await gate;
      return totals();
    },
    new Date(observed),
  );
  try {
    await refreshVaultSnapshots(
      db,
      [deployment],
      rpc,
      async () => totals(),
      new Date(newer),
    );
    const before = sqlite.query("SELECT * FROM vault_snapshots").get();
    release();
    await delayed;
    const response = await handlePaymentsApi(
      new Request("https://slop.cash/api/v1/payments/projects/acme/vault"),
      { db, now: () => new Date("2026-10-18T10:35:01.000Z") },
    );
    const body = (await response.json()) as {
      snapshots: { observedAt: string }[];
      staleAfterMs: number;
    };
    expect(response.status).toBe(200);
    expect(body.snapshots[0].observedAt).toBe(newer);
    expect(
      Date.parse("2026-10-18T10:35:01.000Z") -
        Date.parse(body.snapshots[0].observedAt),
    ).toBeLessThan(body.staleAfterMs);
    expect(sqlite.query("SELECT * FROM vault_snapshots").get()).toEqual(before);
  } finally {
    release();
    await delayed.catch(() => {});
    sqlite.close();
  }
});

test("write-time ordering keeps newer finalized blocks and the latest observation within a block", async () => {
  for (const advanceBlock of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), "slop-vault-observation-"));
    const file = join(directory, "vault.sqlite");
    const first = sqliteD1(MIGRATIONS, file);
    const second = sqliteD1([], file);
    try {
      first.sqlite.exec("PRAGMA journal_mode=WAL");
      await storeVaultSnapshot(first.db, deployment, totals(), observed);
      first.sqlite.exec("UPDATE vault_snapshots SET total_service_fees='17'");
      first.sqlite.exec("BEGIN IMMEDIATE");
      await storeVaultSnapshot(
        first.db,
        deployment,
        totals(),
        "2026-10-18T10:05:02.000Z",
      );
      const before = first.sqlite
        .query("SELECT * FROM vault_snapshots")
        .get() as Record<string, unknown>;
      expect(
        second.sqlite.query("SELECT observed_at FROM vault_snapshots").get(),
      ).toEqual({ observed_at: observed });
      const incoming = advanceBlock
        ? totals({
            blockNumber: "1001",
            totalDeposited: "600000000",
            freeBalance: "400000000",
          })
        : totals();
      // The other connection reads the old committed row, then yields at SELECT.
      // Commit before its INSERT resumes: the SQL must inspect the current row.
      const delayed = storeVaultSnapshot(
        second.db,
        deployment,
        incoming,
        "2026-10-18T10:05:01.000Z",
      );
      first.sqlite.exec("COMMIT");
      expect(await delayed).toBe(advanceBlock ? "stored" : "older");
      expect(
        second.sqlite.query("SELECT * FROM vault_snapshots").get(),
      ).toEqual(
        advanceBlock
          ? {
              ...before,
              block_number: "1001",
              total_deposited: "600000000",
              free_balance: "400000000",
              observed_at: "2026-10-18T10:05:01.000Z",
            }
          : before,
      );
    } finally {
      if (first.sqlite.inTransaction) first.sqlite.exec("ROLLBACK");
      second.sqlite.close();
      first.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("block order takes precedence over observation time without relabeling balances", async () => {
  const { db, sqlite } = sqliteD1();
  try {
    await storeVaultSnapshot(db, deployment, totals(), observed);
    const initial = sqlite.query("SELECT * FROM vault_snapshots").get();
    // Same block: compare instants rather than the lexical order of offsets.
    expect(
      await storeVaultSnapshot(
        db,
        deployment,
        totals(),
        "2026-10-18T11:04:59+01:00",
      ),
    ).toBe("older");
    expect(sqlite.query("SELECT * FROM vault_snapshots").get()).toEqual(
      initial,
    );
    expect(
      await storeVaultSnapshot(
        db,
        deployment,
        totals(),
        "2026-10-18T11:05:00+01:00",
      ),
    ).toBe("stored");
    const advanced = totals({
      blockNumber: "1001",
      blockTime: "2026-10-18T10:00:02.000Z",
      totalDeposited: "600000000",
      freeBalance: "400000000",
    });
    // An earlier-started refresh can read a later finalized block. Store its
    // actual observation time, not the time of the previous block's balances.
    const earlier = "2026-10-18T10:04:59.999Z";
    expect(await storeVaultSnapshot(db, deployment, advanced, earlier)).toBe(
      "stored",
    );
    expect(
      sqlite
        .query(
          "SELECT block_number,block_time,free_balance,observed_at,reserved,total_service_fees FROM vault_snapshots",
        )
        .get(),
    ).toEqual({
      block_number: "1001",
      block_time: advanced.blockTime,
      free_balance: "400000000",
      observed_at: earlier,
      reserved: null,
      total_service_fees: "0",
    });
    const current = sqlite.query("SELECT * FROM vault_snapshots").get();
    expect(
      await storeVaultSnapshot(
        db,
        deployment,
        totals(),
        "2026-10-18T10:20:00.000Z",
      ),
    ).toBe("older");
    expect(sqlite.query("SELECT * FROM vault_snapshots").get()).toEqual(
      current,
    );
    expect(
      await storeVaultSnapshot(
        db,
        deployment,
        advanced,
        "2026-10-18T10:05:00.000Z",
      ),
    ).toBe("stored");
    expect(
      sqlite.query("SELECT observed_at FROM vault_snapshots").get(),
    ).toEqual({ observed_at: observed });
  } finally {
    sqlite.close();
  }
});

test("refreshes both chain caches and preserves the last verified public totals after invalid reads", async () => {
  const db = open();
  const solana: SnapshotDeployment = {
    projectId: "sol",
    network: "solana-devnet",
    chain: "solana",
    vault: "Vau1t11111111111111111111111111111111111111",
    projectPda: "Proj111111111111111111111111111111111111111",
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  };
  const solanaTotals = totals({
    network: solana.network,
    vault: "Proj111111111111111111111111111111111111111",
    asset: solana.asset,
    reservedPrincipal: null,
    reservedFees: null,
    accruedFees: null,
    reserved: "100000000",
  });
  const readPublic = async (projectId: string) => {
    const response = await handlePaymentsApi(
      new Request(
        `https://slop.cash/api/v1/payments/projects/${projectId}/vault`,
      ),
      { db, now: () => new Date(observed) },
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { snapshots: Record<string, unknown>[] })
      .snapshots;
  };
  await refreshVaultSnapshots(
    db,
    [deployment, solana],
    {
      "base-sepolia": "http://rpc.invalid",
      "solana-devnet": "http://rpc.invalid",
    },
    async (selected) => (selected.chain === "solana" ? solanaTotals : totals()),
    new Date(observed),
  );
  expect(await readPublic("acme")).toMatchObject([
    {
      vault: deployment.vault,
      assetAddress: deployment.asset,
      totalDeposited: "500000000",
      blockNumber: "1000",
      observedAt: observed,
    },
  ]);
  expect(await readPublic("sol")).toMatchObject([
    {
      vault: solana.vault,
      assetAddress: solana.asset,
      reserved: "100000000",
      reservedFees: null,
    },
  ]);
  for (const rejected of [
    totals({ vault: "0x3333333333333333333333333333333333333333" }),
    totals({ blockNumber: "1001", totalPaid: "1" }),
    totals({ blockNumber: "1001", decimals: 18 }),
  ]) {
    await expect(
      refreshVaultSnapshots(
        db,
        [deployment],
        {
          "base-sepolia": "http://rpc.invalid",
        },
        async () => rejected,
      ),
    ).rejects.toThrow();
    expect(await readPublic("acme")).toMatchObject([
      {
        totalPaid: "98000000",
        assetDecimals: 6,
        blockNumber: "1000",
      },
    ]);
  }
  await refreshVaultSnapshots(
    db,
    [deployment],
    {
      "base-sepolia": "http://rpc.invalid",
    },
    async () => totals({ blockNumber: "999", totalDeposited: "1" }),
  );
  expect(await readPublic("acme")).toMatchObject([
    { totalDeposited: "500000000", blockNumber: "1000" },
  ]);
  await refreshVaultSnapshots(
    db,
    [deployment],
    {
      "base-sepolia": "http://rpc.invalid",
    },
    async () => totals({ blockNumber: "1002", totalDeposited: "600000000" }),
  );
  expect(await readPublic("acme")).toMatchObject([
    { totalDeposited: "600000000", blockNumber: "1002" },
  ]);
});

describe("GET /api/v1/payments/projects/:id/vault", () => {
  const url = "https://slop.cash/api/v1/payments/projects/acme/vault";
  test("serves cached rows with public edge caching and never reads a chain", async () => {
    const db = open();
    await storeVaultSnapshot(
      db,
      deployment,
      totals({
        totalDeposited: "340282366920938463463374607431768211455",
        freeBalance: null,
      }),
      observed,
    );
    const stored = new Map<string, Response>();
    const edgeCache = {
      match: async (r: Request) => stored.get(r.url)?.clone(),
      put: async (r: Request, response: Response) => {
        stored.set(r.url, response);
      },
      delete: async () => false,
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("no network access expected");
    }) as unknown as typeof fetch;
    try {
      const response = await handlePaymentsApi(new Request(url), {
        db,
        edgeCache,
        now: () => new Date(observed),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=60, s-maxage=60",
      );
      const body = (await response.json()) as {
        snapshots: Record<string, unknown>[];
        staleAfterMs: number;
      };
      expect(body.staleAfterMs).toBe(1_800_000);
      expect(body.snapshots).toEqual([
        {
          projectId: "acme",
          network: "base-sepolia",
          chain: "base",
          vault: deployment.vault,
          assetAddress: deployment.asset,
          assetDecimals: 6,
          totalDeposited: "340282366920938463463374607431768211455",
          totalPaid: "98000000",
          totalPayoutFees: "2000000",
          totalGrossWithdrawn: "0",
          totalWithdrawalFees: "0",
          freeBalance: null,
          reservedPrincipal: "98000000",
          reservedFees: "2000000",
          accruedFees: "2000000",
          reserved: null,
          blockNumber: "1000",
          blockTime: "2026-10-18T10:00:00.000Z",
          observedAt: observed,
        },
      ]);
      // The second read comes from the edge cache, not D1.
      await db.prepare("DELETE FROM vault_snapshots").run();
      const cached = await handlePaymentsApi(new Request(url), {
        db,
        edgeCache,
      });
      expect(
        ((await cached.json()) as { snapshots: unknown[] }).snapshots,
      ).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an unindexed project returns no rows, not zero totals", async () => {
    const response = await handlePaymentsApi(new Request(url), { db: open() });
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { snapshots: unknown[] }).snapshots,
    ).toEqual([]);
  });
});

describe("indexPaymentEvent asset", () => {
  const event = {
    kind: "reserved" as const,
    transactionId: `0x${"aa".repeat(32)}`,
    eventIndex: 0,
    blockId: `0x${"bb".repeat(32)}`,
    obligationId: `0x${"cc".repeat(32)}`,
    projectId: "acme",
    network: "base-sepolia",
    chain: "base" as const,
    vault: deployment.vault,
    githubUserId: "7",
    grossMicro: "100000000",
    netMicro: "98000000",
    feeMicro: "2000000",
    sourceDigest: "dd".repeat(32),
  };
  const input = {
    transactionId: event.transactionId,
    eventIndex: 0,
    kind: "reserved" as const,
    obligationId: event.obligationId,
  };
  test("requires the finalized vault snapshot and records its asset and decimals", async () => {
    const { indexPaymentEvent } = await import("./ledger");
    const db = open();
    const adapter = { verifyFinalized: async () => event };
    await expect(
      indexPaymentEvent(db, adapter, input, observed),
    ).rejects.toThrow();
    await storeVaultSnapshot(db, deployment, totals(), observed);
    await indexPaymentEvent(db, adapter, input, observed);
    expect(
      await db
        .prepare(
          "SELECT asset_address,asset_decimals,gross_base,fee_base FROM payment_obligations",
        )
        .first<unknown>(),
    ).toEqual({
      asset_address: deployment.asset,
      asset_decimals: 6,
      gross_base: "100000000",
      fee_base: "2000000",
    });
    // Re-indexing the same finalized event is a no-op; changed facts conflict.
    await indexPaymentEvent(db, adapter, input, observed);
    await expect(
      indexPaymentEvent(
        db,
        {
          verifyFinalized: async () => ({
            ...event,
            blockId: `0x${"ee".repeat(32)}`,
          }),
        },
        input,
        observed,
      ),
    ).rejects.toThrow();
  });
  test("re-indexing stored evidence for the adapter's deployment makes no chain call", async () => {
    const { indexPaymentEvent } = await import("./ledger");
    const db = open();
    await storeVaultSnapshot(db, deployment, totals(), observed);
    let calls = 0;
    const adapter = {
      deployment: {
        projectId: event.projectId,
        network: event.network,
        vault: event.vault,
      },
      verifyFinalized: async () => {
        calls += 1;
        // After a vault upgrade, today's registry may no longer verify
        // this event at its block; stored evidence must not depend on it.
        if (calls > 1) throw new Error("implementation does not match");
        return event;
      },
    };
    await indexPaymentEvent(db, adapter, input, observed);
    await indexPaymentEvent(db, adapter, input, observed);
    expect(calls).toBe(1);
    // A different obligation at the same event position is not stored
    // evidence, so it is verified and the conflict still fails.
    await expect(
      indexPaymentEvent(
        db,
        adapter,
        { ...input, obligationId: `0x${"ef".repeat(32)}` },
        observed,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});

test("concurrent finalized refreshes cannot decrease cumulative vault counters", async () => {
  for (const [key, column] of [
    ["totalDeposited", "total_deposited"],
    ["totalPaid", "total_paid"],
    ["totalPayoutFees", "total_payout_fees"],
    ["totalGrossWithdrawn", "total_gross_withdrawn"],
    ["totalWithdrawalFees", "total_withdrawal_fees"],
  ] as const) {
    const db = open();
    const initial = "999999999999999999999999999999";
    const higher = "1000000000000000000000000000001";
    const lower = "1000000000000000000000000000000";
    await storeVaultSnapshot(
      db,
      deployment,
      totals({ [key]: initial }),
      observed,
    );
    const results = await Promise.allSettled([
      storeVaultSnapshot(
        db,
        deployment,
        totals({ blockNumber: "1001", [key]: higher }),
        observed,
      ),
      storeVaultSnapshot(
        db,
        deployment,
        totals({ blockNumber: "1002", [key]: lower }),
        observed,
      ),
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: "stored" });
    expect(results[1].status).toBe("rejected");
    expect(
      await db
        .prepare(`SELECT ${column} amount,block_number FROM vault_snapshots`)
        .first<unknown>(),
    ).toEqual({ amount: higher, block_number: "1001" });
  }
});

test("concurrent initial refreshes preserve asset identity and report superseded blocks", async () => {
  const db = open();
  const initial = await Promise.allSettled([
    storeVaultSnapshot(db, deployment, totals(), observed),
    storeVaultSnapshot(db, deployment, totals({ decimals: 18 }), observed),
  ]);
  expect(initial[0]).toEqual({ status: "fulfilled", value: "stored" });
  expect(initial[1].status).toBe("rejected");
  const refreshed = await Promise.all([
    storeVaultSnapshot(
      db,
      deployment,
      totals({ blockNumber: "1002" }),
      observed,
    ),
    storeVaultSnapshot(
      db,
      deployment,
      totals({ blockNumber: "1001" }),
      observed,
    ),
  ]);
  expect(refreshed).toEqual(["stored", "older"]);
  expect(
    await db
      .prepare("SELECT asset_decimals,block_number FROM vault_snapshots")
      .first<unknown>(),
  ).toEqual({ asset_decimals: 6, block_number: "1002" });
});

test("bounded refresh advances healthy vaults while earlier reads wait and reports every failure", async () => {
  const { db, sqlite } = sqliteD1();
  const deferred = () => {
    let finish = () => {};
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { promise, finish: () => finish() };
  };
  const gates = Array.from({ length: 4 }, deferred);
  const lastStarted = deferred();
  const started: number[] = [];
  const errors = [
    new Error("first vault unavailable"),
    new Error("second vault unavailable"),
  ];
  let active = 0;
  let peak = 0;
  const refreshing = refreshVaultSnapshots(
    db,
    Array.from({ length: 8 }, (_, index) => ({
      ...deployment,
      projectId: `parallel-${index}`,
    })),
    { "base-sepolia": "http://rpc.invalid" },
    async (selected) => {
      const index = Number(selected.projectId.slice("parallel-".length));
      started.push(index);
      active += 1;
      peak = Math.max(peak, active);
      if (index === 7) lastStarted.finish();
      try {
        if (index < 4) await gates[index].promise;
        if (index < 2) throw errors[index];
        return totals();
      } finally {
        active -= 1;
      }
    },
  );
  try {
    expect(started).toEqual([0, 1, 2, 3]);
    gates[2].finish();
    gates[3].finish();
    await lastStarted.promise;
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(4);
    // Reverse completion order must not change the aggregate's input order.
    gates[1].finish();
    gates[0].finish();
    const failure = await refreshing.then(
      () => null,
      (error: unknown) => error,
    );
    if (!(failure instanceof AggregateError))
      throw new Error("The refresh did not report its failed vaults");
    expect(failure.errors).toEqual(errors);
    expect(
      sqlite
        .query("SELECT project_id FROM vault_snapshots ORDER BY project_id")
        .all(),
    ).toEqual(
      Array.from({ length: 6 }, (_, index) => ({
        project_id: `parallel-${index + 2}`,
      })),
    );
  } finally {
    for (const gate of gates) gate.finish();
    await refreshing.catch(() => {});
    sqlite.close();
  }
});
