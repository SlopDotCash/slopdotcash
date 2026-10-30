import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  createAccount,
  createMint,
  freezeAccount,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  thawAccount,
} from "@solana/spl-token";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  escrowInvocations,
  readVaultTotals,
  solanaAllocationProof,
  solanaAllocationRoot,
  solanaAllocationTotal,
  solanaAwardId,
  solanaMonthlyMessage,
  solanaPaymentAdapter,
} from "../.local/adapter.mjs";
import { dispatchPayment } from "../.local/dispatch.mjs";
import {
  completeSolanaBinding,
  createSolanaAttester,
  createSolanaExecutor,
  preflightSolanaDeployment,
  solanaTransactionStatus,
} from "../.local/executor.mjs";
import { lookupAttempt } from "../.local/executor-core.mjs";
import { handlePaymentsApi } from "../.local/handler.mjs";
import { indexPaymentEvent } from "../.local/ledger.mjs";
import { recoverUncertainAttempts } from "../.local/payments-worker.mjs";
import { scanSolanaPayments } from "../.local/scanner.mjs";
import { storeVaultSnapshot } from "../.local/vault-snapshots.mjs";
import { receiptProvider } from "./confirmation.mjs";
import {
  configAddress,
  configFees,
  configIdentity,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";

const { Program, BN } = anchor;
const provider = receiptProvider(),
  payer = provider.wallet.payer;
const program = new Program(
  JSON.parse(readFileSync("target/idl/slop_escrow.json")),
  provider,
);
const hash = (s) => createHash("sha256").update(s).digest();
// A public test cluster keeps accounts between runs; a run salt gives each
// run new project accounts. Local runs leave it empty.
const RUN = process.env.SLOP_E2E_RUN ?? "";
const bn = (x) => new BN(String(x));
const pda = (...seeds) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
function signer(key) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(key.secretKey.slice(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return {
    address: key.publicKey.toBase58(),
    signMessage: async (message) =>
      new Uint8Array(sign(null, message, privateKey)),
  };
}
async function finalized(signature) {
  await provider.connection.confirmTransaction(signature, "finalized");
}
async function parsedTransaction(signature) {
  const response = await fetch(provider.connection.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          commitment: "finalized",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });
  return (await response.json()).result;
}
test("durable executor verifies SQLite consent, pays a one-unit award, and retries exact signature", {
  timeout: 480000,
}, async () => {
  await ensureConfig(program);
  // The identity authority and fee recipient are the ones pinned in Config.
  const identity = configIdentity,
    gas = Keypair.generate(),
    recipient = Keypair.generate(),
    fee = configFees;
  const funded = await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: identity.publicKey,
        lamports: 2_000_000_000,
      }),
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: gas.publicKey,
        lamports: 2_000_000_000,
      }),
    ),
    [payer],
  );
  await finalized(funded);
  const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      6,
    ),
    source = await createAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey,
    );
  await mintTo(provider.connection, payer, mint, source, payer, 100_000_000n);
  const domain = hash("executor:solana-localnet"),
    projectId = hash(`executor-project${RUN}`),
    origin = hash("executor-source");
  const project = pda(
      Buffer.from("project"),
      payer.publicKey.toBuffer(),
      projectId,
      Buffer.from([0]),
    ),
    vault = pda(Buffer.from("vault"), project.toBuffer()),
    awardId = Buffer.from(
      solanaAwardId(project.toBase58(), origin.toString("hex")),
      "hex",
    ),
    award = pda(Buffer.from("award"), project.toBuffer(), awardId);
  await program.methods
    .initialize(
      [...projectId],
      [...domain],
      identity.publicKey,
      fee.publicKey,
      bn(2),
      bn(2),
      { ordinary: {} },
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  await program.methods
    .deposit(bn(100_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  // Round-up fees consume this award. The program settles it without a token CPI.
  const approval = await program.methods
    .commit([...awardId], [...origin], bn(103), bn(1))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      vault,
      obligation: award,
      origin: pda(Buffer.from("origin"), project.toBuffer(), origin),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await finalized(approval);
  rmSync(".local/executor.sqlite", { force: true });
  let sql = new DatabaseSync(".local/executor.sqlite");
  for (const migration of readdirSync("../../migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`../../migrations/${migration}`, "utf8"));
  sql.exec(
    "CREATE TABLE test_executor_journal (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  function statement(query, args = []) {
    return {
      bind(...values) {
        return statement(query, values);
      },
      async first() {
        return sql.prepare(query).get(...args) ?? null;
      },
      async run() {
        const result = sql.prepare(query).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  const db = {
    prepare: statement,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const values = [];
        for (const stmt of statements) values.push(await stmt.run());
        sql.exec("COMMIT");
        return values;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const now = new Date().toISOString(),
    expires = new Date(Date.now() + 300000).toISOString(),
    claimDigest = hash("executor-claim").toString("hex");
  const input = {
    obligationId: awardId.toString("hex"),
    network: "solana-localnet",
    vault: vault.toBase58(),
    githubUserId: "103",
    claimId: "executor-wallet",
    claimDigest,
    destination: recipient.publicKey.toBase58(),
    idempotencyKey: "executor-attempt",
  };
  const consent = `Authorize Slop automatic contributor payouts\nAudience: slop.cash\nGitHub actor: 103\nChain: solana\nWallet: ${input.destination}\nClaim: ${input.claimId}\nDigest: ${claimDigest}\nNonce: executor-challenge\nExpires: ${expires}`;
  const consentSignature = Buffer.from(
    await signer(recipient).signMessage(Buffer.from(consent)),
  ).toString("base64");
  sql
    .prepare(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES(?,?,?,?,?,?,?,?,?,?,?,'reserved',?,NULL)",
    )
    .run(
      input.obligationId,
      "executor-project",
      "103",
      input.network,
      "solana",
      input.vault,
      mint.toBase58(),
      6,
      "1",
      "1",
      origin.toString("hex"),
      now,
    );
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,?)",
    )
    .run(
      input.claimId,
      "103",
      "test-contributor",
      input.destination,
      "a".repeat(64),
      now,
      claimDigest,
      now,
      "solana",
    );
  sql
    .prepare("INSERT INTO payment_wallet_challenges VALUES(?,?,?,?,?,?)")
    .run("executor-challenge", input.claimId, "103", consent, expires, now);
  sql
    .prepare("INSERT INTO payment_wallet_authorizations VALUES(?,?,?,?,?)")
    .run(input.claimId, "103", now, "executor-challenge", consentSignature);
  sql
    .prepare("INSERT INTO payment_attempts VALUES(?,?,?,?,NULL,'prepared')")
    .run(input.idempotencyKey, input.obligationId, input.claimId, now);
  let journalGate = Promise.resolve();
  const journal = (prefix) => ({
    async get(key) {
      const row = sql
        .prepare("SELECT value FROM test_executor_journal WHERE key=?")
        .get(prefix + key);
      return row ? JSON.parse(row.value) : undefined;
    },
    async put(key, value) {
      sql
        .prepare(
          "INSERT INTO test_executor_journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(prefix + key, JSON.stringify(value));
    },
    async transaction(fn) {
      const previous = journalGate;
      let release;
      journalGate = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      sql.exec("BEGIN");
      try {
        const result = await fn(this);
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      } finally {
        release();
      }
    },
  });
  const genesis = await provider.connection.getGenesisHash();
  const config = {
    projectId: "executor-project",
    network: input.network,
    chain: "solana",
    vault: input.vault,
    programId: program.programId.toBase58(),
    projectPda: project.toBase58(),
    asset: mint.toBase58(),
    networkDomain: domain.toString("hex"),
    owner: payer.publicKey.toBase58(),
    identityAuthority: identity.publicKey.toBase58(),
    feeRecipient: fee.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: "2",
    rotationDelaySeconds: "2",
  };
  const common = {
    PAYMENTS_DB: db,
    PAYMENT_DEPLOYMENTS: JSON.stringify([config]),
    PAYMENT_RPC_URLS: JSON.stringify({
      [input.network]: provider.connection.rpcEndpoint,
    }),
    ALLOW_LOCAL_TEST_CHAIN: true,
    LOCAL_SOLANA_GENESIS: genesis,
  };
  await assert.rejects(
    preflightSolanaDeployment(
      { ...common, ALLOW_LOCAL_TEST_CHAIN: false },
      input,
    ),
    /Only approved Solana test/,
  );
  await assert.rejects(
    preflightSolanaDeployment(
      {
        ...common,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...config, codeSha256: "0".repeat(64) },
        ]),
      },
      input,
    ),
    /Deployed program bytes/,
  );
  await assert.rejects(
    preflightSolanaDeployment(
      {
        ...common,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...config, owner: recipient.publicKey.toBase58() },
        ]),
      },
      input,
    ),
    /Reviewed project authorities/,
  );
  const identityEnvironment = {
    ...common,
    SOLANA_SIGNER: signer(identity),
    JOURNAL: journal("identity:"),
  };
  const attester = createSolanaAttester(identityEnvironment);
  // The account API reaches the attester role through its service binding,
  // exactly as workers/payment-executor/index.ts routes /v1/pay and
  // /v1/complete-bind for SIGNER_ROLE=attester.
  const attesterService = {
    async fetch(request) {
      const { transaction, ...binding } = await request.json();
      assert.equal(
        request.headers.get("idempotency-key"),
        binding.idempotencyKey,
      );
      const path = new URL(request.url).pathname;
      try {
        return Response.json(
          path === "/v1/complete-bind"
            ? await completeSolanaBinding(
                identityEnvironment,
                binding,
                transaction,
              )
            : await attester.submit(binding),
        );
      } catch {
        return Response.json(
          { error: "execution_pending_or_rejected" },
          { status: 409 },
        );
      }
    },
  };
  const session = "s".repeat(43);
  sql
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('executor-member','103','test-contributor',?,0)",
    )
    .run(now);
  sql
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      createHash("sha256").update(session).digest("hex"),
      "executor-member",
      new Date(Date.now() + 3600000).toISOString(),
    );
  const account = async (path, body) =>
    handlePaymentsApi(
      new Request(`https://slop.cash/api/v1/payments${path}`, {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${session}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { db, solanaAttester: attesterService },
    );
  let gasSignatures = 0;
  const gasSigner = signer(gas);
  const executor = createSolanaExecutor({
    ...common,
    SOLANA_SIGNER: {
      address: gasSigner.address,
      async signMessage(message) {
        gasSignatures++;
        return gasSigner.signMessage(message);
      },
    },
    JOURNAL: journal("gas:"),
  });
  await assert.rejects(
    executor.submit({ ...input, destination: fee.publicKey.toBase58() }),
    /Payout request differs/,
  );
  await assert.rejects(executor.submit(input), /co-signature/);
  // The contributor asks the account API for the half-signed binding. Only the
  // signed-in contributor's own reserved award has one.
  assert.equal(
    (
      await handlePaymentsApi(
        new Request(
          "https://slop.cash/api/v1/payments/wallets/solana-bind/prepare",
          {
            method: "POST",
            headers: {
              origin: "https://slop.cash",
              "content-type": "application/json",
            },
            body: JSON.stringify({ obligationId: input.obligationId }),
          },
        ),
        { db, solanaAttester: attesterService },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await account("/wallets/solana-bind/prepare", {
        obligationId: "0".repeat(64),
      })
    ).status,
    409,
  );
  const preparedResponse = await account("/wallets/solana-bind/prepare", {
    obligationId: input.obligationId,
  });
  assert.equal(preparedResponse.status, 200);
  // The attester half-signs the binding; only the destination wallet can
  // complete it, over exactly the prepared bytes.
  const prepared = await preparedResponse.json();
  assert.ok(prepared.transaction, "prepared binding returns bytes to co-sign");
  assert.deepEqual(await attester.submit(input), prepared);
  const raw = Buffer.from(prepared.transaction, "base64");
  assert.equal(raw[0], 2);
  const bindMessage = raw.subarray(129);
  const cosign = async (wallet) =>
    Buffer.concat([
      raw.subarray(0, 65),
      Buffer.from(await signer(wallet).signMessage(bindMessage)),
      bindMessage,
    ]).toString("base64");
  await assert.rejects(
    completeSolanaBinding(identityEnvironment, input, await cosign(fee)),
    /wallet signature rejected/,
  );
  await assert.rejects(
    completeSolanaBinding(
      identityEnvironment,
      input,
      Buffer.concat([raw.subarray(0, 129), bindMessage, Buffer.of(0)]).toString(
        "base64",
      ),
    ),
    /differs from the prepared binding/,
  );
  // A valid attempt that the attester never prepared has no journaled bytes.
  sql
    .prepare("INSERT INTO payment_attempts VALUES(?,?,?,?,NULL,'prepared')")
    .run("unprepared-attempt", input.obligationId, input.claimId, now);
  await assert.rejects(
    completeSolanaBinding(
      identityEnvironment,
      { ...input, idempotencyKey: "unprepared-attempt" },
      await cosign(recipient),
    ),
    /No prepared binding/,
  );
  // A wrong co-signature through the account API changes nothing.
  assert.equal(
    (
      await account("/wallets/solana-bind/complete", {
        obligationId: input.obligationId,
        transaction: await cosign(fee),
      })
    ).status,
    409,
  );
  // Lose the response only after the actual validator finalized these exact
  // signed bytes. Completion must reconcile the journaled signature, not resend.
  const bindingFetch = globalThis.fetch;
  let bindingSends = 0;
  let bindingFinalizedBeforeDrop = false;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options?.body ?? "{}");
    const response = await bindingFetch(url, options);
    if (body.method === "sendTransaction") {
      bindingSends += 1;
      const accepted = await response.clone().json();
      assert.equal(accepted.result, prepared.transactionId);
      await finalized(accepted.result);
      bindingFinalizedBeforeDrop = true;
      throw new Error("Injected lost binding response after real finalization");
    }
    return response;
  };
  let completed;
  try {
    completed = await account("/wallets/solana-bind/complete", {
      obligationId: input.obligationId,
      transaction: await cosign(recipient),
    });
  } finally {
    globalThis.fetch = bindingFetch;
  }
  assert.equal(bindingSends, 1);
  assert.equal(bindingFinalizedBeforeDrop, true);
  assert.equal(completed.status, 200);
  const bound = await completed.json();
  assert.equal(bound.transactionId, prepared.transactionId);
  // A retry after finalization must return the original transaction identity.
  await finalized(bound.transactionId);
  assert.deepEqual(
    await completeSolanaBinding(identityEnvironment, input, await cosign(fee)),
    bound,
  );
  // Persist real signed bytes, then interrupt the transport before broadcast.
  const originalFetch = globalThis.fetch;
  let latestRequests = 0,
    firstHash;
  let releaseFirst;
  const secondStarted = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options?.body ?? "{}");
    if (body.method === "sendTransaction")
      throw new Error("Injected transport interruption before broadcast");
    if (body.method === "getLatestBlockhash") {
      latestRequests++;
      if (latestRequests === 1) {
        const response = await originalFetch(url, options);
        firstHash = (await response.clone().json()).result.value.blockhash;
        await secondStarted;
        return response;
      }
      releaseFirst();
      const deadline = Date.now() + 20000;
      while (true) {
        const response = await originalFetch(url, options);
        const current = (await response.clone().json()).result.value.blockhash;
        if (firstHash && current !== firstHash) return response;
        assert.ok(Date.now() < deadline, "finalized blockhash did not advance");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return originalFetch(url, options);
  };
  try {
    const results = await Promise.allSettled([
      executor.submit(input),
      executor.submit(input),
    ]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.ok(result.reason instanceof Error);
      assert.equal(result.reason.constructor.name, "SolanaRpcUnavailable");
      assert.equal(
        result.reason.cause?.message,
        "Injected transport interruption before broadcast",
      );
    }
    assert.equal(latestRequests, 2);
    assert.equal(
      gasSignatures,
      1,
      "concurrent fresh requests must preserve one signed transaction despite newer blockhash",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  const pending = await journal("gas:").get(
    `solana:relayer:${input.network}:${input.idempotencyKey}`,
  );
  assert.ok(pending?.raw);
  const expiryDeadline = Date.now() + 150000;
  while (
    (await provider.connection.getBlockHeight("finalized")) <=
    pending.lastValidBlockHeight
  ) {
    assert.ok(
      Date.now() < expiryDeadline,
      "local blockhash did not reach finalized expiry",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(
    (
      await provider.connection.getSignatureStatuses([pending.transactionId], {
        searchTransactionHistory: true,
      })
    ).value[0],
    null,
  );
  const sent = await executor.submit(input);
  assert.notEqual(sent.transactionId, pending.transactionId);
  await finalized(sent.transactionId);
  // Recreate both executor and journal objects to represent restart after submission.
  const restarted = createSolanaExecutor({
    ...common,
    SOLANA_SIGNER: signer(gas),
    JOURNAL: journal("gas:"),
  });
  assert.equal(
    (await restarted.submit(input)).transactionId,
    sent.transactionId,
  );
  assert.equal(
    (
      await getAccount(
        provider.connection,
        getAssociatedTokenAddressSync(mint, recipient.publicKey),
      )
    ).amount,
    0n,
  );
  // The fee accrues in the vault; the executor no longer touches a fee account.
  assert.equal(
    (await program.account.project.fetch(project)).accruedFees.toString(),
    "1",
  );
  assert.equal(
    await provider.connection.getAccountInfo(
      getAssociatedTokenAddressSync(mint, fee.publicKey),
    ),
    null,
  );
  const [paidInvocation] = escrowInvocations(
    await parsedTransaction(sent.transactionId),
    config.programId,
  );
  assert.equal(paidInvocation.children.length, 0);
  const eventIndex = paidInvocation.index;
  console.log(
    JSON.stringify({
      step: "one-unit-payment-finalized",
      signature: sent.transactionId,
      gross: "1",
      fee: "1",
      net: "0",
      tokenTransfers: 0,
    }),
  );
  const adapter = solanaPaymentAdapter({
    ...config,
    mint: config.asset,
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: genesis,
  });
  assert.equal(
    (
      await adapter.verifyFinalized({
        transactionId: sent.transactionId,
        eventIndex,
        kind: "paid",
        obligationId: input.obligationId,
      })
    ).netMicro,
    "0",
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM test_executor_journal").get().n,
    3,
  );
  // Another project's commit that merely mentions this project account must
  // not stop this project's scanner.
  const foreignId = hash(`foreign-project${RUN}`),
    foreignOrigin = hash("foreign-source");
  const foreign = pda(
      Buffer.from("project"),
      payer.publicKey.toBuffer(),
      foreignId,
      Buffer.from([0]),
    ),
    foreignVault = pda(Buffer.from("vault"), foreign.toBuffer()),
    foreignAward = Buffer.from(
      solanaAwardId(foreign.toBase58(), foreignOrigin.toString("hex")),
      "hex",
    );
  await program.methods
    .initialize(
      [...foreignId],
      [...domain],
      identity.publicKey,
      fee.publicKey,
      bn(2),
      bn(2),
      { ordinary: {} },
    )
    .accountsStrict({
      owner: payer.publicKey,
      project: foreign,
      mint,
      vault: foreignVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  await mintTo(provider.connection, payer, mint, source, payer, 1_000_000n);
  await program.methods
    .deposit(bn(1_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project: foreign,
      mint,
      source,
      vault: foreignVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await finalized(
    await program.methods
      .commit([...foreignAward], [...foreignOrigin], bn(103), bn(1_000_000))
      .accountsStrict({
        owner: payer.publicKey,
        project: foreign,
        vault: foreignVault,
        obligation: pda(Buffer.from("award"), foreign.toBuffer(), foreignAward),
        origin: pda(Buffer.from("origin"), foreign.toBuffer(), foreignOrigin),
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: project, isWritable: false, isSigner: false },
      ])
      .rpc(),
  );
  // Real finalized account mentions span more than one RPC page. They must
  // not make every cron run repeat discovery from the newest signature.
  const mentions = [];
  for (let first = 0; first < 1001; first += 25) {
    const { blockhash } = await provider.connection.getLatestBlockhash();
    const batch = await Promise.all(
      Array.from({ length: Math.min(25, 1001 - first) }, async (_, offset) => {
        const instruction = SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: payer.publicKey,
          lamports: first + offset + 1,
        });
        instruction.keys.push({
          pubkey: project,
          isWritable: false,
          isSigner: false,
        });
        const tx = new Transaction({
          recentBlockhash: blockhash,
          feePayer: payer.publicKey,
        }).add(instruction);
        tx.sign(payer);
        return provider.connection.sendRawTransaction(tx.serialize());
      }),
    );
    mentions.push(...batch);
  }
  await finalized(mentions.at(-1));
  for (let first = 0; first < mentions.length; first += 256) {
    const { value } = await provider.connection.getSignatureStatuses(
      mentions.slice(first, first + 256),
      { searchTransactionHistory: true },
    );
    for (const status of value) {
      assert.equal(status?.confirmationStatus, "finalized");
      assert.equal(status.err, null);
    }
  }
  const [newest] = await provider.connection.getSignaturesForAddress(
    project,
    { limit: 1 },
    "finalized",
  );
  // The payments cron's first step: the finalized vault read is stored, and
  // the ledger takes each award's asset and decimals from it.
  const totals = await readVaultTotals({
    rpcUrl: provider.connection.rpcEndpoint,
    network: config.network,
    projectPda: config.projectPda,
    programId: config.programId,
  });
  assert.equal(totals.vault, config.projectPda);
  assert.equal(totals.asset, config.asset);
  assert.equal(totals.decimals, 6);
  assert.equal(
    await storeVaultSnapshot(db, config, totals, new Date().toISOString()),
    "stored",
  );
  const index = (event) =>
    indexPaymentEvent(db, adapter, event, new Date().toISOString());
  await scanSolanaPayments(db, config, provider.connection.rpcEndpoint, index);
  const discovery = sql.prepare("SELECT * FROM payment_solana_scans").get();
  assert.equal(discovery.ready, 0);
  assert.equal(discovery.next_page, 1);
  assert.equal(sql.prepare("SELECT count(*) n FROM payment_events").get().n, 0);
  sql.close();
  sql = new DatabaseSync(".local/executor.sqlite");
  await scanSolanaPayments(db, config, provider.connection.rpcEndpoint, index);
  assert.equal(
    sql.prepare("SELECT ready FROM payment_solana_scans").get().ready,
    1,
  );
  // Stop after a real reservation is indexed but before its later payment.
  // A reopened database must replay safely and then finish the frozen interval.
  await assert.rejects(
    scanSolanaPayments(
      db,
      config,
      provider.connection.rpcEndpoint,
      async (event) => {
        if (event.kind === "paid")
          throw new Error("scanner restart checkpoint");
        await index(event);
      },
    ),
    /scanner restart checkpoint/,
  );
  assert.equal(sql.prepare("SELECT count(*) n FROM payment_events").get().n, 1);
  sql.close();
  sql = new DatabaseSync(".local/executor.sqlite");
  let resumeOldRun, signalPaused;
  const paused = new Promise((resolve) => {
    signalPaused = resolve;
  });
  const resume = new Promise((resolve) => {
    resumeOldRun = resolve;
  });
  const oldRun = scanSolanaPayments(
    db,
    config,
    provider.connection.rpcEndpoint,
    async (event) => {
      await index(event);
      if (event.kind === "paid") {
        signalPaused();
        await resume;
      }
    },
  );
  await paused;
  await scanSolanaPayments(db, config, provider.connection.rpcEndpoint, index);
  await scanSolanaPayments(db, config, provider.connection.rpcEndpoint, index);
  const advancedCursor = sql
    .prepare("SELECT position FROM payment_chain_cursors")
    .get().position;
  const advancedScan = sql.prepare("SELECT * FROM payment_solana_scans").get();
  resumeOldRun();
  await oldRun;
  assert.equal(
    sql.prepare("SELECT position FROM payment_chain_cursors").get().position,
    advancedCursor,
  );
  assert.deepEqual(
    sql.prepare("SELECT * FROM payment_solana_scans").get(),
    advancedScan,
  );
  for (let run = 0; run < 20; run++) {
    await scanSolanaPayments(
      db,
      config,
      provider.connection.rpcEndpoint,
      index,
    );
    if (!sql.prepare("SELECT 1 FROM payment_solana_scans").get()) break;
  }
  assert.equal(
    sql.prepare("SELECT count(*) n FROM payment_solana_scans").get().n,
    0,
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM payment_solana_scan_pages").get().n,
    0,
  );
  assert.equal(sql.prepare("SELECT count(*) n FROM payment_events").get().n, 2);
  assert.equal(
    sql.prepare("SELECT state FROM payment_obligations").get().state,
    "paid",
  );
  assert.equal(
    sql.prepare("SELECT position FROM payment_chain_cursors").get().position,
    newest.signature,
  );
  await scanSolanaPayments(db, config, provider.connection.rpcEndpoint, index);
  await scanSolanaPayments(db, config, provider.connection.rpcEndpoint, index);
  assert.equal(sql.prepare("SELECT count(*) n FROM payment_events").get().n, 2);
  const indexedAward = sql
    .prepare(
      "SELECT gross_base,fee_base,paid_transaction FROM payment_obligations",
    )
    .get();
  assert.equal(indexedAward.gross_base, "1");
  assert.equal(indexedAward.fee_base, "1");
  assert.equal(indexedAward.paid_transaction, sent.transactionId);
  console.log(
    JSON.stringify({
      step: "one-unit-payment-indexed",
      state: "paid",
      gross: indexedAward.gross_base,
      fee: indexedAward.fee_base,
      events: 2,
    }),
  );
  // A frozen destination rejects the real preflight after the signer has
  // saved bytes. Cron recovery must keep this eligible for the same-attempt
  // retry, and must not confuse a stored signature with a submitted payment.
  const frozenOrigin = hash("executor-frozen-source");
  const frozenId = Buffer.from(
    solanaAwardId(project.toBase58(), frozenOrigin.toString("hex")),
    "hex",
  );
  const frozenApproval = await program.methods
    .commit([...frozenId], [...frozenOrigin], bn(103), bn(10000))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      vault,
      obligation: pda(Buffer.from("award"), project.toBuffer(), frozenId),
      origin: pda(Buffer.from("origin"), project.toBuffer(), frozenOrigin),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await finalized(frozenApproval);
  await storeVaultSnapshot(
    db,
    config,
    await readVaultTotals({
      rpcUrl: provider.connection.rpcEndpoint,
      network: config.network,
      projectPda: config.projectPda,
      programId: config.programId,
    }),
    new Date().toISOString(),
  );
  const [frozenCommit] = escrowInvocations(
    await parsedTransaction(frozenApproval),
    config.programId,
  );
  await index({
    transactionId: frozenApproval,
    eventIndex: frozenCommit.index,
    kind: "reserved",
    obligationId: frozenId.toString("hex"),
  });
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient.publicKey);
  await finalized(
    await freezeAccount(provider.connection, payer, recipientAta, mint, payer),
  );
  assert.equal(
    (await getAccount(provider.connection, recipientAta)).isFrozen,
    true,
  );
  const frozenFetch = globalThis.fetch;
  let frozenRpcError;
  globalThis.fetch = async (url, options) => {
    const response = await frozenFetch(url, options);
    if (JSON.parse(options?.body ?? "{}").method === "sendTransaction")
      frozenRpcError = (await response.clone().json()).error;
    return response;
  };
  try {
    await assert.rejects(
      dispatchPayment(db, restarted, frozenId.toString("hex"), new Date()),
      /RPC failure/,
    );
  } finally {
    globalThis.fetch = frozenFetch;
  }
  assert.match(JSON.stringify(frozenRpcError), /frozen|0x11/i);
  const frozenAttempt = sql
    .prepare("SELECT * FROM payment_attempts WHERE obligation_id=?")
    .get(frozenId.toString("hex"));
  assert.equal(frozenAttempt.state, "unknown");
  const frozenKey = `solana:relayer:${input.network}:${frozenAttempt.id}`;
  const frozenSigned = await journal("gas:").get(frozenKey);
  assert.ok(frozenSigned?.raw);
  assert.equal(
    (
      await provider.connection.getSignatureStatuses(
        [frozenSigned.transactionId],
        { searchTransactionHistory: true },
      )
    ).value[0],
    null,
  );
  const recoveryEnvironment = {
    PAYMENTS_DB: db,
    SOLANA_PAYMENT_EXECUTOR: {
      async fetch(request) {
        assert.equal(new URL(request.url).pathname, "/v1/attempt-status");
        const identity = await request.json();
        const result = await lookupAttempt(
          { PAYMENTS_DB: db, JOURNAL: journal("gas:") },
          identity,
        );
        const verified = await preflightSolanaDeployment(common, identity);
        return Response.json({
          ...result,
          submitted:
            (await solanaTransactionStatus({ config: verified }, result)) !==
            null,
        });
      },
    },
  };
  await recoverUncertainAttempts(recoveryEnvironment);
  const recovered = sql
    .prepare("SELECT state FROM payment_outbox WHERE obligation_id=?")
    .get(frozenId.toString("hex"));
  console.log(
    JSON.stringify({
      step: "frozen-preflight-recovery",
      signature: frozenSigned.transactionId,
      observed: false,
      outbox: recovered.state,
    }),
  );
  assert.equal(
    recovered.state,
    "ready",
    "a journaled but unobserved signature must remain retryable",
  );
  // Recover a row saved by the old scheduler, with the same actual unobserved
  // signature. The existing signed journal record must remain intact.
  sql
    .prepare(
      "UPDATE payment_attempts SET state='submitted',transaction_id=? WHERE id=?",
    )
    .run(frozenSigned.transactionId, frozenAttempt.id);
  sql
    .prepare(
      "UPDATE payment_outbox SET state='submitted' WHERE obligation_id=?",
    )
    .run(frozenId.toString("hex"));
  await recoverUncertainAttempts(recoveryEnvironment);
  assert.equal(
    sql
      .prepare("SELECT state FROM payment_outbox WHERE obligation_id=?")
      .get(frozenId.toString("hex")).state,
    "ready",
  );
  assert.equal(
    (await journal("gas:").get(frozenKey)).transactionId,
    frozenSigned.transactionId,
  );
  await finalized(
    await thawAccount(provider.connection, payer, recipientAta, mint, payer),
  );
  const frozenExpiryDeadline = Date.now() + 150000;
  while (
    (await provider.connection.getBlockHeight("finalized")) <=
    frozenSigned.lastValidBlockHeight
  ) {
    assert.ok(
      Date.now() < frozenExpiryDeadline,
      "frozen attempt did not reach finalized expiry",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(
    await dispatchPayment(db, restarted, frozenId.toString("hex"), new Date()),
    "submitted",
  );
  const retried = sql
    .prepare("SELECT * FROM payment_attempts WHERE obligation_id=?")
    .get(frozenId.toString("hex"));
  assert.equal(retried.id, frozenAttempt.id);
  assert.notEqual(retried.transaction_id, frozenSigned.transactionId);
  await finalized(retried.transaction_id);
  const [frozenPay] = escrowInvocations(
    await parsedTransaction(retried.transaction_id),
    config.programId,
  );
  await index({
    transactionId: retried.transaction_id,
    eventIndex: frozenPay.index,
    kind: "paid",
    obligationId: frozenId.toString("hex"),
  });
  assert.equal(
    sql
      .prepare("SELECT state FROM payment_obligations WHERE id=?")
      .get(frozenId.toString("hex")).state,
    "paid",
  );
  assert.equal(
    (await getAccount(provider.connection, recipientAta)).amount,
    9800n,
  );
  const history = await journal("gas:").get(
    `${frozenKey}:expired:${frozenSigned.generation}`,
  );
  assert.equal(history.transactionId, frozenSigned.transactionId);
  console.log(
    JSON.stringify({
      step: "frozen-destination-recovered",
      oldSignature: frozenSigned.transactionId,
      paidSignature: retried.transaction_id,
      sameAttempt: true,
      net: "9800",
    }),
  );
  sql.close();
});

// A fresh funded project, a SQLite ledger with every migration, and the real
// scanner and ledger wired to the adapter, as the payments cron runs them.
async function scannedProject(label) {
  await ensureConfig(program);
  const mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
  );
  const source = await createAccount(
    provider.connection,
    payer,
    mint,
    payer.publicKey,
  );
  await mintTo(provider.connection, payer, mint, source, payer, 50_000_000n);
  const domain = hash(`scanned:${label}`),
    projectId = hash(`scanned-project:${label}${RUN}`);
  const project = pda(
      Buffer.from("project"),
      payer.publicKey.toBuffer(),
      projectId,
      Buffer.from([0]),
    ),
    vault = pda(Buffer.from("vault"), project.toBuffer());
  await program.methods
    .initialize(
      [...projectId],
      [...domain],
      configIdentity.publicKey,
      configFees.publicKey,
      bn(0),
      bn(0),
      { ordinary: {} },
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      config: configAddress(program.programId),
    })
    .rpc();
  await program.methods
    .deposit(bn(50_000_000))
    .accountsStrict({
      depositor: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const config = {
    projectId: `scanned-${label}`,
    network: "solana-localnet",
    chain: "solana",
    vault: vault.toBase58(),
    programId: program.programId.toBase58(),
    projectPda: project.toBase58(),
    asset: mint.toBase58(),
    networkDomain: domain.toString("hex"),
    owner: payer.publicKey.toBase58(),
    identityAuthority: configIdentity.publicKey.toBase58(),
    feeRecipient: configFees.publicKey.toBase58(),
    ...expectedDeployment,
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "0",
  };
  const adapter = solanaPaymentAdapter({
    ...config,
    mint: config.asset,
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: await provider.connection.getGenesisHash(),
  });
  rmSync(`.local/scanned-${label}.sqlite`, { force: true });
  const sql = new DatabaseSync(`.local/scanned-${label}.sqlite`);
  for (const migration of readdirSync("../../migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`../../migrations/${migration}`, "utf8"));
  const statement = (query, args = []) => ({
    bind: (...values) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) ?? null,
    run: async () => {
      const result = sql.prepare(query).run(...args);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });
  const db = {
    prepare: statement,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const values = [];
        for (const stmt of statements) values.push(await stmt.run());
        sql.exec("COMMIT");
        return values;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  // Runs the cron until the scan interval completes; any throw fails the test.
  async function scan() {
    await storeVaultSnapshot(
      db,
      config,
      await readVaultTotals({
        rpcUrl: provider.connection.rpcEndpoint,
        network: config.network,
        projectPda: config.projectPda,
        programId: config.programId,
      }),
      new Date().toISOString(),
    );
    const index = (event) =>
      indexPaymentEvent(db, adapter, event, new Date().toISOString());
    for (let run = 0; run < 20; run++) {
      await scanSolanaPayments(
        db,
        config,
        provider.connection.rpcEndpoint,
        index,
      );
      if (!sql.prepare("SELECT 1 FROM payment_solana_scans").get()) break;
    }
    assert.equal(
      sql.prepare("SELECT count(*) n FROM payment_solana_scans").get().n,
      0,
    );
  }
  return { mint, domain, project, vault, config, sql, scan };
}

// Regression for red-team pass 3: commit_monthly_award puts its u32 period
// before the award ID. The scanner read the ID 4 bytes early, so the first
// committed monthly leaf failed verification and the scanner stopped for good.
test("the scanner indexes a committed monthly leaf and advances its cursor", {
  timeout: 300000,
}, async () => {
  const { project, vault, domain, sql, scan } = await scannedProject("monthly");
  await program.methods
    .setMonthlyCommitment(bn(40_000_000), true)
    .accountsStrict({ owner: payer.publicKey, project })
    .rpc();
  const chainTime = async () =>
    provider.connection.getBlockTime(
      await provider.connection.getSlot("confirmed"),
    );
  const shifted = new Date(((await chainTime()) - 259_200) * 1000);
  const open = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1),
  );
  const period = `${open.getUTCFullYear()}-${String(open.getUTCMonth() + 1).padStart(2, "0")}`;
  const number = Number(period.replace("-", ""));
  const month = pda(
    Buffer.from("month"),
    project.toBuffer(),
    Buffer.from(new Uint32Array([number]).buffer),
  );
  const entries = [501, 502].map((actor) => ({
    githubUserId: String(actor),
    grossMicro: "10000000",
    sourceDigest: hash(`scanned-monthly:${actor}`).toString("hex"),
  }));
  const root = solanaAllocationRoot(entries),
    total = solanaAllocationTotal(entries),
    frozenAt = String(await chainTime());
  await program.methods
    .commitMonthly(
      number,
      [...Buffer.from(root, "hex")],
      bn(total),
      bn(frozenAt),
    )
    .accountsStrict({
      payer: payer.publicKey,
      project,
      vault,
      month,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      Ed25519Program.createInstructionWithPrivateKey({
        privateKey: configIdentity.secretKey,
        message: solanaMonthlyMessage(
          program.programId.toBase58(),
          project.toBase58(),
          period,
          root,
          total,
          frozenAt,
          domain.toString("hex"),
        ),
      }),
    ])
    .rpc();
  const [entry] = entries;
  const digest = Buffer.from(entry.sourceDigest, "hex");
  const awardHex = solanaAwardId(project.toBase58(), entry.sourceDigest);
  const award = Buffer.from(awardHex, "hex");
  const committed = await program.methods
    .commitMonthlyAward(
      number,
      [...award],
      [...digest],
      bn(entry.githubUserId),
      bn(entry.grossMicro),
      0,
      entries.length,
      solanaAllocationProof(entries, 0).map((node) => ({
        hash: [...Buffer.from(node.hash, "hex")],
        total: bn(node.total),
      })),
    )
    .accountsStrict({
      payer: payer.publicKey,
      project,
      vault,
      month,
      origin: pda(Buffer.from("origin"), project.toBuffer(), digest),
      obligation: pda(Buffer.from("award"), project.toBuffer(), award),
      settled: pda(Buffer.from("settled"), month.toBuffer(), digest),
      monthlySource: pda(
        Buffer.from("monthly-source"),
        project.toBuffer(),
        digest,
      ),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await finalized(committed);
  const [invocation] = escrowInvocations(
    await parsedTransaction(committed),
    program.programId.toBase58(),
  );
  assert.equal(invocation.awardId, awardHex);
  await scan();
  const event = sql.prepare("SELECT * FROM payment_events").get();
  assert.equal(event.kind, "reserved");
  assert.equal(event.obligation_id, awardHex);
  assert.deepEqual(
    {
      ...sql
        .prepare("SELECT github_user_id,state FROM payment_obligations")
        .get(),
    },
    { github_user_id: "501", state: "reserved" },
  );
  assert.equal(
    sql.prepare("SELECT position FROM payment_chain_cursors").get().position,
    committed,
  );
  sql.close();
});

// Regression for red-team pass 3: with the fee rounded up, a 1-unit award has
// a net of 0 and pay makes no transfer. The adapter required one transfer, so
// the paid event could never be indexed and the scanner stopped.
test("a zero-net payment of a 1-unit award is indexed as paid", {
  timeout: 300000,
}, async () => {
  const { mint, project, vault, domain, sql, scan } =
    await scannedProject("one-unit");
  const digest = hash("scanned-one-unit-source");
  const awardHex = solanaAwardId(project.toBase58(), digest.toString("hex"));
  const award = Buffer.from(awardHex, "hex");
  const obligation = pda(Buffer.from("award"), project.toBuffer(), award);
  const actor = 601n;
  await finalized(
    await program.methods
      .commit([...award], [...digest], bn(actor), bn(1))
      .accountsStrict({
        owner: payer.publicKey,
        project,
        vault,
        origin: pda(Buffer.from("origin"), project.toBuffer(), digest),
        obligation,
        systemProgram: SystemProgram.programId,
      })
      .rpc(),
  );
  const stored = await program.account.obligation.fetch(obligation);
  assert.equal(stored.principal.toString(), "0");
  assert.equal(stored.fee.toString(), "1");
  const wallet = Keypair.generate();
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: configIdentity.publicKey,
        lamports: 100_000_000,
      }),
    ),
    [payer],
  );
  const destination = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    wallet.publicKey,
  );
  const actorSeed = Buffer.alloc(8);
  actorSeed.writeBigUInt64LE(actor);
  const binding = pda(Buffer.from("wallet"), project.toBuffer(), actorSeed);
  const now = await provider.connection.getBlockTime(
    await provider.connection.getSlot("confirmed"),
  );
  await program.methods
    .bindWallet(
      bn(actor),
      [...domain],
      bn(0),
      [...hash("scanned-one-unit-claim")],
      bn(now + 600),
    )
    .accountsStrict({
      payer: payer.publicKey,
      identityAuthority: configIdentity.publicKey,
      destination: wallet.publicKey,
      project,
      binding,
      systemProgram: SystemProgram.programId,
    })
    .signers([configIdentity, wallet])
    .rpc();
  // The ledger records a payout only to a wallet the contributor authorized.
  const at = new Date().toISOString();
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('one-unit-wallet','601','one-unit',?,'d1_registry',?,?,?,?,'solana')",
    )
    .run(wallet.publicKey.toBase58(), "a".repeat(64), at, "b".repeat(64), at);
  sql
    .prepare("INSERT INTO payment_wallet_challenges VALUES(?,?,?,?,?,?)")
    .run("one-unit-challenge", "one-unit-wallet", "601", "consent", at, at);
  sql
    .prepare("INSERT INTO payment_wallet_authorizations VALUES(?,?,?,?,?)")
    .run("one-unit-wallet", "601", at, "one-unit-challenge", "signature");
  const versionSeed = Buffer.alloc(8);
  versionSeed.writeBigUInt64LE(1n);
  const paid = await program.methods
    .pay(bn(1))
    .accountsStrict({
      project,
      obligation,
      binding,
      mint,
      vault,
      destination: destination.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      veto: pda(
        Buffer.from("veto"),
        project.toBuffer(),
        actorSeed,
        versionSeed,
      ),
    })
    .rpc();
  await finalized(paid);
  const [invocation] = escrowInvocations(
    await parsedTransaction(paid),
    program.programId.toBase58(),
  );
  assert.equal(invocation.kind, "paid");
  assert.equal(invocation.children.length, 0);
  await scan();
  assert.deepEqual(
    sql
      .prepare("SELECT kind FROM payment_events ORDER BY kind")
      .all()
      .map((row) => row.kind),
    ["paid", "reserved"],
  );
  assert.equal(
    sql.prepare("SELECT state FROM payment_obligations").get().state,
    "paid",
  );
  assert.equal(
    sql.prepare("SELECT position FROM payment_chain_cursors").get().position,
    paid,
  );
  sql.close();
});
