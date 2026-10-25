/** Local validator proof of the external keeper. Requires a disclosed local genesis/schedule fixture. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import anchor from "@coral-xyz/anchor";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
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
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { onRequest } from "../../../functions/api/v1/[[path]].ts";
import { runKeeper } from "../../../scripts/payment-keeper/keeper.ts";
import { openKeeperStore } from "../../../scripts/payment-keeper/store.ts";
import { ESCROW_NETWORKS } from "../../../src/lib/escrow-policy.mjs";
import { PRD_MONTHLY_SCHEDULE } from "../../../src/lib/payments/monthly-allocation.ts";
import { assertProjectDefinition } from "../../../src/lib/project-schema.mjs";
import { applicationManifest } from "../../../tests/project-application-manifest.ts";
import { sqliteD1 } from "../../../tests/sqlite-d1.ts";
import { freezeSolanaMonthly } from "../../../workers/payment-executor/solana-monthly.ts";
import {
  solanaAllocationRoot,
  solanaAllocationTotal,
  solanaMonthlyMessage,
} from "../adapter.ts";
import {
  configAddress,
  configFees,
  configIdentity,
  ensureConfig,
  expectedDeployment,
} from "./deployment.mjs";

if (process.env.SLOP_KEEPER_LOCAL_PROOF !== "1")
  throw new Error("Explicit local keeper proof required");
const provider = anchor.AnchorProvider.env();
if (new URL(provider.connection.rpcEndpoint).hostname !== "127.0.0.1")
  throw new Error("Only the owned loopback validator is permitted");
const genesis = await provider.connection.getGenesisHash();
assert.equal(
  ESCROW_NETWORKS["solana-devnet"].genesisHash,
  genesis,
  "Apply and record the fixture-only genesis overlay; never spoof RPC genesis",
);
assert.notEqual(genesis, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
const owner = provider.wallet.payer;
const program = new anchor.Program(
  JSON.parse(readFileSync("target/idl/slop_escrow.json")),
  provider,
);
const hash = (value) => createHash("sha256").update(value).digest();
const bn = (value) => new anchor.BN(String(value));
const pda = (...seeds) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const gas = Keypair.generate();
const alice = Keypair.generate();
const bob = Keypair.generate();
const directory = mkdtempSync(join(tmpdir(), "slop-solana-keeper-"));
const journalFile = join(directory, "keeper.sqlite");
let store = openKeeperStore(journalFile);
const { db, sqlite } = sqliteD1(
  readdirSync("../../migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort(),
);
let lose = false;
let last;
const proxy = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const text = await request.text();
    if (lose && JSON.parse(text).method === "sendTransaction")
      return new Response("lost before acceptance", { status: 502 });
    return fetch(provider.connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });
  },
});
const api = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    return onRequest({
      request: new Request(`https://slop.cash${new URL(request.url).pathname}`),
      env: { SLOP_DB: db, PAYMENT_NETWORKS: '["solana-devnet"]' },
    });
  },
});
const finalized = async (signature) =>
  provider.connection.confirmTransaction(signature, "finalized");
const time = async () => {
  const slot = await provider.connection.getSlot("finalized");
  const value = await provider.connection.getBlockTime(slot);
  assert(Number.isSafeInteger(value));
  return value;
};
async function until(check, seconds = 90) {
  const deadline = Date.now() + seconds * 1000;
  let result;
  do {
    result = await check();
    if (result) return result;
    await Bun.sleep(500);
  } while (Date.now() < deadline);
  throw new Error(
    `Local keeper check did not finish: ${JSON.stringify(result)}`,
  );
}
try {
  await ensureConfig(program);
  await finalized(
    await sendAndConfirmTransaction(
      provider.connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: gas.publicKey,
          lamports: 100_000_000,
        }),
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: configIdentity.publicKey,
          lamports: 100_000_000,
        }),
      ),
      [owner],
    ),
  );
  const mint = await createMint(
    provider.connection,
    owner,
    owner.publicKey,
    owner.publicKey,
    6,
  );
  const source = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    mint,
    owner.publicKey,
  );
  await mintTo(
    provider.connection,
    owner,
    mint,
    source.address,
    owner,
    10_000_000n,
  );
  const projectId = "solana-keeper-proof";
  const projectDigest = hash(`slop-project:${projectId}`);
  const domain = hash("local-keeper-domain");
  const project = pda(
    Buffer.from("project"),
    owner.publicKey.toBuffer(),
    projectDigest,
    Buffer.from([0]),
  );
  const vault = pda(Buffer.from("vault"), project.toBuffer());
  const creation = await program.methods
    .initialize(
      [...projectDigest],
      [...domain],
      configIdentity.publicKey,
      configFees.publicKey,
      bn(0),
      bn(604800),
      { ordinary: {} },
    )
    .accountsStrict({
      owner: owner.publicKey,
      project,
      mint,
      vault,
      config: configAddress(program.programId),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await finalized(creation);
  await finalized(
    await program.methods
      .setMonthlyCommitment(bn(2_000_000), true)
      .accountsStrict({ owner: owner.publicKey, project })
      .rpc(),
  );
  await finalized(
    await program.methods
      .deposit(bn(10_000_000))
      .accountsStrict({
        depositor: owner.publicKey,
        project,
        mint,
        source: source.address,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(),
  );
  const now = new Date((await time()) * 1000);
  const cutoffMonth = now.getUTCDate() >= 4 ? 1 : 2;
  const period = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - cutoffMonth, 1),
  )
    .toISOString()
    .slice(0, 7);
  assert.equal(
    PRD_MONTHLY_SCHEDULE.firstPeriod,
    period,
    "Fixture schedule must disclose the current local open month; production begins November",
  );
  const deployment = {
    ...expectedDeployment,
    network: "solana-devnet",
    vault: vault.toBase58(),
    programId: program.programId.toBase58(),
    projectPda: project.toBase58(),
    networkDomain: domain.toString("hex"),
    asset: mint.toBase58(),
    owner: owner.publicKey.toBase58(),
    identityAuthority: configIdentity.publicKey.toBase58(),
    feeRecipient: configFees.publicKey.toBase58(),
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "604800",
    factory: null,
    factoryCodeSha256: null,
    registrar: null,
    deploymentTransaction: creation,
    sourceCommit: process.env.SLOP_KEEPER_SOURCE,
  };
  const draft = applicationManifest(projectId, "example/solana-keeper-proof");
  const manifest = assertProjectDefinition({
    ...draft,
    status: "active",
    reward: {
      ...draft.reward,
      chain: "solana",
      currency: "TEST",
      feeBasisPoints: 200,
      monthlyCapMinor: "2000000",
      monthlyCapDisplay: "2 TEST",
    },
    rewardAsset: {
      network: "solana",
      kind: "token",
      address: mint.toBase58(),
      symbol: "TEST",
      decimals: 6,
      chainId: null,
      cluster: "mainnet-beta",
      verifiedAt: now.toISOString(),
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: period,
      chain: "solana",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  });
  const text = JSON.stringify(manifest),
    digest = hash(text).toString("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(projectId, text, digest, "Local keeper proof", now.toISOString());
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(projectId, text, digest, now.toISOString(), now.toISOString());
  const entries = ["1001", "1002"].map((actor) => ({
    githubUserId: actor,
    grossMicro: "1000000",
    sourceDigest: hash(`keeper-month:${actor}`).toString("hex"),
  }));
  const config = {
    ...deployment,
    mint: deployment.asset,
    rpcUrl: provider.connection.rpcEndpoint,
    genesisHash: genesis,
    projectId,
  };
  const plan = {
    family: "solana",
    request: {
      projectId,
      period,
      network: "solana-devnet",
      snapshotSha256: hash("local frozen fixture").toString("hex"),
    },
    deployment,
    allocationRoot: solanaAllocationRoot(entries),
    totalGrossBase: solanaAllocationTotal(entries),
    entries,
    messageHex: "",
  };
  plan.frozenAt = await freezeSolanaMonthly(config, plan);
  const message = solanaMonthlyMessage(
    config.programId,
    config.projectPda,
    period,
    plan.allocationRoot,
    plan.totalGrossBase,
    plan.frozenAt,
    config.networkDomain,
  );
  plan.messageHex = Buffer.from(message).toString("hex");
  const authorization = {
    plan,
    signatureHex: Buffer.from(
      ed25519.sign(message, configIdentity.secretKey.slice(0, 32)),
    ).toString("hex"),
  };
  sqlite
    .query("INSERT INTO monthly_reward_bases VALUES(?,?,?,?,?,?,?,?)")
    .run(
      projectId,
      period,
      text,
      digest,
      plan.request.snapshotSha256,
      "2000000",
      2,
      now.toISOString(),
    );
  sqlite
    .query(
      "INSERT INTO monthly_payment_runs VALUES(?,?,'automatic',NULL,0,?,?,?,?,?,?,?)",
    )
    .run(
      projectId,
      period,
      JSON.stringify(entries),
      plan.request.snapshotSha256,
      "solana-devnet",
      deployment.vault,
      "2000000",
      now.toISOString(),
      now.toISOString(),
    );
  sqlite
    .query("INSERT INTO monthly_payment_authorizations VALUES(?,?,?,?,?,?)")
    .run(
      projectId,
      period,
      "solana-devnet",
      plan.request.snapshotSha256,
      JSON.stringify(authorization),
      now.toISOString(),
    );
  const operator = {
    apiOrigin: api.url.origin,
    network: "solana-devnet",
    projectIds: [projectId],
    signer: gas.publicKey.toBase58(),
    rpcUrl: proxy.url.origin,
    perRun: 10,
    gas: {
      perTransaction: "10000000",
      perDay: "100000000",
      additionalFeeReserve: "0",
    },
  };
  let signatures = 0;
  const signer = {
    address: gas.publicKey.toBase58(),
    async signMessage(message) {
      signatures++;
      return ed25519.sign(message, gas.secretKey.slice(0, 32));
    },
  };
  const tick = async (execute = true, value = operator) =>
    (last = await runKeeper(
      value,
      {
        store,
        solanaSigner: signer,
        now,
        localChain: { solanaGenesis: genesis },
      },
      execute,
    ));
  const dry = await tick(false);
  assert(
    dry.some((item) => item.state === "published-not-executed"),
    JSON.stringify(dry),
  );
  assert.equal(signatures, 0);
  await finalized(
    await program.methods
      .setMonthlyCommitment(bn(2_000_000), false)
      .accountsStrict({ owner: owner.publicKey, project })
      .rpc(),
  );
  // Contract simulation refuses opt-out. A rejected signed attempt remains journaled.
  await tick();
  const beforeOn = signatures;
  assert(
    last.some((item) => item.state === "waiting"),
    JSON.stringify(last),
  );
  await finalized(
    await program.methods
      .setMonthlyCommitment(bn(2_000_000), true)
      .accountsStrict({ owner: owner.publicKey, project })
      .rpc(),
  );
  lose = true;
  await tick();
  const rootAttempt = store.db
    .query("SELECT value FROM journal WHERE key LIKE 'solana:monthly:%:root'")
    .get();
  assert(rootAttempt);
  const beforeRestart = signatures;
  store.close();
  store = openKeeperStore(journalFile);
  lose = false;
  await tick();
  assert.equal(
    signatures,
    beforeRestart,
    "Restart reuses the exact signed root",
  );
  await finalized(JSON.parse(rootAttempt.value).transactionId);
  await until(async () => {
    await tick();
    return store.db.query("SELECT count(*) n FROM awards").get().n === 2;
  });
  assert(
    last.filter((item) => item.state === "awaiting-wallet").length === 2,
    JSON.stringify(last),
  );
  // Real account+wallet signatures establish each binding. No private claim DB reaches the keeper.
  for (const [index, wallet] of [alice, bob].entries()) {
    const actor = BigInt(entries[index].githubUserId);
    const actorBytes = Buffer.alloc(8);
    actorBytes.writeBigUInt64LE(actor);
    await finalized(
      await program.methods
        .bindWallet(
          bn(actor),
          [...domain],
          bn(0),
          [...hash(`claim:${index}`)],
          bn((await time()) + 86400),
        )
        .accountsStrict({
          payer: owner.publicKey,
          identityAuthority: configIdentity.publicKey,
          destination: wallet.publicKey,
          project,
          binding: pda(Buffer.from("wallet"), project.toBuffer(), actorBytes),
          systemProgram: SystemProgram.programId,
        })
        .signers([configIdentity, wallet])
        .rpc(),
    );
  }
  const aliceAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    owner,
    mint,
    alice.publicKey,
  );
  await finalized(
    await freezeAccount(
      provider.connection,
      owner,
      aliceAta.address,
      mint,
      owner,
    ),
  );
  await until(async () => {
    await tick();
    return (
      store.db
        .query("SELECT count(*) n FROM awards WHERE payment IS NOT NULL")
        .get().n === 1
    );
  });
  assert.equal(
    (
      await getAccount(
        provider.connection,
        getAssociatedTokenAddressSync(mint, bob.publicKey),
        "finalized",
      )
    ).amount,
    980000n,
  );
  await finalized(
    await thawAccount(
      provider.connection,
      owner,
      aliceAta.address,
      mint,
      owner,
    ),
  );
  // The prior failed preflight signature is safe to retry unchanged after thaw.
  await until(async () => {
    await tick();
    return (
      store.db
        .query("SELECT count(*) n FROM awards WHERE payment IS NOT NULL")
        .get().n === 2
    );
  });
  assert.equal(
    (await getAccount(provider.connection, aliceAta.address, "finalized"))
      .amount,
    980000n,
  );
  const count = signatures;
  await tick();
  assert.equal(signatures, count);
  const paid = await program.account.project.fetch(project, "finalized");
  assert.equal(paid.reserved.toString(), "0");
  assert.equal(paid.totalPaid.toString(), "1960000");
  assert.equal(paid.accruedFees.toString(), "40000");
  console.log(
    JSON.stringify({
      result: "PASS",
      source: process.env.SLOP_KEEPER_SOURCE,
      genesis,
      programSha256: expectedDeployment.codeSha256,
      overlay:
        "local genesis pin + firstPeriod=current local open month; no public-network or November-start qualification",
      period,
      cases: [
        "public HTTP and migrated SQLite",
        "read-only dry run",
        "on-chain opt-out",
        "same-byte root restart",
        "bounded monthly leaves",
        "late co-signed wallet binding",
        "frozen recipient isolation",
        "exact finalized scanner indexing",
        "replay",
      ],
      beforeOn,
      signatures,
      payments: 2,
    }),
  );
} catch (error) {
  console.error("Local keeper last safe result", JSON.stringify(last));
  throw error;
} finally {
  store.close();
  sqlite.close();
  api.stop(true);
  proxy.stop(true);
}
