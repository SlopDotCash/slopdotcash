import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { dispatchPayment } from "./dispatch";

const at = "2026-10-30T00:00:00.000Z";
const actor = "123";
const obligationId = "obligation-lease";
const claimId = "claim-lease";
const digest = "ab".repeat(32);

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  sqlite
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      claimId,
      actor,
      "contributor",
      "0x0000000000000000000000000000000000000004",
      "d1_registry",
      digest,
      at,
      digest,
      null,
      at,
      "base",
    );
  sqlite
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "challenge-lease",
      claimId,
      actor,
      "lease",
      "2026-10-30T01:00:00.000Z",
      at,
    );
  sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run(claimId, actor, at, "challenge-lease", "signature");
  sqlite
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?)",
    )
    .run(
      obligationId,
      "project",
      actor,
      "base-sepolia",
      "base",
      "0x3000000000000000000000000000000000000003",
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      6,
      "100000000",
      "2000000",
      digest,
      at,
    );
  sqlite
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
    )
    .run(obligationId, at);
  // The steward row lets the conflict path's payout-exception notice insert.
  const manifest = JSON.stringify({
    id: "project",
    status: "active",
    steward: { github: { actorId: "456" } },
  });
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run("project", manifest, digest, "Approved", at);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run("project", manifest, digest, at, at);
  return { database, sqlite };
}

test("a late dispatch response cannot replace the recorded transaction", async () => {
  const { database, sqlite } = fixture();
  try {
    const keys: string[] = [];
    const firstResult = deferred<{ transactionId: string }>();
    const firstStarted = deferred<void>();
    const first = dispatchPayment(
      database,
      {
        async submit(input) {
          keys.push(input.idempotencyKey);
          firstStarted.resolve();
          return firstResult.promise;
        },
      },
      obligationId,
      new Date(at),
    );
    await firstStarted.promise;
    const secondResult = deferred<{ transactionId: string }>();
    const secondStarted = deferred<void>();
    // The 60s lease has expired, so a second dispatcher may retry the same attempt.
    const second = dispatchPayment(
      database,
      {
        async submit(input) {
          keys.push(input.idempotencyKey);
          secondStarted.resolve();
          return secondResult.promise;
        },
      },
      obligationId,
      new Date("2026-10-30T00:01:01.000Z"),
    );
    await secondStarted.promise;
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    firstResult.resolve({ transactionId: "tx-a" });
    expect(await first).toBe("submitted");
    // A returns submitted while the outbox is still processing under B's
    // lease. B's conflicting id is what settles the row.
    expect(
      sqlite
        .query(
          "SELECT state, lease_token IS NOT NULL AS leased, lease_until FROM payment_outbox",
        )
        .get(),
    ).toEqual({
      state: "processing",
      leased: 1,
      lease_until: "2026-10-30T00:02:01.000Z",
    });
    secondResult.resolve({ transactionId: "tx-b" });
    await expect(second).rejects.toThrow(
      "Submitted transaction conflicts with the recorded attempt",
    );
    expect(
      sqlite
        .query(
          "SELECT transaction_id id, state, (SELECT COUNT(*) FROM payment_attempts) n FROM payment_attempts",
        )
        .get(),
    ).toEqual({ id: "tx-a", state: "submitted", n: 1 });
    expect(
      sqlite
        .query(
          "SELECT state, lease_token, lease_until, updated_at FROM payment_outbox",
        )
        .get(),
    ).toEqual({
      state: "held",
      lease_token: null,
      lease_until: null,
      updated_at: "2026-10-30T00:01:01.000Z",
    });
    expect(
      sqlite
        .query(
          "SELECT event_key, recipient_github_id, kind, subject, action_path FROM notifications ORDER BY event_key",
        )
        .all(),
    ).toEqual([
      {
        event_key: `payout-exception:${obligationId}:2026-10-30T00:01:01.000Z`,
        recipient_github_id: "456",
        kind: "payout_exception",
        subject: "project",
        action_path: "/projects/project",
      },
      {
        event_key: `payout-held:${obligationId}:2026-10-30T00:01:01.000Z`,
        recipient_github_id: actor,
        kind: "payout_held",
        subject: "project",
        action_path: "/earnings",
      },
    ]);
    let submits = 0;
    for (const [index, transactionId] of [
      "tx-c",
      "tx-d",
      "tx-e",
      "tx-f",
      "tx-g",
    ].entries()) {
      expect(
        await dispatchPayment(
          database,
          {
            async submit(input) {
              submits += 1;
              expect(input.idempotencyKey).toBe(keys[0]);
              return { transactionId };
            },
          },
          obligationId,
          new Date(`2026-10-30T00:0${index + 3}:00.000Z`),
        ),
      ).toBe("unavailable");
    }
    expect(submits).toBe(0);
    expect(
      sqlite
        .query(
          "SELECT state, lease_token, (SELECT transaction_id || ':' || state FROM payment_attempts) attempt FROM payment_outbox",
        )
        .get(),
    ).toEqual({
      state: "held",
      lease_token: null,
      attempt: "tx-a:submitted",
    });
  } finally {
    sqlite.close();
  }
});

test("a retry that returns the recorded transaction id submits the outbox", async () => {
  const { database, sqlite } = fixture();
  try {
    const firstResult = deferred<{ transactionId: string }>();
    const firstStarted = deferred<void>();
    const first = dispatchPayment(
      database,
      {
        async submit() {
          firstStarted.resolve();
          return firstResult.promise;
        },
      },
      obligationId,
      new Date(at),
    );
    await firstStarted.promise;
    const secondResult = deferred<{ transactionId: string }>();
    const secondStarted = deferred<void>();
    const second = dispatchPayment(
      database,
      {
        async submit() {
          secondStarted.resolve();
          return secondResult.promise;
        },
      },
      obligationId,
      new Date("2026-10-30T00:01:01.000Z"),
    );
    await secondStarted.promise;
    firstResult.resolve({ transactionId: "tx-a" });
    expect(await first).toBe("submitted");
    expect(
      sqlite.query("SELECT state, lease_until FROM payment_outbox").get(),
    ).toEqual({
      state: "processing",
      lease_until: "2026-10-30T00:02:01.000Z",
    });
    secondResult.resolve({ transactionId: "tx-a" });
    expect(await second).toBe("submitted");
    expect(
      sqlite
        .query(
          "SELECT transaction_id id, state, (SELECT COUNT(*) FROM payment_attempts) n FROM payment_attempts",
        )
        .get(),
    ).toEqual({ id: "tx-a", state: "submitted", n: 1 });
    expect(
      sqlite
        .query("SELECT state, lease_token, lease_until FROM payment_outbox")
        .get(),
    ).toEqual({ state: "submitted", lease_token: null, lease_until: null });
    expect(sqlite.query("SELECT COUNT(*) n FROM notifications").get()).toEqual({
      n: 0,
    });
  } finally {
    sqlite.close();
  }
});
