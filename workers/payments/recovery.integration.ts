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
// The worker compares the lease against the real clock, not the fixture one.
const leaseUntil = new Date(Date.now() + 60_000).toISOString();
// Unsigned attempts a dispatcher still holds. The executor journal serializes
// retirement and signing, so a retired attempt is never signed and the
// dispatcher's submit fails on the tombstone; these entries answer that pair.
const retirements = new Map<string, string>();
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
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}
/** Park the dispatcher on one query so recovery can run inside its window. */
function gatedFirst(
  database: D1Database,
  prefix: string,
  reached: () => void,
  gate: Promise<void>,
): D1Database {
  return {
    ...database,
    prepare(query) {
      const statement = database.prepare(query);
      if (!query.startsWith(prefix)) return statement;
      return {
        bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          return {
            run: () => bound.run(),
            async first<T>() {
              const result = await bound.first<T>();
              reached();
              await gate;
              return result;
            },
          };
        },
      } as ReturnType<D1Database["prepare"]>;
    },
  };
}
function digest() {
  return crypto.randomUUID().replaceAll("-", "").repeat(2).slice(0, 64);
}
function claim(
  id: string,
  actor: string,
  login: string,
  wallet: string,
  supersedes: string | null,
) {
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      actor,
      login,
      wallet,
      "d1_registry",
      digest(),
      timestamp,
      digest(),
      supersedes,
      timestamp,
      "base",
    );
}
function authorize(claimId: string, actor: string) {
  sql
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(`challenge-${claimId}`, claimId, actor, claimId, expiresAt, timestamp);
  sql
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run(claimId, actor, timestamp, `challenge-${claimId}`, "signature");
}
/** A reserved award whose attempt a dispatcher is about to pick up, with an
 * authorized successor wallet. `retired` is the claim the attempt hangs on: the
 * old one puts the dispatcher on the held branch, the current one lets it sign
 * while `rotate` replaces the wallet under it. */
