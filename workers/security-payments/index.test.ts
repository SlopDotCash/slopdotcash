import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase } from "../../backend/d1";
import { dispatchPayment } from "../../backend/payments/dispatch";
import { handlePaymentsApi } from "../../backend/payments/handler";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import { securityPaymentDatabase } from "../../backend/security/payment-database";
import { securitySettlementView } from "../../backend/security/payments";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import type { PaymentsAccount } from "../../src/lib/payments/contracts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import securityPayments from "./index";

const at = "2026-10-30T00:00:00.000Z";
const later = "2026-10-30T00:05:00.000Z";
const address = (byte: string) => `0x${byte.repeat(20)}`;
const word = (hex: string) => `0x${hex.replace(/^0x/u, "").padStart(64, "0")}`;
const runtimeCode = "0x6000";
const runtimeCodeSha256 = createHash("sha256")
  .update(Buffer.from("6000", "hex"))
  .digest("hex");
const baseAsset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const ethereumAsset = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const deploymentTx = `0x${"0d".repeat(32)}`;
const blockHash = `0x${"0b".repeat(32)}`;
const projectKey = `0x${"1".padStart(64, "0")}`;

function selector(signature: string) {
  return `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature)))
    .toString("hex")
    .slice(0, 8)}`;
}

function makeDeployment(
  network: "base-sepolia" | "ethereum-sepolia",
  vault: string,
  asset: string,
): EscrowDeployment {
  return {
    network,
    vault,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    asset,
    owner: address("b2"),
    identityAuthority: address("c3"),
    feeRecipient: address("d4"),
    deploymentTransaction: deploymentTx,
    sourceCommit: "a".repeat(40),
    codeSha256: runtimeCodeSha256,
    bindingDelaySeconds: "0",
    rotationDelaySeconds: null,
    factory: address("e5"),
    factoryCodeSha256: runtimeCodeSha256,
    registrar: address("f6"),
  };
}

const baseDeployment = makeDeployment("base-sepolia", address("a1"), baseAsset);
const ethereumDeployment = makeDeployment(
  "ethereum-sepolia",
  address("a9"),
  ethereumAsset,
);

function serveBaseSepoliaRpc() {
  const selectors = new Map<string, string>([
    [selector("registrar()"), word(baseDeployment.registrar ?? "")],
    [selector("feeRecipient()"), word(baseDeployment.feeRecipient)],
    [selector("bindingDelay()"), word("0")],
    [selector("AUTHORITY_ROTATION_DELAY()"), word((604800).toString(16))],
    [selector("token()"), word(baseDeployment.asset)],
    [selector("owner()"), word(baseDeployment.owner)],
    [selector("factory()"), word(baseDeployment.factory ?? "")],
    [selector("purpose()"), word("1")],
    [selector("projectId()"), projectKey],
    [selector("vaults(bytes32)"), word(baseDeployment.vault)],
    [selector("decimals()"), word("6")],
    [selector("totals()"), `0x${"0".repeat(640)}`],
  ]);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const {
        id = 1,
        method,
        params = [],
      } = (await request.json()) as {
        id?: number;
        method: string;
        params?: unknown[];
      };
      const reply = (result: unknown) =>
        Response.json({ jsonrpc: "2.0", id, result });
      if (method === "eth_chainId") return reply("0x14a34");
      if (method === "eth_getCode") return reply(runtimeCode);
      if (method === "eth_getStorageAt") return reply(word("0"));
      if (method === "eth_getBlockByNumber")
        return reply({
          number: "0x20",
          hash: blockHash,
          timestamp: "0x67000000",
          transactions: [],
        });
      if (method === "eth_getTransactionReceipt")
        return reply(
          params[0] === deploymentTx
            ? { status: "0x1", blockNumber: "0x10" }
            : null,
        );
      if (method === "eth_getLogs") return reply([]);
      if (method === "eth_call") {
        const data = (params[0] as { data?: string } | undefined)?.data ?? "";
        const value = selectors.get(data.slice(0, 10));
        if (value) return reply(value);
      }
      return Response.json(
        { jsonrpc: "2.0", id, error: { code: -32601, message: method } },
        { status: 400 },
      );
    },
  });
}

function seedSecurityProject(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  id: string,
  chain: "base" | "ethereum",
  deployment: EscrowDeployment,
) {
  const manifest = JSON.stringify({
    id,
    status: "active",
    steward: { github: { actorId: "456" } },
    securityBounty: {
      approvers: { financial: [{ githubId: "456" }], technical: [] },
      settlement: {
        schemaVersion: "1",
        effectiveCycle: "2026-10",
        chain,
        feeBasisPoints: 2500,
        withdrawalFeeBasisPoints: ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
        feeMode: "deduct-from-gross",
        deployments: [deployment],
      },
    },
  });
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(id, manifest, digest, "Approved", at);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(id, manifest, digest, at, at);
}

