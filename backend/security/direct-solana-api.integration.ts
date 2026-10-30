/** Actual SOL/SPL transfers through private award, consent, refresh and receipt APIs. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { SOLANA_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
import { rewardFields } from "../../src/lib/project-proposal";
import { privateBountyTerms } from "../../src/lib/security-bounty-proposal";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { D1ConversionStore } from "../../workers/fee-converter/store";
import type { DirectIntent } from "./direct-payments";
import { handleSecurityApi } from "./handler";

const require = createRequire(
  new URL("../../contracts/solana/package.json", import.meta.url),
);
const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const directory = mkdtempSync(join(tmpdir(), "slop-direct-solana-api-"));
const port = Number(process.env.SLOP_DIRECT_SOLANA_API_TEST_PORT ?? "30899");
const rpcUrl = `http://127.0.0.1:${port}`;
const historyProxy = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) =>
    fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
    }),
});
const log = openSync(join(directory, "validator.log"), "w");
const validator = spawn(
  "solana-test-validator",
  [
    "--reset",
    "--quiet",
    "--ticks-per-slot",
    "8",
    "--ledger",
    join(directory, "ledger"),
    "--rpc-port",
    String(port),
    "--faucet-port",
    String(port + 41),
    "--dynamic-port-range",
    `${port + 2}-${port + 31}`,
    "--bind-address",
    "127.0.0.1",
  ],
  { stdio: ["ignore", log, log] },
);
const connection = new Connection(rpcUrl, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 180_000,
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const OWNER = { githubId: "710000001", githubLogin: "solana-owner" };
const REPORTER = { githubId: "710000002", githubLogin: "solana-reporter" };
const payer = Keypair.generate(),
  recipient = Keypair.generate(),
  fee = Keypair.generate();
let sequence = 0;
async function send(
  transaction: InstanceType<typeof Transaction>,
  signers = [payer],
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = payer.publicKey;
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
  );
  const result = await connection.confirmTransaction(
    { signature, ...latest },
    "finalized",
  );
  assert.equal(result.value.err, null);
  return signature;
}
try {
  let genesisHash = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    if (validator.exitCode !== null)
      throw Error(`Validator exited: ${directory}`);
    try {
      genesisHash = await connection.getGenesisHash();
      break;
    } catch {
      await sleep(300);
    }
  }
  assert.ok(genesisHash);
  const airdrop = await connection.requestAirdrop(
    payer.publicKey,
    10_000_000_000,
  );
  await connection.confirmTransaction(airdrop, "finalized");
  const scenarios = ["SOL-full-award", "SOL-75-25", "SPL-75-25"] as const;
  const selected = process.env.SLOP_DIRECT_SOLANA_SCENARIO;
  if (selected && !scenarios.includes(selected as (typeof scenarios)[number]))
    throw new Error("Unknown direct Solana scenario");
  for (const scenario of scenarios.filter(
    (scenario) => !selected || selected === scenario,
  )) {
    let address = SOLANA_NATIVE_ASSET,
      decimals = 9,
      symbol = "SOL";
    const fullAward = scenario === "SOL-full-award";
    const isNative = scenario.startsWith("SOL-");
    if (!isNative) {
      const mint = Keypair.generate();
      address = mint.publicKey.toBase58();
      decimals = 6;
      symbol = "LOCAL";
      const source = spl.getAssociatedTokenAddressSync(
        mint.publicKey,
        payer.publicKey,
      );
      await send(
        new Transaction().add(
          SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(
              spl.MINT_SIZE,
            ),
            space: spl.MINT_SIZE,
            programId: spl.TOKEN_PROGRAM_ID,
          }),
          spl.createInitializeMint2Instruction(
            mint.publicKey,
            decimals,
            payer.publicKey,
            null,
          ),
          spl.createAssociatedTokenAccountIdempotentInstruction(
            payer.publicKey,
            source,
            payer.publicKey,
            mint.publicKey,
          ),
          spl.createMintToInstruction(
            mint.publicKey,
            source,
            payer.publicKey,
            20_000_000,
          ),
        ),
        [payer, mint],
      );
    }
    const asset = {
      network: "solana",
      kind: isNative ? "native" : "token",
      address,
      symbol,
      decimals,
      chainId: null,
      cluster: "mainnet-beta",
      verifiedAt: new Date().toISOString(),
    };
    const gross = isNative ? "40000000" : "4000000";
    const program = {
      ...privateBountyTerms({
        name: "Direct Solana API",
        repository: "example/direct-solana",
        commit: "a".repeat(40),
        scope: "Synthetic local Solana security payment.",
        criteria: "A reproducible critical synthetic finding.",
        testing: "Only local synthetic balances may be used.",
        actor: OWNER,
        funding: {
          mode: "monthly",
          network: "solana",
          assetKind: isNative ? "native" : "token",
          tokenAddress: address,
          tokenSymbol: symbol,
          monthlyAmount: isNative ? "0.04" : "4",
        },
      }),
      amount: {
        asset,
        currency: symbol,
        network: "solana",
        decimals,
        grossMinor: gross,
      },
      split: fullAward
        ? { researcherBasisPoints: 10000, slopBasisPoints: 0 }
        : { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
    };
    const manifest = applicationManifest(
      "direct-solana",
      "example/direct-solana",
      {
        ...rewardFields(
          {
            mode: "none",
            network: "solana",
            assetKind: "stablecoin",
            tokenAddress: "",
            tokenSymbol: "",
            monthlyAmount: "",
          },
          new Date(),
        ),
        securityBounty: program,
        status: "active",
      },
    );
    delete manifest.rewardAsset;
    delete manifest.escrow;
    const { db, sqlite } = sqliteD1();
    const stamp = new Date(Date.now() - 60_000).toISOString(),
      text = JSON.stringify(manifest);
    sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('direct-solana',1,?,?,'local fixture',?)",
      )
      .run(text, hash(text), stamp);
    sqlite
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('direct-solana','active',1,?,?,?,?)",
      )
      .run(text, hash(text), stamp, stamp);
    for (const [actor, wallet] of [
      [OWNER, payer.publicKey.toBase58()],
      [REPORTER, recipient.publicKey.toBase58()],
    ] as const) {
      const id = `claim-${actor.githubId}`;
      sqlite
        .prepare(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,'solana')",
        )
        .run(
          id,
          actor.githubId,
          actor.githubLogin,
          wallet,
          hash(id),
          stamp,
          hash(`${id}-record`),
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,'verified fixture',?,?)",
        )
        .run(
          `challenge-${id}`,
          id,
          actor.githubId,
          new Date(Date.now() + 86_400_000).toISOString(),
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
        )
        .run(
          id,
          actor.githubId,
          stamp,
          `challenge-${id}`,
          "verified-fixture-signature",
        );
    }
    const deps = {
      db,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
      sessionActor: async () => OWNER,
      reportingRead: async () => ({ kind: "unavailable" as const }),
      directPayments: (network: string) =>
        network === "solana-mainnet"
          ? {
              rpcUrl,
              recoveryRpcUrl: `http://127.0.0.1:${historyProxy.port}`,
              genesisHash,
              feeRecipient: fee.publicKey.toBase58(),
            }
          : null,
    };
    async function call(actor: typeof OWNER, path: string, body?: unknown) {
      const response = await handleSecurityApi(
        new Request(`https://local.test/api/v1/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            origin: "https://local.test",
            "content-type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { ...deps, sessionActor: async () => actor },
      );
      assert(response);
      return {
        status: response.status,
        body: (await response.json()) as {
          error?: string;
          case: {
            revision: number;
            awardState: string;
            paymentState: string;
            settlement: {
              ownerRequest: DirectIntent;
              generation: number;
              recovery: {
                mode: string;
                messages?: { messageId: string; message: string }[];
              } | null;
            };
          };
        },
      };
    }
    async function act(
      actor: typeof OWNER,
      id: string,
      action: string,
      extra: Record<string, unknown> = {},
    ) {
      const current = await call(actor, `security-cases/${id}`);
      return call(actor, `security-cases/${id}/actions`, {
        action,
        expectedRevision: current.body.case.revision,
        idempotencyKey: `solana-direct-api-${++sequence}`,
        ...extra,
      });
    }
    function seedCase(id: string, rootCause: string) {
      const frozen = {
        ...program.amount,
        researcherMinor: fullAward
          ? gross
          : ((BigInt(gross) * 3n) / 4n).toString(),
        slopMinor: fullAward ? "0" : (BigInt(gross) / 4n).toString(),
        fundingPolicy: "after-approval",
        split: program.split,
        capacityAwards: null,
      };
      sqlite
        .prepare(
          "INSERT INTO security_cases(id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,policy_revision,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,severity,loss_finding,root_cause_key,appeal_state,revision,created_at,updated_at) VALUES(?,'direct-solana','example/direct-solana',?,?,?,'verified',?,?,?,1,?,'confirmed','not-started','pending','not-applicable','embargoed','private','critical','verified-potential',?,'none',1,?,?)",
        )
        .run(
          id,
          rootCause === "root-one"
            ? "GHSA-2345-6789-cfgh"
            : "GHSA-3456-789c-fghj",
          REPORTER.githubId,
          REPORTER.githubLogin,
          stamp,
          stamp,
          OWNER.githubId,
          JSON.stringify(frozen),
          rootCause,
          stamp,
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO security_case_events(case_id,case_revision,kind,actor_github_id,actor_role,idempotency_key,detail,at) VALUES(?,1,'decide',?,'security-maintainer',?,'{\"inScope\":true}',?)",
        )
        .run(id, OWNER.githubId, `${id}-seed`, stamp);
    }
    const id = "sc_direct_solana_1";
    seedCase(id, "root-one");
    const award = {
      decision: "amount",
      grossMinor: gross,
      paymentDeadline: new Date(Date.now() + 86_400_000).toISOString(),
      confirmation: true,
      reason: "Approve this synthetic local payment.",
    };
    assert.equal((await act(OWNER, id, "award", award)).status, 200);
    assert.equal(
      sqlite
        .query<{ n: number }, []>(
          "SELECT COUNT(*) n FROM security_award_reservations",
        )
        .get()?.n,
      0,
    );
    assert.equal(
      (
        await act(OWNER, id, "prepare-payment", {
          network: "solana-mainnet",
          confirmation: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await act(REPORTER, id, "consent-payment", {
          network: "solana-mainnet",
          confirmation: true,
        })
      ).status,
      200,
    );
    const prepared = await act(OWNER, id, "prepare-payment", {
      network: "solana-mainnet",
      confirmation: true,
    });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const first = prepared.body.case.settlement.ownerRequest;
    assert.ok(first.solana);
    const immutable = sqlite
      .query<{ intent: string }, [string]>(
        "SELECT intent FROM security_direct_payments WHERE case_id=?",
      )
      .get(id)?.intent;
    for (let i = 0; i < 40; i++) {
      if (
        (await connection.getLatestBlockhash("finalized")).blockhash !==
        first.solana.blockhash
      )
        break;
      await sleep(500);
    }
    const refreshed = await act(OWNER, id, "prepare-payment", {
      network: "solana-mainnet",
      confirmation: true,
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    const intent = refreshed.body.case.settlement.ownerRequest;
    assert.ok(intent.solana);
    assert.equal(
      intent.solana.transaction,
      first.solana.transaction,
      "a still-valid request must be reused so refresh cannot issue two payable messages",
    );
    assert.equal(intent.afterBlock, first.afterBlock);
    assert.equal(
      sqlite
        .query<{ intent: string }, [string]>(
          "SELECT intent FROM security_direct_payments WHERE case_id=?",
        )
        .get(id)?.intent,
      immutable,
    );
    const old = await act(OWNER, id, "verify-payment", {
      transactionIds: [airdrop],
      confirmation: true,
    });
    assert.equal(old.status, 409);
    assert.notEqual(
      (await call(OWNER, `security-cases/${id}`)).body.case.paymentState,
      "paid",
    );
    const decoded = Transaction.from(
      Buffer.from(intent.solana.transaction, "base64"),
    );
    decoded.sign(payer);
    const signature = await connection.sendRawTransaction(decoded.serialize());
    const confirmed = await connection.confirmTransaction(
      signature,
      "finalized",
    );
    assert.equal(confirmed.value.err, null);
    if (isNative)
      assert.equal(
        await new D1ConversionStore(db).nativeFeeBalance(
          "solana",
          SOLANA_NATIVE_ASSET,
          fee.publicKey.toBase58(),
        ),
        0n,
      );
    const paid = await act(OWNER, id, "verify-payment", {
      transactionIds: [signature],
      confirmation: true,
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.case.paymentState, "paid");
    if (isNative)
      assert.equal(
        await new D1ConversionStore(db).nativeFeeBalance(
          "solana",
          SOLANA_NATIVE_ASSET,
          fee.publicKey.toBase58(),
        ),
        fullAward ? 0n : 10_000_000n,
      );
    assert.equal(
      (
        await act(OWNER, id, "verify-payment", {
          transactionIds: [signature],
          confirmation: true,
        })
      ).status,
      409,
    );
    const second = "sc_direct_solana_2";
    seedCase(second, "root-two");
    assert.equal((await act(OWNER, second, "award", award)).status, 200);
    assert.equal(
      (
        await act(REPORTER, second, "consent-payment", {
          network: "solana-mainnet",
          confirmation: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await act(OWNER, second, "prepare-payment", {
          network: "solana-mainnet",
          confirmation: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await act(OWNER, second, "verify-payment", {
          transactionIds: [signature],
          confirmation: true,
        })
      ).status,
      409,
    );
    assert.equal(
      sqlite
        .query<{ n: number }, []>(
          "SELECT COUNT(*) n FROM security_direct_payment_receipts",
        )
        .get()?.n,
      1,
    );
    const oldPayment = (await call(OWNER, `security-cases/${second}`)).body.case
      .settlement.ownerRequest;
    console.log(
      JSON.stringify({ scenario, phase: "original-paid-second-prepared" }),
    );
    assert.ok(oldPayment.solana);
    let failedOriginalSignature: string | undefined;
    if (scenario === "SOL-75-25") {
      const balance = await connection.getBalance(payer.publicKey, "finalized");
      await send(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: balance - 2_000_000,
          }),
        ),
      );
      const failedOriginal = Transaction.from(
        Buffer.from(oldPayment.solana.transaction, "base64"),
      );
      failedOriginal.sign(payer);
      failedOriginalSignature = await connection.sendRawTransaction(
        failedOriginal.serialize(),
        { skipPreflight: true },
      );
      const result = await connection.confirmTransaction(
        failedOriginalSignature,
        "finalized",
      );
      assert.notEqual(
        result.value.err,
        null,
        "original request must fail on-chain after its balance changes",
      );
      const refill = await connection.requestAirdrop(
        payer.publicKey,
        1_000_000_000,
      );
      await connection.confirmTransaction(refill, "finalized");
    }
    const priorBytes = sqlite
      .query<{ intent: string }, [string]>(
        "SELECT intent FROM security_direct_payments WHERE case_id=?",
      )
      .get(second)?.intent;
    const destination = fullAward ? recipient : Keypair.generate();
    if (!fullAward) {
      const claim = `claim-successor-${scenario}`,
        challenge = `challenge-successor-${scenario}`;
      sqlite
        .prepare(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain,supersedes_claim_id) SELECT ?,github_user_id,github_login,?,source,source_body_sha256,observed_at,?,created_at,chain,id FROM wallet_claims WHERE id=?",
        )
        .run(
          claim,
          destination.publicKey.toBase58(),
          hash(claim),
          `claim-${REPORTER.githubId}`,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,'local successor',?,?)",
        )
        .run(
          challenge,
          claim,
          REPORTER.githubId,
          new Date(Date.now() + 86400000).toISOString(),
          stamp,
        );
      sqlite
        .prepare(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
        )
        .run(
          claim,
          REPORTER.githubId,
          stamp,
          challenge,
          "verified-local-successor",
        );
      assert.equal(
        (await act(OWNER, second, "recover-payment", { confirmation: true }))
          .body.error,
        "payment_consent_required",
      );
      assert.equal(
        (
          await act(REPORTER, second, "consent-payment", {
            network: "solana-mainnet",
            confirmation: true,
          })
        ).status,
        200,
      );
    }
    const unexpired = await act(OWNER, second, "recover-payment", {
      confirmation: true,
    });
    assert.equal(unexpired.status, 200, JSON.stringify(unexpired.body));
    assert.equal(
      unexpired.body.case.settlement.recovery?.mode,
      "expiry-required",
    );
    assert.equal(
      unexpired.body.case.settlement.recovery?.messages,
      undefined,
      "raw signing challenge is withheld while the transfer can land",
    );
    for (let attempt = 0; ; attempt++) {
      if (
        !(
          await connection.isBlockhashValid(oldPayment.solana.blockhash, {
            commitment: "finalized",
          })
        ).value &&
        (await connection.getBlockHeight("finalized")) >
          oldPayment.solana.lastValidBlockHeight
      )
        break;
      if (attempt > 600)
        throw new Error("Local payment blockhash did not expire");
      await sleep(500);
    }
    assert.equal(
      (
        await act(OWNER, second, "prepare-payment", {
          network: "solana-mainnet",
          confirmation: true,
        })
      ).status,
      409,
      "expired requests never silently create another payable message",
    );
    const challenge = await act(OWNER, second, "recover-payment", {
      confirmation: true,
    });
    console.log(
      JSON.stringify({
        scenario,
        phase: "expired-recovery-challenge",
        mode: challenge.body.case?.settlement?.recovery?.mode,
      }),
    );
    assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    assert.equal(
      challenge.body.case.settlement.recovery?.mode,
      "signature-required",
    );
    assert.equal(challenge.body.case.settlement.recovery.messages?.length, 1);
    assert.equal(
      (
        await act(OWNER, second, "recover-payment", {
          confirmation: true,
          signatures: [
            { messageId: oldPayment.solana.messageId, signature: "invalid" },
          ],
        })
      ).status,
      400,
    );
    const oldSigned = Transaction.from(
      Buffer.from(oldPayment.solana.transaction, "base64"),
    );
    oldSigned.sign(payer);
    const expiredSignature = solanaBase58(oldSigned.signature);
    if (failedOriginalSignature)
      assert.equal(expiredSignature, failedOriginalSignature);
    let recovery = await act(OWNER, second, "recover-payment", {
      confirmation: true,
      signatures: [
        { messageId: oldPayment.solana.messageId, signature: expiredSignature },
      ],
    });
    for (
      let attempt = 0;
      recovery.status === 200 && recovery.body.case.settlement.generation === 0;
      attempt++
    ) {
      assert.equal(
        recovery.body.case.settlement.recovery?.mode,
        "history-check",
        JSON.stringify(recovery.body),
      );
      if (attempt > 32)
        throw new Error("Local retained history did not finish");
      recovery = await act(OWNER, second, "recover-payment", {
        confirmation: true,
      });
    }
    assert.equal(recovery.status, 200, JSON.stringify(recovery.body));
    assert.equal(recovery.body.case.settlement.generation, 1);
    const successor = recovery.body.case.settlement.ownerRequest;
    assert.ok(successor.solana);
    assert.notEqual(
      successor.solana.transaction,
      oldPayment.solana.transaction,
    );
    assert.equal(
      successor.transfers[0].recipient,
      destination.publicKey.toBase58(),
    );
    assert.equal(successor.netBase, oldPayment.netBase);
    assert.equal(successor.feeBase, oldPayment.feeBase);
    assert.equal(
      sqlite
        .query<{ intent: string }, [string]>(
          "SELECT intent FROM security_direct_payments WHERE case_id=?",
        )
        .get(second)?.intent,
      priorBytes,
    );
    if (!failedOriginalSignature)
      await assert.rejects(
        connection.sendRawTransaction(oldSigned.serialize()),
        "the retired signed message can no longer land",
      );
    else
      assert.equal(
        (
          await act(OWNER, second, "verify-payment", {
            confirmation: true,
            transactionIds: [expiredSignature],
          })
        ).status,
        409,
        "a failed retired transaction can never count as payment",
      );
    const nextSigned = Transaction.from(
      Buffer.from(successor.solana.transaction, "base64"),
    );
    nextSigned.sign(payer);
    const nextSignature = await connection.sendRawTransaction(
      nextSigned.serialize(),
    );
    assert.equal(
      (await connection.confirmTransaction(nextSignature, "finalized")).value
        .err,
      null,
    );
    const recoveredPaid = await act(OWNER, second, "verify-payment", {
      confirmation: true,
      transactionIds: [nextSignature],
    });
    assert.equal(recoveredPaid.status, 200, JSON.stringify(recoveredPaid.body));
    assert.equal(recoveredPaid.body.case.paymentState, "paid");
    console.log(
      JSON.stringify({
        scenario,
        paid: true,
        noVault: true,
        missingConsentRejected: true,
        refreshReusesUnexpiredIntent: true,
        preIntentAndReplayRejected: true,
        expiredMessageRetiredBeforeSuccessor: true,
        recoveryDestination: fullAward
          ? "same verified wallet"
          : "new verified wallet",
        ...(failedOriginalSignature ? { failedOriginalRetired: true } : {}),
        ...(isNative ? { nativeFeeCreditVerified: true } : {}),
        signature,
        validatorLog: join(directory, "validator.log"),
      }),
    );
    sqlite.close();
  }
} finally {
  await historyProxy.stop(true);
  connection._rpcWebSocket.close();
  validator.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) =>
      validator.exitCode !== null
        ? resolve(null)
        : validator.once("exit", resolve),
    ),
    sleep(5_000),
  ]);
  if (validator.exitCode === null) validator.kill("SIGKILL");
  closeSync(log);
}
