/** Local reconciliation workflow: migrated SQLite and stubbed JSON-RPC endpoints.
 * One attempt that cannot be reconciled (an unavailable RPC endpoint, or a
 * deployment that is missing from the reviewed set) must not stop the
 * reconciliation of every later attempt (PAY-06, PAY-07). Transaction
 * identities and RPC responses are local fixtures, not chain receipts. */
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { reconcileFailedAttempts } from "./reconcile";

const root = fileURLToPath(new URL("../../", import.meta.url));
const timestamp = "2026-10-14T00:00:00.000Z";
const now = new Date(timestamp);
const GENESIS = "fixture-genesis-hash";
const BASE_RPC = "https://rpc.fixture/base";
const SOLANA_RPC = "https://rpc.fixture/solana";
const BASE_TX = `0x${"a".repeat(64)}`;
const SOLANA_TX = "4".repeat(88);
const BLOCK_HASH = `0x${"b".repeat(64)}`;

let baseRpcDown = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = String(input);
  const request = JSON.parse(String(init?.body ?? "{}")) as {
    method?: string;
    params?: unknown[];
  };
  const reply = (result: unknown) =>
    Response.json({ jsonrpc: "2.0", id: 1, result });
  if (url === BASE_RPC) {
    if (baseRpcDown)
      return new Response("service unavailable", { status: 503 });
    if (request.method === "eth_chainId") return reply("0x1");
    if (request.method === "eth_getTransactionReceipt")
      return reply({
        status: "0x0",
        transactionHash: request.params?.[0],
        blockHash: BLOCK_HASH,
        blockNumber: "0x10",
      });
    if (request.method === "eth_getBlockByNumber")
      return request.params?.[0] === "finalized"
        ? reply({ number: "0x20", hash: BLOCK_HASH })
        : reply({ number: "0x10", hash: BLOCK_HASH });
  }
  if (url === SOLANA_RPC) {
    if (request.method === "getGenesisHash") return reply(GENESIS);
    if (request.method === "getTransaction")
      return reply({
        slot: 42,
        meta: { err: { InstructionError: [0, "Custom:6001"] } },
      });
  }
  throw new Error(`Unexpected RPC request to ${url}`);
}) as typeof fetch;

function makeDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "slop-payment-reconcile-"));
  const sql = new Database(join(directory, "payments.sqlite"));
  sql.exec("PRAGMA foreign_keys=ON");
  for (const filename of readdirSync(join(root, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sql.exec(readFileSync(join(root, "migrations", filename), "utf8"));
  }
  const statement = (
    query: string,
    args: unknown[] = [],
  ): ReturnType<D1Database["prepare"]> => ({
    bind(...values: unknown[]) {
      return statement(query, values);
    },
    async first<T>() {
      return (sql.query(query).get(...(args as string[])) ?? null) as T | null;
    },
    async run() {
      const result = sql.query(query).run(...(args as string[]));
      return { success: true, meta: { changes: result.changes } };
    },
  });
  const db: D1Database = {
    prepare: statement,
    async batch(statements) {
      sql.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { directory, sql, db };
}

const deployments = [
  {
    network: "base-local",
    chain: "base",
    vault: "vault-base",
    chainId: "1",
  },
  { network: "solana-local", chain: "solana", vault: "vault-solana" },
] as const;
const rpcUrls = { "base-local": BASE_RPC, "solana-local": SOLANA_RPC };
const genesisHashes = { "solana-local": GENESIS };

function seedAttempt(
  sql: Database,
  input: {
    id: string;
    actor: string;
    network: string;
    chain: "base" | "solana";
    vault: string;
    transactionId: string;
    seed: string;
  },
) {
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      `claim-${input.id}`,
      input.actor,
      `fixture-${input.id}`,
      input.chain === "base"
        ? "0x0000000000000000000000000000000000000001"
        : "11111111111111111111111111111111",
      "d1_registry",
      input.seed.repeat(64),
      timestamp,
      input.seed.repeat(64),
      timestamp,
      input.chain,
    );
  sql
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
    )
    .run(
      `obligation-${input.id}`,
      `fixture-${input.id}`,
      input.actor,
      input.network,
      input.chain,
      input.vault,
      input.chain === "solana"
        ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        : "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      6,
      "100000000",
      "2000000",
      input.seed.repeat(64),
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'held',?)",
    )
    .run(`obligation-${input.id}`, timestamp);
  sql
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES(?,?,?,?,?,'submitted')",
    )
    .run(
      input.id,
      `obligation-${input.id}`,
      `claim-${input.id}`,
      timestamp,
      input.transactionId,
    );
}

