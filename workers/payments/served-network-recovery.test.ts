// Each network runs its own payments Worker and relayer
// (payment-executor/configure.mjs sets PAYMENT_NETWORKS to that one network),
// and a staging stack shares one PAYMENTS_DB with every other network. Only the
// relayer of an attempt's network holds its signer journal, so recovery in any
// other Worker reads "never signed" and could retire an attempt that the
// attempt's own relayer already signed. Dispatch would then sign a second
// payment for the same award.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { keccak256, toFunctionSelector, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { dispatchPayment } from "../../backend/payments/dispatch";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import {
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { type JournalStore, lookupAttempt } from "../payment-executor/core";
import { PaymentSignerJournal } from "../payment-executor/index";
import paymentsWorker, { recoverUncertainAttempts } from "./index";
import { reconcileFailedAttempts } from "./reconcile";

const at = "2026-10-01T00:00:00.000Z";
const address = (byte: string) => `0x${byte.repeat(20)}`;
const asset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const baseDeployment: EscrowDeployment = {
  network: "base-sepolia",
  vault: address("a1"),
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset,
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
const ethereumVault = address("a9");

function memoryJournal(): JournalStore {
  const values = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return structuredClone(values.get(key)) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async transaction(callback) {
      return callback(journal);
    },
  };
  return journal;
}

