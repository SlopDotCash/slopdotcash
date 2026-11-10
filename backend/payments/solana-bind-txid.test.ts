// B-F3 (round 3): the Solana bind handler returned the attester's
// transaction id to the browser but never wrote it to D1, so
// reconcileFailedAttempts (which only reads attempts with a transaction id)
// could never see a finalized failed binding, and the attempt id stayed stuck.
//
// Rework (remarbical, 2026-11-10): the first fix wrote the bind txid into
// payment_attempts.transaction_id, which is the payment receipt column.
// That polluted the shared attempt row (F1: the next payment dispatch
// reuses the row, broadcasts P, then its guard only matches a NULL or
// P transaction_id, so it threw `Submitted transaction conflicts with the
// recorded attempt` and held the outbox while P stayed invisible to
// reconcile) and silently dropped re-prepared txids (F2: the guard only
// allowed NULL or the same value, so a re-prepare after expiry returned
// 200 with the new txid while D1 still held the old one).
//
// The bind txid now lives in its own columns (binding_transaction_id and
// binding_last_valid_block_height); transaction_id stays the payment
// receipt. Reconcile reads the payment txid when present, else the
// binding txid. A re-prepare may replace the recorded binding only when
// the attester names the expired txid it supersedes; otherwise the
// handler re-reads and answers 409 instead of returning an unrecorded
// txid. Synthetic data only: stub attesters and a local JSON-RPC node.
import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { serveJsonRpc } from "../../tests/payment-test-journal";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { reconcileFailedAttempts } from "../../workers/payments/reconcile";
import { dispatchPayment } from "./dispatch";
import { handlePaymentsApi } from "./handler";

const TOKEN = "a".repeat(43);
const OBLIGATION_ID = "e".repeat(64);
const CLAIM_DIGEST = "c".repeat(64);
const SOLANA_TX = "4".repeat(88);
const BIND_A = "5".repeat(88);
const BIND_B = "6".repeat(88);
const PAYMENT_TX = "7".repeat(88);
const LVBH_A = 100;
const LVBH_B = 200;
const GENESIS = "fixture-genesis-hash";

async function seeded(outboxState = "submitted") {
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
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,?,?)",
    )
    .run(OBLIGATION_ID, outboxState, at);
  // The steward row lets the held path's payout-exception notice insert.
  const manifest = JSON.stringify({
    id: "project-1",
    status: "active",
    steward: { github: { actorId: "456" } },
  });
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run("project-1", manifest, "a".repeat(64), "Approved", at);
  sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run("project-1", manifest, "a".repeat(64), at, at);
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

// The txid reconciliation can see: the payment receipt first, else the
// binding txid. Mirrors the COALESCE in reconcileFailedAttempts.
function attemptRow(sqlite: {
  query(sql: string): { get(...args: unknown[]): unknown };
}) {
  const row = sqlite
    .query("SELECT * FROM payment_attempts WHERE id='attempt-1'")
    .get() as Record<string, unknown>;
  return {
    transactionId: (row.transaction_id as string | null) ?? null,
    bindingTransactionId: (row.binding_transaction_id as string | null) ?? null,
    bindingLastValidBlockHeight:
      (row.binding_last_valid_block_height as number | null) ?? null,
    visibleTransactionId:
      ((row.transaction_id ?? row.binding_transaction_id) as string | null) ??
      null,
    state: row.state as string,
  };
}

function outboxState(sqlite: {
  query(sql: string): { get(...args: unknown[]): unknown };
}) {
  return (
    sqlite
      .query("SELECT state FROM payment_outbox WHERE obligation_id=?")
      .get(OBLIGATION_ID) as { state: string }
  ).state;
}

function failedReconciliation(db: unknown, failingTransactionId: string) {
  const rpc = serveJsonRpc((method, params) => {
    if (method === "getGenesisHash") return GENESIS;
    if (method === "getTransaction") {
      expect((params as unknown[])[0]).toBe(failingTransactionId);
      return {
        slot: 42,
        meta: { err: { InstructionError: [0, "Custom:6001"] } },
      };
    }
    throw new Error(`Unexpected RPC method ${method}`);
  });
  return (async () => {
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
  })();
}

