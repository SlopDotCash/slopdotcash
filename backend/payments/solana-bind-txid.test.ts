// B-F3 (round 3): the Solana bind handler returns the attester's
// transaction id to the browser but never writes it to D1, so
// reconcileFailedAttempts (which only reads attempts with a transaction id)
// can never see a finalized failed binding, and the attempt id stays stuck.
// The ordinary dispatch path records the id (dispatch.ts); the bind path
// must do the same. Synthetic data only: a stub attester and a local
// JSON-RPC node that reports the binding transaction as finalized-failed.
import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { serveJsonRpc } from "../../tests/payment-test-journal";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { reconcileFailedAttempts } from "../../workers/payments/reconcile";
import { handlePaymentsApi } from "./handler";

const TOKEN = "a".repeat(43);
const OBLIGATION_ID = "e".repeat(64);
const CLAIM_DIGEST = "c".repeat(64);
const SOLANA_TX = "4".repeat(88);
const GENESIS = "fixture-genesis-hash";

async function seeded() {
  const { db, sqlite } = sqliteD1();
  const at = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('alice','123','alice',?,0)",
    )
    .run(at);
  sqlite
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      await sha256Hex(TOKEN),
      "alice",
      new Date(Date.now() + 3600_000).toISOString(),
    );
  sqlite
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim','123','alice','11111111111111111111111111111111','d1_registry',?,?,?,?,'solana')",
    )
    .run("a".repeat(64), at, CLAIM_DIGEST, at);
  sqlite
    .prepare(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES('challenge-1','claim','123','message',?,?)",
    )
    .run(
      new Date(Date.now() + 3600_000).toISOString(),
      new Date(Date.now() - 1000).toISOString(),
    );
  sqlite
    .prepare(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES('claim','123',?,'challenge-1','signature')",
    )
    .run(at);
  sqlite
    .prepare(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?, 'project-1','123','solana-localnet','solana','vault-solana','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',6,'100000000','2000000',?,'reserved',?)",
    )
    .run(OBLIGATION_ID, "a".repeat(64), at);
  sqlite
    .prepare(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('attempt-1',?,'claim',?,'prepared')",
    )
    .run(OBLIGATION_ID, at);
  sqlite
    .prepare(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'submitted',?)",
    )
    .run(OBLIGATION_ID, at);
  return { db, sqlite };
}

function call(
  db: unknown,
  path: string,
  body: Record<string, unknown>,
  attester: { fetch(request: Request): Promise<Response> },
) {
  return handlePaymentsApi(
    new Request(`https://slop.cash/api/v1/payments${path}`, {
      method: "POST",
      headers: {
        cookie: `__Host-slop_points=${TOKEN}`,
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    {
      db: db as never,
      paymentDeployments: [
        {
          network: "solana-localnet",
          chain: "solana",
          vault: "vault-solana",
          programId: "11111111111111111111111111111111",
          projectPda: "11111111111111111111111111111111",
          networkDomain: "b".repeat(64),
        },
      ],
      solanaAttester: attester,
    },
  );
}

function attemptRow(sqlite: {
  query(sql: string): { get(...args: unknown[]): unknown };
}) {
  return sqlite
    .query(
      "SELECT transaction_id transactionId, state FROM payment_attempts WHERE id='attempt-1'",
    )
    .get() as { transactionId: string | null; state: string };
}

test("solana bind persists its transaction id for reconciliation", async () => {
  const { db, sqlite } = await seeded();
  const attester = {
    async fetch(request: Request) {
      const prepare = request.url.endsWith("/v1/pay");
      return Response.json({
        transactionId: SOLANA_TX,
        ...(prepare
          ? { transaction: Buffer.from("prepared-binding").toString("base64") }
          : {}),
      });
    },
  };
  const prepared = await call(
    db,
    "/wallets/solana-bind/prepare",
    { obligationId: OBLIGATION_ID },
    attester,
  );
  expect(prepared.status).toBe(200);
  expect(
    ((await prepared.json()) as { transactionId: string }).transactionId,
  ).toBe(SOLANA_TX);
  // The prepared binding is half-signed and not yet broadcast, but its
  // transaction id is already determined: record it so the attempt is
  // findable once the completed broadcast fails.
  expect(attemptRow(sqlite)).toEqual({
    transactionId: SOLANA_TX,
    state: "prepared",
  });

  const completed = await call(
    db,
    "/wallets/solana-bind/complete",
    {
      obligationId: OBLIGATION_ID,
      transaction: Buffer.from("signed-binding").toString("base64"),
    },
    attester,
  );
  expect(completed.status).toBe(200);
  expect(attemptRow(sqlite)).toEqual({
    transactionId: SOLANA_TX,
    state: "submitted",
  });

  // The finalized failure is now visible to reconciliation: the attempt is
  // marked failed, the failure is recorded, and the outbox reopens.
  const rpc = serveJsonRpc((method) => {
    if (method === "getGenesisHash") return GENESIS;
    if (method === "getTransaction")
      return {
        slot: 42,
        meta: { err: { InstructionError: [0, "Custom:6001"] } },
      };
    throw new Error(`Unexpected RPC method ${method}`);
  });
  try {
    await reconcileFailedAttempts(
      db as never,
      [
        {
          network: "solana-localnet",
          chain: "solana",
          vault: "vault-solana",
        },
      ] as never,
      { "solana-localnet": rpc.url },
      { "solana-localnet": GENESIS },
      new Date("2026-10-14T00:00:00.000Z"),
    );
  } finally {
    rpc.stop();
  }
  expect(attemptRow(sqlite)).toEqual({
    transactionId: SOLANA_TX,
    state: "failed",
  });
  expect(
    sqlite
      .query(
        "SELECT COUNT(*) count FROM payment_attempt_failures WHERE attempt_id='attempt-1'",
      )
      .get() as { count: number },
  ).toEqual({ count: 1 });
  expect(
    sqlite
      .query("SELECT state FROM payment_outbox WHERE obligation_id=?")
      .get(OBLIGATION_ID) as { state: string },
  ).toEqual({ state: "ready" });
});
