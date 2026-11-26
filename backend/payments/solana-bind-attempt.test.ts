import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { dispatchPayment } from "./dispatch";
import { handlePaymentsApi } from "./handler";

const actor = "123";
const token = "a".repeat(43);
const obligationId = "b".repeat(64);
const at = "2026-11-16T03:00:00.000Z";
const destination = "DScqtGwFoDTme2Rzdjpdb2w7CtuKc6Z8KF7hMhbx8ugQ";
const vault = "3QZBA7XCw8pfJ1ECnynswkroXVejyTmBUvJFSoR3i2Wp";

async function fixture(id = obligationId, authorized = true, owner = actor) {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  sqlite
    .query(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('member',?,'alice',?,0)",
    )
    .run(actor, at);
  sqlite
    .query("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(await sha256Hex(token), "member", "2099-01-01T00:00:00.000Z");
  sqlite
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim',?,'alice',?,'d1_registry',?,?,?,?, 'solana')",
    )
    .run(actor, destination, "c".repeat(64), at, "d".repeat(64), at);
  sqlite
    .query(
      "INSERT INTO payment_wallet_challenges VALUES('challenge','claim',?,'message',?,?)",
    )
    .run(actor, "2099-01-01T00:00:00.000Z", at);
  if (authorized) {
    sqlite
      .query(
        "INSERT INTO payment_wallet_authorizations VALUES('claim',?,?,'challenge','signature')",
      )
      .run(actor, at);
  }
  sqlite
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,'feed',?,'solana-mainnet','solana',?,'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',6,'1000000','20000',?,'reserved',?)",
    )
    .run(id, owner, vault, "e".repeat(64), at);
  sqlite
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
    )
    .run(id, at);
  const calls: { path: string; body: Record<string, string> }[] = [];
  let reject = false;
  const attester = {
    async fetch(request: Request) {
      calls.push({
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, string>,
      });
      return reject
        ? Response.json({ error: "unavailable" }, { status: 503 })
        : Response.json({
            transactionId: "binding",
            transaction: "cHJlcGFyZWQ=",
          });
    },
  };
  const extra: Record<string, unknown> = {};
  async function call(
    complete = false,
    expectedActor = actor,
    requestedId = id,
  ) {
    const response = await handlePaymentsApi(
      new Request(
        `https://slop.cash/api/v1/payments/wallets/solana-bind/${complete ? "complete" : "prepare"}`,
        {
          method: "POST",
          headers: {
            cookie: `__Host-slop_points=${token}`,
            origin: "https://slop.cash",
            "content-type": "application/json",
            "x-slop-expected-github-id": expectedActor,
          },
          body: JSON.stringify({
            obligationId: requestedId,
            ...(complete ? { transaction: "c2lnbmVk" } : {}),
          }),
        },
      ),
      {
        db: database,
        now: () => new Date(at),
        solanaAttester: attester,
        paymentDeployments: [
          {
            chain: "solana",
            network: "solana-mainnet",
            vault,
            programId: "program",
            projectPda: "project",
            networkDomain: "f".repeat(64),
          },
        ],
        ...extra,
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }
  const attempts = () =>
    sqlite.query("SELECT id,claim_id,state FROM payment_attempts").all() as {
      id: string;
      claim_id: string;
      state: string;
    }[];
  return {
    database,
    sqlite,
    calls,
    call,
    attempts,
    attester,
    extra,
    reject: () => {
      reject = true;
    },
  };
}

test("own Solana binding creates one canonical attempt without a hosted dispatcher", async () => {
  const f = await fixture();
  expect((await f.call()).status).toBe(200);
  expect(f.attempts()).toHaveLength(1);
  expect(f.attempts()[0].state).toBe("prepared");
  expect((await f.call()).status).toBe(200);
  expect(f.attempts()).toHaveLength(1);
  expect(f.calls[0].body.idempotencyKey).toBe(f.calls[1].body.idempotencyKey);
  expect(f.calls[0].body.destination).toBe(destination);
  expect((await f.call(true)).status).toBe(200);
  expect(f.calls[2].path).toBe("/v1/complete-bind");
  f.sqlite.close();
});

test("complete alone cannot create an attempt and an attester failure retains the prepared attempt", async () => {
  const f = await fixture();
  expect((await f.call(true)).status).toBe(409);
  expect(f.attempts()).toHaveLength(0);
  f.reject();
  expect((await f.call()).status).toBe(409);
  expect(f.attempts()).toHaveLength(1);
  const id = f.attempts()[0].id;
  expect((await f.call()).status).toBe(409);
  expect(f.attempts()[0].id).toBe(id);
  f.sqlite.close();
});

test("binding preparation reuses a same-claim unknown attempt", async () => {
  const f = await fixture();
  f.sqlite
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('existing',?,'claim',?,'unknown')",
    )
    .run(obligationId, at);
  expect((await f.call()).status).toBe(200);
  expect(f.calls[0].body.idempotencyKey).toBe("existing");
  expect(f.attempts()).toHaveLength(1);
  f.sqlite.close();
});

