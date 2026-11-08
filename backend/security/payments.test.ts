import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import {
  ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { isNotificationEventKey } from "../../src/lib/notifications";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase } from "../d1";
import { dispatchPayment } from "../payments/dispatch";
import { buildPaymentWalletMessage } from "../payments/possession";
import { securityPaymentDatabase } from "./payment-database";
import {
  securityLedgerPolicy,
  securityPaymentNotices,
  securitySettlementView,
} from "./payments";

const t0 = "2026-10-30T00:00:00.000Z";
const t1 = "2026-10-30T00:01:05.000Z";
const t2 = "2026-10-30T00:03:00.000Z";
const address = (byte: string) => `0x${byte.repeat(20)}`;
const baseAsset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

const deployment: EscrowDeployment = {
  network: "base-sepolia",
  vault: address("a1"),
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset: baseAsset,
  owner: address("b2"),
  identityAuthority: address("c3"),
  feeRecipient: address("d4"),
  deploymentTransaction: `0x${"0d".repeat(32)}`,
  sourceCommit: "a".repeat(40),
  codeSha256: "11".repeat(32),
  bindingDelaySeconds: "0",
  rotationDelaySeconds: null,
  factory: address("e5"),
  factoryCodeSha256: "22".repeat(32),
  registrar: address("f6"),
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(obligationId = `0x${"71".repeat(32)}`) {
  const { db, sqlite } = sqliteD1();
  const registryDb = db as unknown as D1TransactionalDatabase;
  const privateDb = securityPaymentDatabase(registryDb);
  const manifest = JSON.stringify({
    id: "project-sec",
    status: "active",
    steward: { github: { actorId: "456" } },
    securityBounty: {
      approvers: {
        financial: [{ githubId: "456" }],
        technical: [{ githubId: "789" }],
      },
      settlement: {
        schemaVersion: "1",
        effectiveCycle: "2026-10",
        chain: "base",
        feeBasisPoints: 2500,
        withdrawalFeeBasisPoints: ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
        feeMode: "deduct-from-gross",
        deployments: [deployment],
      },
    },
  });
  const manifestDigest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('project-sec',1,?,?,'Approved',?)",
    )
    .run(manifest, manifestDigest, t0);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('project-sec','active',1,?,?,?,?)",
    )
    .run(manifest, manifestDigest, t0, t0);

  const record = {
    ...paymentDeploymentRecord("project-sec", deployment),
    payoutPolicy: "security-bounty",
  };
  const sourceDigest = createHash("sha256").update(obligationId).digest("hex");
  sqlite
    .query(
      "INSERT INTO security_cases(id,project_id,advisory_repository,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,policy_revision,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at) VALUES('sc_notice_case01','project-sec','org/repo','101','alice','verified',?,?,'456',1,'{}','confirmed','resolved','approved','not-applicable','embargoed','private','none',1,?,?)",
    )
    .run(t0, t0, t0, t0);
  sqlite
    .query(
      "INSERT INTO security_settlements(case_id,obligation_id,source_digest,network,vault,asset,asset_decimals,gross_base,fee_base,reporter_github_id,approved_by,approved_at,case_revision,deployment) VALUES('sc_notice_case01',?,?,?,?,?,6,'100000000','25000000','101','456',?,1,?)",
    )
    .run(
      obligationId,
      sourceDigest,
      record.network,
      record.vault,
      record.asset,
      t0,
      JSON.stringify(record),
    );
  sqlite
    .query(
      "INSERT INTO security_payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,'project-sec','101',?,?,?,?,6,'100000000','25000000',?,'reserved',?)",
    )
    .run(
      obligationId,
      record.network,
      record.chain,
      record.vault,
      record.asset,
      sourceDigest,
      t0,
    );
  sqlite
    .query(
      "INSERT INTO security_payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
    )
    .run(obligationId, t0);

  async function authorize(
    claimId: string,
    key: string,
    supersedes: string | null = null,
  ) {
    const wallet = privateKeyToAccount(`0x${key.repeat(64)}`);
    const digest = createHash("sha256").update(claimId).digest("hex");
    const expiresAt = "2026-10-30T00:15:00.000Z";
    sqlite
      .query(
        "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,'101','alice',?,'d1_registry',?,?,?,?,?,'base')",
      )
      .run(
        claimId,
        wallet.address.toLowerCase(),
        digest,
        t0,
        digest,
        supersedes,
        t0,
      );
    const message = buildPaymentWalletMessage({
      actorId: "101",
      chain: "base",
      address: wallet.address.toLowerCase(),
      claimId,
      claimDigest: digest,
      nonce: `challenge-${claimId}`,
      expiresAt,
    });
    sqlite
      .query(
        "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,'101',?,?,?)",
      )
      .run(`challenge-${claimId}`, claimId, message, expiresAt, t0);
    sqlite
      .query(
        "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,'101',?,?,?)",
      )
      .run(
        claimId,
        t0,
        `challenge-${claimId}`,
        await wallet.signMessage({ message }),
      );
  }

  const heldNotices = (id: string, at: string) =>
    securityPaymentNotices(registryDb, id, "held", at);

  return {
    db,
    sqlite,
    registryDb,
    privateDb,
    obligationId,
    sourceDigest,
    authorize,
    heldNotices,
  };
}

