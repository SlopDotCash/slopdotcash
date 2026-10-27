/**
 * Local-only workflow: the production Base mainnet attester binds a stored,
 * wallet-signed destination for a reserved award, and the award is then
 * payable by anyone. Real escrow contracts run on Anvil with the Base
 * mainnet chain id (8453). The registry and the account tables are one
 * SQLite database with every real migration, as production binds the
 * attester's PAYMENTS_DB and REGISTRY_DB to the Pages SLOP_DB. The attester
 * runs through the hosted Worker entry point (`scheduled`, the
 * PaymentSignerJournal Durable Object and the production stack
 * configuration of configure.mjs); the contributor uses the Pages account
 * API router.
 *
 * Failure cases: an expired binding consent is never submitted; a consent
 * from another GitHub actor is refused by the API and by the attester; and
 * a binding whose broadcast is lost is held in the journal and broadcast
 * again with the same signed bytes, never signed again.
 *
 * Anvil's public deterministic accounts and test key 1 are fixtures, not
 * user secrets.
 */
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import {
  evmAwardId,
  evmBindingTypedData,
  evmVaultKey,
} from "../../contracts/evm/adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
import { onRequest } from "../../functions/api/v1/[[path]]";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { paymentDeploymentRecord } from "../../src/lib/escrow-policy.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";
import { paymentStack } from "./configure.mjs";
import { type JournalStore, pendingStoredBindings } from "./core";
import worker, { PaymentSignerJournal, runDestinationBindings } from "./index";

const root = fileURLToPath(new URL("../../", import.meta.url));
const anvilPort = Number(process.env.SLOP_BIND_TRIGGER_PORT ?? "18583");
const anvilUrl = `http://127.0.0.1:${anvilPort}`;
// Anvil accounts 0 to 3: registrar, identity authority, vault owner and an
// unrelated payer that proves `pay` needs no Slop key.
const registrar = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const attesterKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const attester = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const owner = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const payer = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const fee = "0x0000000000000000000000000000000000000fee";
const projectKey = `0x${"1".padStart(64, "0")}`;
const source = `0x${"2".padStart(64, "0")}`;
const wallet = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const recipient = wallet.address.toLowerCase();
const claimDigest = "c".repeat(64);
const gross = 10_000_000n; // 10 USDC at 6 decimals

