import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { encodeBase58Bytes } from "../../src/lib/base58";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { scanSolanaPayments, type ScanEvent } from "./scanner";

// Real scanner and migrated SQLite, with deterministic RPC transport responses.
// These cases do not establish native D1, provider completeness or chain finality.
const originalFetch = globalThis.fetch;
const deployment = {
  projectId: "scan-project",
  network: "solana-devnet",
  vault: "scan-vault",
  projectPda: "scan-project-account",
  programId: "scan-program",
};
const rpcUrl = "https://solana-scanner.invalid";
const noInstructions = {
  meta: { err: null, innerInstructions: [] },
  transaction: { message: { instructions: [] } },
};
afterEach(() => { globalThis.fetch = originalFetch; });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
function transport(answer: (method: string, params: unknown[]) => unknown | Promise<unknown>) {
  const calls: { method: string; params: unknown[] }[] = [];
  globalThis.fetch = (async (url, init) => {
    expect(String(url)).toBe(rpcUrl);
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    return Response.json({ jsonrpc: "2.0", id: 1, result: await answer(request.method, request.params) });
  }) as typeof fetch;
  return calls;
}
function seedReady(sqlite: ReturnType<typeof sqliteD1>["sqlite"], entries: { signature: string; err: unknown }[], generation = "generation-a") {
  sqlite.query("INSERT INTO payment_solana_scans(project_id,network,generation,ready) VALUES(?,?,?,1)")
    .run(deployment.projectId, deployment.network, generation);
  if (entries.length) sqlite.query("INSERT INTO payment_solana_scan_pages VALUES(?,?,?,?,?)")
    .run(deployment.projectId, deployment.network, generation, 0, JSON.stringify(entries));
}
function cursor(sqlite: ReturnType<typeof sqliteD1>["sqlite"]) {
  return sqlite.query("SELECT position FROM payment_chain_cursors WHERE project_id=? AND network=?")
    .get(deployment.projectId, deployment.network) as { position: string } | null;
}
function commitInstruction(project = deployment.projectPda, byte = 1) {
  const discriminator = createHash("sha256").update("global:commit").digest().subarray(0, 8);
  const data = Buffer.concat([discriminator, Buffer.alloc(32, byte)]);
  return { programId: deployment.programId, accounts: ["owner", project], data: encodeBase58Bytes(data) };
}
const transaction = (instructions: unknown[]) => ({
  meta: { err: null, innerInstructions: [] }, transaction: { message: { instructions } },
});

test("discovery reverses full pages and only a later short page enables processing", async () => {
  const { db, sqlite } = sqliteD1();
  const newest = Array.from({ length: 1000 }, (_, index) => ({ signature: `signature-${1002 - index}`, err: null }));
  const oldest = [{ signature: "signature-2", err: null }, { signature: "signature-1", err: null }];
  const calls = transport((method, params) => {
    expect(method).toBe("getSignaturesForAddress");
    expect(params[0]).toBe(deployment.projectPda);
    return calls.length === 1 ? newest : oldest;
  });
  try {
    await scanSolanaPayments(db, deployment, rpcUrl, async () => { throw new Error("discovery must not index"); });
    expect(sqlite.query("SELECT ready,revision,before_signature,next_page FROM payment_solana_scans").get())
      .toEqual({ ready: 0, revision: 1, before_signature: "signature-3", next_page: 1 });
    expect(JSON.parse((sqlite.query("SELECT signatures_json FROM payment_solana_scan_pages WHERE page=0").get() as { signatures_json: string }).signatures_json)[0].signature)
      .toBe("signature-3");
    await scanSolanaPayments(db, deployment, rpcUrl, async () => { throw new Error("discovery must not index"); });
    expect(calls[1].params[1]).toEqual({ commitment: "finalized", limit: 1000, before: "signature-3" });
    expect(sqlite.query("SELECT ready,revision,before_signature,next_page FROM payment_solana_scans").get())
      .toEqual({ ready: 1, revision: 2, before_signature: "signature-1", next_page: 2 });
    expect(cursor(sqlite)).toBeNull();
  } finally { sqlite.close(); }
});

test("invalid discovery preserves the created scan for retry", async () => {
  const { db, sqlite } = sqliteD1();
  transport(() => null);
  try {
    await expect(scanSolanaPayments(db, deployment, rpcUrl, async () => {})).rejects.toThrow("Invalid Solana signature page");
    const frozen = sqlite.query("SELECT generation,revision,next_page,ready FROM payment_solana_scans").get();
    transport(() => []);
    await scanSolanaPayments(db, deployment, rpcUrl, async () => {});
    expect(sqlite.query("SELECT generation FROM payment_solana_scans").get()).toEqual({ generation: (frozen as { generation: string }).generation });
    expect(sqlite.query("SELECT revision,next_page,ready FROM payment_solana_scans").get()).toEqual({ revision: 1, next_page: 0, ready: 1 });
    expect(cursor(sqlite)).toBeNull();
  } finally { sqlite.close(); }
});

test("failed signatures and another project's instructions advance without indexing", async () => {
  const { db, sqlite } = sqliteD1();
  seedReady(sqlite, [{ signature: "failed", err: { InstructionError: [0, "failed"] } }, { signature: "foreign", err: null }]);
  const calls = transport((method) => {
    expect(method).toBe("getTransaction");
    return transaction([commitInstruction("other-project")]);
  });
  const indexed: ScanEvent[] = [];
  try {
    await scanSolanaPayments(db, deployment, rpcUrl, async (event) => { indexed.push(event); });
    expect(calls.map((call) => call.params[0])).toEqual(["foreign"]);
    expect(indexed).toEqual([]);
    expect(cursor(sqlite)).toEqual({ position: "foreign" });
    expect(sqlite.query("SELECT revision FROM payment_solana_scans").get()).toEqual({ revision: 2 });
    expect(sqlite.query("SELECT * FROM payment_solana_scan_pages").all()).toEqual([]);
  } finally { sqlite.close(); }
});

