import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { D1TransactionalDatabase } from "../../backend/d1";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { recoverUncertainAttempts, runPaymentDispatch, type PaymentsWorkerEnvironment } from "./index";

// Actual entrypoints and migrated SQLite. Service responses are controlled
// observations; these tests do not prove a signer journal, signature or chain.
const at = "2026-11-01T00:00:00.000Z";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const { db, sqlite } = sqliteD1();
  const env: PaymentsWorkerEnvironment = {
    PAYMENTS_DB: db as D1TransactionalDatabase,
    REGISTRY_DB: db as D1TransactionalDatabase,
    PAYMENT_NETWORKS: '["base-sepolia","solana-devnet"]', PAYMENT_RPC_URLS: "{}",
  };
  const add = (n: number, options: {
    network?: string; chain?: string; state?: string; tx?: string | null;
    outbox?: string; leaseUntil?: string | null; withAttempt?: boolean;
  } = {}) => {
    const claim = `claim-${n}`, id = `attempt-${n}`, obligation = `award-${n}`;
    const actor = String(1000 + n), chain = options.chain ?? "base";
    sqlite.query("INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,'fixture-wallet','d1_registry',?,?,?,?,?)")
      .run(claim, actor, `actor-${n}`, digest(claim), at, digest(`record-${n}`), at, chain);
    sqlite.query("INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,'fixture-vault','fixture-asset',6,'100','2',?,'reserved',?)")
      .run(obligation, `project-${n}`, actor, options.network ?? "base-sepolia", chain, digest(obligation), at);
    sqlite.query("INSERT INTO payment_outbox(obligation_id,state,lease_token,lease_until,updated_at) VALUES(?,?,?,?,?)")
      .run(obligation, options.outbox ?? "ready", options.leaseUntil ? `lease-${n}` : null, options.leaseUntil ?? null,
        new Date(Date.parse(at) + n * 1000).toISOString());
    if (options.withAttempt !== false) sqlite.query("INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state,transaction_id) VALUES(?,?,?,?,?,?)")
      .run(id, obligation, claim, at, options.state ?? "unknown", options.tx ?? null);
    return { id, obligation, claim, actor, chain };
  };
  const successor = (old: ReturnType<typeof add>) => {
    const claim = `${old.claim}-new`;
    sqlite.query("INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,'new-wallet','d1_registry',?,?,?,?,?,?)")
      .run(claim, old.actor, `actor-${old.actor}`, digest(claim), at, digest(`${claim}-record`), old.claim, at, old.chain);
    // This fixture seeds the previously admitted authorization. Recovery only
    // joins that record; possession validation belongs to its own entrypoint.
    sqlite.query("INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,'previously admitted message',?,?)")
      .run(`${claim}-challenge`, claim, old.actor, at, at);
    sqlite.query("INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)")
      .run(claim, old.actor, at, `${claim}-challenge`, "previously admitted signature");
  };
  const row = (id: string) => sqlite.query("SELECT state,transaction_id FROM payment_attempts WHERE id=?").get(id) as { state: string; transaction_id: string | null } | null;
  const outbox = (id: string) => sqlite.query("SELECT state,updated_at FROM payment_outbox WHERE obligation_id=?").get(id) as { state: string; updated_at: string } | null;
  return { db, sqlite, env, add, successor, row, outbox };
}

test("one recovery failure does not stop the other captured attempt", async () => {
  const f = fixture();
  const first = f.add(1), second = f.add(2);
  const seen: string[] = [];
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch(request) {
    const body = await request.json() as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "network", "obligationId", "vault"]);
    seen.push(body.idempotencyKey);
    return body.idempotencyKey === first.id ? new Response(null, { status: 503 }) :
      Response.json({ transactionId: "signed-second", submitted: true });
  } };
  try {
    await expect(recoverUncertainAttempts(f.env)).rejects.toThrow("Payment attempt recovery failures");
    expect(new Set(seen)).toEqual(new Set([first.id, second.id]));
    expect(f.row(first.id)).toEqual({ state: "unknown", transaction_id: null });
    expect(f.row(second.id)).toEqual({ state: "submitted", transaction_id: "signed-second" });
    expect(f.outbox(second.obligation)?.state).toBe("submitted");
  } finally { f.sqlite.close(); }
});

test.each([{}, { transactionId: 7, submitted: true }, { transactionId: "signed-without-observation" }])(
  "invalid recovery status %j cannot manufacture a submission", async (status) => {
    const f = fixture(), item = f.add(1);
    f.env.EVM_PAYMENT_EXECUTOR = { async fetch() { return Response.json(status); } };
    try {
      await expect(recoverUncertainAttempts(f.env)).rejects.toThrow("Payment attempt recovery failures");
      expect(f.row(item.id)).toEqual({ state: "unknown", transaction_id: null });
      expect(f.outbox(item.obligation)?.state).toBe("ready");
    } finally { f.sqlite.close(); }
  },
);

test("a null observation with no successor neither cancels nor retires", async () => {
  const f = fixture(), item = f.add(1);
  const paths: string[] = [];
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch(request) {
    paths.push(new URL(request.url).pathname);
    return Response.json({ transactionId: null });
  } };
  try {
    await recoverUncertainAttempts(f.env);
    expect(paths).toEqual(["/v1/attempt-status"]);
    expect(f.row(item.id)).toEqual({ state: "unknown", transaction_id: null });
    expect(f.sqlite.query("SELECT * FROM payment_attempt_failures").all()).toEqual([]);
  } finally { f.sqlite.close(); }
});