test("recovery leaves another network's attempt to that network's relayer", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort(),
  );
  const authorize = async (
    id: string,
    chain: "base" | "ethereum",
    key: string,
    supersedes: string | null,
  ) => {
    const wallet = privateKeyToAccount(`0x${key.repeat(64)}`);
    const digest = createHash("sha256").update(id).digest("hex");
    sqlite
      .query(
        "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,'101','alice',?,'d1_registry',?,?,?,?,?,?)",
      )
      .run(id, wallet.address, digest, at, digest, supersedes, at, chain);
    const expiresAt = "2026-10-01T00:15:00.000Z";
    const message = buildPaymentWalletMessage({
      actorId: "101",
      chain,
      address: wallet.address,
      claimId: id,
      claimDigest: digest,
      nonce: `challenge-${id}`,
      expiresAt,
    });
    sqlite
      .query(
        "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,'101',?,?,?)",
      )
      .run(`challenge-${id}`, id, message, expiresAt, at);
    sqlite
      .query(
        "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,'101',?,?,?)",
      )
      .run(id, at, `challenge-${id}`, await wallet.signMessage({ message }));
  };
  // An award whose submit response was lost: the attempt is `unknown` and
  // the outbox is `ready` again, as dispatchPayment leaves it.
  const lostResponse = (
    projectId: string,
    obligationId: string,
    attemptId: string,
    network: string,
    chain: string,
    vault: string,
    claimId: string,
  ) => {
    sqlite
      .query(
        "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,'101',?,?,?,?,6,'100000000','2000000',?,'reserved',?)",
      )
      .run(
        obligationId,
        projectId,
        network,
        chain,
        vault,
        asset,
        "cd".repeat(32),
        at,
      );
    sqlite
      .query(
        "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
      )
      .run(obligationId, at);
    sqlite
      .query(
        "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES(?,?,?,?,'unknown')",
      )
      .run(attemptId, obligationId, claimId, at);
  };
  try {
    const ethereumAward = `0x${"ab".repeat(32)}`;
    const baseAward = `0x${"ba".repeat(32)}`;
    await authorize("ethereum-old", "ethereum", "9", null);
    await authorize("base-old", "base", "6", null);
    lostResponse(
      "project-1",
      ethereumAward,
      "ethereum-attempt",
      "ethereum-sepolia",
      "ethereum",
      ethereumVault,
      "ethereum-old",
    );
    lostResponse(
      "project-2",
      baseAward,
      "base-attempt",
      "base-sepolia",
      "base",
      baseDeployment.vault,
      "base-old",
    );
    // The ethereum-sepolia relayer signed its attempt before the response
    // was lost; its own journal holds the transaction.
    const ethereumJournal = memoryJournal();
    const signed = `0x${"5e".repeat(32)}` as const;
    await ethereumJournal.put("pay:ethereum-attempt", {
      obligationId: ethereumAward,
      network: "ethereum-sepolia",
      vault: ethereumVault,
      fingerprint: "signed-before-the-response-was-lost",
      rawTransaction: "0x02",
      transactionId: signed,
    });
    const ethereumIdentity = {
      idempotencyKey: "ethereum-attempt",
      obligationId: ethereumAward,
      network: "ethereum-sepolia",
      vault: ethereumVault,
    };
    expect(
      await lookupAttempt(
        { PAYMENTS_DB: db as D1Database, JOURNAL: ethereumJournal },
        ethereumIdentity,
      ),
    ).toEqual({ transactionId: signed });
    // The contributor then authorizes successor wallets on both chains.
    await authorize("ethereum-new", "ethereum", "8", "ethereum-old");
    await authorize("base-new", "base", "5", "base-old");

    const relayer = new PaymentSignerJournal(
      { storage: memoryJournal() },
      {
        PAYMENTS_DB: db as D1Database,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          paymentDeploymentRecord("project-2", baseDeployment),
        ]),
        PAYMENT_RPC_URLS: JSON.stringify({
          "base-sepolia": "http://127.0.0.1:9",
        }),
        SIGNER_ROLE: "relayer",
        CHAIN_FAMILY: "evm",
        SIGNER_STACK: "test",
        TEST_SIGNER_PRIVATE_KEY: `0x${"7".repeat(64)}`,
        JOURNAL: {
          idFromName() {
            throw new Error("The relayer journal is passed directly");
          },
          get() {
            throw new Error("The relayer journal is passed directly");
          },
        },
      },
    );
    const requests: string[] = [];
    await recoverUncertainAttempts({
      PAYMENTS_DB: db as D1Database,
      REGISTRY_DB: db as D1Database,
      PAYMENT_NETWORKS: JSON.stringify(["base-sepolia"]),
      PAYMENT_RPC_URLS: "{}",
      EVM_PAYMENT_EXECUTOR: {
        async fetch(request: Request) {
          const { network } = (await request.clone().json()) as {
            network: string;
          };
          requests.push(`${new URL(request.url).pathname} ${network}`);
          return relayer.fetch(request);
        },
      },
    });

    // The base-sepolia Worker still retires its own unsigned attempt.
    expect(requests).toEqual([
      "/v1/attempt-status base-sepolia",
      "/v1/cancel-unsubmitted base-sepolia",
    ]);
    const attempts = sqlite.query(
      "SELECT id,state,transaction_id FROM payment_attempts ORDER BY id",
    );
    expect(attempts.all()).toEqual([
      { id: "base-attempt", state: "failed", transaction_id: null },
      { id: "ethereum-attempt", state: "unknown", transaction_id: null },
    ]);
    expect(
      sqlite.query("SELECT attempt_id FROM payment_attempt_failures").all(),
    ).toEqual([{ attempt_id: "base-attempt" }]);

    // The ethereum-sepolia dispatcher holds the award for the changed wallet
    // instead of signing a second payment next to the signed one.
    const submitted: string[] = [];
    expect(
      await dispatchPayment(
        db as D1Database,
        {
          async submit(input) {
            submitted.push(input.idempotencyKey);
            return { transactionId: `0x${"6f".repeat(32)}` };
          },
        },
        ethereumAward,
        new Date("2026-10-01T00:05:00.000Z"),
      ),
    ).toBe("unavailable");
    expect(submitted).toEqual([]);
    expect(attempts.all()).toHaveLength(2);
  } finally {
    sqlite.close();
  }
});