test("a later index failure retains earlier effects but retries the whole transaction", async () => {
  const { db, sqlite } = sqliteD1();
  seedReady(sqlite, [{ signature: "two-invocations", err: null }]);
  transport(() => transaction([commitInstruction(deployment.projectPda, 1), commitInstruction(deployment.projectPda, 2)]));
  const attempts: number[] = [];
  const durable = new Set<number>();
  let fail = true;
  const index = async (event: ScanEvent) => {
    attempts.push(event.eventIndex);
    if (fail && event.eventIndex === 1) throw new Error("index failed after earlier commit");
    durable.add(event.eventIndex);
  };
  try {
    await expect(scanSolanaPayments(db, deployment, rpcUrl, index)).rejects.toThrow("index failed");
    expect(durable).toEqual(new Set([0]));
    expect(cursor(sqlite)).toBeNull();
    expect(sqlite.query("SELECT revision FROM payment_solana_scans").get()).toEqual({ revision: 0 });
    fail = false;
    await scanSolanaPayments(db, deployment, rpcUrl, index);
    expect(attempts).toEqual([0, 1, 0, 1]);
    expect(durable).toEqual(new Set([0, 1]));
    expect(cursor(sqlite)).toEqual({ position: "two-invocations" });
  } finally { sqlite.close(); }
});

test("a lost checkpoint reply preserves its atomic cursor and page mutation", async () => {
  const { db, sqlite } = sqliteD1();
  seedReady(sqlite, [{ signature: "first", err: null }, { signature: "second", err: null }]);
  const calls = transport(() => noInstructions);
  let lost = false;
  const losing: typeof db = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      const result = await db.batch(statements);
      if (!lost && statements.length === 3) { lost = true; throw new Error("lost checkpoint reply"); }
      return result;
    },
  };
  try {
    await expect(scanSolanaPayments(losing, deployment, rpcUrl, async () => {})).rejects.toThrow("lost checkpoint reply");
    expect(cursor(sqlite)).toEqual({ position: "first" });
    expect(sqlite.query("SELECT revision FROM payment_solana_scans").get()).toEqual({ revision: 1 });
    expect(JSON.parse((sqlite.query("SELECT signatures_json FROM payment_solana_scan_pages").get() as { signatures_json: string }).signatures_json))
      .toEqual([{ signature: "second", err: null }]);
    await scanSolanaPayments(db, deployment, rpcUrl, async () => {});
    expect(calls.map((call) => call.params[0])).toEqual(["first", "second"]);
    expect(cursor(sqlite)).toEqual({ position: "second" });
  } finally { sqlite.close(); }
});

test("a stale reader stops after its first failed fence without overwriting a newer prefix", async () => {
  const { db, sqlite } = sqliteD1();
  seedReady(sqlite, [{ signature: "first", err: null }, { signature: "second", err: null }]);
  const blocked = deferred(), release = deferred();
  let hold = true;
  const calls = transport(async () => {
    if (hold) { hold = false; blocked.resolve(); await release.promise; }
    return noInstructions;
  });
  let oldRun: Promise<void> | undefined;
  try {
    oldRun = scanSolanaPayments(db, deployment, rpcUrl, async () => {});
    await blocked.promise;
    await scanSolanaPayments(db, deployment, rpcUrl, async () => {});
    const advanced = sqlite.query("SELECT generation,revision FROM payment_solana_scans").get();
    release.resolve();
    await oldRun;
    expect(calls.map((call) => call.params[0])).toEqual(["first", "first", "second"]);
    expect(sqlite.query("SELECT generation,revision FROM payment_solana_scans").get()).toEqual(advanced);
    expect(cursor(sqlite)).toEqual({ position: "second" });
  } finally { release.resolve(); await oldRun; sqlite.close(); }
});

test("an old empty-page delete cannot remove a replacement generation", async () => {
  const { db, sqlite } = sqliteD1();
  seedReady(sqlite, []);
  const blocked = deferred(), release = deferred();
  let hold = true;
  const delaying: typeof db = {
    prepare: (sql) => {
      const wrap = (statement: ReturnType<typeof db.prepare>): ReturnType<typeof db.prepare> => ({
        ...statement,
        bind: (...values) => wrap(statement.bind(...values)),
        run: async () => {
          if (hold && sql.startsWith("DELETE FROM payment_solana_scans")) { hold = false; blocked.resolve(); await release.promise; }
          return statement.run();
        },
      });
      return wrap(db.prepare(sql));
    },
    batch: (statements) => db.batch(statements),
  };
  transport(() => []);
  let oldRun: Promise<void> | undefined;
  try {
    oldRun = scanSolanaPayments(delaying, deployment, rpcUrl, async () => {});
    await blocked.promise;
    await scanSolanaPayments(db, deployment, rpcUrl, async () => {});
    await scanSolanaPayments(db, deployment, rpcUrl, async () => {});
    const replacement = sqlite.query("SELECT generation,revision,ready FROM payment_solana_scans").get();
    expect((replacement as { generation: string }).generation).not.toBe("generation-a");
    release.resolve();
    await oldRun;
    expect(sqlite.query("SELECT generation,revision,ready FROM payment_solana_scans").get()).toEqual(replacement);
  } finally { release.resolve(); await oldRun; sqlite.close(); }
});