test("solana bind persists its transaction id for reconciliation", async () => {
  const { db, sqlite } = await seeded();
  const attester = {
    async fetch(request: Request) {
      const prepare = request.url.endsWith("/v1/pay");
      return Response.json({
        transactionId: SOLANA_TX,
        lastValidBlockHeight: LVBH_A,
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
  // transaction id is already determined: record it in the binding columns
  // so the attempt is findable once the completed broadcast fails. The
  // payment receipt column stays NULL: no payment has been submitted.
  expect(attemptRow(sqlite)).toEqual({
    transactionId: null,
    bindingTransactionId: SOLANA_TX,
    bindingLastValidBlockHeight: LVBH_A,
    visibleTransactionId: SOLANA_TX,
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
    transactionId: null,
    bindingTransactionId: SOLANA_TX,
    bindingLastValidBlockHeight: LVBH_A,
    visibleTransactionId: SOLANA_TX,
    state: "submitted",
  });

  // The finalized failure is now visible to reconciliation: the attempt is
  // marked failed, the failure is recorded, and the outbox reopens.
  await failedReconciliation(db, SOLANA_TX);
  expect(attemptRow(sqlite)).toEqual({
    transactionId: null,
    bindingTransactionId: SOLANA_TX,
    bindingLastValidBlockHeight: LVBH_A,
    visibleTransactionId: SOLANA_TX,
    state: "failed",
  });
  expect(
    sqlite
      .query(
        "SELECT transaction_id transactionId FROM payment_attempt_failures WHERE attempt_id='attempt-1'",
      )
      .get() as { transactionId: string },
  ).toEqual({ transactionId: SOLANA_TX });
  expect(outboxState(sqlite)).toBe("ready");
});

test("solana bind no longer holds the next payment dispatch", async () => {
  const { db, sqlite } = await seeded("ready");
  const attester = {
    async fetch(request: Request) {
      const prepare = request.url.endsWith("/v1/pay");
      return Response.json({
        transactionId: BIND_B,
        lastValidBlockHeight: LVBH_B,
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

  // The payment dispatch reuses the same attempt row. The bind txid must
  // not block it: dispatch records the payment txid in transaction_id and
  // the row keeps the binding txid in its own column.
  const executor = {
    async submit() {
      return { transactionId: PAYMENT_TX };
    },
  };
  expect(
    await dispatchPayment(db as never, executor, OBLIGATION_ID, new Date()),
  ).toBe("submitted");
  expect(attemptRow(sqlite)).toEqual({
    transactionId: PAYMENT_TX,
    bindingTransactionId: BIND_B,
    bindingLastValidBlockHeight: LVBH_B,
    visibleTransactionId: PAYMENT_TX,
    state: "submitted",
  });
  expect(outboxState(sqlite)).toBe("submitted");

  // The payment txid, not the bind txid, is what reconcile now watches:
  // a finalized failed payment is visible, recorded under the payment
  // txid, and reopens the outbox.
  await failedReconciliation(db, PAYMENT_TX);
  expect(attemptRow(sqlite).state).toBe("failed");
  expect(
    sqlite
      .query(
        "SELECT transaction_id transactionId FROM payment_attempt_failures WHERE attempt_id='attempt-1'",
      )
      .get() as { transactionId: string },
  ).toEqual({ transactionId: PAYMENT_TX });
  expect(outboxState(sqlite)).toBe("ready");
});

test("re-prepare after expiry replaces the recorded binding", async () => {
  const { db, sqlite } = await seeded();
  let prepares = 0;
  const attester = {
    async fetch(request: Request) {
      if (request.url.endsWith("/v1/complete-bind"))
        return Response.json({
          transactionId: BIND_B,
          lastValidBlockHeight: LVBH_B,
        });
      prepares += 1;
      const transaction = Buffer.from("prepared-binding").toString("base64");
      if (prepares === 1)
        return Response.json({
          transactionId: BIND_A,
          transaction,
          lastValidBlockHeight: LVBH_A,
        });
      if (prepares === 2)
        // A divergent re-prepare: a new txid with no proof the recorded
        // one expired. The handler must refuse instead of returning 200
        // with a txid D1 never recorded.
        return Response.json({
          transactionId: BIND_B,
          transaction,
          lastValidBlockHeight: LVBH_B,
        });
      // The attester proves the first attempt expired and names it, so the
      // recorded binding may be replaced.
      return Response.json({
        transactionId: BIND_B,
        transaction,
        lastValidBlockHeight: LVBH_B,
        supersededTransactionId: BIND_A,
      });
    },
  };
  const first = await call(
    db,
    "/wallets/solana-bind/prepare",
    { obligationId: OBLIGATION_ID },
    attester,
  );
  expect(first.status).toBe(200);
  expect(
    ((await first.json()) as { transactionId: string }).transactionId,
  ).toBe(BIND_A);

  const divergent = await call(
    db,
    "/wallets/solana-bind/prepare",
    { obligationId: OBLIGATION_ID },
    attester,
  );
  expect(divergent.status).toBe(409);
  expect(((await divergent.json()) as { error: string }).error).toBe(
    "binding_transaction_conflict",
  );
  expect(attemptRow(sqlite).bindingTransactionId).toBe(BIND_A);

  const expired = await call(
    db,
    "/wallets/solana-bind/prepare",
    { obligationId: OBLIGATION_ID },
    attester,
  );
  expect(expired.status).toBe(200);
  expect(
    ((await expired.json()) as { transactionId: string }).transactionId,
  ).toBe(BIND_B);
  expect(attemptRow(sqlite)).toEqual({
    transactionId: null,
    bindingTransactionId: BIND_B,
    bindingLastValidBlockHeight: LVBH_B,
    visibleTransactionId: BIND_B,
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
  expect(attemptRow(sqlite).state).toBe("submitted");

  // The replacement txid, not the expired one, is what reconcile watches.
  await failedReconciliation(db, BIND_B);
  expect(attemptRow(sqlite).state).toBe("failed");
  expect(
    sqlite
      .query(
        "SELECT transaction_id transactionId FROM payment_attempt_failures WHERE attempt_id='attempt-1'",
      )
      .get() as { transactionId: string },
  ).toEqual({ transactionId: BIND_B });
  expect(outboxState(sqlite)).toBe("ready");
});