test("a cancellation race can disclose the signed attempt instead of retirement", async () => {
  const f = fixture(), item = f.add(1);
  f.successor(item);
  const paths: string[] = [];
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch(request) {
    const path = new URL(request.url).pathname;
    paths.push(path);
    return Response.json(path === "/v1/attempt-status" ? { transactionId: null } :
      { retired: false, transactionId: "signed-during-cancel", submitted: true });
  } };
  try {
    await recoverUncertainAttempts(f.env);
    expect(paths).toEqual(["/v1/attempt-status", "/v1/cancel-unsubmitted"]);
    expect(f.row(item.id)).toEqual({ state: "submitted", transaction_id: "signed-during-cancel" });
    expect(f.outbox(item.obligation)?.state).toBe("submitted");
    expect(f.sqlite.query("SELECT * FROM payment_attempt_failures").all()).toEqual([]);
  } finally { f.sqlite.close(); }
});

test("a malformed cancellation result keeps the original attempt recoverable", async () => {
  const f = fixture(), item = f.add(1);
  f.successor(item);
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch(request) {
    return Response.json(new URL(request.url).pathname === "/v1/attempt-status" ? { transactionId: null } :
      { retired: true, transactionId: "conflicting-signed-transaction" });
  } };
  try {
    await expect(recoverUncertainAttempts(f.env)).rejects.toThrow("Payment attempt recovery failures");
    expect(f.row(item.id)).toEqual({ state: "unknown", transaction_id: null });
    expect(f.outbox(item.obligation)?.state).toBe("ready");
  } finally { f.sqlite.close(); }
});

test("late status retains its transaction receipt without reopening a paid outbox", async () => {
  const f = fixture(), item = f.add(1);
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch() {
    // Represents the independent finalized indexer winning after list capture.
    f.sqlite.query("UPDATE payment_obligations SET state='paid',paid_transaction='indexed-payment' WHERE id=?").run(item.obligation);
    f.sqlite.query("UPDATE payment_outbox SET state='paid' WHERE obligation_id=?").run(item.obligation);
    return Response.json({ transactionId: "retained-attempt", submitted: true });
  } };
  try {
    await recoverUncertainAttempts(f.env);
    expect(f.row(item.id)).toEqual({ state: "submitted", transaction_id: "retained-attempt" });
    expect(f.outbox(item.obligation)?.state).toBe("paid");
    expect(f.sqlite.query("SELECT paid_transaction FROM payment_obligations WHERE id=?").get(item.obligation))
      .toEqual({ paid_transaction: "indexed-payment" });
  } finally { f.sqlite.close(); }
});

test("a committed recovery batch survives its lost reply and is not selected again", async () => {
  const f = fixture(), item = f.add(1);
  let calls = 0, lost = false;
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch() { calls += 1; return Response.json({ transactionId: "retained", submitted: true }); } };
  const db: D1TransactionalDatabase = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      const result = await f.db.batch(statements);
      if (!lost) { lost = true; throw new Error("lost committed recovery reply"); }
      return result;
    },
  };
  try {
    await expect(recoverUncertainAttempts({ ...f.env, PAYMENTS_DB: db })).rejects.toThrow("Payment attempt recovery failures");
    expect(f.row(item.id)).toEqual({ state: "submitted", transaction_id: "retained" });
    await recoverUncertainAttempts(f.env);
    expect(calls).toBe(1);
    expect(f.outbox(item.obligation)?.state).toBe("submitted");
  } finally { f.sqlite.close(); }
});

test("dispatch takes the oldest 50 eligible rows and leaves the next row ready", async () => {
  const f = fixture();
  for (let n = 1; n <= 51; n++) f.add(n, { withAttempt: false });
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch() { throw new Error("walletless work must not reach an executor"); } };
  try {
    await runPaymentDispatch(f.env, () => new Date(Date.parse(at) + 120_000));
    expect(f.sqlite.query("SELECT state,count(*) count FROM payment_outbox GROUP BY state ORDER BY state").all())
      .toEqual([{ state: "held", count: 50 }, { state: "ready", count: 1 }]);
    expect(f.outbox("award-51")?.state).toBe("ready");
    expect(f.sqlite.query("SELECT * FROM payment_attempts").all()).toEqual([]);
  } finally { f.sqlite.close(); }
});

test("dispatch uses strict lease expiry at selection and a fresh per-item timestamp", async () => {
  const f = fixture();
  f.add(1, { withAttempt: false, outbox: "processing", leaseUntil: at });
  const expired = f.add(2, { withAttempt: false, outbox: "processing", leaseUntil: new Date(Date.parse(at) - 1).toISOString() });
  f.add(3, { withAttempt: false, outbox: "processing", leaseUntil: new Date(Date.parse(at) + 10_000).toISOString() });
  f.env.EVM_PAYMENT_EXECUTOR = { async fetch() { throw new Error("walletless work must not reach an executor"); } };
  let clocks = 0;
  try {
    await runPaymentDispatch(f.env, () => new Date(Date.parse(at) + clocks++ * 1000));
    expect(clocks).toBe(2);
    expect(f.outbox("award-1")?.state).toBe("processing");
    expect(f.outbox("award-3")?.state).toBe("processing");
    expect(f.outbox(expired.obligation)).toEqual({ state: "held", updated_at: "2026-11-01T00:00:01.000Z" });
  } finally { f.sqlite.close(); }
});
