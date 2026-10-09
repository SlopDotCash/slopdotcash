import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import {
  createAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  escrowInvocations,
  solanaAwardId,
  solanaPaymentAdapter,
} from "../.local/adapter.mjs";
import {
  createSolanaAttester,
  createSolanaExecutor,
  preflightSolanaDeployment,
} from "../.local/executor.mjs";
import { indexPaymentEvent } from "../.local/ledger.mjs";
import { scanSolanaPayments } from "../.local/scanner.mjs";
import { expectedDeployment } from "./deployment.mjs";

const { AnchorProvider, Program, BN } = anchor;
const provider = AnchorProvider.env(),
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
test("durable executor verifies SQLite consent, binds, creates ATAs, pays and retries exact signature", {
  timeout: 480000,
}, async () => {
  const identity = Keypair.generate(),
    gas = Keypair.generate(),
    recipient = Keypair.generate(),
    fee = Keypair.generate();
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
      null,
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
    )
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await program.methods
    .deposit(bn(100_000_000))
    .accountsStrict({
      owner: payer.publicKey,
      project,
      mint,
      source,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  const approval = await program.methods
    .commit([...awardId], [...origin], bn(103), bn(100_000_000))
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
      "INSERT INTO payment_obligations VALUES(?,?,?,?,?,?,?,?,?,'reserved',?,NULL)",
    )
    .run(
      input.obligationId,
      "executor-project",
      "103",
      input.network,
      "solana",
      input.vault,
      "100000000",
      "2000000",
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
  const attester = createSolanaAttester({
    ...common,
    SOLANA_SIGNER: signer(identity),
    JOURNAL: journal("identity:"),
  });
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
    ATTESTER: attester,
  });
  await assert.rejects(
    executor.submit({ ...input, destination: fee.publicKey.toBase58() }),
    /Payout request differs/,
  );
  await assert.rejects(executor.submit(input), /binding awaiting finality/);
  const bound = await attester.submit(input);
  await finalized(bound.transactionId);
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
      assert.match(String(result.reason), /Injected transport interruption/);
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
    ATTESTER: attester,
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
    98_000_000n,
  );
  assert.equal(
    (
      await getAccount(
        provider.connection,
        getAssociatedTokenAddressSync(mint, fee.publicKey),
      )
    ).amount,
    2_000_000n,
  );
  const [{ index: eventIndex }] = escrowInvocations(
    await parsedTransaction(sent.transactionId),
    config.programId,
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
    "98000000",
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
    )
    .accountsStrict({
      owner: payer.publicKey,
      project: foreign,
      mint,
      vault: foreignVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await mintTo(provider.connection, payer, mint, source, payer, 1_000_000n);
  await program.methods
    .deposit(bn(1_000_000))
    .accountsStrict({
      owner: payer.publicKey,
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
      if (event.kind === "reserved") {
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
  sql.close();
});
