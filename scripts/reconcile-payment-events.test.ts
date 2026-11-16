import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { indexPaymentEvent } from "../backend/payments/ledger";
import {
  buildCommitAwardCalldata,
  buildPayCalldata,
  evmAwardId,
} from "../contracts/evm/adapter";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { escrowAwardOrigin } from "../src/lib/payments/escrow-cycle";
import { buildExecutionSnapshot } from "../src/lib/payments/monthly-allocation";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  type ReconciliationPacket,
  readReconciliationPacket,
  reconcileReviewedPaymentEvents,
  reconciliationDatabase,
} from "./reconcile-payment-events";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const at = "2026-11-16T18:00:00.000Z";
async function fixture() {
  const f = sqliteD1();
  const account = privateKeyToAccount(`0x${"11".repeat(32)}` as `0x${string}`);
  const vault = `0x${"22".repeat(20)}`,
    actor = "123",
    sourceDigest = escrowAwardOrigin("fixture", "2026-10", actor);
  const asset = ESCROW_NETWORKS["base-mainnet"].asset;
  if (!asset) throw Error("Fixture asset required");
  const deployment = {
    network: "base-mainnet",
    sourceCommit: "a".repeat(40),
    codeSha256: "b".repeat(64),
    vault,
    owner: account.address.toLowerCase(),
    asset,
    identityAuthority: `0x${"33".repeat(20)}`,
    feeRecipient: `0x${"44".repeat(20)}`,
    factory: `0x${"55".repeat(20)}`,
    factoryCodeSha256: "c".repeat(64),
    registrar: `0x${"66".repeat(20)}`,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    rotationDelaySeconds: null,
    bindingDelaySeconds: "0",
    deploymentTransaction: `0x${"77".repeat(32)}`,
  };
  const manifest = {
    id: "fixture",
    status: "active",
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  };
  const manifestText = JSON.stringify(manifest),
    manifestSha256 = hash(manifestText);
  f.sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('fixture',1,?,?,'Fixture',?)",
    )
    .run(manifestText, manifestSha256, at);
  f.sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('fixture','active',1,?,?,?,?)",
    )
    .run(manifestText, manifestSha256, at, at);
  const award = {
    githubUserId: actor,
    login: "contributor",
    grossBase: "10000",
    feeBase: "200",
    netBase: "9800",
    sourceDigest,
  };
  const snapshot = buildExecutionSnapshot({
    base: {
      projectId: "fixture",
      period: "2026-10",
      manifestSha256,
      sourceSnapshotSha256: "d".repeat(64),
      capBase: "10000",
    },
    allocations: [{ ...award, proposedGrossBase: award.grossBase }],
    allocationSequence: 0,
    trigger: "owner",
    manifestSha256,
    network: "base-mainnet",
    vault,
    asset: deployment.asset,
    frozenAt: at,
  }).text;
  f.sqlite
    .query(
      "INSERT INTO monthly_reward_bases VALUES('fixture','2026-10',?,?,?,'10000',1,?)",
    )
    .run(manifestText, manifestSha256, "d".repeat(64), at);
  f.sqlite
    .query(
      "INSERT INTO monthly_payment_runs VALUES('fixture','2026-10','owner','456',0,?,?,'base-mainnet',?,'10000',?,?)",
    )
    .run(snapshot, hash(snapshot), vault, at, at);
  f.sqlite
    .query(
      "INSERT INTO monthly_payment_obligations VALUES('fixture','2026-10','123','contributor','10000','200',?,'base-mainnet',?,?)",
    )
    .run(sourceDigest, vault, at);
  f.sqlite
    .query(
      "INSERT INTO vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,observed_at,block_number,block_time) VALUES('fixture','base-mainnet','base',?,?,6,'10000','0','0','0','0','0',?,'100',?)",
    )
    .run(vault, deployment.asset, at, at);
  f.sqlite
    .query(
      "INSERT INTO payment_chain_cursors VALUES('fixture','base-mainnet','50',?)",
    )
    .run(at);
  const obligationId = evmAwardId(8453n, vault, `0x${sourceDigest}`);
  const data = buildCommitAwardCalldata({
    obligationId,
    githubUserId: actor,
    grossMicro: "10000",
    sourceDigest: `0x${sourceDigest}`,
  });
  const rawTransaction = await account.signTransaction({
    type: "eip1559",
    chainId: 8453,
    nonce: 1,
    to: vault as `0x${string}`,
    data: data as `0x${string}`,
    value: 0n,
    gas: 250000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
  });
  const reference = {
    ...award,
    transactionId: keccak256(rawTransaction),
    rawTransaction,
    eventIndex: 0,
    obligationId,
  };
  const packet: ReconciliationPacket = {
    schemaVersion: "reviewed-payment-events:v1",
    projectId: "fixture",
    network: "base-mainnet",
    period: "2026-10",
    revision: 1,
    manifestSha256,
    snapshotSha256: hash(snapshot),
    events: [reference],
  };
  const evidence = {
    kind: "reserved" as const,
    transactionId: reference.transactionId,
    eventIndex: 0,
    blockId: `0x${"88".repeat(32)}`,
    obligationId,
    projectId: "fixture",
    network: "base-mainnet",
    chain: "base" as const,
    vault,
    githubUserId: actor,
    grossMicro: "10000",
    feeMicro: "200",
    netMicro: "9800",
    sourceDigest,
  };
  const verify = async () => ({
    ...evidence,
    sourceDigest: `0x${sourceDigest}`,
  });
  const verifyDeployment = async () => {};
  return { ...f, packet, evidence, verify, verifyDeployment };
}