async function authorizeWallet(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  actorId: string,
  claimId: string,
  chain: "base" | "ethereum",
  key: string,
  supersedes: string | null = null,
) {
  const wallet = privateKeyToAccount(`0x${key.repeat(64)}`);
  const digest = createHash("sha256").update(claimId).digest("hex");
  const expiresAt = "2026-10-30T00:15:00.000Z";
  sqlite
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,'alice',?,'d1_registry',?,?,?,?,?,?)",
    )
    .run(
      claimId,
      actorId,
      wallet.address.toLowerCase(),
      digest,
      at,
      digest,
      supersedes,
      at,
      chain,
    );
  const message = buildPaymentWalletMessage({
    actorId,
    chain,
    address: wallet.address.toLowerCase(),
    claimId,
    claimDigest: digest,
    nonce: `challenge-${claimId}`,
    expiresAt,
  });
  sqlite
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(`challenge-${claimId}`, claimId, actorId, message, expiresAt, at);
  sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run(
      claimId,
      actorId,
      at,
      `challenge-${claimId}`,
      await wallet.signMessage({ message }),
    );
  return wallet;
}

function seedSecuritySettlement(
  sqlite: ReturnType<typeof sqliteD1>["sqlite"],
  input: {
    caseId: string;
    obligationId: string;
    projectId: string;
    actorId: string;
    deployment: EscrowDeployment;
    outboxState?: "ready" | "held" | "submitted";
  },
) {
  const record = {
    ...paymentDeploymentRecord(input.projectId, input.deployment),
    payoutPolicy: "security-bounty",
  };
  const digest = createHash("sha256").update(input.obligationId).digest("hex");
  sqlite
    .query(
      "INSERT INTO security_cases(id,project_id,advisory_repository,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,policy_revision,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at) VALUES(?,?,'org/repo',?,'alice','verified',?,?,'456',1,'{}','confirmed','resolved','approved','not-applicable','embargoed','private','none',1,?,?)",
    )
    .run(input.caseId, input.projectId, input.actorId, at, at, at, at);
  sqlite
    .query(
      "INSERT INTO security_settlements(case_id,obligation_id,source_digest,network,vault,asset,asset_decimals,gross_base,fee_base,reporter_github_id,approved_by,approved_at,case_revision,deployment) VALUES(?,?,?,?,?,?,6,'100000000','25000000',?,'456',?,1,?)",
    )
    .run(
      input.caseId,
      input.obligationId,
      digest,
      record.network,
      record.vault,
      record.asset,
      input.actorId,
      at,
      JSON.stringify(record),
    );
  sqlite
    .query(
      "INSERT INTO security_payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,?,?,?,6,'100000000','25000000',?,'reserved',?)",
    )
    .run(
      input.obligationId,
      input.projectId,
      input.actorId,
      record.network,
      record.chain,
      record.vault,
      record.asset,
      digest,
      at,
    );
  if (input.outboxState)
    sqlite
      .query(
        "INSERT INTO security_payment_outbox(obligation_id,state,updated_at) VALUES(?,?,?)",
      )
      .run(input.obligationId, input.outboxState, at);
}

