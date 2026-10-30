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
      await dispatchPayment(
        database,
        {
          async submit(input) {
            expect(input.idempotencyKey).toBe(keys[0]);
            return { transactionId: "tx-a" };
          },
        },
        obligationId,
        new Date("2026-10-30T00:03:00.000Z"),
      ),
    ).toBe("submitted");
    expect(
      sqlite
        .query(
          "SELECT transaction_id id, state, (SELECT COUNT(*) FROM payment_attempts) n FROM payment_attempts",
        )
        .get(),
    ).toEqual({ id: "tx-a", state: "submitted", n: 1 });
  } finally {
    sqlite.close();
  }
});