test("reviewed packet checksum and amount/duplicate guards refuse changes", async () => {
  const f = await fixture();
  try {
    const text = JSON.stringify(f.packet);
    expect(readReconciliationPacket(text, hash(text))).toEqual(f.packet);
    expect(() => readReconciliationPacket(`${text} `, hash(text))).toThrow();
    for (const events of [
      [{ ...f.packet.events[0], feeBase: "199" }],
      [f.packet.events[0], f.packet.events[0]],
    ]) {
      const changed = JSON.stringify({ ...f.packet, events });
      expect(() => readReconciliationPacket(changed, hash(changed))).toThrow();
    }
  } finally {
    f.sqlite.close();
  }
});

test("preview verifies the frozen allocation and canonical wire without writing", async () => {
  const f = await fixture();
  try {
    expect(
      await reconcileReviewedPaymentEvents({
        ...f,
        rpcUrl: "https://rpc.invalid",
        apply: false,
      }),
    ).toEqual({ verified: 1, indexed: 0, replayVerified: false });
    expect(
      f.sqlite.query("SELECT count(*) n FROM payment_events").get(),
    ).toEqual({ n: 0 });
  } finally {
    f.sqlite.close();
  }
});

test("canonical event indexing and replay create one obligation without moving the cursor", async () => {
  const f = await fixture();
  try {
    const result = await reconcileReviewedPaymentEvents({
      ...f,
      rpcUrl: "https://rpc.invalid",
      apply: true,
      ingest: async (_env, input, now) =>
        indexPaymentEvent(
          f.db,
          {
            deployment: {
              projectId: "fixture",
              network: "base-mainnet",
              vault: f.evidence.vault,
            },
            verifyFinalized: async () => f.evidence,
          },
          input,
          now.toISOString(),
        ),
    });
    expect(result.replayVerified).toBe(true);
    for (const table of [
      "payment_events",
      "payment_obligations",
      "notifications",
    ])
      expect(f.sqlite.query(`SELECT count(*) n FROM ${table}`).get()).toEqual({
        n: 1,
      });
    expect(
      f.sqlite.query("SELECT position FROM payment_chain_cursors").get(),
    ).toEqual({ position: "50" });
  } finally {
    f.sqlite.close();
  }
});

test("stale registry, allocation, actor, and signed wire refuse before ingestion", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    for (const packet of [
      { ...f.packet, revision: 2 },
      { ...f.packet, snapshotSha256: "0".repeat(64) },
      { ...f.packet, events: [{ ...f.packet.events[0], githubUserId: "999" }] },
      {
        ...f.packet,
        events: [
          {
            ...f.packet.events[0],
            rawTransaction: (f.packet.events[0].rawTransaction.slice(0, -2) +
              "00") as `0x${string}`,
          },
        ],
      },
    ])
      await expect(
        reconcileReviewedPaymentEvents({
          ...f,
          packet,
          rpcUrl: "https://rpc.invalid",
          apply: true,
          ingest: async () => {
            calls++;
          },
        }),
      ).rejects.toThrow();
    expect(calls).toBe(0);
  } finally {
    f.sqlite.close();
  }
});