function attemptState(sql: Database, id: string) {
  return sql
    .query<
      { attemptState: string; outboxState: string; failureCount: number },
      [string]
    >(
      "SELECT a.state attemptState, b.state outboxState, (SELECT COUNT(*) FROM payment_attempt_failures f WHERE f.attempt_id=a.id) failureCount FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id WHERE a.id=?",
    )
    .get(id);
}

async function captureError(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

try {
  // Phase 1: the first attempt's RPC endpoint is unavailable. The later
  // Solana attempt has a finalized failed transaction and must still be
  // reconciled: marked failed, with its outbox ready for a fresh attempt.
  {
    const { directory, sql, db } = makeDatabase();
    try {
      seedAttempt(sql, {
        id: "attempt-base",
        actor: "101",
        network: "base-local",
        chain: "base",
        vault: "vault-base",
        transactionId: BASE_TX,
        seed: "1",
      });
      seedAttempt(sql, {
        id: "attempt-solana",
        actor: "202",
        network: "solana-local",
        chain: "solana",
        vault: "vault-solana",
        transactionId: SOLANA_TX,
        seed: "2",
      });
      baseRpcDown = true;
      const error = await captureError(() =>
        reconcileFailedAttempts(db, deployments, rpcUrls, genesisHashes, now),
      );
      assert.ok(
        error instanceof AggregateError,
        `expected an AggregateError, got ${String(error)}`,
      );
      assert.equal(error.errors.length, 1);
      assert.match(String(error.errors[0]), /RPC HTTP failure: 503/);
      assert.deepEqual(attemptState(sql, "attempt-solana"), {
        attemptState: "failed",
        outboxState: "ready",
        failureCount: 1,
      });
      // The unavailable attempt stays submitted and reserved for a later run.
      assert.deepEqual(attemptState(sql, "attempt-base"), {
        attemptState: "submitted",
        outboxState: "held",
        failureCount: 0,
      });
    } finally {
      baseRpcDown = false;
      sql.close();
      rmSync(directory, { recursive: true, force: true });
    }
    console.log("phase 1 passed: RPC outage isolated to its own attempt");
  }

  // Phase 2: the first attempt names a deployment outside the reviewed set.
  // The later Base attempt must still be reconciled from its revert proof.
  {
    const { directory, sql, db } = makeDatabase();
    try {
      seedAttempt(sql, {
        id: "attempt-ghost",
        actor: "303",
        network: "ghost-net",
        chain: "base",
        vault: "vault-ghost",
        transactionId: `0x${"d".repeat(64)}`,
        seed: "3",
      });
      seedAttempt(sql, {
        id: "attempt-base",
        actor: "101",
        network: "base-local",
        chain: "base",
        vault: "vault-base",
        transactionId: BASE_TX,
        seed: "1",
      });
      const error = await captureError(() =>
        reconcileFailedAttempts(db, deployments, rpcUrls, genesisHashes, now),
      );
      assert.ok(
        error instanceof AggregateError,
        `expected an AggregateError, got ${String(error)}`,
      );
      assert.equal(error.errors.length, 1);
      assert.match(
        String(error.errors[0]),
        /Reviewed deployment missing for reconciliation/,
      );
      assert.deepEqual(attemptState(sql, "attempt-base"), {
        attemptState: "failed",
        outboxState: "ready",
        failureCount: 1,
      });
      assert.deepEqual(attemptState(sql, "attempt-ghost"), {
        attemptState: "submitted",
        outboxState: "held",
        failureCount: 0,
      });
    } finally {
      sql.close();
      rmSync(directory, { recursive: true, force: true });
    }
    console.log("phase 2 passed: missing deployment isolated to its attempt");
  }

  // Phase 3: a single healthy attempt reconciles with no error at all.
  {
    const { directory, sql, db } = makeDatabase();
    try {
      seedAttempt(sql, {
        id: "attempt-base",
        actor: "101",
        network: "base-local",
        chain: "base",
        vault: "vault-base",
        transactionId: BASE_TX,
        seed: "1",
      });
      const error = await captureError(() =>
        reconcileFailedAttempts(db, deployments, rpcUrls, genesisHashes, now),
      );
      assert.equal(error, null);
      assert.deepEqual(attemptState(sql, "attempt-base"), {
        attemptState: "failed",
        outboxState: "ready",
        failureCount: 1,
      });
    } finally {
      sql.close();
      rmSync(directory, { recursive: true, force: true });
    }
    console.log("phase 3 passed: healthy attempt reconciles cleanly");
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log("reconcile isolation integration passed");