test("securityPayments.scheduled validates served networks before mutating outbox and leaves other networks untouched", async () => {
  const { db, sqlite } = sqliteD1();
  const rpc = serveBaseSepoliaRpc();
  try {
    seedSecurityProject(sqlite, "project-base", "base", baseDeployment);
    seedSecurityProject(
      sqlite,
      "project-ethereum",
      "ethereum",
      ethereumDeployment,
    );
    await authorizeWallet(sqlite, "101", "base-claim", "base", "1");
    await authorizeWallet(sqlite, "102", "eth-claim-1", "ethereum", "2");
    await authorizeWallet(
      sqlite,
      "102",
      "eth-claim-2",
      "ethereum",
      "3",
      "eth-claim-1",
    );

    const baseReserve = `0x${"11".repeat(32)}`;
    const ethUnqueued = `0x${"22".repeat(32)}`;
    const ethHeld = `0x${"33".repeat(32)}`;
    seedSecuritySettlement(sqlite, {
      caseId: "sc_base_reserve",
      obligationId: baseReserve,
      projectId: "project-base",
      actorId: "101",
      deployment: baseDeployment,
    });
    seedSecuritySettlement(sqlite, {
      caseId: "sc_eth_unqueued",
      obligationId: ethUnqueued,
      projectId: "project-ethereum",
      actorId: "102",
      deployment: ethereumDeployment,
    });
    seedSecuritySettlement(sqlite, {
      caseId: "sc_eth_held_01",
      obligationId: ethHeld,
      projectId: "project-ethereum",
      actorId: "102",
      deployment: ethereumDeployment,
      outboxState: "held",
    });
    sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('eth-open',?,'eth-claim-1',?,'unknown')",
      )
      .run(ethHeld, at);

    const paidCalls: string[] = [];
    const env = {
      PAYMENTS_DB: db as unknown as D1TransactionalDatabase,
      REGISTRY_DB: db as unknown as D1TransactionalDatabase,
      PAYMENT_NETWORKS: JSON.stringify(["base-sepolia"]),
      PAYMENT_RPC_URLS: JSON.stringify({
        "base-sepolia": `http://127.0.0.1:${rpc.port}`,
      }),
      EVM_PAYMENT_EXECUTOR: {
        async fetch(request: Request) {
          const { pathname } = new URL(request.url);
          const body = (await request.json()) as { obligationId: string };
          if (pathname === "/v1/pay") {
            paidCalls.push(body.obligationId);
            return Response.json({ transactionId: `0x${"aa".repeat(32)}` });
          }
          throw new Error(`Unexpected executor call ${pathname}`);
        },
      },
    };

    await expect(
      securityPayments.scheduled(null, { ...env, PAYMENT_NETWORKS: "[]" }),
    ).rejects.toThrow(
      "PAYMENT_NETWORKS must be a JSON array of unique registry networks",
    );
    expect(
      sqlite
        .query(
          "SELECT obligation_id, state, updated_at FROM security_payment_outbox ORDER BY obligation_id",
        )
        .all(),
    ).toEqual([{ obligation_id: ethHeld, state: "held", updated_at: at }]);

    await securityPayments.scheduled(null, env);
    expect(paidCalls).toEqual([baseReserve]);
    expect((await securitySettlementView(db, "sc_base_reserve"))?.state).toBe(
      "submitted",
    );
    expect((await securitySettlementView(db, "sc_eth_unqueued"))?.state).toBe(
      "needs-wallet",
    );
    expect(
      sqlite
        .query(
          "SELECT obligation_id, state, updated_at FROM security_payment_outbox WHERE obligation_id IN (?, ?) ORDER BY obligation_id",
        )
        .all(ethUnqueued, ethHeld),
    ).toEqual([{ obligation_id: ethHeld, state: "held", updated_at: at }]);
  } finally {
    rpc.stop(true);
    sqlite.close();
  }
});