const anvil = spawn(
  "anvil",
  ["--port", String(anvilPort), "--chain-id", "8453", "--silent"],
  { stdio: "ignore" },
);
// The attester's private RPC. While `dropBroadcast` is set it loses every
// raw transaction before Anvil sees it, so the attester cannot tell whether
// its binding was sent.
let dropBroadcast = false;
let bindingBroadcasts = 0;
let receiptFault: {
  transactionId: string;
  kind: "missing" | "wrong-block";
} | null = null;
const proxy = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = await request.text();
    const input = JSON.parse(body) as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (input.method === "eth_sendRawTransaction") {
      bindingBroadcasts += 1;
      if (dropBroadcast) return new Response("lost", { status: 502 });
    }
    const fault =
      receiptFault &&
      input.method === "eth_getTransactionReceipt" &&
      input.params[0] === receiptFault.transactionId
        ? receiptFault
        : null;
    if (fault?.kind === "missing")
      return Response.json({ jsonrpc: "2.0", id: input.id, result: null });
    const response = await fetch(anvilUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (fault?.kind === "wrong-block") {
      const result = (await response.json()) as {
        result: Record<string, unknown>;
      };
      return Response.json({
        ...result,
        result: { ...result.result, blockHash: `0x${"f".repeat(64)}` },
      });
    }
    return response;
  },
});
const sql = new Database(":memory:");
const db: D1Database = (() => {
  function statement(
    query: string,
    args: unknown[] = [],
  ): ReturnType<D1Database["prepare"]> {
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
  return {
    prepare: statement,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
})();
/** The Durable Object storage: one SQLite table, serialized transactions. */
const journalDb = new Database(":memory:");
journalDb.exec("CREATE TABLE journal(key TEXT PRIMARY KEY,value TEXT)");
let gate = Promise.resolve();
const journal: JournalStore = {
  async get<T>(key: string) {
    const row = journalDb
      .query<{ value: string }, [string]>(
        "SELECT value FROM journal WHERE key=?",
      )
      .get(key);
    return row ? (JSON.parse(row.value) as T) : undefined;
  },
  async put<T>(key: string, value: T) {
    journalDb
      .prepare(
        "INSERT INTO journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  },
  async transaction<T>(callback: (store: JournalStore) => Promise<T>) {
    const previous = gate;
    let unlock!: () => void;
    gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    journalDb.exec("BEGIN IMMEDIATE");
    try {
      const result = await callback(journal);
      journalDb.exec("COMMIT");
      return result;
    } catch (error) {
      journalDb.exec("ROLLBACK");
      throw error;
    } finally {
      unlock();
    }
  },
};
const bindEntries = () =>
  journalDb
    .query<{ key: string; value: string }, []>(
      "SELECT key,value FROM journal WHERE key LIKE 'bind:%' ORDER BY key",
    )
    .all()
    .map((row) => ({
      key: row.key,
      ...(JSON.parse(row.value) as {
        transactionId: string;
        rawTransaction: `0x${string}`;
      }),
    }));

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(anvilUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result: unknown; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const mine = (blocks: number) =>
  rpc("anvil_mine", [`0x${blocks.toString(16)}`]);
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
        anvilUrl,
        "--unlocked",
        "--from",
        registrar,
        "--broadcast",
        "--json",
        ...(args.length ? ["--constructor-args", ...args] : []),
      ],
      { encoding: "utf8" },
    ),
  ) as { deployedTo: string; transactionHash: string };
}
function calldata(signature: string, args: string[]) {
  return execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
}
async function send(
  to: string,
  signature: string,
  args: string[],
  from = registrar,
) {
  const hash = (await rpc("eth_sendTransaction", [
    { from, to, data: calldata(signature, args), gas: "0x7a1200" },
  ])) as string;
  await mine(1);
  const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as {
    status: string;
  };
  assert.equal(receipt.status, "0x1", `Transaction failed: ${signature}`);
  return hash;
}
async function read(to: string, signature: string, args: string[] = []) {
  return (await rpc("eth_call", [
    { to, data: calldata(signature, args) },
    "latest",
  ])) as string;
}
const words = (value: string) =>
  (value.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
const balance = async (asset: string, account: string) =>
  words(await read(asset, "balanceOf(address)", [account]))[0];
const nonce = async (account: string) =>
  Number(
    BigInt(
      (await rpc("eth_getTransactionCount", [account, "latest"])) as string,
    ),
  );
const codeSha256 = async (address: string) =>
  createHash("sha256")
    .update(
      Buffer.from(
        ((await rpc("eth_getCode", [address, "latest"])) as string).slice(2),
        "hex",
      ),
    )
    .digest("hex");
/** viem signs the EIP-712 structure the vault hashes. */
function signBinding(typedData: ReturnType<typeof evmBindingTypedData>) {
  const { EIP712Domain: _domain, ...types } = typedData.types;
  return wallet.signTypedData({
    domain: {
      ...typedData.domain,
      chainId: Number(typedData.domain.chainId),
      verifyingContract: typedData.domain.verifyingContract as `0x${string}`,
    },
    types,
    primaryType: typedData.primaryType,
    message: {
      actorId: BigInt(typedData.message.actorId),
      destination: typedData.message.destination as `0x${string}`,
      expectedVersion: BigInt(typedData.message.expectedVersion),
      claimDigest: typedData.message.claimDigest as `0x${string}`,
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  } as never);
}

try {
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    if (anvil.exitCode !== null) throw new Error("Anvil startup failed");
    try {
      await rpc("eth_chainId", []);
      ready = true;
    } catch {
      await Bun.sleep(50);
    }
  }
  assert(ready, "Anvil startup");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(`${root}migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sql.exec(readFileSync(`${root}migrations/${file}`, "utf8"));

  // (1) The owner creates the vault from its own wallet: factory.create
  // (projectId, USDC, purpose 0). The binding delay is 0, as on Base.
  const asset = deploy("integration/TestDollar.sol:TestDollar").deployedTo;
  const factory = deployUpgradeableFactory(
    (contract, args) => deploy(contract, args).deployedTo,
    [registrar, fee, attester, "0"],
  );
  const createTx = await send(
    factory,
    "create(bytes32,address,uint8)",
    [projectKey, asset, "0"],
    owner,
  );
  const vault = `0x${(
    await read(factory, "vaults(bytes32)", [
      evmVaultKey({ owner, projectId: projectKey, asset }),
    ])
  )
    .slice(-40)
    .toLowerCase()}`;

  // (2) An admin revision records the vault in the project manifest.
  const fixture = fixtureProject("eliza");
  const deployment = {
    network: "base-mainnet" as const,
    vault,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    asset: asset.toLowerCase(),
    owner,
    identityAuthority: attester,
    feeRecipient: fee,
    deploymentTransaction: createTx,
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    codeSha256: await codeSha256(vault),
    bindingDelaySeconds: "0",
    rotationDelaySeconds: null,
    factory: factory.toLowerCase(),
    factoryCodeSha256: await codeSha256(factory),
    registrar,
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
  };
  const manifest = assertProjectDefinition({
    ...fixture,
    reward: {
      ...fixture.reward,
      chain: "base",
      currency: "USDC",
      feeBasisPoints: 200,
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  });
  const text = JSON.stringify(manifest);
  const digest = createHash("sha256").update(text).digest("hex");
  const at = new Date().toISOString();
  sql
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,1,?,?,'Record escrow deployment','900000001','e2e-admin',?)",
    )
    .run(manifest.id, text, digest, at);
  sql
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
    )
    .run(manifest.id, manifest.status, text, digest, at, at);

  // (3) The production stack configuration, as the release generates it,
  // with the owner-installed secrets. The Durable Object namespace returns
  // the one journal instance.
  const pinned = [paymentDeploymentRecord(manifest.id, deployment)];
  const stackInput = {
    stack: "production" as const,
    network: "base-mainnet",
    deployments: pinned,
    registry: [manifest],
    registryDatabase: {
      database_name: "slop-private",
      database_id: "1b453124-2709-45af-8389-151a8105c461",
    },
    monthlySchedule:
      '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}',
  };
  const stack = paymentStack(stackInput);
  assert.throws(
    () => paymentStack({ ...stackInput, deployments: [] }),
    /Empty attester configuration omits reviewed deployments/,
  );
  assert.throws(
    () =>
      paymentStack({
        ...stackInput,
        deployments: [{ ...pinned[0], vault: payer }],
      }),
    /Deployment differs from canonical project manifest/,
  );
  const vars = stack.configs.attester.vars as Record<string, string>;
  assert.equal(stack.configs.attester.services, undefined);
  assert.deepEqual(stack.configs.attester.triggers, {
    crons: ["*/5 * * * *"],
  });
  const journalNames: string[] = [];
  const env = {
    ...vars,
    PAYMENTS_DB: db,
    REGISTRY_DB: db,
    PAYMENT_RPC_URLS: JSON.stringify({
      "base-mainnet": `http://127.0.0.1:${proxy.port}`,
    }),
    SIGNER_PRIVATE_KEY: attesterKey,
    JOURNAL: {
      idFromName(name: string) {
        journalNames.push(name);
        return name;
      },
      get: () => signer,
    },
  };
  const signer = new PaymentSignerJournal({ storage: journal }, env as never);
  const scheduled = () => worker.scheduled(undefined, env as never);
  /** The scheduled run fails loudly for the binding step only; indexing and monthly steps pass. */
  const bindingHeld = async () => {
    const error = await scheduled().then(
      () => null,
      (failure: unknown) => failure,
    );
    assert(error instanceof AggregateError, "The scheduled run must fail");
    assert.deepEqual(error.errors.map(String), [
      "Error: Destination binding incomplete",
    ]);
  };

  // (5) The owner deposits 50 USDC. (6) The owner approves a 10 USDC award.
  await send(asset, "mint(address,uint256)", [owner, "50000000"]);
  await send(asset, "approve(address,uint256)", [vault, "50000000"], owner);
  await send(vault, "deposit(uint128)", ["50000000"], owner);
  const award = evmAwardId(8453n, vault, source);
  await send(
    vault,
    "commitAward(bytes32,uint64,uint128,bytes32)",
    [award, "123", gross.toString(), source],
    owner,
  );
  await mine(64);

  // The contributor alice (GitHub 123) signs in and confirms her wallet;
  // bob (GitHub 456) is another signed-in member, and carol (GitHub 789)
  // a second contributor.
  const sessions = {
    alice: "a".repeat(43),
    bob: "b".repeat(43),
    carol: "c".repeat(43),
  };
  for (const [login, github] of [
    ["alice", "123"],
    ["bob", "456"],
    ["carol", "789"],
  ] as const) {
    sql
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
      )
      .run(login, github, login, at);
    sql
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(
        await sha256Hex(sessions[login]),
        login,
        new Date(Date.now() + 3600000).toISOString(),
      );
  }
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim','123','alice',?,'d1_registry',?,?,?,?,'base')",
    )
    .run(recipient, "a".repeat(64), at, claimDigest, at);
  const account = async (
    who: keyof typeof sessions,
    path: string,
    body: Record<string, string>,
  ) =>
    onRequest({
      request: new Request(`https://slop.cash/api/v1/payments${path}`, {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${sessions[who]}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      env: { SLOP_DB: db, PAYMENT_NETWORKS: '["base-mainnet"]' },
    } as never);
  const walletChallenge = (await (
    await account("alice", "/wallets/challenge", { claimId: "claim" })
  ).json()) as { message: string; challengeId: string };
  assert.equal(
    (
      await account("alice", "/wallets/authorize", {
        claimId: "claim",
        challengeId: walletChallenge.challengeId,
        signature: await wallet.signMessage({
          message: walletChallenge.message,
        }),
      })
    ).status,
    200,
  );

  // The first run indexes the finalized award. Without a stored binding
  // consent there is nothing to bind: no transaction, no journal entry.
  await scheduled();
  assert.deepEqual(journalNames.slice(-1), ["production-signer-v1"]);
  assert.equal(
    (
      sql
        .query("SELECT state FROM payment_obligations WHERE id=?")
        .get(award) as { state: string }
    ).state,
    "reserved",
  );
  assert.deepEqual(await runDestinationBindings(env as never), {
    candidates: 0,
    current: 0,
    waiting: 0,
    failed: 0,
    submitted: [],
  });

  const typedData = (
    expectedVersion: string,
    actor: string,
    expiresAt: string,
  ) =>
    evmBindingTypedData(8453n, vault, {
      githubUserId: actor,
      destination: recipient,
      expectedVersion,
      claimDigest: `0x${claimDigest}`,
      expiresAt,
    });
  const storeRow = (expiresAt: string, signature: string) =>
    sql
      .prepare(
        "INSERT INTO payment_binding_authorizations(claim_id,github_user_id,network,vault,chain_id,expected_version,expires_at,signature,created_at) VALUES('claim','123','base-mainnet',?,'8453','0',?,?,?)",
      )
      .run(vault, expiresAt, signature, at);
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Failure: an expired consent. The API refuses to store one that expires
  // inside the attester's submission window, and a stored consent that has
  // expired since is never submitted.
  const soon = String(nowSeconds + 300);
  const refusedSoon = await account("alice", "/wallets/bind-authorize", {
    claimId: "claim",
    network: "base-mainnet",
    vault,
    expectedVersion: "0",
    expiresAt: soon,
    signature: await signBinding(typedData("0", "123", soon)),
  });
  assert.equal(refusedSoon.status, 400);
  assert.deepEqual(await refusedSoon.json(), {
    error: "authorization_expires_too_soon",
  });
  const expired = String(nowSeconds - 60);
  storeRow(expired, await signBinding(typedData("0", "123", expired)));
  await scheduled();
  assert.equal((await runDestinationBindings(env as never))?.candidates, 0);
  assert.equal(await nonce(attester), 0);
  assert.deepEqual(bindEntries(), []);

  // Failure: the wrong GitHub actor. Bob cannot request consent for
  // alice's claim, and a stored wallet signature over another actor ID is
  // refused by the attester before it signs anything.
  const refusedActor = await account("bob", "/wallets/bind-challenge", {
    claimId: "claim",
    network: "base-mainnet",
    vault,
    expectedVersion: "0",
  });
  assert.equal(refusedActor.status, 409);
  const otherActor = String(nowSeconds + 30 * 24 * 3600);
  storeRow(otherActor, await signBinding(typedData("0", "456", otherActor)));
  await bindingHeld();
  assert.equal(await nonce(attester), 0);
  assert.deepEqual(bindEntries(), []);

  // (7) The contributor signs the binding through the account API.
  const challenge = await account("alice", "/wallets/bind-challenge", {
    claimId: "claim",
    network: "base-mainnet",
    vault,
    expectedVersion: "0",
  });
  assert.equal(challenge.status, 200);
  const consent = (
    (await challenge.json()) as {
      typedData: ReturnType<typeof evmBindingTypedData>;
    }
  ).typedData;
  assert.equal(consent.domain.chainId, "8453");
  const authorized = await account("alice", "/wallets/bind-authorize", {
    claimId: "claim",
    network: "base-mainnet",
    vault,
    expectedVersion: "0",
    expiresAt: consent.message.expiresAt,
    signature: await signBinding(consent),
  });
  assert.equal(authorized.status, 200, await authorized.clone().text());

  // Failure: an uncertain send. The broadcast is lost twice. The attester
  // journals one signed binding before its first broadcast; each later run
  // finds that entry and broadcasts the same bytes again. It never signs a
  // second binding while the first is unreconciled.
  // Keep this original near the existing 10 gwei ceiling. Its minimum
  // cancellation fee would exceed that ceiling, so the later guard cases hold.
  await rpc("anvil_setNextBlockBaseFeePerGas", ["0x10c388d00"]);
  await mine(1);
  dropBroadcast = true;
  await bindingHeld();
  const held = bindEntries();
  assert.equal(held.length, 1);
  assert(
    (parseTransaction(held[0].rawTransaction).maxFeePerGas ?? 0n) * 9n >
      80_000_000_000n,
  );
  assert.equal(
    await rpc("eth_getTransactionByHash", [held[0].transactionId]),
    null,
  );
  await bindingHeld();
  assert.deepEqual(bindEntries(), held);
  assert.equal(await nonce(attester), 0);
  assert.equal(
    await journal.get(`nonce:8453:${attester}`),
    1,
    "One nonce was allocated, for the one signed binding",
  );

  // Renewed consent does not replace the still-valid exact consent already signed.
  const renewed = String(Number(consent.message.expiresAt) + 3600);
  storeRow(renewed, await signBinding(typedData("0", "123", renewed)));

  // Expired consent stays held when cancellation cannot fit the existing fee cap.
  // Move the actual local chain and the attester clock together, then restore
  // the chain snapshot so the remaining independent cases use the original time.
  const expirySnapshot = await rpc("evm_snapshot", []);
  const originalNow = Date.now;
  const expiredAt = Number(consent.message.expiresAt) + 1;
  await rpc("evm_setNextBlockTimestamp", [expiredAt]);
  await mine(64);
  Date.now = () => expiredAt * 1000;
  dropBroadcast = false;
  const beforeExpiryBroadcasts = bindingBroadcasts;
  try {
    await assert.rejects(
      runDestinationBindings(env as never),
      /Destination binding incomplete/,
    );
    assert.equal(bindingBroadcasts, beforeExpiryBroadcasts);
    assert.equal(await nonce(attester), 0);
    assert.deepEqual(bindEntries(), held);
    assert.equal(
      await journal.get(`binding-cancel:${held[0].transactionId}`),
      undefined,
    );
  } finally {
    Date.now = originalNow;
    assert.equal(await rpc("evm_revert", [expirySnapshot]), true);
  }

  // The RPC recovers: the next run broadcasts the original authorized bytes.
  dropBroadcast = false;
  const run = await runDestinationBindings(env as never);
  assert.deepEqual(run, {
    candidates: 1,
    current: 0,
    waiting: 0,
    failed: 0,
    submitted: [held[0].transactionId],
  });
  await mine(1);
  const receipt = (await rpc("eth_getTransactionReceipt", [
    held[0].transactionId,
  ])) as { status: string; from: string; to: string };
  assert.equal(receipt.status, "0x1");
  assert.equal(receipt.from, attester);
  assert.equal(receipt.to, vault);
  await mine(64);

  // Payable: the finalized binding is current, so the attester does
  // nothing more, and the vault reports a payable destination.
  await scheduled();
  assert.deepEqual(await runDestinationBindings(env as never), {
    candidates: 1,
    current: 1,
    waiting: 0,
    failed: 0,
    submitted: [],
  });
  const [payTo, version] = words(
    await read(vault, "payableBinding(uint64)", ["123"]),
  );
  assert.equal(`0x${payTo.toString(16).padStart(40, "0")}`, recipient);
  assert.equal(version, 1n);
  assert.equal(await nonce(attester), 1, "The attester sent one transaction");

  // (8) pay is permissionless: an unrelated account submits it with no
  // Slop key. The contributor receives the net 9.8 USDC.
  await send(vault, "pay(bytes32,uint64)", [award, "1"], payer);
  assert.equal(await balance(asset, recipient), 9_800_000n);
  await mine(64);
  await scheduled();
  assert.equal(
    (
      sql
        .query("SELECT state FROM payment_obligations WHERE id=?")
        .get(award) as { state: string }
    ).state,
    "paid",
  );
  // (9) Anyone moves the 2% fee to the fee recipient.
  await send(vault, "claimFees()", [], payer);
  assert.equal(await balance(asset, fee), 200_000n);

  // A signed replacement supersedes Carol's pending binding. The old raw/hash/nonce
  // stays held when cancellation exceeds the cap; delayed original receipts
  // still reconcile. An unsigned registration alone must not obsolete it.
  const carolWallet = privateKeyToAccount(`0x${"0".repeat(63)}2`);
  const carolAward = evmAwardId(8453n, vault, `0x${"3".padStart(64, "0")}`);
  await send(
    vault,
    "commitAward(bytes32,uint64,uint128,bytes32)",
    [carolAward, "789", "1000000", `0x${"3".padStart(64, "0")}`],
    owner,
  );
  await mine(64);
  const carolClaim = (await (
    await account("carol", "/wallets/register", {
      chain: "base",
      address: carolWallet.address.toLowerCase(),
    })
  ).json()) as { claimId: string };
  const carolChallenge = (await (
    await account("carol", "/wallets/challenge", {
      claimId: carolClaim.claimId,
    })
  ).json()) as { message: string; challengeId: string };
  assert.equal(
    (
      await account("carol", "/wallets/authorize", {
        claimId: carolClaim.claimId,
        challengeId: carolChallenge.challengeId,
        signature: await carolWallet.signMessage({
          message: carolChallenge.message,
        }),
      })
    ).status,
    200,
  );
  const carolConsent = {
    claimId: carolClaim.claimId,
    network: "base-mainnet",
    vault,
    expectedVersion: "0",
  };
  const carolTyped = (
    (await (
      await account("carol", "/wallets/bind-challenge", carolConsent)
    ).json()) as { typedData: ReturnType<typeof evmBindingTypedData> }
  ).typedData;
  const { EIP712Domain: _carolDomain, ...carolTypes } = carolTyped.types;
  assert.equal(
    (
      await account("carol", "/wallets/bind-authorize", {
        ...carolConsent,
        expiresAt: carolTyped.message.expiresAt,
        signature: await carolWallet.signTypedData({
          domain: {
            ...carolTyped.domain,
            chainId: Number(carolTyped.domain.chainId),
            verifyingContract: carolTyped.domain
              .verifyingContract as `0x${string}`,
          },
          types: carolTypes,
          primaryType: carolTyped.primaryType,
          message: {
            actorId: BigInt(carolTyped.message.actorId),
            destination: carolTyped.message.destination as `0x${string}`,
            expectedVersion: BigInt(carolTyped.message.expectedVersion),
            claimDigest: carolTyped.message.claimDigest as `0x${string}`,
            expiresAt: BigInt(carolTyped.message.expiresAt),
          },
        } as never),
      })
    ).status,
    200,
  );
  await rpc("anvil_setNextBlockBaseFeePerGas", ["0x10c388d00"]);
  await mine(1);
  dropBroadcast = true;
  await bindingHeld();
  const carolHeld = bindEntries().filter(
    (entry) => entry.transactionId !== held[0].transactionId,
  );
  assert.equal(carolHeld.length, 1);
  assert(
    (parseTransaction(carolHeld[0].rawTransaction).maxFeePerGas ?? 0n) * 9n >
      80_000_000_000n,
  );
  assert.equal((await pendingStoredBindings(journal)).length, 1);
  const replacementWallet = privateKeyToAccount(`0x${"0".repeat(63)}3`);
  const replacement = (await (
    await account("carol", "/wallets/register", {
      chain: "base",
      address: replacementWallet.address.toLowerCase(),
    })
  ).json()) as { claimId: string };
  // A pending registration still permits retry of the same signed old binding.
  const beforeUnsignedRetry = bindingBroadcasts;
  const unsignedJournal = JSON.stringify(await journal.get(carolHeld[0].key));
  await bindingHeld();
  assert(bindingBroadcasts > beforeUnsignedRetry);
  assert.equal(
    JSON.stringify(await journal.get(carolHeld[0].key)),
    unsignedJournal,
  );
  assert.equal(
    await journal.get(`binding-cancel:${carolHeld[0].transactionId}`),
    undefined,
  );
  const replacementChallenge = (await (
    await account("carol", "/wallets/challenge", {
      claimId: replacement.claimId,
    })
  ).json()) as { challengeId: string; message: string };
  assert.equal(
    (
      await account("carol", "/wallets/authorize", {
        claimId: replacement.claimId,
        challengeId: replacementChallenge.challengeId,
        signature: await replacementWallet.signMessage({
          message: replacementChallenge.message,
        }),
      })
    ).status,
    200,
  );
  const carolAttempt = await journal.get<{ rawTransaction: `0x${string}` }>(
    carolHeld[0].key,
  );
  assert.ok(carolAttempt);
  const savedAttempt = JSON.stringify(carolAttempt);
  const pendingKeys = await pendingStoredBindings(journal);
  const beforeObsoleteBroadcasts = bindingBroadcasts;
  dropBroadcast = false;
  await assert.rejects(
    runDestinationBindings(env as never),
    /Destination binding incomplete/,
  );
  assert.equal(bindingBroadcasts, beforeObsoleteBroadcasts);
  assert.equal(
    await journal.get(`binding-cancel:${carolHeld[0].transactionId}`),
    undefined,
  );
  assert.equal(
    await rpc("eth_getTransactionByHash", [carolHeld[0].transactionId]),
    null,
  );
  assert.equal(
    await nonce(attester),
    1,
    "Obsolete nonce remains held, not consumed or replaced",
  );
  assert.equal(
    JSON.stringify(await journal.get(carolHeld[0].key)),
    savedAttempt,
  );
  assert.deepEqual(await pendingStoredBindings(journal), pendingKeys);
  assert.equal(await balance(asset, carolWallet.address), 0n);

  // Model delayed delivery of the already-signed original request. Only the
  // local node receives these existing bytes; no new attempt is signed. The
  // service must reconcile that receipt truthfully even though D1 changed.
  assert.equal(
    await rpc("eth_sendRawTransaction", [carolAttempt.rawTransaction]),
    carolHeld[0].transactionId,
  );
  await mine(1);
  receiptFault = { transactionId: carolHeld[0].transactionId, kind: "missing" };
  await assert.rejects(
    runDestinationBindings(env as never),
    /Destination binding incomplete/,
  );
  assert.equal(bindingBroadcasts, beforeObsoleteBroadcasts);
  assert.deepEqual(await pendingStoredBindings(journal), pendingKeys);
  assert.equal(
    JSON.stringify(await journal.get(carolHeld[0].key)),
    savedAttempt,
  );
  await mine(64);
  receiptFault = {
    transactionId: carolHeld[0].transactionId,
    kind: "wrong-block",
  };
  await assert.rejects(
    runDestinationBindings(env as never),
    /Destination binding incomplete/,
  );
  assert.deepEqual(await pendingStoredBindings(journal), pendingKeys);
  receiptFault = null;
  await scheduled();
  assert.deepEqual(await pendingStoredBindings(journal), []);
  assert.equal(
    JSON.stringify(await journal.get(carolHeld[0].key)),
    savedAttempt,
  );
  assert.equal(bindingBroadcasts, beforeObsoleteBroadcasts);
  assert.equal(
    await nonce(attester),
    2,
    "Finalized original receipts are reconciled despite wallet replacement",
  );

  // (10) The owner withdraws the unused 39 USDC, less the 2% fee.
  await send(vault, "withdrawUnused(uint128)", ["39000000"], owner);
  assert.equal(await balance(asset, owner), 38_220_000n);
  // Carol's reserved 1 USDC and the 0.78 USDC withdrawal fee remain.
  assert.equal(await balance(asset, vault), 1_780_000n);

  // Failure: the identity authority as a payout destination. Dave (GitHub
  // 321) confirms the attester's own address as his wallet and signs a
  // binding to it. The EVM vault would accept that binding; the attester
  // refuses it before it signs anything, as the Solana program does.
  const daveSession = "d".repeat(43);
  const daveWallet = privateKeyToAccount(attesterKey);
  sql
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('dave','321','dave',?,0)",
    )
    .run(at);
  sql
    .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
    .run(
      await sha256Hex(daveSession),
      "dave",
      new Date(Date.now() + 3600000).toISOString(),
    );
  const dave = (path: string, body: Record<string, string>) =>
    onRequest({
      request: new Request(`https://slop.cash/api/v1/payments${path}`, {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${daveSession}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      env: { SLOP_DB: db, PAYMENT_NETWORKS: '["base-mainnet"]' },
    } as never);
  const daveSource = `0x${"4".padStart(64, "0")}`;
  await send(asset, "mint(address,uint256)", [owner, "1000000"]);
  await send(asset, "approve(address,uint256)", [vault, "1000000"], owner);
  await send(vault, "deposit(uint128)", ["1000000"], owner);
  await send(
    vault,
    "commitAward(bytes32,uint64,uint128,bytes32)",
    [evmAwardId(8453n, vault, daveSource), "321", "1000000", daveSource],
    owner,
  );
  await mine(64);
  const daveClaim = (await (
    await dave("/wallets/register", { chain: "base", address: attester })
  ).json()) as { claimId: string };
  const daveChallenge = (await (
    await dave("/wallets/challenge", { claimId: daveClaim.claimId })
  ).json()) as { message: string; challengeId: string };
  assert.equal(
    (
      await dave("/wallets/authorize", {
        claimId: daveClaim.claimId,
        challengeId: daveChallenge.challengeId,
        signature: await daveWallet.signMessage({
          message: daveChallenge.message,
        }),
      })
    ).status,
    200,
  );
  const daveConsent = {
    claimId: daveClaim.claimId,
    network: "base-mainnet",
    vault,
    expectedVersion: "0",
  };
  const daveTyped = (
    (await (await dave("/wallets/bind-challenge", daveConsent)).json()) as {
      typedData: ReturnType<typeof evmBindingTypedData>;
    }
  ).typedData;
  assert.equal(daveTyped.message.destination, attester);
  const { EIP712Domain: _daveDomain, ...daveTypes } = daveTyped.types;
  assert.equal(
    (
      await dave("/wallets/bind-authorize", {
        ...daveConsent,
        expiresAt: daveTyped.message.expiresAt,
        signature: await daveWallet.signTypedData({
          domain: {
            ...daveTyped.domain,
            chainId: Number(daveTyped.domain.chainId),
            verifyingContract: daveTyped.domain
              .verifyingContract as `0x${string}`,
          },
          types: daveTypes,
          primaryType: daveTyped.primaryType,
          message: {
            actorId: BigInt(daveTyped.message.actorId),
            destination: daveTyped.message.destination as `0x${string}`,
            expectedVersion: BigInt(daveTyped.message.expectedVersion),
            claimDigest: daveTyped.message.claimDigest as `0x${string}`,
            expiresAt: BigInt(daveTyped.message.expiresAt),
          },
        } as never),
      })
    ).status,
    200,
  );
  await bindingHeld();
  assert.equal(await nonce(attester), 2, "No binding to the authority");
  assert.deepEqual(await pendingStoredBindings(journal), []);
  const [daveTo] = words(await read(vault, "payableBinding(uint64)", ["321"]));
  assert.equal(daveTo, 0n, "Dave has no payable destination");

  // The binding run exists only on a production EVM attester, or a test
  // one with SCHEDULED_BINDINGS=on (staging keeper topology).
  for (const other of [
    { SIGNER_STACK: "test" },
    { SIGNER_ROLE: "relayer" },
    { SIGNER_ROLE: "relayer", SIGNER_STACK: "test", SCHEDULED_BINDINGS: "on" },
  ])
    assert.equal(
      await runDestinationBindings({ ...env, ...other } as never),
      null,
    );
  await assert.rejects(
    runDestinationBindings({ ...env, SCHEDULED_BINDINGS: "yes" } as never),
    /Unknown SCHEDULED_BINDINGS/,
  );
  // A scheduled test attester uses the test journal and the test stack's
  // network checks: it never signs for this mainnet vault.
  const testScheduled = {
    ...env,
    SIGNER_STACK: "test",
    SCHEDULED_BINDINGS: "on",
    JOURNAL: {
      idFromName(name: string) {
        journalNames.push(name);
        return name;
      },
      get: () =>
        new PaymentSignerJournal({ storage: journal }, testScheduled as never),
    },
  };
  const nonceBefore = await nonce(attester);
  await assert.rejects(
    runDestinationBindings(testScheduled as never),
    /Destination binding run rejected/,
  );
  assert.equal(journalNames.at(-1), "dedicated-test-signer-v1");
  assert.equal(await nonce(attester), nonceBefore);
  // Like production, it refuses requested bindings: the schedule is the
  // only binding path.
  assert.equal(
    (
      await new PaymentSignerJournal(
        { storage: journal },
        testScheduled as never,
      ).fetch(
        new Request("https://attester.internal/v1/pay", {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
    404,
  );
  console.log(
    `base-mainnet bind trigger: bound ${held[0].transactionId} after two lost broadcasts; paid ${recipient} 9.8 USDC; fee 0.2 USDC claimed; expired and superseded consent stayed held at the existing cancellation fee cap; the delayed original receipt reconciled without another broadcast`,
  );
} finally {
  anvil.kill();
  proxy.stop(true);
  sql.close();
  journalDb.close();
}