function leasedAttempt(
  suffix: string,
  actor: string,
  wallet: string,
  retired: "old" | "current" = "old",
) {
  const old = `old-${suffix}`;
  const current = `current-${suffix}`;
  const next = `next-${suffix}`;
  const obligation = `obligation-${suffix}`;
  const attempt = `attempt-${suffix}`;
  claim(old, actor, `fixture-${suffix}`, wallet, null);
  claim(current, actor, `fixture-${suffix}`, wallet, old);
  authorize(current, actor);
  sql
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
    )
    .run(
      obligation,
      `fixture-${suffix}`,
      actor,
      `base-${suffix}`,
      "base",
      `vault-${suffix}`,
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      6,
      "100000000",
      "2000000",
      digest(),
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES(?,?,?,?,'prepared')",
    )
    .run(attempt, obligation, retired === "old" ? old : current, timestamp);
  sql
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
    )
    .run(obligation, timestamp);
  retirements.set(attempt, obligation);
  return {
    attempt,
    obligation,
    current,
    // A further authorized wallet makes the attempt's claim a retired one.
    rotate() {
      claim(
        next,
        actor,
        `fixture-${suffix}`,
        "0x0000000000000000000000000000000000000007",
        current,
      );
      authorize(next, actor);
    },
  };
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
      const parts = new URL(request.url).pathname.split("/");
      const chain = parts[1];
      const route = `${parts[2]}/${parts[3]}`;
      assert.equal(request.method, "POST");
      assert(["v1/attempt-status", "v1/cancel-unsubmitted"].includes(route));
      const body = (await request.json()) as {
        idempotencyKey: string;
        obligationId: string;
        network: string;
        vault: string;
      };
      if (retirements.has(body.idempotencyKey)) {
        assert.equal(body.obligationId, retirements.get(body.idempotencyKey));
        return Response.json(
          route === "v1/cancel-unsubmitted"
            ? { retired: true, transactionId: null }
            : { transactionId: null },
        );
      }
      assert.equal(route, "v1/attempt-status");
      assert.deepEqual(body, {
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
  // A dispatcher that already took the outbox lease and wrote its prepared
  // attempt is mid-submit. Retirement of that attempt must not free the lease:
  // the dispatcher's own completion batch matches on the lease token, and its
  // attempt update does not accept the failed state retirement writes.
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "old-lease",
      "303",
      "fixture-lease",
      "0x0000000000000000000000000000000000000002",
      "d1_registry",
      "9".repeat(64),
      timestamp,
      "8".repeat(64),
      null,
      timestamp,
      "base",
    );
  sql
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
    )
    .run(
      "obligation-lease",
      "fixture-lease",
      "303",
      "base-local",
      "base",
      "vault-lease",
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      6,
      "100000000",
      "2000000",
      "7".repeat(64),
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES(?,?,?,?,'prepared')",
    )
    .run("attempt-lease", "obligation-lease", "old-lease", timestamp);
  retirements.set("attempt-lease", "obligation-lease");
  sql
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,lease_token,lease_until,updated_at) VALUES(?,'processing',?,?,?)",
    )
    .run("obligation-lease", "lease-holder", leaseUntil, timestamp);
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "successor-lease",
      "303",
      "fixture-lease",
      "0x0000000000000000000000000000000000000003",
      "d1_registry",
      "6".repeat(64),
      timestamp,
      "5".repeat(64),
      "old-lease",
      timestamp,
      "base",
    );
  sql
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "challenge-lease",
      "successor-lease",
      "303",
      "lease fixture",
      expiresAt,
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run("successor-lease", "303", timestamp, "challenge-lease", "signature");
  await recoverUncertainAttempts(env);
  assert.deepEqual(
    sql
      .query<
        { attemptState: string; lease: string | null; outboxState: string },
        []
      >(
        "SELECT a.state attemptState,b.lease_token lease,b.state outboxState FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id WHERE a.id='attempt-lease'",
      )
      .get(),
    {
      attemptState: "failed",
      lease: "lease-holder",
      outboxState: "processing",
    },
    "Retiring an attempt must leave the dispatcher's live lease in place",
  );
  // A dispatcher that read the old attempt just before retirement must not hold
  // the row with only a failed attempt behind it.
  const hold = leasedAttempt(
    "hold",
    "404",
    "0x0000000000000000000000000000000000000004",
  );
  const previousRead = deferred();
  const releaseRead = deferred();
  const heldRun = dispatchPayment(
    gatedFirst(
      db,
      "SELECT id,claim_id FROM payment_attempts",
      () => previousRead.resolve(undefined),
      releaseRead.promise,
    ),
    {
      async submit() {
        throw new Error("A retired attempt must not reach the chain");
      },
    },
    hold.obligation,
    new Date(),
  );
  await previousRead.promise;
  await recoverUncertainAttempts(env);
  releaseRead.resolve();
  assert.equal(await heldRun, "unavailable");
  assert.deepEqual(
    sql
      .query<
        {
          attemptState: string;
          transactionId: string | null;
          lease: string | null;
          outboxState: string;
        },
        [string]
      >(
        "SELECT a.state attemptState,a.transaction_id transactionId,b.lease_token lease,b.state outboxState FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id WHERE a.obligation_id=?",
      )
      .all(hold.obligation),
    [
      {
        attemptState: "failed",
        transactionId: null,
        lease: null,
        outboxState: "ready",
      },
    ],
    "A held branch that lost its attempt to retirement must free the row",
  );
  const destinations: string[] = [];
  assert.equal(
    await dispatchPayment(
      db,
      {
        async submit(input) {
          destinations.push(input.destination);
          return { transactionId: "hold-retry" };
        },
      },
      hold.obligation,
      new Date(),
    ),
    "submitted",
  );
  assert.deepEqual(destinations, [
    "0x0000000000000000000000000000000000000004",
  ]);
  assert.equal(
    sql
      .query<{ count: number }, [string]>(
        "SELECT count(*) count FROM payment_attempts WHERE obligation_id=?",
      )
      .get(hold.obligation)?.count,
    2,
    "The successor claim must dispatch once, without repeating the retired attempt",
  );
  // A submit that returns after retirement keeps its receipt on the same row.
  const late = leasedAttempt(
    "late",
    "505",
    "0x0000000000000000000000000000000000000005",
    "current",
  );
  const submitReached = deferred();
  const submitResult = deferred<{ transactionId: string }>();
  const lateRun = dispatchPayment(
    db,
    {
      async submit() {
        submitReached.resolve(undefined);
        return submitResult.promise;
      },
    },
    late.obligation,
    new Date(),
  );
  await submitReached.promise;
  late.rotate();
  await recoverUncertainAttempts(env);
  submitResult.resolve({ transactionId: "late-journal-transaction" });
  assert.equal(await lateRun, "submitted");
  assert.deepEqual(
    sql
      .query<
        {
          attemptState: string;
          transactionId: string | null;
          lease: string | null;
          outboxState: string;
        },
        [string]
      >(
        "SELECT a.state attemptState,a.transaction_id transactionId,b.lease_token lease,b.state outboxState FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id WHERE a.obligation_id=?",
      )
      .all(late.obligation),
    [
      {
        attemptState: "submitted",
        transactionId: "late-journal-transaction",
        lease: null,
        outboxState: "submitted",
      },
    ],
    "A submission that lands after retirement must keep its transaction on the retired row",
  );
  assert.equal(
    sql
      .query<{ kind: string }, [string]>(
        "SELECT json_extract(evidence_json,'$.kind') kind FROM payment_attempt_failures WHERE attempt_id=?",
      )
      .get(late.attempt)?.kind,
    "unsigned-attempt-retired",
  );
  // The contract case: the tombstone wins, so the submit reports an uncertain
  // failure. The attempt stays failed and the freed row dispatches again.
  const uncertain = leasedAttempt(
    "uncertain",
    "606",
    "0x0000000000000000000000000000000000000006",
    "current",
  );
  const rejectReached = deferred();
  const rejectResult = deferred<{ transactionId: string }>();
  const rejectedRun = dispatchPayment(
    db,
    {
      async submit() {
        rejectReached.resolve(undefined);
        return rejectResult.promise;
      },
    },
    uncertain.obligation,
    new Date(),
  );
  await rejectReached.promise;
  uncertain.rotate();
  await recoverUncertainAttempts(env);
  rejectResult.reject(new Error("Retired before signing"));
  await assert.rejects(rejectedRun, /Retired before signing/);
  assert.deepEqual(
    sql
      .query<
        {
          attemptState: string;
          transactionId: string | null;
          lease: string | null;
          outboxState: string;
        },
        [string]
      >(
        "SELECT a.state attemptState,a.transaction_id transactionId,b.lease_token lease,b.state outboxState FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id WHERE a.obligation_id=?",
      )
      .all(uncertain.obligation),
    [
      {
        attemptState: "failed",
        transactionId: null,
        lease: null,
        outboxState: "ready",
      },
    ],
    "An uncertain submit against a retirement must leave a retryable row",
  );
  const uncertainDestinations: string[] = [];
  assert.equal(
    await dispatchPayment(
      db,
      {
        async submit(input) {
          uncertainDestinations.push(input.destination);
          return { transactionId: "uncertain-retry" };
        },
      },
      uncertain.obligation,
      new Date(),
    ),
    "submitted",
  );
  assert.deepEqual(uncertainDestinations, [
    "0x0000000000000000000000000000000000000007",
  ]);
  // A Solana row marked submitted whose journal holds no transaction: the
  // executor never saw the saved bytes, and a successor wallet exists. The row
  // must retire like an unsigned attempt, not keep a submitted receipt.
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "old-solana-submitted",
      "707",
      "fixture-solana-submitted",
      "11111111111111111111111111111111",
      "d1_registry",
      "b".repeat(64),
      timestamp,
      "c".repeat(64),
      null,
      timestamp,
      "solana",
    );
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "successor-solana-submitted",
      "707",
      "fixture-solana-submitted",
      "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
      "d1_registry",
      "d".repeat(64),
      timestamp,
      "e".repeat(64),
      "old-solana-submitted",
      timestamp,
      "solana",
    );
  sql
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "challenge-solana-submitted",
      "successor-solana-submitted",
      "707",
      "solana submitted fixture",
      expiresAt,
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run(
      "successor-solana-submitted",
      "707",
      timestamp,
      "challenge-solana-submitted",
      "signature",
    );
  sql
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
    )
    .run(
      "obligation-solana-submitted",
      "fixture-solana-submitted",
      "707",
      "solana-local",
      "solana",
      "vault-solana-submitted",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      6,
      "100000000",
      "2000000",
      "f".repeat(64),
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,transaction_id,created_at,state) VALUES(?,?,?,?,?,'submitted')",
    )
    .run(
      "attempt-solana-submitted",
      "obligation-solana-submitted",
      "old-solana-submitted",
      "forgotten-solana-transaction",
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'submitted',?)",
    )
    .run("obligation-solana-submitted", timestamp);
  retirements.set("attempt-solana-submitted", "obligation-solana-submitted");
  await recoverUncertainAttempts(env);
  assert.deepEqual(
    sql
      .query<
        {
          attemptState: string;
          transactionId: string | null;
          outboxState: string;
        },
        [string]
      >(
        "SELECT a.state attemptState,a.transaction_id transactionId,b.state outboxState FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id WHERE a.obligation_id=?",
      )
      .all("obligation-solana-submitted"),
    [
      {
        attemptState: "failed",
        transactionId: null,
        outboxState: "ready",
      },
    ],
    "A submitted Solana row without a journal transaction must retire to a dispatchable row",
  );
  assert.equal(
    await dispatchPayment(
      db,
      {
        async submit(input) {
          assert.equal(
            input.destination,
            "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
          );
          return { transactionId: "solana-submitted-retry" };
        },
      },
      "obligation-solana-submitted",
      new Date(),
    ),
    "submitted",
  );
  assert.deepEqual(
    sql
      .query<
        {
          attemptState: string;
          transactionId: string | null;
          outboxState: string;
        },
        [string]
      >(
        "SELECT a.state attemptState,a.transaction_id transactionId,b.state outboxState FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id WHERE a.obligation_id=? ORDER BY a.rowid",
      )
      .all("obligation-solana-submitted"),
    [
      {
        attemptState: "failed",
        transactionId: null,
        outboxState: "submitted",
      },
      {
        attemptState: "submitted",
        transactionId: "solana-submitted-retry",
        outboxState: "submitted",
      },
    ],
    "The replacement attempt must own the receipt instead of the retired row",
  );
  assert.equal(
    sql
      .query<{ kind: string }, [string]>(
        "SELECT json_extract(evidence_json,'$.kind') kind FROM payment_attempt_failures WHERE attempt_id=?",
      )
      .get("attempt-solana-submitted")?.kind,
    "unsigned-attempt-retired",
  );
  console.log(
    "Payment recovery integration passed: Base outage remains reported; held Solana attempt recovers durably; restored Base recovers once; a live lease survives retirement and both dispatcher outcomes leave a dispatchable row; a submitted Solana row without a journal transaction retires and dispatches again. Local journal evidence only, no chain submission or finality.",
  );
} finally {
  server?.stop(true);
  journal.close();
  sql.close();
  rmSync(directory, { recursive: true, force: true });
}