test("securityPayments.scheduled reopens walletless holds but keeps conflicted and unresolved-attempt holds held", async () => {
  const { db, sqlite } = sqliteD1();
  const rpc = serveBaseSepoliaRpc();
  try {
    seedSecurityProject(sqlite, "project-base", "base", baseDeployment);
    await authorizeWallet(sqlite, "201", "conflict-claim", "base", "4");
    await authorizeWallet(sqlite, "202", "old-claim", "base", "5");
    await authorizeWallet(sqlite, "202", "new-claim", "base", "6", "old-claim");
    await authorizeWallet(sqlite, "203", "retired-claim", "base", "7");

    const conflicted = `0x${"44".repeat(32)}`;
    const replacedPending = `0x${"55".repeat(32)}`;
    const retiredThenAuthorized = `0x${"66".repeat(32)}`;

    seedSecuritySettlement(sqlite, {
      caseId: "sc_conflicted_1",
      obligationId: conflicted,
      projectId: "project-base",
      actorId: "201",
      deployment: baseDeployment,
      outboxState: "ready",
    });
    sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('conflict-attempt',?,'conflict-claim',?,?,'submitted')",
      )
      .run(conflicted, at, `0x${"c1".repeat(32)}`);

    // First dispatch hits a conflicting transaction ID and moves the outbox to `held`.
    const privateDb = securityPaymentDatabase(
      db as unknown as D1TransactionalDatabase,
    );
    await expect(
      dispatchPayment(
        privateDb,
        {
          async submit() {
            return { transactionId: `0x${"c2".repeat(32)}` };
          },
        },
        conflicted,
        new Date(at),
      ),
    ).rejects.toThrow(
      "Submitted transaction conflicts with the recorded attempt",
    );
    expect((await securitySettlementView(db, "sc_conflicted_1"))?.state).toBe(
      "held",
    );

    seedSecuritySettlement(sqlite, {
      caseId: "sc_replaced_pnd",
      obligationId: replacedPending,
      projectId: "project-base",
      actorId: "202",
      deployment: baseDeployment,
      outboxState: "held",
    });
    sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('old-submitted',?,'old-claim',?,?,'submitted')",
      )
      .run(replacedPending, at, `0x${"d1".repeat(32)}`);

    seedSecuritySettlement(sqlite, {
      caseId: "sc_retired_0001",
      obligationId: retiredThenAuthorized,
      projectId: "project-base",
      actorId: "203",
      deployment: baseDeployment,
      outboxState: "held",
    });
    sqlite
      .query(
        "INSERT INTO security_payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('retired-attempt',?,'retired-claim',?,NULL,'failed')",
      )
      .run(retiredThenAuthorized, at);

    const executorCalls: string[] = [];
    await securityPayments.scheduled(null, {
      PAYMENTS_DB: db as unknown as D1TransactionalDatabase,
      REGISTRY_DB: db as unknown as D1TransactionalDatabase,
      PAYMENT_NETWORKS: JSON.stringify(["base-sepolia"]),
      PAYMENT_RPC_URLS: JSON.stringify({
        "base-sepolia": `http://127.0.0.1:${rpc.port}`,
      }),
      EVM_PAYMENT_EXECUTOR: {
        async fetch(request: Request) {
          const { pathname } = new URL(request.url);
          const body = (await request.json()) as { obligationId: string };
          executorCalls.push(`${pathname} ${body.obligationId}`);
          return Response.json({ transactionId: `0x${"e1".repeat(32)}` });
        },
      },
    });

    expect(executorCalls).toEqual([`/v1/pay ${retiredThenAuthorized}`]);
    expect((await securitySettlementView(db, "sc_conflicted_1"))?.state).toBe(
      "held",
    );
    expect((await securitySettlementView(db, "sc_replaced_pnd"))?.state).toBe(
      "held",
    );
    expect((await securitySettlementView(db, "sc_retired_0001"))?.state).toBe(
      "submitted",
    );
    expect(
      sqlite
        .query(
          "SELECT obligation_id, state, updated_at FROM security_payment_outbox WHERE obligation_id IN (?, ?) ORDER BY obligation_id",
        )
        .all(conflicted, replacedPending),
    ).toEqual([
      { obligation_id: conflicted, state: "held", updated_at: at },
      { obligation_id: replacedPending, state: "held", updated_at: at },
    ]);
  } finally {
    rpc.stop(true);
    sqlite.close();
  }
});

