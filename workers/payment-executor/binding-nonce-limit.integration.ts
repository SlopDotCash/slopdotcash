/**
 * Local-only regression for the one-nonce test-attester opt-in (PRD section 6).
 * Uses the same real escrow deployment helpers as bind-trigger.integration.ts,
 * full SQLite migrations and actual bindStoredDestination. The revert fault
 * changes only a fresh Anvil vault's code between preflight and broadcast,
 * executes the signed transaction, then restores the code. No receipt is faked.
 * All keys below are Anvil's public deterministic fixtures, never user keys.
 */
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { keccak256, parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase } from "../../backend/d1";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import {
  evmAwardId,
  evmBindingTypedData,
  evmVaultKey,
} from "../../contracts/evm/adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
import { paymentDeploymentRecord } from "../../src/lib/escrow-policy.mjs";
import { reconcileBindingWinner } from "./binding-recovery";
import {
  type BindingCandidate,
  bindStoredDestination,
  type ExecutorEnvironment,
  type JournalStore,
  pendingStoredBindings,
  STORED_BINDING,
} from "./core";
import { privateScopeJournal, testBindingNonceLimit } from "./index";

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.SLOP_BINDING_NONCE_LIMIT_PORT ?? "22843");
assert(Number.isSafeInteger(port) && port > 22000 && port < 65536);
const url = `http://127.0.0.1:${port}`;
const registrar = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const owner = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const fee = "0x0000000000000000000000000000000000000fee";
const attester = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const wallet = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const chainId = 84532n;
const network = "base-sepolia";
const cases: string[] = [];
const databases: Database[] = [];
type RpcBody = {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: unknown;
};
type Receipt = { status: string; gasUsed: string; blockNumber: string };
async function request(method: string, params: unknown[]): Promise<RpcBody> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert(response.ok);
  return (await response.json()) as RpcBody;
}
async function rpc<T = string>(method: string, params: unknown[]): Promise<T> {
  const body = await request(method, params);
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return body.result as T;
}
const mine = (blocks: number) =>
  rpc("anvil_mine", [`0x${blocks.toString(16)}`]);
const nonce = async () =>
  Number(
    BigInt(await rpc("eth_getTransactionCount", [attester.address, "latest"])),
  );

