import { createHash } from "node:crypto";
/** Local-only workflow: real Anvil contracts + SQLite + GitHub-session API + signed wallet authorization. */

import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { mnemonicToAccount } from "viem/accounts";
import {
  baseAwardId,
  buildBindCalldata,
  buildPayCalldata,
  verifyBinding,
} from "../../contracts/evm/adapter";
import { sha256Hex } from "../../workers/identity/crypto";
import {
  createBaseAttester,
  createBaseExecutor,
  type JournalStore,
  lookupAttempt,
  retireUnsignedAttempt,
} from "../../workers/payment-executor/core";
import { scanBasePayments } from "../../workers/payments/scanner";
import type { D1Database } from "../trace/cloudflare-persistence";
import { basePaymentAdapter } from "./base-adapter";
import { dispatchPayment } from "./dispatch";
import { handlePaymentsApi } from "./handler";
import { indexPaymentEvent } from "./ledger";
import { personalMessageHash } from "./possession";

const root = fileURLToPath(new URL("../../", import.meta.url));
const localPort = process.argv.includes("--serve") ? 18547 : 18557;
const rpcUrl = `http://127.0.0.1:${localPort}`;
const anvil = spawn("anvil", ["--port", String(localPort), "--silent"], {
  stdio: "ignore",
});
const sql = new Database(":memory:");
const journalDirectory = mkdtempSync(join(tmpdir(), "slop-executor-journal-"));
let faultProxy: ReturnType<typeof Bun.serve> | undefined;
const journalHandles: Database[] = [];
function journal(role: string): JournalStore {
  const database = new Database(join(journalDirectory, `${role}.sqlite`));
  journalHandles.push(database);
  database.exec(
    "CREATE TABLE IF NOT EXISTS journal(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  let gate = Promise.resolve();
  const store: JournalStore = {
    async get<T>(key: string) {
      const row = database
        .query<{ value: string }, [string]>(
          "SELECT value FROM journal WHERE key=?",
        )
        .get(key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async put<T>(key: string, value: T) {
      database
        .prepare(
          "INSERT INTO journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    async transaction<T>(callback: (txn: JournalStore) => Promise<T>) {
      const previous = gate;
      let unlock!: () => void;
      gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(store);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        unlock();
      }
    },
  };
  return store;
}
function statement(
  query: string,
  args: unknown[] = [],
): ReturnType<D1Database["prepare"]> {
  return {
    bind(...values: unknown[]) {
      return statement(query, values);
    },
    async first<T>() {
      return (sql.prepare(query).get(...(args as string[])) ??
        null) as T | null;
    },
    async run() {
      const result = sql.prepare(query).run(...(args as string[]));
      return { success: true, meta: { changes: result.changes } };
    },
  };
}
const db: D1Database = {
  prepare: statement,
  async batch(statements) {
    sql.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      sql.exec("COMMIT");
      return results;
    } catch (error) {
      sql.exec("ROLLBACK");
      throw error;
    }
  },
};
const owner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const attester = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const recipient = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const fee = "0x0000000000000000000000000000000000000fee";
const projectKey = `0x${"1".padStart(64, "0")}`;
const delay = "3600";
// Award IDs are bound to the deployed vault; set after deployment.
let award = "";
const source = `0x${"2".padStart(64, "0")}`;
const claimDigest = "c".repeat(64);
const now = new Date().toISOString();
const session = "a".repeat(43);
async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result: unknown; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const deploymentTransactions = new Map<string, string>();
function deploy(contract: string, args: string[] = []) {
  const created = JSON.parse(
    execFileSync(
      "forge",
      [
        "create",
        "--root",
        `${root}contracts/evm`,
        contract,
        "--rpc-url",
        rpcUrl,
        "--unlocked",
        "--from",
        owner,
        "--broadcast",
        "--json",
        ...(args.length ? ["--constructor-args", ...args] : []),
      ],
      { encoding: "utf8" },
    ),
  ) as { deployedTo: string; transactionHash: string };
  deploymentTransactions.set(created.deployedTo, created.transactionHash);
  return created.deployedTo;
}
async function send(to: string, signature: string, args: string[]) {
  const data = execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
  const hash = (await rpc("eth_sendTransaction", [
    { from: owner, to, data, gas: "0x7a1200" },
  ])) as string;
  await rpc("anvil_mine", ["0x1"]);
  const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as {
    status: string;
  };
  assert.equal(receipt.status, "0x1", `Transaction failed: ${signature}`);
  return hash;
}
function request(path: string, body?: unknown) {
  return new Request(`https://slop.cash/api/v1/payments${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: `__Host-slop_points=${session}`,
      ...(body
        ? { origin: "https://slop.cash", "content-type": "application/json" }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (anvil.exitCode !== null) throw new Error("Anvil startup failed");
    try {
      await rpc("eth_chainId", []);
      ready = true;
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  assert(ready);
  sql.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(`${root}migrations`)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`${root}migrations/${file}`, "utf8"));
  const asset = deploy("integration/TestDollar.sol:TestDollar");
  const vault = deploy("src/ProjectEscrow.sol:ProjectEscrow", [
    projectKey,
    asset,
    owner,
    owner,
    fee,
    attester,
    delay,
  ]);
  award = baseAwardId(31337n, vault, source);
  await send(asset, "mint(address,uint256)", [owner, "200000000"]);
  await send(asset, "approve(address,uint256)", [vault, "200000000"]);
  await send(vault, "deposit(uint64)", ["200000000"]);
  const reserveTx = await send(
    vault,
    "commitAward(bytes32,uint64,uint64,bytes32)",
    [award, "123", "100000000", source],
  );
  const runtimeCode = (await rpc("eth_getCode", [vault, "latest"])) as string;
  const config = {
    asset,
    owner,
    identityAuthority: attester,
    feeRecipient: fee,
    codeSha256: createHash("sha256")
      .update(Buffer.from(runtimeCode.slice(2), "hex"))
      .digest("hex"),
    rpcUrl,
    chainId: 31337n,
    vault,
    bindingDelaySeconds: delay,
    projectId: "integration-fixture",
    network: "anvil",
  };
  const adapter = basePaymentAdapter(db, config);
  const scan = () =>
    scanBasePayments(
      db,
      {
        ...config,
        chain: "base",
        deploymentTransaction: deploymentTransactions.get(vault),
      },
      rpcUrl,
      async (event) => {
        await indexPaymentEvent(db, adapter, event, new Date().toISOString());
      },
    );
  await assert.rejects(
    indexPaymentEvent(
      db,
      adapter,
      {
        transactionId: reserveTx,
        eventIndex: 0,
        kind: "reserved",
        obligationId: award,
      },
      now,
    ),
    /finalized/,
  );
  await rpc("anvil_mine", ["0x40"]);
  await scan();
  assert.equal(
    sql.query<{ n: number }, []>("SELECT count(*) n FROM payment_outbox").get()
      ?.n,
    0,
  );
  await assert.rejects(
    send(vault, "withdrawUnused(uint64)", ["100000001"]),
    /Transaction failed/,
  );
  await send(vault, "withdrawUnused(uint64)", ["100000000"]);
  // Free funds are refunded while the walletless contributor's full gross reserve survives.
  sql
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node','123','alice',?,0)",
    )
    .run(now);
  sql
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      await sha256Hex(session),
      "node",
      new Date(Date.now() + 3600000).toISOString(),
    );
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim','123','alice',?,'d1_registry',?,?,?,?,'base')",
    )
    .run(recipient, "a".repeat(64), now, claimDigest, now);
  const challenge = (await (
    await handlePaymentsApi(
      request("/wallets/challenge", { claimId: "claim" }),
      { db },
    )
  ).json()) as { message: string; challengeId: string };
  // Public deterministic test key 1; no user wallet or secret is read.
  const key = new Uint8Array(32);
  key[31] = 1;
  const signed = secp256k1.sign(personalMessageHash(challenge.message), key, {
    prehash: false,
    format: "recovered",
  });
  const signature = `0x${Array.from(signed.slice(1), (b) => b.toString(16).padStart(2, "0")).join("")}${(signed[0] + 27).toString(16)}`;
  assert.equal(
    (
      await handlePaymentsApi(
        request("/wallets/authorize", {
          claimId: "claim",
          challengeId: challenge.challengeId,
          signature,
        }),
        { db },
      )
    ).status,
    200,
  );
  // Public Anvil mnemonic only. Dedicated local attester and gas keys sign real EIP1559 bytes.
  const mnemonic =
    "test test test test test test test test test test test junk";
  const attesterAccount = mnemonicToAccount(mnemonic, { addressIndex: 1 });
  const gasAccount = mnemonicToAccount(mnemonic, { addressIndex: 2 });
  assert.equal(attesterAccount.address.toLowerCase(), attester.toLowerCase());
  const attesterJournal = journal("attester");
  let gasJournal = journal("relayer");
  let loseNextSend = false;
  let loseNextLookup = false;
  let rawBroadcasts = 0;
  let estimateBarrier: { reached: () => void; gate: Promise<void> } | undefined;
  faultProxy = Bun.serve({
    port: process.argv.includes("--serve") ? 18559 : 18558,
    async fetch(request) {
      const text = await request.text();
      const body = JSON.parse(text) as { method: string; params: unknown[] };
      if (body.method === "eth_getTransactionByHash" && loseNextLookup) {
        loseNextLookup = false;
        return new Response("simulated outage", { status: 503 });
      }
      if (body.method === "eth_estimateGas" && estimateBarrier) {
        const barrier = estimateBarrier;
        estimateBarrier = undefined;
        barrier.reached();
        await barrier.gate;
      }
      if (body.method === "eth_sendRawTransaction") {
        rawBroadcasts++;
        assert(
          journalHandles.some((database) =>
            database
              .query<{ value: string }, []>("SELECT value FROM journal")
              .all()
              .some(
                (row) =>
                  JSON.parse(row.value).rawTransaction === body.params[0],
              ),
          ),
          "Signed transaction journal exists before broadcast",
        );
      }
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });
      if (body.method === "eth_sendRawTransaction" && loseNextSend) {
        loseNextSend = false;
        loseNextLookup = true;
        await response.text();
        return new Response("simulated lost response", { status: 503 });
      }
      return response;
    },
  });
  const deployments = JSON.stringify([
    { ...config, chain: "base", chainId: "31337" },
  ]);
  const shared = {
    PAYMENTS_DB: db,
    PAYMENT_DEPLOYMENTS: deployments,
    PAYMENT_RPC_URLS: JSON.stringify({
      anvil: `http://127.0.0.1:${faultProxy.port}`,
    }),
    ALLOW_LOCAL_TEST_CHAIN: true,
  };
  let rejectFirstBinding = true;
  const attesterEngine = createBaseAttester({
    ...shared,
    SIGNER: {
      address: attesterAccount.address,
      async signTransaction(transaction) {
        // The local signer emits one invalid actor ID. Anvil must mine the
        // real contract revert; no receipt or finality response is simulated.
        if (rejectFirstBinding) {
          rejectFirstBinding = false;
          return attesterAccount.signTransaction({
            ...transaction,
            data: `${transaction.data.slice(0, 10)}${"0".repeat(64)}${transaction.data.slice(74)}` as `0x${string}`,
          });
        }
        return attesterAccount.signTransaction(transaction);
      },
    },
    JOURNAL: attesterJournal,
  });
  const makeExecutor = () =>
    createBaseExecutor({
      ...shared,
      SIGNER: gasAccount,
      JOURNAL: gasJournal,
      ATTESTER: attesterEngine,
    });
  await assert.rejects(
    dispatchPayment(db, makeExecutor(), award, new Date()),
    /awaits finality/,
  );
  const bindingAttempt = sql
    .query<{ id: string }, []>("SELECT id FROM payment_attempts LIMIT 1")
    .get();
  assert(bindingAttempt);
  const rejectedBinding = await attesterJournal.get<{ transactionId: string }>(
    `bind:${bindingAttempt.id}`,
  );
  assert(rejectedBinding);
  const rejectedReceipt = (await rpc("eth_getTransactionReceipt", [
    rejectedBinding.transactionId,
  ])) as { status: string };
  assert.equal(rejectedReceipt.status, "0x0");
  await assert.rejects(
    dispatchPayment(db, makeExecutor(), award, new Date()),
    /Recorded transaction reverted/,
  );
  assert.equal(
    rawBroadcasts,
    1,
    "Unfinalized revert must not create a new signed bind",
  );
  assert.deepEqual(
    await attesterJournal.get(`bind:${bindingAttempt.id}`),
    rejectedBinding,
    "The original signed journal entry stays intact until finality",
  );
  await rpc("anvil_mine", ["0x40"]);
  await assert.rejects(
    dispatchPayment(db, makeExecutor(), award, new Date()),
    /awaits finality/,
  );
  const replacementBinding = await attesterJournal.get<{
    transactionId: string;
  }>(`bind:${bindingAttempt.id}`);
  assert(replacementBinding);
  assert.notEqual(
    replacementBinding.transactionId,
    rejectedBinding.transactionId,
  );
  assert.equal(
    rawBroadcasts,
    2,
    "Finalized revert permits one replacement bind",
  );
  await rpc("anvil_mine", ["0x40"]);
  // A pending binding never reaches signing; it pays only after the delay.
  await assert.rejects(
    dispatchPayment(db, makeExecutor(), award, new Date()),
    /activates at/,
  );
  await rpc("evm_increaseTime", [Number(delay)]);
  await rpc("anvil_mine", ["0x1"]);
  loseNextSend = true;
  await assert.rejects(
    dispatchPayment(db, makeExecutor(), award, new Date()),
    /RPC unavailable/,
  );
  await rpc("anvil_mine", ["0x1"]);
  // Reopen the durable SQLite journal, recreating execution state after the ambiguous submission.
  gasJournal = journal("relayer");
  await dispatchPayment(db, makeExecutor(), award, new Date());
  const prepared = sql
    .query<{ id: string; transaction_id: string }, []>(
      "SELECT id,transaction_id FROM payment_attempts LIMIT 1",
    )
    .get();
  assert(prepared);
  const paidTx = prepared.transaction_id;
  assert.equal(
    rawBroadcasts,
    3,
    "One rejected bind, one replacement and one payment across restart",
  );
  await assert.rejects(
    makeExecutor().submit({
      obligationId: award,
      network: "anvil",
      vault,
      githubUserId: "123",
      claimId: "claim",
      claimDigest,
      destination: owner,
      idempotencyKey: prepared.id,
    }),
    /approved registry/,
  );
  assert.equal(
    sql
      .query<{ state: string }, []>("SELECT state FROM payment_obligations")
      .get()?.state,
    "reserved",
  );
  await rpc("anvil_mine", ["0x1"]);
  await assert.rejects(
    indexPaymentEvent(
      db,
      adapter,
      {
        transactionId: paidTx,
        eventIndex: 0,
        kind: "paid",
        obligationId: award,
      },
      now,
    ),
    /finalized/,
  );
  await rpc("anvil_mine", ["0x40"]);
  await scan();
  const eventCount = sql
    .query<{ n: number }, []>("SELECT count(*) n FROM payment_events")
    .get()?.n;
  assert.equal(eventCount, 2);
  await scan();
  assert.equal(
    sql.query<{ n: number }, []>("SELECT count(*) n FROM payment_events").get()
      ?.n,
    eventCount,
    "Scanner replay is idempotent",
  );
  const account = (await (
    await handlePaymentsApi(request("/me"), { db })
  ).json()) as {
    payments: { state: string; netMicro: string }[];
    balances: { chain: string; netMicro: string }[];
  };
  assert.equal(account.payments[0].state, "paid");
  assert.equal(account.payments[0].netMicro, "98000000");
  assert.equal(account.balances.find((b) => b.chain === "base")?.netMicro, "0");
  const balance = execFileSync(
    "cast",
    [
      "call",
      asset,
      "balanceOf(address)(uint256)",
      recipient,
      "--rpc-url",
      rpcUrl,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(balance.split(" ")[0], "98000000");
  // Fees accrue in the vault until anyone claims them for the fee recipient.
  await send(vault, "claimFees()", []);
  const feeBalance = execFileSync(
    "cast",
    ["call", asset, "balanceOf(address)(uint256)", fee, "--rpc-url", rpcUrl],
    { encoding: "utf8" },
  ).trim();
  assert.equal(feeBalance.split(" ")[0], "12000000");
  const refundBalance = execFileSync(
    "cast",
    ["call", asset, "balanceOf(address)(uint256)", owner, "--rpc-url", rpcUrl],
    { encoding: "utf8" },
  ).trim();
  assert.equal(refundBalance.split(" ")[0], "90000000");
  // A later award follows an authenticated successor only after the 24-hour delay.
  const rotationAward = baseAwardId(
    31337n,
    vault,
    `0x${"a".padStart(64, "0")}`,
  );
  await send(asset, "mint(address,uint256)", [owner, "100000000"]);
  await send(asset, "approve(address,uint256)", [vault, "100000000"]);
  await send(vault, "deposit(uint64)", ["100000000"]);
  await send(vault, "commitAward(bytes32,uint64,uint64,bytes32)", [
    rotationAward,
    "123",
    "100000000",
    `0x${"a".padStart(64, "0")}`,
  ]);
  await rpc("anvil_mine", ["0x40"]);
  await scan();
  sql
    .prepare(
      "INSERT INTO payment_attempts(id,obligation_id,claim_id,created_at,state) VALUES('unsigned-old',?,'claim',?,'unknown')",
    )
    .run(rotationAward, now);
  let releaseEstimate!: () => void;
  let reachedEstimate!: () => void;
  const reachedEstimatePromise = new Promise<void>((resolve) => {
    reachedEstimate = resolve;
  });
  const estimateGate = new Promise<void>((resolve) => {
    releaseEstimate = resolve;
  });
  estimateBarrier = { reached: reachedEstimate, gate: estimateGate };
  const inFlightOld = makeExecutor().submit({
    obligationId: rotationAward,
    network: "anvil",
    vault,
    githubUserId: "123",
    claimId: "claim",
    claimDigest,
    destination: recipient,
    idempotencyKey: "unsigned-old",
  });
  await Promise.race([
    reachedEstimatePromise,
    Bun.sleep(10000).then(() => {
      throw new Error("Signer did not reach pre-sign RPC barrier");
    }),
  ]);
  const successorAccount = mnemonicToAccount(mnemonic, { addressIndex: 4 });
  // Use the account's normal personal-sign implementation for this separately controlled test wallet.
  const successorDigest = "d".repeat(64);
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES('claim-next','123','alice',?,'d1_registry',?,?,?,'claim',?,'base')",
    )
    .run(successorAccount.address, "e".repeat(64), now, successorDigest, now);
  const successorChallenge = (await (
    await handlePaymentsApi(
      request("/wallets/challenge", { claimId: "claim-next" }),
      { db },
    )
  ).json()) as { message: string; challengeId: string };
  const successorSignature = await successorAccount.signMessage({
    message: successorChallenge.message,
  });
  assert.equal(
    (
      await handlePaymentsApi(
        request("/wallets/authorize", {
          claimId: "claim-next",
          challengeId: successorChallenge.challengeId,
          signature: successorSignature,
        }),
        { db },
      )
    ).status,
    200,
  );
  // The already-authorized old signer is paused at RPC while its wallet is superseded.
  const oldRequest = {
    idempotencyKey: "unsigned-old",
    obligationId: rotationAward,
    network: "anvil",
    vault,
  };
  assert.deepEqual(
    await retireUnsignedAttempt(
      { PAYMENTS_DB: db, JOURNAL: gasJournal },
      oldRequest,
    ),
    { retired: true, transactionId: null },
  );
  assert(await gasJournal.get("retired:anvil:unsigned-old"));
  releaseEstimate();
  await assert.rejects(inFlightOld, /retired before signing/);
  assert.equal(
    rawBroadcasts,
    3,
    "Retirement blocks the in-flight old signer before broadcast",
  );
  sql
    .prepare(
      "UPDATE payment_attempts SET state='failed' WHERE id='unsigned-old'",
    )
    .run();
  assert.deepEqual(
    await lookupAttempt(
      { PAYMENTS_DB: db, JOURNAL: gasJournal },
      {
        idempotencyKey: prepared.id,
        obligationId: award,
        network: "anvil",
        vault,
      },
    ),
    { transactionId: paidTx },
    "Signed attempt remains discoverable after its wallet is superseded",
  );
  // A signed old attempt cannot be cancelled or replaced by the new-wallet consent.
  assert.deepEqual(
    await retireUnsignedAttempt(
      { PAYMENTS_DB: db, JOURNAL: gasJournal },
      {
        idempotencyKey: prepared.id,
        obligationId: award,
        network: "anvil",
        vault,
      },
    ),
    { retired: false, transactionId: paidTx },
  );
  await assert.rejects(
    dispatchPayment(db, makeExecutor(), rotationAward, new Date()),
    /24 hours/,
  );
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 25 * 60 * 60 * 1000;
    await assert.rejects(
      dispatchPayment(db, makeExecutor(), rotationAward, new Date()),
      /awaits finality/,
    );
  } finally {
    Date.now = realNow;
  }
  await rpc("anvil_mine", ["0x40"]);
  await rpc("evm_increaseTime", [Number(delay)]);
  await rpc("anvil_mine", ["0x1"]);
  await dispatchPayment(db, makeExecutor(), rotationAward, new Date());
  await rpc("anvil_mine", ["0x40"]);
  await scan();
  const successorBalance = execFileSync(
    "cast",
    [
      "call",
      asset,
      "balanceOf(address)(uint256)",
      successorAccount.address,
      "--rpc-url",
      rpcUrl,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(successorBalance.split(" ")[0], "98000000");
  const priorBalance = execFileSync(
    "cast",
    [
      "call",
      asset,
      "balanceOf(address)(uint256)",
      recipient,
      "--rpc-url",
      rpcUrl,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(
    priorBalance.split(" ")[0],
    "98000000",
    "Original award is never replayed during rotation",
  );
  if (process.argv.includes("--serve")) {
    const browserAward = baseAwardId(
      31337n,
      vault,
      `0x${"5".padStart(64, "0")}`,
    );
    await send(asset, "mint(address,uint256)", [owner, "100000000"]);
    await send(asset, "approve(address,uint256)", [vault, "100000000"]);
    await send(vault, "deposit(uint64)", ["100000000"]);
    const browserReserve = await send(
      vault,
      "commitAward(bytes32,uint64,uint64,bytes32)",
      [browserAward, "456", "100000000", `0x${"5".padStart(64, "0")}`],
    );
    await rpc("anvil_mine", ["0x40"]);
    await indexPaymentEvent(
      db,
      adapter,
      {
        transactionId: browserReserve,
        eventIndex: 0,
        kind: "reserved",
        obligationId: browserAward,
      },
      new Date().toISOString(),
    );
    sql
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('browser-node','456','browser-fixture','2026-10-06T00:00:00.000Z',0)",
      )
      .run();
    const browserSession = "b".repeat(43);
    sql
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(
        await sha256Hex(browserSession),
        "browser-node",
        new Date(Date.now() + 3600000).toISOString(),
      );
    let settling = false;
    const settle = async () => {
      if (settling) return;
      settling = true;
      try {
        let tx = "";
        await dispatchPayment(
          db,
          {
            async submit(input) {
              const latest = (await rpc("eth_getBlockByNumber", [
                "latest",
                false,
              ])) as { timestamp: string };
              const bindingTx = (await rpc("eth_sendTransaction", [
                {
                  from: attester,
                  to: vault,
                  gas: "0x7a1200",
                  data: buildBindCalldata({
                    githubUserId: input.githubUserId,
                    destination: input.destination,
                    expectedVersion: "0",
                    claimDigest: `0x${input.claimDigest}`,
                    expiresAt: String(Number(BigInt(latest.timestamp)) + 3600),
                  }),
                },
              ])) as string;
              await rpc("anvil_mine", ["0x40"]);
              await rpc("evm_increaseTime", [Number(delay)]);
              await rpc("anvil_mine", ["0x1"]);
              const binding = await verifyBinding(
                config,
                bindingTx,
                0,
                input.githubUserId,
              );
              tx = (await rpc("eth_sendTransaction", [
                {
                  from: owner,
                  to: vault,
                  gas: "0x7a1200",
                  data: buildPayCalldata(
                    input.obligationId,
                    binding.bindingVersion,
                  ),
                },
              ])) as string;
              return { transactionId: tx };
            },
          },
          browserAward,
          new Date(),
        );
        if (tx) {
          await rpc("anvil_mine", ["0x40"]);
          await indexPaymentEvent(
            db,
            adapter,
            {
              transactionId: tx,
              eventIndex: 0,
              kind: "paid",
              obligationId: browserAward,
            },
            new Date().toISOString(),
          );
        }
      } finally {
        settling = false;
      }
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 18548,
      async fetch(incoming) {
        const url = new URL(incoming.url);
        if (url.pathname === "/fixture")
          return Response.json({
            githubUserId: "456",
            address: recipient,
            award: browserAward,
            rpcUrl,
            vault,
            asset,
          });
        if (url.pathname === "/api/v1/points/me")
          return Response.json({
            actor: { id: "browser-node", login: "browser-fixture" },
            public: false,
            welcome: 0,
          });
        if (url.pathname.startsWith("/api/v1/payments/")) {
          const headers = new Headers(incoming.headers);
          headers.set("cookie", `__Host-slop_points=${browserSession}`);
          if (incoming.method !== "GET")
            headers.set("origin", "https://slop.cash");
          const result = await handlePaymentsApi(
            new Request(`https://slop.cash${url.pathname}${url.search}`, {
              method: incoming.method,
              headers,
              ...(incoming.method !== "GET"
                ? { body: await incoming.text() }
                : {}),
            }),
            { db },
          );
          if (url.pathname.endsWith("/authorize") && result.ok)
            void settle().catch((error) =>
              console.error("Fixture settlement failed", String(error)),
            );
          return result;
        }
        return new Response("Not found", { status: 404 });
      },
    });
    console.log(
      `Browser fixture ready: http://127.0.0.1:${server.port}; seeded GitHub session (not real OAuth); wallet key 1; real SQLite and Anvil.`,
    );
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => {
        server.stop(true);
        faultProxy?.stop(true);
        for (const database of journalHandles) database.close();
        rmSync(journalDirectory, { recursive: true, force: true });
        anvil.kill("SIGTERM");
        sql.close();
        process.exit(0);
      });
    await new Promise(() => {});
  }
  console.log(
    "Local Base workflow passed: escrow, signed consent, separate signed execution, durable ambiguous-send recovery, finalized binding retry, finalized scanner replay, safe unsigned retirement, delayed successor rotation, and exact net balances.",
  );
} finally {
  sql.close();
  faultProxy?.stop(true);
  for (const database of journalHandles) database.close();
  rmSync(journalDirectory, { recursive: true, force: true });
  anvil.kill("SIGTERM");
}
