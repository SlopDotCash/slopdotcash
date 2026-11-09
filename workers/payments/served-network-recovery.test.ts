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
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { dispatchPayment } from "../../backend/payments/dispatch";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import {
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { memoryJournal } from "../../tests/payment-test-journal";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { lookupAttempt } from "../payment-executor/core";
import { PaymentSignerJournal } from "../payment-executor/index";
import { recoverUncertainAttempts } from "./index";

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
