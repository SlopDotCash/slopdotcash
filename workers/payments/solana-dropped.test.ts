// A Solana sendTransaction result is only a signature: the leader can drop the
// transaction and its blockhash then expires. The executor journal replaces an
// expired signature (finalized expiry, no history, finalized obligation re-read),
// but only when the dispatcher calls it again with the same attempt.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dispatchPayment } from "../../backend/payments/dispatch";
import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import { type PaymentDeployment, recoverUncertainAttempts } from "./index";
import { reconcileFailedAttempts } from "./reconcile";

const GENESIS = "fixture-solana-genesis";
const NETWORK = "solana-devnet";
const VAULT = "vault-solana";
const DROPPED = "5".repeat(88);
const timestamp = "2026-10-20T00:00:00.000Z";

let server: ReturnType<typeof Bun.serve>;
let rpcUrl: string;
const rpcMethods: string[] = [];
let status: "dropped" | "confirmed" = "dropped";
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { id, method } = (await request.json()) as {
        id: number;
        method: string;
      };
      rpcMethods.push(method);
      // The signature was accepted by the RPC, then dropped: no finalized
      // transaction exists for it, successful or failed.
      const result =
        method === "getGenesisHash"
          ? GENESIS
          : method === "getTransaction"
            ? null
            : method === "getSignatureStatuses"
              ? {
                  context: { slot: 1 },
                  value: [
                    status === "confirmed"
                      ? {
                          slot: 1,
                          confirmations: 3,
                          err: null,
                          confirmationStatus: "confirmed",
                        }
                      : null,
                  ],
                }
              : undefined;
      if (result === undefined)
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: method },
        });
      return Response.json({ jsonrpc: "2.0", id, result });
    },
  });
  rpcUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

function open() {
  const sql = new Database(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`migrations/${file}`, "utf8"));
  function statement(
    query: string,
    args: unknown[] = [],
  ): ReturnType<D1Database["prepare"]> {
    return {
      bind(...values: unknown[]) {
        return statement(query, values);
      },
      async first<T>() {
        return (sql.query(query).get(...(args as string[])) ??
          null) as T | null;
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
  sql
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "claim-1",
      "202",
      "fixture",
      "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
      "d1_registry",
      "1".repeat(64),
      timestamp,
      "2".repeat(64),
      timestamp,
      "solana",
    );
  sql
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run("challenge-1", "claim-1", "202", "fixture", timestamp, timestamp);
  sql
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run("claim-1", "202", timestamp, "challenge-1", "fixture");
  sql
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
    )
    .run(
      "obligation-1",
      "fixture-solana",
      "202",
      NETWORK,
      "solana",
      VAULT,
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      6,
      "100000000",
      "2000000",
      "3".repeat(64),
      timestamp,
    );
  sql
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
    )
    .run("obligation-1", timestamp);
  return { sql, db };
}

const deployments = [
  {
    projectId: "fixture-solana",
    network: NETWORK,
    chain: "solana",
    vault: VAULT,
  },
] as PaymentDeployment[];

test("a dropped Solana payout signature returns to its executor attempt instead of staying submitted forever", async () => {
  const { sql, db } = open();
  const calls: string[] = [];
  // First dispatch: the executor journals and broadcasts; the RPC accepts the
  // signature, which is all sendTransaction proves.
  expect(
    await dispatchPayment(
      db,
      {
        async submit(input) {
          calls.push(input.idempotencyKey);
          return { transactionId: DROPPED };
        },
      },
      "obligation-1",
      new Date(timestamp),
    ),
  ).toBe("submitted");
  const [attemptId] = calls;

  // Later scheduled runs, in the Worker's order: recovery, reconciliation,
  // dispatch. The transaction never landed, so its blockhash has expired.
  for (let run = 1; run <= 3; run++) {
    const now = new Date(Date.parse(timestamp) + run * 10 * 60 * 1000);
    await recoverUncertainAttempts({
      PAYMENTS_DB: db,
      SOLANA_PAYMENT_EXECUTOR: {
        async fetch() {
          throw new Error("A signed attempt needs no journal recovery");
        },
      },
    } as unknown as Parameters<typeof recoverUncertainAttempts>[0]);
    await reconcileFailedAttempts(
      db,
      deployments,
      { [NETWORK]: rpcUrl },
      { [NETWORK]: GENESIS },
      now,
    );
    await dispatchPayment(
      db,
      {
        async submit(input) {
          // The real executor returns the same signature while it may still
          // land, and replaces it only after finalized blockhash expiry.
          calls.push(input.idempotencyKey);
          return { transactionId: DROPPED };
        },
      },
      "obligation-1",
      now,
    );
  }
  expect(rpcMethods).toContain("getTransaction");
  // No new attempt and no failure record: the same journaled attempt is retried.
  expect(sql.query("SELECT id,state FROM payment_attempts").all()).toEqual([
    { id: attemptId, state: "submitted" },
  ]);
  expect(
    sql.query("SELECT count(*) n FROM payment_attempt_failures").get(),
  ).toEqual({ n: 0 });
  // The executor must be asked again, with the same idempotency key, so it
  // can rebroadcast the same bytes or replace a proven-expired signature.
  expect(calls.length).toBeGreaterThan(1);
  expect(new Set(calls)).toEqual(new Set([attemptId]));
});

test("a landed Solana payout signature that is not finalized yet stays submitted", async () => {
  status = "confirmed";
  try {
    const { sql, db } = open();
    expect(
      await dispatchPayment(
        db,
        {
          async submit() {
            return { transactionId: DROPPED };
          },
        },
        "obligation-1",
        new Date(timestamp),
      ),
    ).toBe("submitted");
    await reconcileFailedAttempts(
      db,
      deployments,
      { [NETWORK]: rpcUrl },
      { [NETWORK]: GENESIS },
      new Date(Date.parse(timestamp) + 60_000),
    );
    // The cluster has the transaction; finality, not a resend, decides it.
    expect(sql.query("SELECT state FROM payment_outbox").all()).toEqual([
      { state: "submitted" },
    ]);
  } finally {
    status = "dropped";
  }
});