test("an uncertain completed indexing request can replay without a second award", async () => {
  const f = await fixture();
  try {
    let loseResponse = true;
    const ingest = async (
      _env: unknown,
      input: Parameters<typeof indexPaymentEvent>[2],
      now: Date,
    ) => {
      await indexPaymentEvent(
        f.db,
        {
          deployment: {
            projectId: "fixture",
            network: "base-mainnet",
            vault: f.evidence.vault,
          },
          verifyFinalized: async () => f.evidence,
        },
        input,
        now.toISOString(),
      );
      if (loseResponse) {
        loseResponse = false;
        throw Error("Fixture lost response after commit");
      }
    };
    const input = { ...f, rpcUrl: "https://rpc.invalid", apply: true, ingest };
    await expect(reconcileReviewedPaymentEvents(input)).rejects.toThrow(
      "lost response",
    );
    expect((await reconcileReviewedPaymentEvents(input)).replayVerified).toBe(
      true,
    );
    expect(
      f.sqlite.query("SELECT count(*) n FROM payment_obligations").get(),
    ).toEqual({ n: 1 });
  } finally {
    f.sqlite.close();
  }
});

test("D1 REST serializes one atomic batch and native D1 rolls back all statements", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('fixture')}}",
      d1Databases: { DB: "fixture" },
      compatibilityDate: "2026-09-14",
    }),
  );
  try {
    const native = await mf.getD1Database("DB");
    await native.exec("CREATE TABLE payment_events(id INTEGER PRIMARY KEY)");
    const calls: { batch: { sql: string; params: unknown[] }[] }[] = [];
    const request = (async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      try {
        const statements = (body.batch ?? [body]).map(
          (item: { sql: string; params: unknown[] }) =>
            native.prepare(item.sql).bind(...item.params),
        );
        return Response.json({
          success: true,
          result: await native.batch(statements),
        });
      } catch {
        return Response.json({ success: false, result: [] }, { status: 400 });
      }
    }) as typeof fetch;
    const db = reconciliationDatabase({
      account: "a".repeat(32),
      databaseId: "fixture",
      token: "fixture-secret",
      apply: true,
      request,
    });
    await expect(
      db.batch([
        db.prepare("INSERT INTO payment_events VALUES(?)").bind(1),
        db.prepare("INSERT INTO payment_events VALUES(?)").bind(1),
      ]),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0].batch).toHaveLength(2);
    expect(
      await native.prepare("SELECT count(*) n FROM payment_events").first(),
    ).toEqual({ n: 0 });
    await native.exec(
      "CREATE TABLE payment_obligations(id TEXT PRIMARY KEY,state TEXT,paid_transaction TEXT); CREATE TABLE payment_outbox(obligation_id TEXT,state TEXT,lease_token TEXT,lease_until TEXT,updated_at TEXT); CREATE TABLE payment_attempts(obligation_id TEXT,transaction_id TEXT,state TEXT)",
    );
    await native.exec(
      "INSERT INTO payment_obligations VALUES('award','reserved',NULL); INSERT INTO payment_outbox VALUES('award','submitted','lease','future','old'); INSERT INTO payment_attempts VALUES('award','tx','submitted')",
    );
    await db.batch([
      db
        .prepare(
          "UPDATE payment_obligations SET state='paid',paid_transaction=? WHERE id=? AND state='reserved'",
        )
        .bind("tx", "award"),
      db
        .prepare(
          "UPDATE payment_outbox SET state='paid',lease_token=NULL,lease_until=NULL,updated_at=? WHERE obligation_id=?",
        )
        .bind(at, "award"),
      db
        .prepare(
          "UPDATE payment_attempts SET state='finalized' WHERE obligation_id=? AND transaction_id=?",
        )
        .bind("award", "tx"),
    ]);
    expect(calls.at(-1)?.batch).toHaveLength(3);
    expect(
      await native
        .prepare("SELECT state,paid_transaction FROM payment_obligations")
        .first(),
    ).toEqual({ state: "paid", paid_transaction: "tx" });
    expect(
      await native
        .prepare("SELECT state,lease_token FROM payment_outbox")
        .first(),
    ).toEqual({ state: "paid", lease_token: null });
    expect(
      await native.prepare("SELECT state FROM payment_attempts").first(),
    ).toEqual({ state: "finalized" });
    await expect(
      db.batch([db.prepare("UPDATE payment_obligations SET state='reserved'")]),
    ).rejects.toThrow("Only canonical");
    const preview = reconciliationDatabase({
      account: "a".repeat(32),
      databaseId: "fixture",
      token: "fixture-secret",
      apply: false,
      request,
    });
    await expect(
      preview.batch([
        preview.prepare("INSERT INTO payment_events VALUES(?)").bind(2),
      ]),
    ).rejects.toThrow("Preview cannot write");
    await expect(
      db.batch([db.prepare("UPDATE payment_chain_cursors SET position='999'")]),
    ).rejects.toThrow("Only canonical");
  } finally {
    await mf.dispose();
  }
}, 30000);