test("scheduled reconciliation leaves another network's submitted attempt to that network's worker", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort(),
  );
  const vaultCode = "0x6001";
  const factoryCode = "0x6002";
  const sha256Hex = (hex: string) =>
    createHash("sha256")
      .update(Buffer.from(hex.slice(2), "hex"))
      .digest("hex");
  const baseScheduledDeployment: EscrowDeployment = {
    ...baseDeployment,
    codeSha256: sha256Hex(vaultCode),
    factoryCodeSha256: sha256Hex(factoryCode),
  };
  const ethereumScheduledDeployment: EscrowDeployment = {
    ...baseScheduledDeployment,
    network: "ethereum-sepolia",
    vault: ethereumVault,
  };
  const revertedBaseTx = `0x${"88".repeat(32)}`;
  const inFlightEthereumTx = `0x${"77".repeat(32)}`;
  const replacementBaseTx = `0x${"99".repeat(32)}`;
  const blockHash = `0x${"10".repeat(32)}`;
  const word = (value: bigint | string) =>
    (typeof value === "bigint"
      ? value.toString(16)
      : value.replace(/^0x/, "").toLowerCase()
    ).padStart(64, "0");
  const calls: Record<string, string> = {
    [toFunctionSelector("registrar()")]: word(
      baseScheduledDeployment.registrar ?? "",
    ),
    [toFunctionSelector("feeRecipient()")]: word(
      baseScheduledDeployment.feeRecipient,
    ),
    [toFunctionSelector("bindingDelay()")]: word(0n),
    [toFunctionSelector("AUTHORITY_ROTATION_DELAY()")]: word(604800n),
    [toFunctionSelector("vaults(bytes32)")]: word(
      baseScheduledDeployment.vault,
    ),
    [toFunctionSelector("token()")]: word(baseScheduledDeployment.asset),
    [toFunctionSelector("owner()")]: word(baseScheduledDeployment.owner),
    [toFunctionSelector("factory()")]: word(
      baseScheduledDeployment.factory ?? "",
    ),
    [toFunctionSelector("purpose()")]: word(0n),
    [toFunctionSelector("projectId()")]: keccak256(toHex("project-base")).slice(
      2,
    ),
    [toFunctionSelector("totals()")]: "0".repeat(640),
    [toFunctionSelector("decimals()")]: word(6n),
  };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { id, method, params } = (await request.json()) as {
        id: number;
        method: string;
        params: unknown[];
      };
      const answer = () => {
        switch (method) {
          case "eth_chainId":
            return "0x14a34";
          case "eth_getCode":
            return params[0] === baseScheduledDeployment.factory
              ? factoryCode
              : vaultCode;
          case "eth_getStorageAt":
            return `0x${"0".repeat(64)}`;
          case "eth_call": {
            const selector = (params[0] as { data: string }).data.slice(0, 10);
            const value = calls[selector];
            if (!value) throw new Error(`Unexpected eth_call ${selector}`);
            return `0x${value}`;
          }
          case "eth_getBlockByNumber":
            return {
              number: "0x10",
              hash: blockHash,
              timestamp: "0x68000000",
            };
          case "eth_getTransactionReceipt": {
            const txHash = String(params[0]).toLowerCase();
            if (
              txHash ===
              baseScheduledDeployment.deploymentTransaction?.toLowerCase()
            ) {
              return {
                status: "0x1",
                transactionHash: params[0],
                blockHash,
                blockNumber: "0x10",
              };
            }
            if (txHash === revertedBaseTx) {
              return {
                status: "0x0",
                transactionHash: revertedBaseTx,
                blockHash,
                blockNumber: "0x10",
              };
            }
            return null;
          }
          case "eth_getLogs":
            return [];
          default:
            throw new Error(`Unexpected RPC ${method}`);
        }
      };
      return Response.json({ jsonrpc: "2.0", id, result: answer() });
    },
  });
  try {
    const registerProject = (
      id: string,
      chain: "base" | "ethereum",
      deployment: EscrowDeployment,
    ) => {
      const manifest = JSON.stringify({
        id,
        status: "active",
        escrow: {
          schemaVersion: "1",
          effectiveCycle: "2026-10",
          chain,
          feeBasisPoints: 200,
          withdrawalFeeBasisPoints: 200,
          feeMode: "deduct-from-gross",
          deployments: [deployment],
        },
      });
      const digest = createHash("sha256").update(manifest).digest("hex");
      sqlite
        .query(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Fixture',?)",
        )
        .run(id, manifest, digest, at);
      sqlite
        .query(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
        )
        .run(id, manifest, digest, at, at);
    };
    registerProject("project-base", "base", baseScheduledDeployment);
    registerProject(
      "project-ethereum",
      "ethereum",
      ethereumScheduledDeployment,
    );

    const authorize = async (
      id: string,
      chain: "base" | "ethereum",
      key: string,
    ) => {
      const wallet = privateKeyToAccount(`0x${key.repeat(64)}`);
      const digest = createHash("sha256").update(id).digest("hex");
      sqlite
        .query(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,'101','alice',?,'d1_registry',?,?,?,NULL,?,?)",
        )
        .run(id, wallet.address, digest, at, digest, at, chain);
      const expiresAt = "2026-10-01T00:15:00.000Z";
      const message = buildPaymentWalletMessage({
        actorId: "101",
        chain,
        address: wallet.address,
        claimId: id,
        claimDigest: digest,
        nonce: `challenge-${id}`,
        expiresAt,
      });
      sqlite
        .query(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,'101',?,?,?)",
        )
        .run(`challenge-${id}`, id, message, expiresAt, at);
      sqlite
        .query(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,'101',?,?,?)",
        )
        .run(id, at, `challenge-${id}`, await wallet.signMessage({ message }));
    };
    await authorize("claim-base", "base", "6");
    await authorize("claim-ethereum", "ethereum", "9");

    const seedSubmitted = (
      projectId: string,
      obligationId: string,
      attemptId: string,
      network: string,
      chain: string,
      vault: string,
      claimId: string,
      txHash: string,
      outboxState: "submitted" | "held",
    ) => {
      sqlite
        .query(
          "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,'101',?,?,?,?,6,'100000000','2000000',?,'reserved',?)",
        )
        .run(
          obligationId,
          projectId,
          network,
          chain,
          vault,
          asset,
          "cd".repeat(32),
          at,
        );
      sqlite
        .query(
          "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,?,?)",
        )
        .run(obligationId, outboxState, at);
      sqlite
        .query(
          "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,transaction_id,state) VALUES(?,?,?,?,?,'submitted')",
        )
        .run(attemptId, obligationId, claimId, at, txHash);
    };
    const ethereumAward = `0x${"1a".repeat(32)}`;
    const baseAward = `0x${"2b".repeat(32)}`;
    seedSubmitted(
      "project-ethereum",
      ethereumAward,
      "ethereum-submitted",
      "ethereum-sepolia",
      "ethereum",
      ethereumVault,
      "claim-ethereum",
      inFlightEthereumTx,
      "submitted",
    );
    seedSubmitted(
      "project-base",
      baseAward,
      "base-reverted",
      "base-sepolia",
      "base",
      baseScheduledDeployment.vault,
      "claim-base",
      revertedBaseTx,
      "held",
    );

    const rpcUrl = `http://127.0.0.1:${server.port}`;
    const executorCalls: string[] = [];
    await paymentsWorker.scheduled(
      {},
      {
        PAYMENTS_DB: db as D1Database,
        REGISTRY_DB: db as D1Database,
        PAYMENT_NETWORKS: JSON.stringify(["base-sepolia"]),
        PAYMENT_RPC_URLS: JSON.stringify({ "base-sepolia": rpcUrl }),
        EVM_PAYMENT_EXECUTOR: {
          async fetch(request: Request) {
            const { network } = (await request.clone().json()) as {
              network: string;
            };
            executorCalls.push(`${new URL(request.url).pathname} ${network}`);
            return Response.json({ transactionId: replacementBaseTx });
          },
        },
      },
    );

    expect(executorCalls).toEqual(["/v1/pay base-sepolia"]);
    expect(
      sqlite
        .query(
          "SELECT obligation_id,state,transaction_id FROM payment_attempts ORDER BY obligation_id,created_at,id",
        )
        .all(),
    ).toEqual([
      {
        obligation_id: ethereumAward,
        state: "submitted",
        transaction_id: inFlightEthereumTx,
      },
      {
        obligation_id: baseAward,
        state: "failed",
        transaction_id: revertedBaseTx,
      },
      {
        obligation_id: baseAward,
        state: "submitted",
        transaction_id: replacementBaseTx,
      },
    ]);
    expect(
      sqlite
        .query(
          "SELECT attempt_id FROM payment_attempt_failures ORDER BY attempt_id",
        )
        .all(),
    ).toEqual([{ attempt_id: "base-reverted" }]);

    // An unreviewed vault on a network this Worker DOES serve still fails closed.
    seedSubmitted(
      "project-unreviewed",
      `0x${"3c".repeat(32)}`,
      "base-unreviewed-vault",
      "base-sepolia",
      "base",
      address("fe"),
      "claim-base",
      `0x${"66".repeat(32)}`,
      "held",
    );
    let servedMismatch: unknown = null;
    try {
      await reconcileFailedAttempts(
        db as D1Database,
        [paymentDeploymentRecord("project-base", baseScheduledDeployment)],
        { "base-sepolia": rpcUrl },
        {},
        new Date(at),
        ["base-sepolia"],
      );
    } catch (error) {
      servedMismatch = error;
    }
    expect(servedMismatch).toBeInstanceOf(AggregateError);
    expect(String((servedMismatch as AggregateError).errors[0])).toMatch(
      /Reviewed deployment missing for reconciliation/,
    );
  } finally {
    server.stop(true);
    sqlite.close();
  }
});