test("retiring an unsigned attempt during a live dispatch lease leaves the outbox ready without held notices", async () => {
  const f = fixture();
  try {
    await f.authorize("claim-1", "1");
    f.sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('attempt-1',?,'claim-1',?,NULL,'unknown')",
      )
      .run(f.obligationId, t0);
    await f.authorize("claim-2", "2", "claim-1");

    const loadedPrevious = deferred();
    const allowFinish = deferred();
    const pausedDb: D1TransactionalDatabase = {
      prepare(sql: string) {
        const inner = f.privateDb.prepare(sql);
        if (!sql.includes("FROM payment_attempts WHERE obligation_id=?"))
          return inner;
        const wrap = (stmt: ReturnType<typeof inner.bind>): typeof stmt => ({
          ...stmt,
          bind: (...args: unknown[]) => wrap(stmt.bind(...args)),
          async first<T>() {
            const row = await stmt.first<T>();
            loadedPrevious.resolve();
            await allowFinish.promise;
            return row;
          },
        });
        return wrap(inner);
      },
      batch: (statements) => f.privateDb.batch(statements),
    };

    const run = dispatchPayment(
      pausedDb,
      {
        async submit() {
          throw new Error("Unexpected submit while replacing wallet");
        },
      },
      f.obligationId,
      new Date(t0),
      f.heldNotices,
    );

    await loadedPrevious.promise;
    // Recovery retires the unsigned old-wallet attempt while the lease is live.
    f.sqlite
      .query(
        "UPDATE security_payment_attempts SET state='failed',transaction_id=NULL WHERE id='attempt-1'",
      )
      .run();
    allowFinish.resolve();

    expect(await run).toBe("unavailable");
    expect(
      (await securitySettlementView(f.db, "sc_notice_case01"))?.state,
    ).toBe("ready");
    expect(
      f.sqlite
        .query("SELECT event_key, recipient_github_id FROM notifications")
        .all(),
    ).toEqual([]);
    expect(
      f.sqlite
        .query("SELECT COUNT(*) n FROM security_notification_outbox")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    f.sqlite.close();
  }
});