async function paidFixture() {
  const f = await fixture();
  const destination = `0x${"99".repeat(20)}`;
  f.sqlite
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim','123','contributor',?,'d1_registry',?,?,?,?,'base')",
    )
    .run(destination, "a".repeat(64), at, "e".repeat(64), at);
  f.sqlite
    .query(
      "INSERT INTO payment_wallet_challenges VALUES('challenge','claim','123','fixture',?,?)",
    )
    .run(at, at);
  f.sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations VALUES('claim','123',?,'challenge','signature')",
    )
    .run(at);
  await indexPaymentEvent(
    f.db,
    { verifyFinalized: async () => f.evidence },
    {
      ...f.packet.events[0],
      kind: "reserved",
    },
    at,
  );
  const payer = privateKeyToAccount(`0x${"12".repeat(32)}`);
  const rawTransaction = await payer.signTransaction({
    type: "eip1559",
    chainId: 8453,
    nonce: 0,
    to: f.evidence.vault as `0x${string}`,
    value: 0n,
    gas: 250000n,
    data: buildPayCalldata(f.evidence.obligationId, "1") as `0x${string}`,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
  });
  const reference = {
    ...f.packet.events[0],
    kind: "paid" as const,
    transactionId: keccak256(rawTransaction),
    rawTransaction,
    destination,
    claimId: "claim",
    bindingVersion: "1",
    payer: payer.address.toLowerCase(),
  };
  const evidence = {
    ...f.evidence,
    kind: "paid" as const,
    transactionId: reference.transactionId,
    destination,
    bindingVersion: "1",
  };
  f.sqlite
    .query(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state,transaction_id) VALUES('attempt',?,'claim',?,'submitted',?)",
    )
    .run(reference.obligationId, at, reference.transactionId);
  return {
    ...f,
    packet: { ...f.packet, events: [reference] },
    paidEvidence: evidence,
    verifyPaid: async () => ({ ...evidence, sourceDigest: undefined }),
  };
}

function paidIngest(f: Awaited<ReturnType<typeof paidFixture>>) {
  return async (
    _env: unknown,
    input: Parameters<typeof indexPaymentEvent>[2],
    now: Date,
  ) =>
    indexPaymentEvent(
      f.db,
      {
        deployment: {
          projectId: "fixture",
          network: "base-mainnet",
          vault: f.evidence.vault,
        },
        verifyFinalized: async () => f.paidEvidence,
      },
      input,
      now.toISOString(),
    );
}

