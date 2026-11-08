import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { dispatchPayment } from "./dispatch";
import { indexPaymentEvent } from "./ledger";

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

async function finalizeFixturePayment(
  { database, sqlite }: ReturnType<typeof fixture>,
  transactionId: string,
) {
  sqlite
    .query(`INSERT INTO vault_snapshots
    (project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,
     total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,
     free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at)
    VALUES('project','base-sepolia','base','0x3000000000000000000000000000000000000003',
     '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',6,'100000000','0','0','0','0','0','0','98000000','2000000','0',NULL,'1',?,?)`)
    .run(at, at);
  await indexPaymentEvent(
    database,
    {
      async verifyFinalized(input) {
        return {
          ...input,
          blockId: "block-final",
          projectId: "project",
          network: "base-sepolia",
          chain: "base",
          vault: "0x3000000000000000000000000000000000000003",
          githubUserId: actor,
          grossMicro: "100000000",
          netMicro: "98000000",
          feeMicro: "2000000",
          sourceDigest: digest,
          destination: "0x0000000000000000000000000000000000000004",
        };
      },
    },
    { kind: "paid", obligationId, transactionId, eventIndex: 0 },
    at,
  );
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

test("Quint ambiguous-send trace conforms to migrated SQLite dispatch and finalized ledger", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-dispatch-quint-"));
  const { database, sqlite } = fixture();
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        "formal/models/payment_dispatch.qnt",
        "--backend=typescript",
        "--seed=1",
        "--match=^ambiguousRetryTest$",
        `--out-itf=${join(directory, "trace-{test}-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const trace = JSON.parse(
      readFileSync(join(directory, "trace-ambiguousRetryTest-0.json"), "utf8"),
    ) as {
      states: { s: { outbox: string } }[];
    };
    const expected = trace.states
      .map(({ s }) => s.outbox)
      .filter((state, index, all) => index === 0 || state !== all[index - 1]);
    const actual: string[] = [];
    const observe = () =>
      actual.push(
        (
          sqlite
            .query("SELECT state FROM payment_outbox WHERE obligation_id=?")
            .get(obligationId) as { state: string }
        ).state,
      );
    observe();
    let firstAttempt = "";
    await expect(
      dispatchPayment(
        database,
        {
          async submit(input) {
            firstAttempt = input.idempotencyKey;
            observe();
            throw new Error("response lost");
          },
        },
        obligationId,
        new Date(at),
      ),
    ).rejects.toThrow("response lost");
    observe();
    await expect(
      dispatchPayment(
        database,
        {
          async submit(input) {
            expect(input.idempotencyKey).toBe(firstAttempt);
            observe();
            return { transactionId: "tx-ambiguous-recovered" };
          },
        },
        obligationId,
        new Date(at),
      ),
    ).resolves.toBe("submitted");
    observe();
    await finalizeFixturePayment(
      { database, sqlite },
      "tx-ambiguous-recovered",
    );
    observe();
    expect(actual).toEqual(expected);
    expect(
      sqlite.query("SELECT count(*) count FROM payment_attempts").get(),
    ).toEqual({ count: 1 });
    expect(sqlite.query("SELECT state FROM payment_obligations").get()).toEqual(
      { state: "paid" },
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Quint late original remains payable after a newly authorized wallet replaces it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-late-wallet-quint-"));
  const f = fixture();
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        "formal/models/payment_dispatch.qnt",
        "--backend=typescript",
        "--seed=1",
        "--match=^lateOriginalAfterWalletReplacementTest$",
        `--out-itf=${join(directory, "trace-{test}-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const trace = JSON.parse(
      readFileSync(
        join(directory, "trace-lateOriginalAfterWalletReplacementTest-0.json"),
        "utf8",
      ),
    ) as { states: { s: { outbox: string } }[] };
    const expected = trace.states
      .map(({ s }) => s.outbox)
      .filter((value, index, all) => index === 0 || value !== all[index - 1]);
    const actual: string[] = [];
    const observe = () =>
      actual.push(
        (
          f.sqlite.query("SELECT state FROM payment_outbox").get() as {
            state: string;
          }
        ).state,
      );
    observe();
    const started = deferred<void>();
    const result = deferred<{ transactionId: string }>();
    const dispatch = dispatchPayment(
      f.database,
      {
        async submit(input) {
          expect(input.claimId).toBe(claimId);
          observe();
          started.resolve();
          return result.promise;
        },
      },
      obligationId,
      new Date(at),
    );
    await started.promise;
    f.sqlite
      .query(`INSERT INTO wallet_claims
      (id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,
       record_sha256,supersedes_claim_id,created_at,chain)
      VALUES('successor',?,'contributor','0x0000000000000000000000000000000000000006',
       'd1_registry',?,?,?, ?,?,'base')`)
      .run(actor, "cd".repeat(32), at, "cd".repeat(32), claimId, at);
    f.sqlite
      .query(
        "INSERT INTO payment_wallet_challenges VALUES('successor-challenge','successor',?,'fixture','2026-10-30T01:00:00.000Z',?)",
      )
      .run(actor, at);
    f.sqlite
      .query(
        "INSERT INTO payment_wallet_authorizations VALUES('successor',?,?,'successor-challenge','fixture')",
      )
      .run(actor, at);
    expect(
      f.sqlite.query("SELECT id FROM effective_payment_wallet_claims").get(),
    ).toEqual({ id: "successor" });
    result.resolve({ transactionId: "late-original" });
    expect(await dispatch).toBe("submitted");
    observe();
    await finalizeFixturePayment(f, "late-original");
    observe();
    expect(actual).toEqual(expected);
    expect(
      f.sqlite.query("SELECT claim_id FROM payment_attempts").get(),
    ).toEqual({ claim_id: claimId });
    expect(
      f.sqlite
        .query("SELECT state,paid_transaction FROM payment_obligations")
        .get(),
    ).toEqual({ state: "paid", paid_transaction: "late-original" });
  } finally {
    f.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