test("an expired private dispatch lease overtaken by submission or payout emits no stale held notice", async () => {
  const f = fixture();
  try {
    await f.authorize("claim-1", "3");
    const firstSubmitEntered = deferred();
    const releaseStaleConflict = deferred<{ transactionId: string }>();

    const stale = dispatchPayment(
      f.privateDb,
      {
        async submit() {
          firstSubmitEntered.resolve();
          return releaseStaleConflict.promise;
        },
      },
      f.obligationId,
      new Date(t0),
      f.heldNotices,
    );
    await firstSubmitEntered.promise;

    // Lease expires after 60s; the next dispatcher submits and chain finality pays it.
    expect(
      await dispatchPayment(
        f.privateDb,
        {
          async submit() {
            return { transactionId: `0x${"aa".repeat(32)}` };
          },
        },
        f.obligationId,
        new Date(t1),
        f.heldNotices,
      ),
    ).toBe("submitted");
    f.sqlite
      .query(
        "UPDATE security_payment_obligations SET state='paid',paid_transaction=? WHERE id=?",
      )
      .run(`0x${"aa".repeat(32)}`, f.obligationId);
    f.sqlite
      .query(
        "UPDATE security_payment_outbox SET state='paid',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=?",
      )
      .run(t1, f.obligationId);

    // The stalled dispatcher now returns a conflicting tx ID with an expired lease.
    releaseStaleConflict.resolve({ transactionId: `0x${"bb".repeat(32)}` });
    await expect(stale).rejects.toThrow(
      "Submitted transaction conflicts with the recorded attempt",
    );

    expect(
      (await securitySettlementView(f.db, "sc_notice_case01"))?.state,
    ).toBe("paid");
    expect(
      f.sqlite
        .query(
          "SELECT event_key FROM notifications WHERE event_key LIKE 'security-payment:%:held%'",
        )
        .all(),
    ).toEqual([]);
    expect(
      f.sqlite
        .query("SELECT COUNT(*) n FROM security_notification_outbox")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    f.sqlite.close();
  }
});

test("distinct private holds each notify recipients once while ledger reserved/paid notices remain gated on obligation state", async () => {
  const f = fixture();
  try {
    // Hold 1: reporter has not authorized a wallet yet.
    expect(
      await dispatchPayment(
        f.privateDb,
        {
          async submit() {
            throw new Error("Unexpected submit without wallet");
          },
        },
        f.obligationId,
        new Date(t0),
        f.heldNotices,
      ),
    ).toBe("unavailable");
    expect(
      (await securitySettlementView(f.db, "sc_notice_case01"))?.state,
    ).toBe("held");
    expect(
      f.sqlite
        .query(
          "SELECT recipient_github_id FROM notifications WHERE event_key=? ORDER BY recipient_github_id",
        )
        .all(`security-payment:${f.obligationId}:held:${t0}`),
    ).toEqual([
      { recipient_github_id: "101" },
      { recipient_github_id: "456" },
      { recipient_github_id: "789" },
    ]);

    // Reporter authorizes wallet 1, an attempt becomes unknown, then wallet 2 supersedes it -> Hold 2 at t2.
    await f.authorize("claim-1", "4");
    f.sqlite
      .query(
        "UPDATE security_payment_outbox SET state='ready',updated_at=? WHERE obligation_id=?",
      )
      .run(t1, f.obligationId);
    f.sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('attempt-u',?,'claim-1',?,NULL,'unknown')",
      )
      .run(f.obligationId, t1);
    await f.authorize("claim-2", "5", "claim-1");

    expect(
      await dispatchPayment(
        f.privateDb,
        {
          async submit() {
            throw new Error("Unexpected submit with unknown prior attempt");
          },
        },
        f.obligationId,
        new Date(t2),
        f.heldNotices,
      ),
    ).toBe("unavailable");
    expect(
      f.sqlite
        .query(
          "SELECT DISTINCT event_key FROM notifications WHERE event_key LIKE 'security-payment:%:held%' ORDER BY event_key",
        )
        .all(),
    ).toEqual([
      { event_key: `security-payment:${f.obligationId}:held:${t0}` },
      {
        event_key: `security-payment:${f.obligationId}:held:attempt-u:unknown`,
      },
    ]);

    // Replaying the same hold timestamp is idempotent; ledger reserved/paid notices still emit once.
    await f.registryDb.batch(await f.heldNotices(f.obligationId, t2));
    const policy = securityLedgerPolicy(f.registryDb);
    await f.registryDb.batch(
      await policy.notices(
        {
          kind: "reserved",
          network: "base-sepolia",
          chain: "base",
          vault: deployment.vault,
          projectId: "project-sec",
          obligationId: f.obligationId,
          githubUserId: "101",
          grossMicro: "100000000",
          feeMicro: "25000000",
          netMicro: "75000000",
          sourceDigest: f.sourceDigest,
          transactionId: `0x${"cc".repeat(32)}`,
          eventIndex: 0,
          blockId: `0x${"dd".repeat(32)}`,
        },
        t0,
      ),
    );
    // A `paid` notice while the obligation is still `reserved` writes nothing,
    // and emits once after the obligation transitions to `paid`.
    const paidEvent = {
      kind: "paid" as const,
      network: "base-sepolia",
      chain: "base" as const,
      vault: deployment.vault,
      projectId: "project-sec",
      obligationId: f.obligationId,
      githubUserId: "101",
      grossMicro: "100000000",
      feeMicro: "25000000",
      netMicro: "75000000",
      sourceDigest: f.sourceDigest,
      destination: address("44"),
      transactionId: `0x${"ee".repeat(32)}`,
      eventIndex: 1,
      blockId: `0x${"ff".repeat(32)}`,
    };
    await f.registryDb.batch(await policy.notices(paidEvent, t2));
    expect(
      f.sqlite
        .query(
          "SELECT DISTINCT event_key FROM notifications ORDER BY event_key",
        )
        .all(),
    ).toEqual([
      { event_key: `security-payment:${f.obligationId}:held:${t0}` },
      {
        event_key: `security-payment:${f.obligationId}:held:attempt-u:unknown`,
      },
      { event_key: `security-payment:${f.obligationId}:reserved` },
    ]);
    expect(
      f.sqlite
        .query("SELECT COUNT(*) n FROM security_notification_outbox")
        .get(),
    ).toEqual({ n: 9 });

    f.sqlite
      .query(
        "UPDATE security_payment_obligations SET state='paid',paid_transaction=? WHERE id=?",
      )
      .run(paidEvent.transactionId, f.obligationId);
    await f.registryDb.batch(await policy.notices(paidEvent, t2));
    expect(
      f.sqlite
        .query(
          "SELECT DISTINCT event_key FROM notifications ORDER BY event_key",
        )
        .all(),
    ).toEqual([
      { event_key: `security-payment:${f.obligationId}:held:${t0}` },
      {
        event_key: `security-payment:${f.obligationId}:held:attempt-u:unknown`,
      },
      { event_key: `security-payment:${f.obligationId}:paid` },
      { event_key: `security-payment:${f.obligationId}:reserved` },
    ]);
    expect(
      f.sqlite
        .query("SELECT COUNT(*) n FROM security_notification_outbox")
        .get(),
    ).toEqual({ n: 12 });
  } finally {
    f.sqlite.close();
  }
});