for (const state of ["held", "processing", "submitted", "paid"]) {
  test(`binding preparation cannot bypass ${state} outbox`, async () => {
    const f = await fixture();
    f.sqlite.query("UPDATE payment_outbox SET state=?").run(state);
    expect((await f.call()).status).toBe(409);
    expect(f.attempts()).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    f.sqlite.close();
  });
}

test("wrong actor, missing consent, and paid obligations cannot prepare", async () => {
  const f = await fixture();
  expect((await f.call(false, "456")).status).toBe(403);
  expect(f.attempts()).toHaveLength(0);
  const otherActor = await fixture(obligationId, true, "456");
  expect((await otherActor.call()).status).toBe(409);
  expect(otherActor.attempts()).toHaveLength(0);
  expect(otherActor.calls).toHaveLength(0);
  otherActor.sqlite.close();
  const noConsent = await fixture(obligationId, false);
  expect((await noConsent.call()).status).toBe(409);
  expect(noConsent.attempts()).toHaveLength(0);
  noConsent.sqlite.close();
  f.sqlite
    .query(
      "UPDATE payment_obligations SET state='paid',paid_transaction='paid'",
    )
    .run();
  expect((await f.call()).status).toBe(409);
  expect(f.attempts()).toHaveLength(0);
  f.sqlite.close();
});

test("a changed authorized claim cannot replace an unresolved attempt", async () => {
  const f = await fixture();
  f.sqlite
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('existing',?,'claim',?,'unknown')",
    )
    .run(obligationId, at);
  f.sqlite
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain,supersedes_claim_id) VALUES('successor',?,'alice',?,'d1_registry',?,?,?,?, 'solana','claim')",
    )
    .run(actor, destination, "1".repeat(64), at, "2".repeat(64), at);
  f.sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations VALUES('successor',?,?,'challenge','signature')",
    )
    .run(actor, at);
  expect((await f.call()).status).toBe(409);
  expect(f.attempts()).toEqual([
    { id: "existing", claim_id: "claim", state: "unknown" },
  ]);
  expect(f.calls).toHaveLength(0);
  f.sqlite.close();
});

test("self-service first and dispatcher first share one attempt", async () => {
  for (const selfFirst of [true, false]) {
    const f = await fixture();
    let reached: () => void = () => {};
    let finish: (value: { transactionId: string }) => void = () => {};
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const pending = new Promise<{ transactionId: string }>((resolve) => {
      finish = resolve;
    });
    const ids: string[] = [];
    if (selfFirst) expect((await f.call()).status).toBe(200);
    const dispatch = dispatchPayment(
      f.database,
      {
        submit: async (input) => {
          ids.push(input.idempotencyKey);
          reached();
          return pending;
        },
      },
      obligationId,
      new Date(at),
    );
    await started;
    expect((await f.call()).status).toBe(200);
    expect(f.attempts()).toHaveLength(1);
    expect(f.calls.at(-1)?.body.idempotencyKey).toBe(ids[0]);
    finish({ transactionId: "binding" });
    expect(await dispatch).toBe("submitted");
    expect(f.attempts()).toHaveLength(1);
    f.sqlite.close();
  }
});

test("two simultaneous preparations reuse one attempt", async () => {
  const f = await fixture();
  const responses = await Promise.all([f.call(), f.call()]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(f.attempts()).toHaveLength(1);
  expect(new Set(f.calls.map((call) => call.body.idempotencyKey)).size).toBe(1);
  f.sqlite.close();
});

test("private bounty preparation stays in its authorized private database", async () => {
  const f = await fixture();
  const privateId = "9".repeat(64);
  const privateLedger = await fixture(privateId);
  f.extra.securityPayments = {
    db: privateLedger.database,
    solanaAttester: privateLedger.attester,
  };
  f.sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('feed',1,'{}',?,'fixture',?)",
    )
    .run("a".repeat(64), at);
  f.sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('feed','active',1,'{}',?,?,?)",
    )
    .run("a".repeat(64), at, at);
  f.sqlite
    .query(
      "INSERT INTO security_cases(id,project_id,advisory_repository,reporter_github_id,reporter_github_login,submission_state,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at) VALUES('sc_fixture12','feed','owner/repo',?,'alice','claimed','received','not-started','not-applicable','not-applicable','embargoed','private','none',1,?,?)",
    )
    .run(actor, at, at);
  f.sqlite
    .query(
      "INSERT INTO security_settlements(case_id,obligation_id,source_digest,network,vault,asset,asset_decimals,gross_base,fee_base,reporter_github_id,approved_by,approved_at,case_revision,deployment) VALUES('sc_fixture12',?,?,'solana-mainnet',?,'mint',6,'1000000','250000',?,'456',?,1,'{}')",
    )
    .run(privateId, "a".repeat(64), vault, actor, at);
  expect((await f.call(false, actor, privateId)).status).toBe(200);
  expect(f.attempts()).toHaveLength(0);
  expect(privateLedger.attempts()).toHaveLength(1);
  expect(privateLedger.calls[0].path).toBe("/v1/security/pay");
  expect(
    f.sqlite.query("SELECT count(*) n FROM security_case_access_log").get(),
  ).toEqual({ n: 1 });
  f.sqlite.close();
  privateLedger.sqlite.close();
});