test("finalized permissionless payout indexes canonical state and notices exactly once", async () => {
  const f = await paidFixture();
  try {
    const text = JSON.stringify(f.packet);
    expect(readReconciliationPacket(text, hash(text))).toEqual(f.packet);
    const input = {
      ...f,
      rpcUrl: "https://rpc.invalid",
      apply: true,
      ingest: paidIngest(f),
    };
    expect((await reconcileReviewedPaymentEvents(input)).replayVerified).toBe(
      true,
    );
    expect((await reconcileReviewedPaymentEvents(input)).replayVerified).toBe(
      true,
    );
    expect(
      f.sqlite
        .query("SELECT state,paid_transaction FROM payment_obligations")
        .get(),
    ).toEqual({
      state: "paid",
      paid_transaction: f.packet.events[0].transactionId,
    });
    expect(f.sqlite.query("SELECT state FROM payment_outbox").get()).toEqual({
      state: "paid",
    });
    expect(f.sqlite.query("SELECT state FROM payment_attempts").get()).toEqual({
      state: "finalized",
    });
    expect(
      f.sqlite
        .query("SELECT count(*) n FROM notifications WHERE kind='payment_paid'")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      f.sqlite
        .query("SELECT count(*) n FROM payment_events WHERE kind='paid'")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      f.sqlite.query("SELECT position FROM payment_chain_cursors").get(),
    ).toEqual({ position: "50" });
  } finally {
    f.sqlite.close();
  }
});

test("paid preflight refuses unauthorized destination, changed origin, payer and binding before writes", async () => {
  const f = await paidFixture();
  try {
    let calls = 0;
    for (const changes of [
      { destination: `0x${"aa".repeat(20)}` },
      { claimId: "missing" },
      { payer: f.evidence.vault },
      { bindingVersion: "2" },
      { sourceDigest: "f".repeat(64) },
    ]) {
      await expect(
        reconcileReviewedPaymentEvents({
          ...f,
          packet: {
            ...f.packet,
            events: [{ ...f.packet.events[0], ...changes }],
          },
          rpcUrl: "https://rpc.invalid",
          apply: true,
          ingest: async () => {
            calls++;
          },
        }),
      ).rejects.toThrow();
    }
    expect(calls).toBe(0);
    expect(
      f.sqlite.query("SELECT state FROM payment_obligations").get(),
    ).toEqual({ state: "reserved" });
    await expect(
      reconcileReviewedPaymentEvents({
        ...f,
        rpcUrl: "https://rpc.invalid",
        apply: true,
        verifyPaid: async () => ({
          ...f.paidEvidence,
          destination: `0x${"aa".repeat(20)}`,
        }),
        ingest: async () => {
          calls++;
        },
      }),
    ).rejects.toThrow("Finalized payment event differs");
    expect(calls).toBe(0);
  } finally {
    f.sqlite.close();
  }
});

test("an uncertain committed paid batch replays without duplicate payout or notification", async () => {
  const f = await paidFixture();
  try {
    const canonical = paidIngest(f);
    let lose = true;
    const input = {
      ...f,
      rpcUrl: "https://rpc.invalid",
      apply: true,
      ingest: async (...args: Parameters<typeof canonical>) => {
        await canonical(...args);
        if (lose) {
          lose = false;
          throw Error("Lost paid response");
        }
      },
    };
    await expect(reconcileReviewedPaymentEvents(input)).rejects.toThrow(
      "Lost paid response",
    );
    expect((await reconcileReviewedPaymentEvents(input)).replayVerified).toBe(
      true,
    );
    expect(
      f.sqlite
        .query("SELECT count(*) n FROM payment_events WHERE kind='paid'")
        .get(),
    ).toEqual({ n: 1 });
    expect(
      f.sqlite
        .query("SELECT count(*) n FROM notifications WHERE kind='payment_paid'")
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    f.sqlite.close();
  }
});

test("replay refuses an existing event with altered accounting despite matching identity", async () => {
  const f = await paidFixture();
  try {
    f.sqlite
      .query("INSERT INTO payment_events VALUES(?,?,?,?,?,?,?,?)")
      .run(
        f.packet.network,
        f.paidEvidence.transactionId,
        f.paidEvidence.eventIndex,
        f.paidEvidence.blockId,
        "paid",
        f.paidEvidence.obligationId,
        JSON.stringify({ ...f.paidEvidence, grossMicro: "9999" }),
        at,
      );
    f.sqlite
      .query(
        "UPDATE payment_obligations SET state='paid',paid_transaction=? WHERE id=?",
      )
      .run(f.paidEvidence.transactionId, f.paidEvidence.obligationId);
    await expect(
      reconcileReviewedPaymentEvents({
        ...f,
        rpcUrl: "https://rpc.invalid",
        apply: true,
        ingest: paidIngest(f),
      }),
    ).rejects.toThrow("Canonical stored event readback differs");
  } finally {
    f.sqlite.close();
  }
});