test("POST /api/v1/payments/wallets/authorize reopens walletless holds without reopening open-attempt holds", async () => {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1TransactionalDatabase;
  const first = privateKeyToAccount(`0x${"8".repeat(64)}`);
  const second = privateKeyToAccount(`0x${"9".repeat(64)}`);
  const third = privateKeyToAccount(`0x${"7".repeat(64)}`);
  let clock = new Date(at);
  try {
    const manifest = JSON.stringify({
      id: "project",
      status: "active",
      steward: { github: { actorId: "456" } },
    });
    const digest = createHash("sha256").update(manifest).digest("hex");
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('project',1,?,?,'Approved',?)",
      )
      .run(manifest, digest, at);
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('project','active',1,?,?,?,?)",
      )
      .run(manifest, digest, at, at);
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node','123','alice',?,0)",
      )
      .run(at);
    sqlite
      .query("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(await sha256Hex("a".repeat(43)), "node", "2026-10-31T00:00:00.000Z");

    const call = async (path: string, body?: unknown) => {
      const response = await handlePaymentsApi(
        new Request(`https://slop.cash/api/v1/payments/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            cookie: `__Host-slop_points=${"a".repeat(43)}`,
            origin: "https://slop.cash",
            "content-type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { db: database, now: () => clock },
      );
      return {
        status: response.status,
        body: (await response.json()) as {
          claimId: string;
          challengeId: string;
          message: string;
          payments: PaymentsAccount["payments"];
        },
      };
    };

    const registerAndAuthorize = async (wallet: typeof first) => {
      const reg = await call("wallets/register", {
        chain: "base",
        address: wallet.address.toLowerCase(),
      });
      expect(reg.status).toBe(200);
      const challenge = await call("wallets/challenge", {
        claimId: reg.body.claimId,
      });
      expect(challenge.status).toBe(200);
      const auth = await call("wallets/authorize", {
        claimId: reg.body.claimId,
        challengeId: challenge.body.challengeId,
        signature: await wallet.signMessage({
          message: challenge.body.message,
        }),
      });
      expect(auth.status).toBe(200);
      return reg.body.claimId;
    };

    // 1. Re-authorizing the current wallet on a conflicted attempt keeps the hold.
    const claim1 = await registerAndAuthorize(first);
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES('award-conflict','project','123','base-sepolia','base',?,?,6,'100000000','2000000',?,'reserved',?)",
      )
      .run(address("11"), baseAsset, "aa".repeat(32), at);
    sqlite
      .query(
        "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES('award-conflict','ready',?)",
      )
      .run(at);
    sqlite
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('attempt-conflict','award-conflict',?,?,?,'submitted')",
      )
      .run(claim1, at, `0x${"f1".repeat(32)}`);
    await expect(
      dispatchPayment(
        database,
        {
          async submit() {
            return { transactionId: `0x${"f2".repeat(32)}` };
          },
        },
        "award-conflict",
        clock,
      ),
    ).rejects.toThrow(
      "Submitted transaction conflicts with the recorded attempt",
    );

    clock = new Date(later);
    const rechallenge = await call("wallets/challenge", { claimId: claim1 });
    expect(rechallenge.status).toBe(200);
    expect(
      (
        await call("wallets/authorize", {
          claimId: claim1,
          challengeId: rechallenge.body.challengeId,
          signature: await first.signMessage({
            message: rechallenge.body.message,
          }),
        })
      ).status,
    ).toBe(200);

    let conflictRetries = 0;
    expect(
      await dispatchPayment(
        database,
        {
          async submit() {
            conflictRetries += 1;
            return { transactionId: `0x${"f3".repeat(32)}` };
          },
        },
        "award-conflict",
        clock,
      ),
    ).toBe("unavailable");
    expect(conflictRetries).toBe(0);

    // 2. Authorizing a successor wallet reopens walletless/retired holds, while
    //    keeping unresolved old-wallet holds held without duplicate notices.
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES('award-walletless','project','123','base-sepolia','base',?,?,6,'100000000','2000000',?,'reserved',?)",
      )
      .run(address("11"), baseAsset, "bb".repeat(32), at);
    sqlite
      .query(
        "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES('award-walletless','held',?)",
      )
      .run(at);
    sqlite
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('attempt-retired','award-walletless',?,?,NULL,'failed')",
      )
      .run(claim1, at);
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES('award-replaced','project','123','base-sepolia','base',?,?,6,'100000000','2000000',?,'reserved',?)",
      )
      .run(address("11"), baseAsset, "cc".repeat(32), at);
    sqlite
      .query(
        "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES('award-replaced','ready',?)",
      )
      .run(at);
    sqlite
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES('attempt-unknown','award-replaced',?,?,NULL,'unknown')",
      )
      .run(claim1, at);

    await registerAndAuthorize(second);
    expect(
      await dispatchPayment(
        database,
        {
          async submit() {
            throw new Error("Unexpected submit while old attempt is unknown");
          },
        },
        "award-replaced",
        clock,
      ),
    ).toBe("unavailable");
    const afterSecond = new Map(
      (await call("me")).body.payments.map((p) => [p.id, p.deliveryState]),
    );
    expect(afterSecond.get("award-walletless")).toBe("ready");
    expect(afterSecond.get("award-conflict")).toBe("held");
    expect(afterSecond.get("award-replaced")).toBe("held");

    // Authorizing a third wallet still preserves `held` and avoids duplicate notices.
    clock = new Date("2026-10-30T00:10:00.000Z");
    await registerAndAuthorize(third);
    const afterThird = new Map(
      (await call("me")).body.payments.map((p) => [p.id, p.deliveryState]),
    );
    expect(afterThird.get("award-conflict")).toBe("held");
    expect(afterThird.get("award-replaced")).toBe("held");

    expect(
      await dispatchPayment(
        database,
        {
          async submit() {
            conflictRetries += 1;
            return { transactionId: `0x${"f4".repeat(32)}` };
          },
        },
        "award-conflict",
        clock,
      ),
    ).toBe("unavailable");
    expect(
      await dispatchPayment(
        database,
        {
          async submit() {
            throw new Error("Unexpected submit after third wallet");
          },
        },
        "award-replaced",
        clock,
      ),
    ).toBe("unavailable");
    expect(conflictRetries).toBe(0);
    expect(
      sqlite
        .query(
          "SELECT kind, COUNT(*) n FROM notifications WHERE event_key LIKE '%:award-replaced:%' GROUP BY kind ORDER BY kind",
        )
        .all(),
    ).toEqual([
      { kind: "payout_exception", n: 1 },
      { kind: "payout_held", n: 1 },
    ]);
  } finally {
    sqlite.close();
  }
});