function calldata(signature: string, args: string[]) {
  return execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
}
async function read(to: string, signature: string, args: string[] = []) {
  return (await rpc("eth_call", [
    { to, data: calldata(signature, args) },
    "latest",
  ])) as string;
}
async function send(
  to: string,
  signature: string,
  args: string[],
  from = registrar,
) {
  const tx = await rpc("eth_sendTransaction", [
    { from, to, data: calldata(signature, args), gas: "0x7a1200" },
  ]);
  await mine(1);
  const receipt = await rpc<Receipt>("eth_getTransactionReceipt", [tx]);
  if (receipt.status !== "0x1") {
    // Preserve the actual local revert cause before the fixture's finally
    // shuts down its isolated chain; this never queries another network.
    const trace = await rpc<unknown>("debug_traceTransaction", [
      tx,
      { tracer: "callTracer" },
    ]);
    console.error(JSON.stringify({ localFailedOperation: signature, trace }));
  }
  assert.equal(receipt.status, "0x1", signature);
  return tx as string;
}
function deploy(contract: string, args: string[] = []) {
  return JSON.parse(
    execFileSync(
      "forge",
      [
        "create",
        "--root",
        `${root}contracts/evm`,
        contract,
        "--rpc-url",
        url,
        "--unlocked",
        "--from",
        registrar,
        "--broadcast",
        "--json",
        ...(args.length ? ["--constructor-args", ...args] : []),
      ],
      { encoding: "utf8" },
    ),
  ).deployedTo as string;
}
async function codeHash(address: string) {
  return createHash("sha256")
    .update(
      Buffer.from(
        (await rpc("eth_getCode", [address, "latest"])).slice(2),
        "hex",
      ),
    )
    .digest("hex");
}
function database() {
  const sql = new Database(":memory:");
  databases.push(sql);
  sql.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(`${root}migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`${root}migrations/${file}`, "utf8"));
  function statement(
    query: string,
    args: unknown[] = [],
  ): ReturnType<D1TransactionalDatabase["prepare"]> {
    return {
      bind: (...values: unknown[]) => statement(query, values),
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
  const db: D1TransactionalDatabase = {
    prepare: statement,
    async batch(items) {
      sql.exec("BEGIN");
      try {
        const values = [];
        for (const item of items) values.push(await item.run());
        sql.exec("COMMIT");
        return values;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sql, db };
}
function journalFixture() {
  const sql = new Database(":memory:");
  databases.push(sql);
  sql.exec("CREATE TABLE journal(key TEXT PRIMARY KEY,value TEXT)");
  let gate = Promise.resolve(),
    lists = 0;
  const store: JournalStore = {
    async get<T>(key: string) {
      const row = sql
        .query<{ value: string }, [string]>(
          "SELECT value FROM journal WHERE key=?",
        )
        .get(key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async put<T>(key: string, value: T) {
      sql
        .prepare(
          "INSERT INTO journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    async list<T>({ prefix, limit }: { prefix: string; limit: number }) {
      lists++;
      return new Map(
        sql
          .query<{ key: string; value: string }, [number, string, number]>(
            "SELECT key,value FROM journal WHERE substr(key,1,?)=? ORDER BY key LIMIT ?",
          )
          .all(prefix.length, prefix, limit)
          .map((row) => [row.key, JSON.parse(row.value) as T]),
      );
    },
    async transaction<T>(callback: (value: JournalStore) => Promise<T>) {
      const previous = gate;
      let unlock!: () => void;
      gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
      sql.exec("BEGIN IMMEDIATE");
      try {
        const value = await callback(store);
        sql.exec("COMMIT");
        return value;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      } finally {
        unlock();
      }
    },
  };
  const entries = () =>
    sql
      .query<{ key: string; value: string }, []>(
        "SELECT key,value FROM journal ORDER BY key",
      )
      .all()
      .map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  return {
    store,
    entries,
    lists: () => lists,
    remove: (key: string) =>
      sql.prepare("DELETE FROM journal WHERE key=?").run(key),
  };
}

interface Fixture {
  sql: Database;
  vault: string;
  env: ExecutorEnvironment;
  candidate: BindingCandidate;
  journal: ReturnType<typeof journalFixture>;
  signatures(): number;
  broadcasts: number;
  revertNext: boolean;
  revertedReceipt: Receipt | null;
}
let active: Fixture | undefined;
// Refuse to attach the fixture to an older or unrelated local chain.
await new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
});
const proxy = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (body.method !== "eth_sendRawTransaction")
      return Response.json({
        ...(await request(body.method, body.params)),
        id: body.id,
      });
    assert(active, "Broadcast outside the local test fixture");
    const raw = body.params[0] as `0x${string}`;
    const tx = parseTransaction(raw);
    assert.equal(tx.to?.toLowerCase(), active.vault);
    const row = active.journal
      .entries()
      .find(
        (item) =>
          item.key.replace(/^security:/, "").startsWith(STORED_BINDING) &&
          item.value?.rawTransaction === raw &&
          !item.key.includes(":reverted:"),
      );
    assert(row, "Signed binding must be stored before broadcast");
    if (active.env.BINDING_NONCE_LIMIT === 1) {
      assert(row.value.bindingNonceBudgetKey);
      const budget = await active.env.JOURNAL.get<{
        transactionId: string;
        nonce: number;
      }>(row.value.bindingNonceBudgetKey);
      assert(budget);
      assert.equal(budget.transactionId, keccak256(raw));
      assert.equal(budget.nonce, tx.nonce);
    }
    active.broadcasts++;
    if (!active.revertNext)
      return Response.json({
        ...(await request(body.method, body.params)),
        id: body.id,
      });
    active.revertNext = false;
    const code = await rpc("eth_getCode", [active.vault, "latest"]);
    let result: RpcBody | undefined;
    try {
      await rpc("anvil_setCode", [active.vault, "0x60006000fd"]);
      result = await request(body.method, body.params);
      assert.equal(result.error, undefined);
      // Anvil may acknowledge the submitted hash before its automined receipt
      // is visible. Keep the fault installed through real execution; never
      // substitute a synthetic failure receipt.
      await mine(1);
      let receipt: Receipt | null = null;
      for (let attempt = 0; attempt < 50 && receipt === null; attempt++) {
        receipt = await rpc<Receipt | null>("eth_getTransactionReceipt", [
          result.result,
        ]);
        if (receipt === null) await Bun.sleep(20);
      }
      assert(receipt, "Real local revert receipt did not become available");
      assert.equal(
        receipt.status,
        "0x0",
        "Fault must produce an actual EVM revert",
      );
      assert(BigInt(receipt.gasUsed) > 0n);
      active.revertedReceipt = receipt;
    } finally {
      await rpc("anvil_setCode", [active.vault, code]);
      await mine(64);
    }
    assert(result);
    return Response.json({ ...result, id: body.id });
  },
});
const anvil = spawn(
  "anvil",
  ["--port", String(port), "--chain-id", String(chainId), "--silent"],
  { stdio: "ignore" },
);
let anvilFailure: Error | undefined;
anvil.once("error", (error) => {
  anvilFailure = error;
});
const anvilClosed = new Promise<void>((resolve) => {
  anvil.once("close", () => resolve());
});
let asset = "",
  factory = "";
async function fixture(actor: string, limited: boolean): Promise<Fixture> {
  const key = `0x${hash(`nonce-limit-project-${actor}`)}`;
  const source = `0x${hash(`nonce-limit-source-${actor}`)}`;
  const claimDigest = hash(`nonce-limit-claim-${actor}`);
  const projectId = `nonce-limit-${actor}`;
  const creation = await send(
    factory,
    "create(bytes32,address,uint8)",
    [key, asset, "0"],
    owner,
  );
  const vault = `0x${(await read(factory, "vaults(bytes32)", [evmVaultKey({ owner, projectId: key, asset })])).slice(-40).toLowerCase()}`;
  await send(asset, "approve(address,uint256)", [vault, "1000000"], owner);
  await send(vault, "deposit(uint128)", ["1000000"], owner);
  const award = evmAwardId(chainId, vault, source);
  await send(
    vault,
    "commitAward(bytes32,uint64,uint128,bytes32)",
    [award, actor, "1000000", source],
    owner,
  );
  await mine(64);
  const { sql, db } = database();
  const journal = journalFixture();
  const now = new Date().toISOString(),
    expiresAt = new Date(Date.now() + 3600000).toISOString();
  const claim = `claim-${actor}`,
    challenge = `challenge-${actor}`;
  const destination = wallet.address.toLowerCase();
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,'base')",
    )
    .run(
      claim,
      actor,
      `fixture-${actor}`,
      destination,
      hash("source"),
      now,
      claimDigest,
      now,
    );
  const message = buildPaymentWalletMessage({
    actorId: actor,
    chain: "base",
    address: destination,
    claimId: claim,
    claimDigest,
    nonce: challenge,
    expiresAt,
  });
  sql
    .prepare(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(challenge, claim, actor, message, expiresAt, now);
  sql
    .prepare(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run(claim, actor, now, challenge, await wallet.signMessage({ message }));
  sql
    .prepare(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,?,?,?,'base',?,?,6,'1000000','20000',?,'reserved',?)",
    )
    .run(award, projectId, actor, network, vault, asset, source.slice(2), now);
  const expires = String(Math.floor(Date.now() / 1000) + 86400);
  const typed = evmBindingTypedData(chainId, vault, {
    githubUserId: actor,
    destination,
    expectedVersion: "0",
    claimDigest: `0x${claimDigest}`,
    expiresAt: expires,
  });
  const { EIP712Domain: _domain, ...types } = typed.types;
  const signature = await wallet.signTypedData({
    domain: {
      ...typed.domain,
      chainId: Number(chainId),
      verifyingContract: vault,
    },
    types,
    primaryType: typed.primaryType,
    message: {
      actorId: BigInt(actor),
      destination,
      expectedVersion: 0n,
      claimDigest: `0x${claimDigest}`,
      expiresAt: BigInt(expires),
    },
  } as never);
  sql
    .prepare(
      "INSERT INTO payment_binding_authorizations(claim_id,github_user_id,network,vault,chain_id,expected_version,expires_at,signature,created_at) VALUES(?,?,?,?,?,'0',?,?,?)",
    )
    .run(
      claim,
      actor,
      network,
      vault,
      String(chainId),
      expires,
      signature,
      now,
    );
  const deployment = {
    network: network as "base-sepolia",
    vault,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    asset: asset.toLowerCase(),
    owner,
    identityAuthority: attester.address.toLowerCase(),
    feeRecipient: fee,
    deploymentTransaction: creation,
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    codeSha256: await codeHash(vault),
    bindingDelaySeconds: "0",
    rotationDelaySeconds: null,
    factory: factory.toLowerCase(),
    factoryCodeSha256: await codeHash(factory),
    registrar,
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
  };
  let signatures = 0;
  const env: ExecutorEnvironment = {
    PAYMENTS_DB: db,
    PAYMENT_DEPLOYMENTS: JSON.stringify([
      paymentDeploymentRecord(projectId, deployment),
    ]),
    PAYMENT_RPC_URLS: JSON.stringify({
      [network]: `http://127.0.0.1:${proxy.port}`,
    }),
    JOURNAL: journal.store,
    SIGNER: {
      address: attester.address,
      async signTransaction(input) {
        signatures++;
        return attester.signTransaction(input);
      },
    },
    ...(limited ? { BINDING_NONCE_LIMIT: 1 as const } : {}),
  };
  const candidate: BindingCandidate = {
    obligationId: award,
    network,
    vault,
    githubUserId: actor,
    claimId: claim,
    claimDigest,
    destination,
  };
  return {
    sql,
    vault,
    env,
    candidate,
    journal,
    signatures: () => signatures,
    broadcasts: 0,
    revertNext: false,
    revertedReceipt: null,
  };
}
async function successorClaim(fixture: Fixture): Promise<BindingCandidate> {
  const old = fixture.candidate;
  const claimId = `${old.claimId}-successor`;
  const claimDigest = hash(`${old.claimDigest}:successor`);
  const challenge = `${claimId}-challenge`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const sql = fixture.sql;
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,?,'base')",
    )
    .run(
      claimId,
      old.githubUserId,
      `fixture-${old.githubUserId}`,
      old.destination,
      hash("successor-source"),
      now,
      claimDigest,
      old.claimId,
      now,
    );
  const message = buildPaymentWalletMessage({
    actorId: old.githubUserId,
    chain: "base",
    address: old.destination,
    claimId,
    claimDigest,
    nonce: challenge,
    expiresAt,
  });
  sql
    .prepare(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
    )
    .run(challenge, claimId, old.githubUserId, message, expiresAt, now);
  sql
    .prepare(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
    )
    .run(
      claimId,
      old.githubUserId,
      now,
      challenge,
      await wallet.signMessage({ message }),
    );
  const expires = String(Math.floor(Date.now() / 1000) + 86400);
  const typed = evmBindingTypedData(chainId, fixture.vault, {
    githubUserId: old.githubUserId,
    destination: old.destination,
    expectedVersion: "0",
    claimDigest: `0x${claimDigest}`,
    expiresAt: expires,
  });
  const { EIP712Domain: _domain, ...types } = typed.types;
  const signature = await wallet.signTypedData({
    domain: {
      ...typed.domain,
      chainId: Number(chainId),
      verifyingContract: fixture.vault,
    },
    types,
    primaryType: typed.primaryType,
    message: {
      actorId: BigInt(old.githubUserId),
      destination: old.destination,
      expectedVersion: 0n,
      claimDigest: `0x${claimDigest}`,
      expiresAt: BigInt(expires),
    },
  } as never);
  sql
    .prepare(
      "INSERT INTO payment_binding_authorizations(claim_id,github_user_id,network,vault,chain_id,expected_version,expires_at,signature,created_at) VALUES(?,?,?,?,?,'0',?,?,?)",
    )
    .run(
      claimId,
      old.githubUserId,
      network,
      fixture.vault,
      String(chainId),
      expires,
      signature,
      now,
    );
  return { ...old, claimId, claimDigest };
}
async function run(name: string, body: () => Promise<void> | void) {
  await body();
  cases.push(name);
}

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    assert.equal(anvilFailure, undefined, "Anvil could not start");
    assert.equal(anvil.exitCode, null, "Anvil exited before startup");
    try {
      ready = BigInt(await rpc("eth_chainId", [])) === chainId;
    } catch {
      await Bun.sleep(50);
    }
  }
  assert(ready, "Local Anvil84532 unavailable");
  await run(
    "opt-in rejects production, relayer, Solana and unknown values before signer access",
    async () => {
      let keyReads = 0;
      const valid = {
        TEST_BINDING_NONCE_LIMIT: "1",
        SIGNER_STACK: "test",
        SIGNER_ROLE: "attester",
        CHAIN_FAMILY: "evm",
        SCHEDULED_BINDINGS: "on",
        get SIGNER_PRIVATE_KEY() {
          keyReads++;
          throw Error("Signer must not be read");
        },
      };
      assert.equal(testBindingNonceLimit(valid as never), 1);
      for (const change of [
        { SIGNER_STACK: "production" },
        { SIGNER_ROLE: "relayer" },
        { CHAIN_FAMILY: "solana" },
        { TEST_BINDING_NONCE_LIMIT: "2" },
        { SCHEDULED_BINDINGS: undefined },
      ])
        assert.throws(() =>
          testBindingNonceLimit(
            Object.assign(Object.create(valid), change) as never,
          ),
        );
      assert.equal(testBindingNonceLimit({} as never), undefined);
      assert.equal(keyReads, 0);
    },
  );
  asset = deploy("integration/TestDollar.sol:TestDollar");
  factory = deployUpgradeableFactory(
    (contract, args) => deploy(contract, args),
    [registrar, fee, attester.address, "0"],
  );
  await send(asset, "mint(address,uint256)", [owner, "10000000"]);
  await run(
    "concurrent opt-in triggers sign one nonce and retain budget before broadcast",
    async () => {
      active = await fixture("123", true);
      const before = await nonce();
      const outcomes = await Promise.allSettled([
        bindStoredDestination(active.env, active.candidate),
        bindStoredDestination(active.env, active.candidate),
      ]);
      assert(outcomes.some((value) => value.status === "fulfilled"));
      await mine(64);
      assert.equal(active.signatures(), 1);
      assert.equal(await nonce(), before + 1);
      const rows = active.journal.entries();
      assert.equal(
        rows.filter((row) => row.key.startsWith("bind:test-nonce:")).length,
        1,
      );
      assert.equal(
        rows.filter((row) => row.key.startsWith(STORED_BINDING)).length,
        1,
      );
      assert.equal(
        (await bindStoredDestination(active.env, active.candidate)).state,
        "current",
      );
      assert.equal(active.signatures(), 1);
    },
  );
  await run(
    "finalized real revert remains held without a second signed nonce",
    async () => {
      active = await fixture("124", true);
      const before = await nonce();
      active.revertNext = true;
      await bindStoredDestination(active.env, active.candidate);
      assert(active.revertedReceipt);
      assert.equal(active.revertedReceipt.status, "0x0");
      const original = active.journal
        .entries()
        .find((row) => row.key.startsWith(STORED_BINDING));
      assert(original);
      for (let i = 0; i < 2; i++)
        await assert.rejects(
          bindStoredDestination(active.env, active.candidate),
          /reverted/,
        );
      assert.equal(active.signatures(), 1);
      assert.equal(await nonce(), before + 1);
      assert.deepEqual(
        await active.journal.store.get(original.key),
        original.value,
      );
      assert(
        active.journal
          .entries()
          .some((row) => row.key.startsWith(`${original.key}:reverted:`)),
      );
      assert(
        (await pendingStoredBindings(active.journal.store)).includes(
          original.key,
        ),
      );
    },
  );
  await run(
    "unflagged finalized revert still retries with a new nonce",
    async () => {
      active = await fixture("125", false);
      const before = await nonce();
      active.revertNext = true;
      await bindStoredDestination(active.env, active.candidate);
      assert(active.revertedReceipt);
      assert.equal(active.revertedReceipt.status, "0x0");
      await bindStoredDestination(active.env, active.candidate);
      await mine(64);
      assert.equal(active.signatures(), 2);
      assert.equal(await nonce(), before + 2);
      assert.equal(active.journal.lists(), 0);
      assert.equal(
        (await bindStoredDestination(active.env, active.candidate)).state,
        "current",
      );
    },
  );
  await run(
    "opt-in holds legacy unmarked, tombstoned and archived attempts",
    async () => {
      active = await fixture("126", false);
      active.revertNext = true;
      await bindStoredDestination(active.env, active.candidate);
      const original = active.journal
        .entries()
        .find((row) => row.key.startsWith(STORED_BINDING));
      assert(original);
      assert.equal(original.value.bindingNonceBudgetKey, undefined);
      active.env.BINDING_NONCE_LIMIT = 1;
      const before = await nonce();
      await assert.rejects(
        bindStoredDestination(active.env, active.candidate),
        /Legacy test binding/,
      );
      await active.journal.store.put(original.key, null);
      await assert.rejects(
        bindStoredDestination(active.env, active.candidate),
        /Retired test binding/,
      );
      active.journal.remove(original.key);
      await assert.rejects(
        bindStoredDestination(active.env, active.candidate),
        /Legacy test binding history/,
      );
      assert.equal(active.signatures(), 1);
      assert.equal(await nonce(), before);
    },
  );
  await run(
    "observed legacy revert blocks a successor claim's new fingerprint",
    async () => {
      active = await fixture("127", false);
      active.revertNext = true;
      await bindStoredDestination(active.env, active.candidate);
      const original = active.journal
        .entries()
        .find((row) => row.key.startsWith(STORED_BINDING));
      assert(original);
      const observed = await reconcileBindingWinner(active.env, {
        network,
        vault: active.vault,
        originalTransactionId: original.value.transactionId,
        winnerTransactionId: original.value.transactionId,
      });
      assert.equal(observed.state, "original_reverted");
      assert.equal(await active.journal.store.get(original.key), null);
      assert(
        active.journal
          .entries()
          .some((row) => row.key.startsWith("binding-observed:")),
      );
      assert(
        !active.journal.entries().some((row) => row.key.includes(":reverted:")),
      );
      const candidate = await successorClaim(active);
      active.env.BINDING_NONCE_LIMIT = 1;
      const before = await nonce();
      await assert.rejects(
        bindStoredDestination(active.env, candidate),
        /Legacy test binding/,
      );
      active.journal.remove(original.key);
      await assert.rejects(
        bindStoredDestination(active.env, candidate),
        /Legacy test binding/,
      );
      assert.equal(active.signatures(), 1);
      assert.equal(await nonce(), before);
    },
  );
  await run(
    "private journal admits one binding without reading ordinary history",
    async () => {
      active = await fixture("128", true);
      active.env.JOURNAL = privateScopeJournal(active.journal.store);
      // An ordinary record for the same vault must not enter private history.
      await active.journal.store.put(`${STORED_BINDING}ordinary-only`, {
        network,
        vault: active.vault,
        rawTransaction: "invalid ordinary-only sentinel",
      });
      await bindStoredDestination(active.env, active.candidate);
      await mine(64);
      assert.equal(active.signatures(), 1);
      assert.equal(
        (await bindStoredDestination(active.env, active.candidate)).state,
        "current",
      );
      const rows = active.journal.entries();
      assert.equal(
        rows.filter((row) => row.key.startsWith("security:bind:test-nonce:"))
          .length,
        1,
      );
      assert.equal(
        rows.filter((row) => row.key.startsWith("security:bind:stored:"))
          .length,
        1,
      );
      assert(rows.some((row) => row.key.startsWith("nonce:")));
      assert(!rows.some((row) => row.key.startsWith("security:nonce:")));
    },
  );
  await run(
    "private legacy archive refuses a successor binding under the nonce limit",
    async () => {
      active = await fixture("129", false);
      active.env.JOURNAL = privateScopeJournal(active.journal.store);
      active.revertNext = true;
      await bindStoredDestination(active.env, active.candidate);
      const original = active.journal
        .entries()
        .find((row) => row.key.startsWith(`security:${STORED_BINDING}`));
      assert(original);
      const observed = await reconcileBindingWinner(active.env, {
        network,
        vault: active.vault,
        originalTransactionId: original.value.transactionId,
        winnerTransactionId: original.value.transactionId,
      });
      assert.equal(observed.state, "original_reverted");
      const candidate = await successorClaim(active);
      active.env.BINDING_NONCE_LIMIT = 1;
      const before = await nonce();
      await assert.rejects(
        bindStoredDestination(active.env, candidate),
        /Legacy test binding/,
      );
      assert.equal(active.signatures(), 1);
      assert.equal(await nonce(), before);
    },
  );
  console.log(
    JSON.stringify({
      passed: cases.length,
      cases,
      chainId: Number(chainId),
      externalRequests: 0,
      realKeyReads: 0,
      allTransactionsLocal: true,
    }),
  );
} finally {
  await proxy.stop(true);
  for (const db of databases) db.close();
  const forceStop = setTimeout(() => anvil.kill("SIGKILL"), 2000);
  anvil.kill("SIGTERM");
  await anvilClosed;
  clearTimeout(forceStop);
}
