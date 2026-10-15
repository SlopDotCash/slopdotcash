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
import { dispatchPayment } from "../../backend/payments/dispatch";
import {
  buildPaymentWalletMessage,
  verifyPaymentWalletSignature,
} from "../../backend/payments/possession";
import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import paymentsWorker, {
  type PaymentsWorkerEnvironment,
  recoverUncertainAttempts,
} from "./index";

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
      const prepared = sql.prepare(query);
      try {
        return (prepared.get(...(args as string[])) ?? null) as T | null;
      } finally {
        prepared.finalize();
      }
    },
    async run() {
      const prepared = sql.prepare(query);
      try {
        const result = prepared.run(...(args as string[]));
        return { success: true, meta: { changes: result.changes } };
      } finally {
        prepared.finalize();
      }
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
const baseAttempts = [
  "attempt-base",
  ...Array.from({ length: 32 }, (_, i) => `attempt-base-${i + 1}`),
];
function expectedRows(pendingBase: string[] = []) {
  return [...baseAttempts, "attempt-solana"].map((id) => {
    const pending = pendingBase.includes(id);
    return {
      id,
      attemptState: pending ? "unknown" : "submitted",
      transactionId: pending ? null : `${id}-journal-transaction`,
      obligationState: "reserved",
      outboxState: pending ? "held" : "submitted",
    };
  });
}
function resetAttempts() {
  sql.exec("UPDATE payment_attempts SET state='unknown',transaction_id=NULL");
  sql.exec("UPDATE payment_outbox SET state='held'");
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
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,'reserved',?)",
      )
      .run(
        `obligation-${chain}`,
        `fixture-${chain}`,
        actor,
        `${chain}-local`,
        chain,
        `vault-${chain}`,
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
      .run(`attempt-${chain}`, `attempt-${chain}-journal-transaction`);
    if (chain === "base") {
      // One old wallet can have several reserved awards when its executor fails.
      for (const id of baseAttempts.slice(1)) {
        const obligationId = id.replace("attempt-", "obligation-");
        sql
          .query(
            "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,source_digest,state,created_at) SELECT ?,project_id,github_user_id,network,chain,vault,gross_micro,fee_micro,?,state,created_at FROM payment_obligations WHERE id='obligation-base'",
          )
          .run(
            obligationId,
            baseAttempts.indexOf(id).toString(16).padStart(64, "0"),
          );
        sql
          .query(
            "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'held',?)",
          )
          .run(obligationId, timestamp);
        sql
          .query(
            "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES(?,?,'old-base',?,'unknown')",
          )
          .run(id, obligationId, timestamp);
        journal
          .query("INSERT INTO attempts VALUES(?,?)")
          .run(id, `${id}-journal-transaction`);
      }
    }
  }
  const faults = new Map(baseAttempts.map((id) => [`${id}:status`, 503]));
  const unsigned = new Set<string>();
  const requests: { id: string; operation: string; status: number }[] = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const chain = new URL(request.url).pathname.split("/")[1];
      const operation = new URL(request.url).pathname.endsWith("attempt-status")
        ? "status"
        : "cancel";
      assert.equal(
        new URL(request.url).pathname,
        `/${chain}/v1/${operation === "status" ? "attempt-status" : "cancel-unsubmitted"}`,
      );
      assert.equal(request.method, "POST");
      const body = (await request.json()) as { idempotencyKey: string };
      const id = body.idempotencyKey;
      assert.deepEqual(body, {
        idempotencyKey: id,
        obligationId: id.replace("attempt-", "obligation-"),
        network: `${chain}-local`,
        vault: `vault-${chain}`,
      });
      const status = faults.get(`${id}:${operation}`) ?? 200;
      requests.push({ id, operation, status });
      if (status !== 200)
        return new Response("Local Base executor outage", { status });
      const record = journal
        .query<{ transaction_id: string }, [string]>(
          "SELECT transaction_id FROM attempts WHERE id=?",
        )
        .get(id);
      assert(record);
      if (operation === "cancel")
        return Response.json({
          retired: false,
          transactionId: record.transaction_id,
        });
      if (unsigned.has(id)) return Response.json({ transactionId: null });
      return Response.json({ transactionId: record.transaction_id });
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
    PAYMENT_DEPLOYMENTS: "[]",
    PAYMENT_RPC_URLS: "{}",
    EVM_PAYMENT_EXECUTOR: service("base"),
    SOLANA_PAYMENT_EXECUTOR: service("solana"),
  };
  async function reportedFailure(
    scheduled = false,
    environment: PaymentsWorkerEnvironment = env,
  ) {
    let failure: unknown;
    try {
      if (scheduled) await paymentsWorker.scheduled(undefined, environment);
      else await recoverUncertainAttempts(environment);
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof AggregateError);
    if (scheduled) {
      assert.match(
        failure.message,
        /Payment worker failures: Payment attempt recovery failures/,
      );
      failure = failure.errors[0];
      assert(failure instanceof AggregateError);
    }
    return failure as AggregateError;
  }
  function checkContext(
    failure: AggregateError,
    phase: string,
    status?: number,
  ) {
    assert.equal(failure.errors.length, 1);
    const detail = failure.errors[0];
    assert(detail instanceof Error);
    const context = JSON.stringify({
      attemptId: "attempt-base",
      obligationId: "obligation-base",
      chain: "base",
      network: "base-local",
      phase,
      httpStatus: status,
    });
    assert(detail.message.includes(context));
    assert(failure.message.includes(context));
    assert.match(
      detail.message,
      /Keep the obligation reserved.*retry the same attempt/,
    );
    assert(detail.cause instanceof Error);
    assert.equal(
      detail.cause.message,
      phase === "executor-binding"
        ? "Attempt status service unavailable"
        : phase === "cancel-unsubmitted"
          ? "Unsigned attempt retirement failed"
          : "Attempt status reconciliation failed",
    );
    assert(!detail.message.includes("Local Base executor outage"));
    assert(!detail.message.includes("vault-base"));
    assert(!detail.message.includes("http" + "://"));
  }
  for (let run = 1; run <= 2; run++) {
    const failure = await reportedFailure(run === 2);
    assert.deepEqual(
      rows(),
      expectedRows(baseAttempts),
      "The healthy Solana journal must recover despite the earlier Base outage",
    );
    assert.equal(
      requests.filter((request) => request.status === 503).length,
      run,
      "One service outage must not produce one request per queued attempt",
    );
    checkContext(failure, "attempt-status", 503);
    // Read another handle to prove recovery committed while Base stays unavailable.
    const reopened = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(rows(reopened), rows());
    } finally {
      reopened.close(true);
    }
  }
  assert.deepEqual(requests, [
    { id: "attempt-base", operation: "status", status: 503 },
    { id: "attempt-solana", operation: "status", status: 200 },
    { id: "attempt-base", operation: "status", status: 503 },
  ]);
  faults.clear();
  await recoverUncertainAttempts(env);
  assert.deepEqual(rows(), expectedRows());
  await recoverUncertainAttempts(env);
  assert.equal(
    requests.length,
    36,
    "Recovered attempts must not request or submit again",
  );
  for (const status of [409, 500]) {
    resetAttempts();
    requests.length = 0;
    faults.set("attempt-base:status", status);
    const failure = await reportedFailure();
    assert.deepEqual(
      rows(),
      expectedRows(["attempt-base"]),
      "A record refusal must not defer other records on the same service",
    );
    assert.equal(requests.length, 34);
    checkContext(failure, "attempt-status", status);
    faults.clear();
    await recoverUncertainAttempts(env);
    assert.deepEqual(rows(), expectedRows());
    assert.equal(requests.length, 35);
  }
  resetAttempts();
  requests.length = 0;
  unsigned.add("attempt-base");
  faults.set("attempt-base:cancel", 503);
  checkContext(await reportedFailure(), "cancel-unsubmitted", 503);
  assert.deepEqual(rows(), expectedRows(baseAttempts));
  assert.deepEqual(
    requests,
    [
      { id: "attempt-base", operation: "status", status: 200 },
      { id: "attempt-base", operation: "cancel", status: 503 },
      { id: "attempt-solana", operation: "status", status: 200 },
    ],
    "Cancellation and status must share the same service outage state",
  );
  faults.clear();
  await recoverUncertainAttempts(env);
  assert.deepEqual(rows(), expectedRows());
  await recoverUncertainAttempts(env);
  assert.equal(requests.length, 37);
  resetAttempts();
  requests.length = 0;
  checkContext(
    await reportedFailure(false, { ...env, EVM_PAYMENT_EXECUTOR: undefined }),
    "executor-binding",
  );
  assert.deepEqual(rows(), expectedRows(baseAttempts));
  assert.deepEqual(requests, [
    { id: "attempt-solana", operation: "status", status: 200 },
  ]);
  await recoverUncertainAttempts(env);
  assert.deepEqual(rows(), expectedRows());
  assert.equal(
    sql
      .query<{ count: number }, []>(
        "SELECT count(*) count FROM payment_attempts",
      )
      .get()?.count,
    34,
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
    "Payment recovery integration passed: 33 Base attempts defer after one 503; healthy Solana recovers durably; restored Base retries the same attempts once; 409/500 remain isolated; cancellation shares the outage state; missing bindings report once; scheduler preserves safe failure context. Local journal evidence only, no chain submission or finality.",
  );
} finally {
  server?.stop(true);
  journal.close(true);
  sql.close(true);
  rmSync(directory, { recursive: true, force: true });
}