test("cron ready-to-held reopens with the same open attempt stay flat at one private held notice per cause", async () => {
  const f = fixture();
  try {
    const cronReopen = (at: string) =>
      f.privateDb
        .prepare(`INSERT INTO payment_outbox(obligation_id,state,updated_at)
        SELECT o.id,'ready',? FROM payment_obligations o JOIN effective_payment_wallet_claims w
        ON w.github_user_id=o.github_user_id AND w.chain=o.chain
        JOIN payment_wallet_authorizations a ON a.claim_id=w.id
        WHERE o.state='reserved'
        ON CONFLICT(obligation_id) DO UPDATE SET state='ready',updated_at=excluded.updated_at WHERE payment_outbox.state='held'`)
        .bind(at)
        .run();

    // Cause 1: replaced wallet with an open `unknown` prior attempt on claim-1.
    await f.authorize("claim-1", "6");
    f.sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('attempt-u',?,'claim-1',?,NULL,'unknown')",
      )
      .run(f.obligationId, t0);
    await f.authorize("claim-2", "7", "claim-1");

    expect(
      await dispatchPayment(
        f.privateDb,
        {
          async submit() {
            throw new Error("Unexpected submit while replacing wallet");
          },
        },
        f.obligationId,
        new Date(t0),
        f.heldNotices,
      ),
    ).toBe("unavailable");

    // Three scheduled cron reopens (+5m, +10m, +15m) on unmodified development SQL.
    for (const tick of [
      "2026-10-30T00:05:00.000Z",
      "2026-10-30T00:10:00.000Z",
      "2026-10-30T00:15:00.000Z",
    ]) {
      await cronReopen(tick);
      expect(
        await dispatchPayment(
          f.privateDb,
          {
            async submit() {
              throw new Error("Unexpected submit during cron reopen");
            },
          },
          f.obligationId,
          new Date(tick),
          f.heldNotices,
        ),
      ).toBe("unavailable");
    }

    expect(
      f.sqlite.query("SELECT COUNT(*) n FROM notifications").get(),
    ).toEqual({ n: 3 });
    expect(
      f.sqlite
        .query(
          "SELECT DISTINCT event_key FROM notifications ORDER BY event_key",
        )
        .all(),
    ).toEqual([
      {
        event_key: `security-payment:${f.obligationId}:held:attempt-u:unknown`,
      },
    ]);
    expect(
      f.sqlite
        .query("SELECT COUNT(*) n FROM security_notification_outbox")
        .get(),
    ).toEqual({ n: 3 });

    // Cause 2: attempt-u retires to `failed`; a new UUID attempt on claim-2 hits a submitted-tx conflict and also survives cron reopens without churn.
    const conflictAttemptId = "550e8400-e29b-41d4-a716-446655440000";
    f.sqlite
      .query(
        "UPDATE security_payment_attempts SET state='failed',transaction_id=NULL WHERE id='attempt-u'",
      )
      .run();
    f.sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES(?,?,'claim-2','2026-10-30T00:18:00.000Z',?,'submitted')",
      )
      .run(conflictAttemptId, f.obligationId, `0x${"a1".repeat(32)}`);

    for (const tick of [
      "2026-10-30T00:20:00.000Z",
      "2026-10-30T00:25:00.000Z",
      "2026-10-30T00:30:00.000Z",
    ]) {
      await cronReopen(tick);
      await expect(
        dispatchPayment(
          f.privateDb,
          {
            async submit() {
              return { transactionId: `0x${"b2".repeat(32)}` };
            },
          },
          f.obligationId,
          new Date(tick),
          f.heldNotices,
        ),
      ).rejects.toThrow(
        "Submitted transaction conflicts with the recorded attempt",
      );
    }

    const keys = f.sqlite
      .query<{ event_key: string }, []>(
        "SELECT DISTINCT event_key FROM notifications ORDER BY event_key",
      )
      .all()
      .map((row) => row.event_key);
    expect(keys).toEqual([
      `security-payment:${f.obligationId}:held:${conflictAttemptId}:submitted`,
      `security-payment:${f.obligationId}:held:attempt-u:unknown`,
    ]);
    for (const key of keys) expect(isNotificationEventKey(key)).toBe(true);
    expect(
      f.sqlite.query("SELECT COUNT(*) n FROM notifications").get(),
    ).toEqual({ n: 6 });
    expect(
      f.sqlite
        .query("SELECT COUNT(*) n FROM security_notification_outbox")
        .get(),
    ).toEqual({ n: 6 });
  } finally {
    f.sqlite.close();
  }
});
