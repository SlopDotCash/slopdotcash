/** Local recovery workflow: migrated SQLite and HTTP journal-status services.
 * Transaction identities are local journal fixtures, not chain receipts or payouts. */
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { dispatchPayment } from "../../backend/payments/dispatch";
import {
  buildPaymentWalletMessage,
  verifyPaymentWalletSignature,
} from "../../backend/payments/possession";
import { recoverUncertainAttempts } from "./index";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "slop-payment-recovery-"));
const databasePath = join(directory, "payments.sqlite");
const sql = new Database(databasePath);
const journal = new Database(join(directory, "executor-journal.sqlite"));
let server: ReturnType<typeof Bun.serve> | undefined;
function statement(
  query: string,
  args: unknown[] = [],
): ReturnType<D1Database["prepare"]> {
  return {
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
  };
}
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
const now = new Date("2026-10-14T00:00:00.000Z");
const timestamp = now.toISOString();
const expiresAt = "2026-10-14T00:15:00.000Z";
const baseWallet = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const solanaSeed = new Uint8Array(32).fill(1);
type PaymentRow = {
  id: string;
  attemptState: string;
  transactionId: string | null;
  obligationState: string;
  outboxState: string;
};
function rows(database: Database = sql) {
  return database
    .query<PaymentRow, []>(
      "SELECT a.id,a.state attemptState,a.transaction_id transactionId,o.state obligationState,b.state outboxState FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id JOIN payment_outbox b ON b.obligation_id=o.id ORDER BY a.rowid",
    )
    .all();
}
try {
  sql.exec("PRAGMA foreign_keys=ON");
  for (const filename of readdirSync(join(root, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sql.exec(readFileSync(join(root, "migrations", filename), "utf8"));
  }
  journal.exec(
    "CREATE TABLE attempts(id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL) STRICT",
  );
  for (const [chain, actor, sequence] of [
    ["base", "101", 1],
    ["solana", "202", 2],
  ] as const) {
    sql
      .query(
        "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `old-${chain}`,
        actor,
        `fixture-${chain}`,
        chain === "base"
          ? "0x0000000000000000000000000000000000000001"
          : "11111111111111111111111111111111",
        "d1_registry",
        `${sequence}`.repeat(64),
        timestamp,
        `${sequence + 2}`.repeat(64),
        timestamp,
        chain,
      );
    sql
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
      )
      .run(
        `obligation-${chain}`,
        `fixture-${chain}`,
        actor,
        `${chain}-local`,
        chain,
        `vault-${chain}`,
        chain === "solana"
          ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
          : "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        6,
        "100000000",
        "2000000",
        `${sequence + 4}`.repeat(64),
        timestamp,
      );
    sql
      .query(
        "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
      )
      .run(`obligation-${chain}`, timestamp);
    sql
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES(?,?,?,?,'unknown')",
      )
      .run(
        `attempt-${chain}`,
        `obligation-${chain}`,
        `old-${chain}`,
        timestamp,
      );
    const address =
      chain === "base"
        ? baseWallet.address.toLowerCase()
        : "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
    const digest = (sequence + 8).toString(16).repeat(64);
    sql
      .query(
        "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `successor-${chain}`,
        actor,
        `fixture-${chain}`,
        address,
        "d1_registry",
        `${sequence + 6}`.repeat(64),
        timestamp,
        digest,
        `old-${chain}`,
        timestamp,
        chain,
      );
    const message = buildPaymentWalletMessage({
      actorId: actor,
      chain,
      address,
      claimId: `successor-${chain}`,
      claimDigest: digest,
      nonce: `challenge-${chain}`,
      expiresAt,
    });
    const signature =
      chain === "base"
        ? await baseWallet.signMessage({ message })
        : Buffer.from(
            ed25519.sign(new TextEncoder().encode(message), solanaSeed),
          ).toString("base64");
    assert(verifyPaymentWalletSignature(chain, address, message, signature));
    sql
      .query(
        "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        `challenge-${chain}`,
        `successor-${chain}`,
        actor,
        message,
        expiresAt,
        timestamp,
      );
    sql
      .query(
        "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
      )
      .run(
        `successor-${chain}`,
        actor,
        timestamp,
        `challenge-${chain}`,
        signature,
      );
    // Use the actual dispatch guard to establish the old-wallet recovery hold.
    assert.equal(
      await dispatchPayment(
        db,
        {
          async submit() {
            throw new Error(
              "Uncertain old-wallet attempt must block a new send",
            );
          },
        },
        `obligation-${chain}`,
        now,
      ),
      "unavailable",
    );
    assert.equal(
      rows().find((row) => row.id === `attempt-${chain}`)?.outboxState,
      "held",
    );
    journal
      .query("INSERT INTO attempts VALUES(?,?)")
      .run(`attempt-${chain}`, `${chain}-journal-transaction`);
  }
  let baseUnavailable = true;
  const requests: { chain: string; status: number }[] = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const chain = new URL(request.url).pathname.split("/")[1];
      assert.equal(
        new URL(request.url).pathname,
        `/${chain}/v1/attempt-status`,
      );
      assert.equal(request.method, "POST");
      assert.deepEqual(await request.json(), {
        idempotencyKey: `attempt-${chain}`,
        obligationId: `obligation-${chain}`,
        network: `${chain}-local`,
        vault: `vault-${chain}`,
      });
      const status = chain === "base" && baseUnavailable ? 503 : 200;
      requests.push({ chain, status });
      if (status === 503)
        return new Response("Local Base executor outage", { status });
      const record = journal
        .query<{ transaction_id: string }, [string]>(
          "SELECT transaction_id FROM attempts WHERE id=?",
        )
        .get(`attempt-${chain}`);
      assert(record);
      return Response.json({
        transactionId: record.transaction_id,
        submitted: true,
      });
    },
  });
  const executorUrl = `http://127.0.0.1:${server.port}`;
  const service = (chain: string) => ({
    async fetch(request: Request) {
      return fetch(`${executorUrl}/${chain}${new URL(request.url).pathname}`, {
        method: request.method,
        headers: request.headers,
        body: await request.text(),
      });
    },
  });
  const env = {
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    PAYMENT_NETWORKS: JSON.stringify(["base-sepolia", "solana-devnet"]),
    PAYMENT_RPC_URLS: "{}",
    EVM_PAYMENT_EXECUTOR: service("base"),
    SOLANA_PAYMENT_EXECUTOR: service("solana"),
  };
  for (let run = 1; run <= 2; run++) {
    let failure: unknown;
    try {
      await recoverUncertainAttempts(env);
    } catch (error) {
      failure = error;
    }
    assert.deepEqual(
      rows(),
      [
        {
          id: "attempt-base",
          attemptState: "unknown",
          transactionId: null,
          obligationState: "reserved",
          outboxState: "held",
        },
        {
          id: "attempt-solana",
          attemptState: "submitted",
          transactionId: "solana-journal-transaction",
          obligationState: "reserved",
          outboxState: "submitted",
        },
      ],
      "The healthy Solana journal must recover despite the earlier Base outage",
    );
    assert(failure instanceof AggregateError);
    assert.equal(failure.errors.length, 1);
    assert.equal(
      failure.errors[0].message,
      "Attempt status reconciliation failed",
    );
    // Read another handle to prove recovery committed while Base stays unavailable.
    const reopened = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(rows(reopened), rows());
    } finally {
      reopened.close();
    }
  }
  assert.deepEqual(requests, [
    { chain: "base", status: 503 },
    { chain: "solana", status: 200 },
    { chain: "base", status: 503 },
    { chain: "solana", status: 200 },
  ]);
  baseUnavailable = false;
  await recoverUncertainAttempts(env);
  assert.deepEqual(rows(), [
    {
      id: "attempt-base",
      attemptState: "submitted",
      transactionId: "base-journal-transaction",
      obligationState: "reserved",
      outboxState: "submitted",
    },
    {
      id: "attempt-solana",
      attemptState: "submitted",
      transactionId: "solana-journal-transaction",
      obligationState: "reserved",
      outboxState: "submitted",
    },
  ]);
  await recoverUncertainAttempts(env);
  assert.equal(
    requests.length,
    7,
    "Reserved Solana attempts keep checking submission while EVM recovery stays complete",
  );
  assert.equal(
    sql
      .query<{ count: number }, []>(
        "SELECT count(*) count FROM payment_attempts",
      )
      .get()?.count,
    2,
  );
  assert.equal(
    sql
      .query<{ count: number }, []>(
        "SELECT count(*) count FROM payment_attempt_failures",
      )
      .get()?.count,
    0,
  );
  console.log(
    "Payment recovery integration passed: Base outage remains reported; held Solana attempt recovers durably; restored Base recovers once. Local journal evidence only, no chain submission or finality.",
  );
} finally {
  server?.stop(true);
  journal.close();
  sql.close();
  rmSync(directory, { recursive: true, force: true });
}
