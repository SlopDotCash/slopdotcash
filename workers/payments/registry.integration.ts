/**
 * Local-only workflow: the payments Worker finds a vault through the D1
 * project registry and writes its finalized counters to vault_snapshots.
 * Real escrow contracts run on Anvil with the Base Sepolia chain id; the
 * registry tables, triggers and revisions are the real migrations. The
 * registry and the isolated payment database are two separate databases, as
 * configure.mjs binds them (REGISTRY_DB and PAYMENTS_DB). The readiness
 * report then reads the same registry and probes the same RPC.
 *
 * The account API router (the Pages SLOP_DB is the registry) builds wallet
 * binding consent for the recorded vault only for its served networks. The
 * production stack definition of configure.mjs is the identity attester
 * only (PRD PAY-04): it pins the same deployment, has no relayer and no
 * dispatcher, and the hosted signer refuses the relayer role on it and a
 * network outside its stack before it reads a signer secret.
 */
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import {
  type evmBindingTypedData,
  evmVaultKey,
} from "../../contracts/evm/adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
import { onRequest } from "../../functions/api/v1/[[path]]";
import {
  payoutReadiness,
  probeRpc,
} from "../../scripts/check-payout-readiness";
import { paymentDeploymentRecord } from "../../src/lib/escrow-policy.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { sha256Hex } from "../identity/crypto";
import {
  type PaymentStackInput,
  paymentStack,
} from "../payment-executor/configure.mjs";
import { PaymentSignerJournal } from "../payment-executor/index";
import { registryDeployments, syncRegistryVaults } from "./index";

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = 18571;
const rpcUrl = `http://127.0.0.1:${port}`;
// Anvil's public deterministic accounts 0, 1 and 2; no user key is read.
const registrar = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const attester = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const owner = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const fee = "0x0000000000000000000000000000000000000fee";
const delay = "3600";
const projectKey = `0x${"1".padStart(64, "0")}`;

const anvil = spawn(
  "anvil",
  ["--port", String(port), "--chain-id", "84532", "--silent"],
  { stdio: "ignore" },
);
function d1(database: Database): D1Database {
  function statement(
    query: string,
    args: unknown[] = [],
  ): ReturnType<D1Database["prepare"]> {
    return {
      bind: (...values: unknown[]) => statement(query, values),
      async first<T>() {
        return (database.prepare(query).get(...(args as string[])) ??
          null) as T | null;
      },
      async run() {
        const result = database.prepare(query).run(...(args as string[]));
        return { success: true, meta: { changes: result.changes } };
      },
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      const results = [];
      for (const item of statements) results.push(await item.run());
      return results;
    },
  };
}
// `sql` is the registry (the Pages SLOP_DB); `payments` is the isolated
// payment database. Both run every migration, so both have a projects table.
const sql = new Database(":memory:");
const payments = new Database(":memory:");
const registryDb = d1(sql);
const paymentsDb = d1(payments);
const registryDatabaseId = "1b453124-2709-45af-8389-151a8105c461";
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
        rpcUrl,
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
async function send(
  to: string,
  signature: string,
  args: string[],
  from = registrar,
) {
  const data = execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
  const hash = (await rpc("eth_sendTransaction", [
    { from, to, data, gas: "0x7a1200" },
  ])) as string;
  await rpc("anvil_mine", ["0x1"]);
  const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as {
    status: string;
  };
  assert.equal(receipt.status, "0x1", `Transaction failed: ${signature}`);
  return hash;
}
const codeSha256 = async (address: string) =>
  createHash("sha256")
    .update(
      Buffer.from(
        ((await rpc("eth_getCode", [address, "latest"])) as string).slice(2),
        "hex",
      ),
    )
    .digest("hex");
/** Appends one revision and moves the project pointer, as the admin API does. */
function appendRevision(
  manifest: { id: string; status: string },
  revision: number,
) {
  const text = JSON.stringify(manifest);
  const digest = createHash("sha256").update(text).digest("hex");
  const at = new Date().toISOString();
  sql
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      manifest.id,
      revision,
      text,
      digest,
      revision === 1 ? "Approved application" : "Record escrow deployment",
      "900000001",
      "e2e-admin",
      at,
    );
  if (revision === 1)
    sql
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(manifest.id, manifest.status, 1, text, digest, at, at);
  else
    sql
      .prepare(
        "UPDATE projects SET revision=?,manifest=?,manifest_sha256=?,status=?,updated_at=? WHERE id=?",
      )
      .run(revision, text, digest, manifest.status, at, manifest.id);
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
  for (const file of readdirSync(`${root}migrations`)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const database of [sql, payments])
      database.exec(readFileSync(`${root}migrations/${file}`, "utf8"));

  const asset = deploy("integration/TestDollar.sol:TestDollar").deployedTo;
  const factory = deployUpgradeableFactory(
    (contract, args) => deploy(contract, args).deployedTo,
    [registrar, fee, attester, delay],
  );
  // Vault creation is permissionless; the sender (the owner) owns the vault.
  const createTx = await send(
    factory,
    "create(bytes32,address,uint8)",
    [projectKey, asset, "0"],
    owner,
  );
  const vault = `0x${(
    (await rpc("eth_call", [
      {
        to: factory,
        data: execFileSync(
          "cast",
          [
            "calldata",
            "vaults(bytes32)",
            evmVaultKey({ owner, projectId: projectKey, asset }),
          ],
          { encoding: "utf8" },
        ).trim(),
      },
      "latest",
    ])) as string
  )
    .slice(-40)
    .toLowerCase()}`;
  await send(asset, "mint(address,uint256)", [registrar, "250000000"]);
  await send(asset, "approve(address,uint256)", [vault, "250000000"]);
  await send(vault, "deposit(uint128)", ["250000000"]);
  // The worker reads at the finalized tag, so let the deposit finalize.
  await rpc("anvil_mine", ["0x40"]);

  const fixture = JSON.parse(
    readFileSync(`${root}tests/fixtures/projects/eliza.json`, "utf8"),
  );
  const base = {
    ...fixture,
    reward: {
      ...fixture.reward,
      chain: "base",
      currency: "USDC",
      feeBasisPoints: 200,
    },
  };
  const deployment = {
    network: "base-sepolia" as const,
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
    bindingDelaySeconds: delay,
    rotationDelaySeconds: null,
    factory: factory.toLowerCase(),
    factoryCodeSha256: await codeSha256(factory),
    registrar,
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
  };
  const withEscrow = assertProjectDefinition({
    ...base,
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
  const { escrow: _escrow, ...withoutEscrow } = withEscrow;

  const env = {
    PAYMENTS_DB: paymentsDb,
    REGISTRY_DB: registryDb,
    PAYMENT_NETWORKS: JSON.stringify(["base-sepolia"]),
    PAYMENT_RPC_URLS: JSON.stringify({ "base-sepolia": rpcUrl }),
  };
  const snapshots = () =>
    payments
      .query("SELECT * FROM vault_snapshots ORDER BY project_id")
      .all() as Record<string, unknown>[];

  // 1. A project without a recorded deployment has no vault to read. A
  //    served network without a vault is a reported failure, not a success.
  appendRevision(withoutEscrow, 1);
  const before = await syncRegistryVaults(env);
  assert.deepEqual(before.deployments, []);
  assert.deepEqual(before.failures.map(String), [
    "Error: Project registry has no escrow deployment for served network base-sepolia",
  ]);
  assert.deepEqual(snapshots(), []);

  // 2. An admin revision records the deployment. The next run finds the vault
  //    without any Worker configuration change.
  appendRevision(withEscrow, 2);
  const found = await syncRegistryVaults(env);
  assert.deepEqual(found.failures, [], String(found.failures));
  assert.deepEqual(found.deployments, [
    paymentDeploymentRecord("eliza", deployment),
  ]);
  const [row] = snapshots();
  assert.equal(row.project_id, "eliza");
  assert.equal(row.network, "base-sepolia");
  assert.equal(row.chain, "base");
  assert.equal(row.vault, vault);
  assert.equal(row.total_deposited, "250000000");
  assert.equal(row.free_balance, "250000000");
  assert.equal(row.total_paid, "0");
  assert.equal(row.asset_decimals, 6);
  const finalized = (await rpc("eth_getBlockByNumber", [
    "finalized",
    false,
  ])) as {
    number: string;
  };
  assert.equal(row.block_number, BigInt(finalized.number).toString());
  const cursor = payments
    .query(
      "SELECT position FROM payment_chain_cursors WHERE project_id='eliza' AND network='base-sepolia'",
    )
    .get() as { position: string } | null;
  assert.equal(
    cursor?.position,
    BigInt(finalized.number).toString(),
    "The finalized event scan covered the vault up to the finalized head",
  );

  // The registry rows stay in the registry database: the isolated payment
  // database has an empty projects table. A dispatcher that reads the
  // registry from PAYMENTS_DB finds nothing and reports it.
  assert.equal(
    (payments.query("SELECT count(*) n FROM projects").get() as { n: number })
      .n,
    0,
  );
  const misbound = await registryDeployments({
    ...env,
    REGISTRY_DB: paymentsDb,
  });
  assert.deepEqual(misbound.deployments, []);
  assert.match(String(misbound.failures), /no escrow deployment/);

  // 3. A Worker serving another network does not read this vault, and a
  //    Worker without a valid network list stops instead of guessing.
  const other = await registryDeployments({
    ...env,
    PAYMENT_NETWORKS: JSON.stringify(["robinhood-testnet"]),
  });
  assert.deepEqual(other.deployments, []);
  assert.match(String(other.failures), /served network robinhood-testnet/);
  for (const value of [
    "",
    "[]",
    '["base-sepolia","base-sepolia"]',
    '["anvil"]',
  ])
    await assert.rejects(
      syncRegistryVaults({ ...env, PAYMENT_NETWORKS: value }),
      /PAYMENT_NETWORKS/,
    );

  // 3b. The account API router finds the recorded vault in the same registry
  //     (on Pages, SLOP_DB holds the registry and the account tables) and
  //     builds binding consent only for a network it serves.
  //     Public deterministic test key 1 controls the wallet; no user key.
  const wallet = privateKeyToAccount(`0x${"0".repeat(63)}1`);
  const session = "s".repeat(43);
  const at = new Date().toISOString();
  sql
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('node','123','alice',?,0)",
    )
    .run(at);
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
    .run(wallet.address.toLowerCase(), "a".repeat(64), at, "c".repeat(64), at);
  const account = (
    paymentNetworks: string | undefined,
    path: string,
    body: Record<string, string>,
  ) =>
    onRequest({
      request: new Request(`https://slop.cash/api/v1/payments${path}`, {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${session}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      env: {
        SLOP_DB: registryDb,
        ...(paymentNetworks === undefined
          ? {}
          : { PAYMENT_NETWORKS: paymentNetworks }),
      },
    } as never);
  // The wallet first proves control of the claimed address (personal_sign).
  const walletChallenge = (await (
    await account(undefined, "/wallets/challenge", { claimId: "claim" })
  ).json()) as { message: string; challengeId: string };
  const walletAuthorized = await account(undefined, "/wallets/authorize", {
    claimId: "claim",
    challengeId: walletChallenge.challengeId,
    signature: await wallet.signMessage({ message: walletChallenge.message }),
  });
  assert.equal(walletAuthorized.status, 200, await walletAuthorized.text());
  const consent = {
    claimId: "claim",
    network: "base-sepolia",
    vault,
    expectedVersion: "0",
  };
  for (const [served, status, error] of [
    [undefined, 503, "payment_deployments_unavailable"],
    ['["anvil"]', 503, "payment_deployments_unavailable"],
    ['["base-mainnet"]', 400, "unknown_deployment"],
  ] as const) {
    const refused = await account(served, "/wallets/bind-challenge", consent);
    assert.equal(refused.status, status, `PAYMENT_NETWORKS=${served}`);
    assert.deepEqual(await refused.json(), { error });
  }
  const served = JSON.stringify(["base-sepolia"]);
  const challenge = await account(served, "/wallets/bind-challenge", consent);
  assert.equal(challenge.status, 200, await challenge.clone().text());
  const { typedData } = (await challenge.json()) as {
    typedData: ReturnType<typeof evmBindingTypedData>;
  };
  assert.equal(String(typedData.domain.chainId), "84532");
  assert.equal(typedData.domain.verifyingContract.toLowerCase(), vault);
  assert.equal(
    typedData.message.destination.toLowerCase(),
    wallet.address.toLowerCase(),
  );
  const { EIP712Domain: _domain, ...types } = typedData.types;
  const signature = await wallet.signTypedData({
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
  const authorized = await account(served, "/wallets/bind-authorize", {
    ...consent,
    expiresAt: typedData.message.expiresAt,
    signature,
  });
  assert.equal(authorized.status, 200, await authorized.clone().text());
  const binding = sql
    .query(
      "SELECT network,vault,chain_id FROM payment_binding_authorizations WHERE claim_id='claim'",
    )
    .get() as Record<string, string>;
  assert.deepEqual(binding, {
    network: "base-sepolia",
    vault,
    chain_id: "84532",
  });

  // 3c. The production stack definition for one mainnet is the identity
  //     attester only (PRD PAY-04, PAY-05). It pins the registry deployment
  //     and uses the registry database and the production secret name. Slop
  //     generates no relayer and no dispatcher, so the readiness report
  //     names the executor as missing until the project or a permissionless
  //     executor provides one.
  const mainnetDeployment = {
    ...deployment,
    network: "base-mainnet" as const,
    bindingDelaySeconds: "172800",
  };
  const mainnetManifest = assertProjectDefinition({
    ...withEscrow,
    escrow: { ...withEscrow.escrow, deployments: [mainnetDeployment] },
  });
  const registryDatabase = {
    database_name: "slop-private",
    database_id: registryDatabaseId,
  };
  const mainnetRecord = paymentDeploymentRecord("eliza", mainnetDeployment);
  const production = paymentStack({
    stack: "production",
    network: "base-mainnet",
    deployments: [mainnetRecord],
    registry: [mainnetManifest],
    registryDatabase,
  });
  assert.equal(production.secret, "SIGNER_PRIVATE_KEY");
  assert.deepEqual(production.names, {
    attester: "slop-payments-base-mainnet-attester",
  });
  assert.deepEqual(Object.keys(production.configs), ["attester"]);
  assert.equal(production.configs.attester.vars.SIGNER_ROLE, "attester");
  assert.equal(production.configs.attester.vars.SIGNER_STACK, "production");
  assert.deepEqual(production.configs.attester.triggers, {
    crons: ["*/5 * * * *"],
  });
  assert.equal(production.configs.attester.services, undefined);
  assert.deepEqual(production.configs.attester.d1_databases, [
    { binding: "PAYMENTS_DB", ...registryDatabase },
    { binding: "REGISTRY_DB", ...registryDatabase },
  ]);
  const mainnetReport = (enabled: boolean) =>
    payoutReadiness({
      registry: [mainnetManifest],
      registryDatabaseId,
      configs: Object.values(production.configs),
      rpcUrls: { "base-mainnet": "https://base-mainnet.rpc.example" },
      probes: { "base-mainnet": "finalized" },
      executionEnabled: () => enabled,
    }).find((item) => item.network === "base-mainnet");
  assert.equal(mainnetReport(false)?.attester, "configured");
  assert.equal(mainnetReport(true)?.attester, "configured");
  assert.equal(mainnetReport(true)?.executor, "missing");
  assert.equal(mainnetReport(true)?.ready, false);
  // A production stack never serves a test network or a separate database,
  // and a test stack never serves a mainnet.
  assert.throws(
    () =>
      paymentStack({
        stack: "production",
        network: "base-sepolia",
        deployments: [paymentDeploymentRecord("eliza", deployment)],
        registry: [withEscrow],
        registryDatabase,
      }),
    /registry mainnet/,
  );
  assert.throws(
    () =>
      paymentStack({
        stack: "production",
        network: "base-mainnet",
        databaseId: "00000000-0000-4000-8000-000000000001",
        databaseName: "slop-payments-base-mainnet",
        deployments: [mainnetRecord],
        registry: [mainnetManifest],
        registryDatabase,
      }),
    /registry database/,
  );
  assert.throws(
    () =>
      paymentStack({
        network: "base-mainnet",
        databaseId: "00000000-0000-4000-8000-000000000001",
        databaseName: "slop-payments-base-mainnet",
        deployments: [mainnetRecord],
        registry: [mainnetManifest],
        registryDatabase,
      }),
    /Explicit test network/,
  );
  const testStack = paymentStack({
    network: "base-sepolia",
    databaseId: "00000000-0000-4000-8000-000000000001",
    databaseName: "slop-payments-base-sepolia",
    deployments: [paymentDeploymentRecord("eliza", deployment)],
    registry: [withEscrow],
    registryDatabase,
  });
  assert.equal(testStack.secret, "TEST_SIGNER_PRIVATE_KEY");
  assert.equal(testStack.configs.attester.vars.SIGNER_STACK, "test");

  // 3c'. A staging stack serves the staging site: its payment and registry
  //      databases are slop-staging, so the staging account API reads what
  //      it records, and it pins every deployment of the network in the
  //      staging registry. The keeper topology binds on the attester's
  //      schedule and gives the dispatcher no schedule. It never names
  //      production storage, a separate database or its own pins.
  const stagingDatabase = {
    database_name: "slop-staging",
    database_id: "00000000-0000-4000-8000-000000000002",
  };
  const stagingStack = (input: Record<string, unknown> = {}) =>
    paymentStack({
      environment: "staging",
      network: "base-sepolia",
      registry: [withEscrow],
      registryDatabase: stagingDatabase,
      monthlySchedule:
        '{"firstPeriod":"2026-09","cutoffSecondsAfterPeriodEnd":259200}',
      ...input,
    } as PaymentStackInput & { stack?: "test" });
  const stagingRecord = paymentDeploymentRecord("eliza", deployment);
  const relayerTopology = stagingStack();
  assert.deepEqual(relayerTopology.names, {
    attester: "slop-payments-base-sepolia-staging-attester",
    relayer: "slop-payments-base-sepolia-staging-relayer",
    dispatcher: "slop-payments-base-sepolia-staging-dispatcher",
  });
  for (const config of Object.values(relayerTopology.configs))
    assert.deepEqual(config.d1_databases[0], {
      binding: "PAYMENTS_DB",
      ...stagingDatabase,
    });
  assert.deepEqual(relayerTopology.configs.dispatcher.d1_databases[1], {
    binding: "REGISTRY_DB",
    ...stagingDatabase,
  });
  assert.equal(
    relayerTopology.configs.attester.vars.PAYMENT_DEPLOYMENTS,
    JSON.stringify([stagingRecord]),
  );
  assert.equal(
    relayerTopology.configs.attester.vars.SCHEDULED_BINDINGS,
    undefined,
  );
  assert.deepEqual(relayerTopology.configs.dispatcher.triggers, {
    crons: ["*/5 * * * *"],
  });
  const keeperTopology = stagingStack({ topology: "keeper" });
  assert.equal(keeperTopology.configs.attester.vars.SCHEDULED_BINDINGS, "on");
  assert.deepEqual(keeperTopology.configs.dispatcher.triggers, { crons: [] });
  assert.throws(
    () => stagingStack({ registryDatabase }),
    /slop-staging database/,
  );
  assert.throws(
    () => stagingStack({ deployments: [stagingRecord] }),
    /do not name a database or deployments/,
  );
  assert.throws(
    () => stagingStack({ network: "base-mainnet" }),
    /do not name a database or deployments/,
  );
  assert.throws(
    () => stagingStack({ network: "robinhood-testnet" }),
    /no deployment on this network/,
  );
  assert.throws(
    () =>
      paymentStack({
        topology: "keeper",
        network: "base-sepolia",
        databaseId: "00000000-0000-4000-8000-000000000001",
        databaseName: "slop-payments-base-sepolia",
        deployments: [stagingRecord],
        registry: [withEscrow],
        registryDatabase,
      } as never),
    /staging topology/,
  );

  // 3d. The hosted signer reads only its own stack's secret, and only after
  //     the stack, network and preflight checks pass. Each secret is a
  //     getter that records a read; no value is a usable key.
  const signerRun = async (
    stack: string | undefined,
    network: string,
    deployments: unknown[],
    role = "attester",
    path = "/v1/pay",
  ) => {
    const read: string[] = [];
    const env = {
      PAYMENTS_DB: paymentsDb,
      PAYMENT_DEPLOYMENTS: JSON.stringify(deployments),
      PAYMENT_RPC_URLS: JSON.stringify({ [network]: rpcUrl }),
      SIGNER_ROLE: role,
      CHAIN_FAMILY: "evm",
      ...(stack === undefined ? {} : { SIGNER_STACK: stack }),
    };
    for (const name of ["TEST_SIGNER_PRIVATE_KEY", "SIGNER_PRIVATE_KEY"])
      Object.defineProperty(env, name, {
        get() {
          read.push(name);
          return undefined;
        },
      });
    const response = await new PaymentSignerJournal(
      { storage: {} } as never,
      env as never,
    ).fetch(
      new Request(`https://identity-attester.internal${path}`, {
        method: "POST",
        headers: { "idempotency-key": "key" },
        body: JSON.stringify({
          idempotencyKey: "key",
          obligationId: "award",
          network,
          vault,
          githubUserId: "123",
          claimId: "claim",
          claimDigest: `0x${"c".repeat(64)}`,
          destination: wallet.address,
        }),
      }),
    );
    return { status: response.status, read };
  };
  const secretsRead = async (...args: Parameters<typeof signerRun>) => {
    const { status, read } = await signerRun(...args);
    assert.equal(status, 409);
    return read;
  };
  const sepoliaRecord = paymentDeploymentRecord("eliza", deployment);
  // A test stack (with or without SIGNER_STACK) passes the Base Sepolia
  // preflight against the chain and then reads the test secret only.
  assert.deepEqual(
    await secretsRead(undefined, "base-sepolia", [sepoliaRecord]),
    ["TEST_SIGNER_PRIVATE_KEY"],
  );
  assert.deepEqual(await secretsRead("test", "base-sepolia", [sepoliaRecord]), [
    "TEST_SIGNER_PRIVATE_KEY",
  ]);
  // A production stack refuses a test network, a test stack refuses a
  // mainnet, the enabled Base mainnet preflight refuses an RPC of another
  // chain, MAINNET_EXECUTION refuses a mainnet that is off, and an unknown
  // stack stops: none of them reads a secret. A production EVM attester
  // signs bindings only in its scheduled run (/v1/bind-destinations).
  const bindRun = "/v1/bind-destinations";
  assert.deepEqual(
    await secretsRead(
      "production",
      "base-sepolia",
      [sepoliaRecord],
      "attester",
      bindRun,
    ),
    [],
  );
  assert.deepEqual(
    await secretsRead("test", "base-mainnet", [mainnetRecord]),
    [],
  );
  assert.deepEqual(
    await secretsRead(
      "production",
      "base-mainnet",
      [mainnetRecord],
      "attester",
      bindRun,
    ),
    [],
  );
  assert.deepEqual(
    await secretsRead(
      "production",
      "ethereum",
      [
        paymentDeploymentRecord("eliza", {
          ...deployment,
          network: "ethereum",
        }),
      ],
      "attester",
      bindRun,
    ),
    [],
  );
  assert.deepEqual(
    await signerRun("production", "base-mainnet", [mainnetRecord]),
    { status: 404, read: [] },
  );
  assert.deepEqual(
    await signerRun(
      "test",
      "base-sepolia",
      [sepoliaRecord],
      "attester",
      bindRun,
    ),
    { status: 404, read: [] },
  );
  assert.deepEqual(
    await secretsRead("staging", "base-sepolia", [sepoliaRecord]),
    [],
  );
  // PRD PAY-04: a production stack has no Slop relayer. The relayer role and
  // its dispatch endpoints are refused before any secret or journal read,
  // while a test relayer still reaches its preflight.
  for (const path of [
    "/v1/pay",
    "/v1/attempt-status",
    "/v1/cancel-unsubmitted",
  ])
    assert.deepEqual(
      await signerRun(
        "production",
        "base-mainnet",
        [mainnetRecord],
        "relayer",
        path,
      ),
      { status: 404, read: [] },
    );
  assert.deepEqual(
    await secretsRead("test", "base-sepolia", [sepoliaRecord], "relayer"),
    ["TEST_SIGNER_PRIVATE_KEY"],
  );

  // 4. One corrupted manifest is reported and never hides the other vaults.
  sql.exec("DROP TRIGGER projects_match_revision_insert");
  sql
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('broken','paused',1,?,?,?,?)",
    )
    .run(
      JSON.stringify({
        id: "broken",
        status: "paused",
        escrow: { ...withEscrow.escrow, feeBasisPoints: 100 },
      }),
      "0".repeat(64),
      new Date().toISOString(),
      new Date().toISOString(),
    );
  const partial = await syncRegistryVaults(env);
  assert.equal(partial.deployments.length, 1);
  assert.equal(partial.failures.length, 1);
  assert.match(String(partial.failures[0]), /Project broken escrow/);

  // 5. The readiness report: the probe proves the Base Sepolia chain id and
  //    a finalized head, and a mainnet that is not enabled stays off by review.
  assert.equal(await probeRpc("base-sepolia", rpcUrl), "finalized");
  assert.equal(await probeRpc("base-mainnet", rpcUrl), "wrong-chain");
  const record = paymentDeploymentRecord("eliza", deployment);
  const signer = (role: string) => ({
    vars: {
      SIGNER_ROLE: role,
      CHAIN_FAMILY: "evm",
      PAYMENT_DEPLOYMENTS: JSON.stringify([record]),
    },
  });
  const dispatcherWith = (registryId: string) => ({
    vars: { PAYMENT_NETWORKS: env.PAYMENT_NETWORKS },
    services: [{ binding: "EVM_PAYMENT_EXECUTOR", service: "relayer" }],
    d1_databases: [
      {
        binding: "PAYMENTS_DB",
        database_id: "00000000-0000-4000-8000-000000000001",
      },
      { binding: "REGISTRY_DB", database_id: registryId },
    ],
  });
  const dispatcher = dispatcherWith(registryDatabaseId);
  const report = (configs: object[], rpcUrls: Record<string, string>) =>
    payoutReadiness({
      registry: [withEscrow],
      registryDatabaseId,
      configs,
      rpcUrls,
      probes: { "base-sepolia": "finalized" },
    });
  const complete = report([signer("attester"), signer("relayer"), dispatcher], {
    "base-sepolia": "https://base-sepolia.rpc.example",
  });
  const sepolia = complete.find((item) => item.network === "base-sepolia");
  assert.deepEqual(sepolia, {
    network: "base-sepolia",
    testnet: true,
    deployments: 1,
    factory: "configured",
    attester: "configured",
    rpc: "finalized",
    executor: "enabled",
    ready: true,
    reasons: [],
  });
  for (const item of complete.filter(
    (entry) => entry.network !== "base-sepolia",
  ))
    assert.equal(item.ready, false, `${item.network} has no stack`);
  const mainnet = report(
    [signer("attester"), signer("relayer"), dispatcher],
    {},
  ).find((item) => item.network === "ethereum");
  assert.equal(mainnet?.executor, "off-by-review");
  assert(
    mainnet?.reasons.includes("MAINNET_EXECUTION is off for this network"),
  );
  const noAttester = report([signer("relayer"), dispatcher], {
    "base-sepolia": "http://plain-text.example",
  }).find((item) => item.network === "base-sepolia");
  assert.equal(noAttester?.attester, "missing");
  assert.equal(noAttester?.rpc, "missing");
  assert.equal(noAttester?.ready, false);
  // A dispatcher bound to the isolated payment database as its registry, or
  // with no registry binding, is not ready.
  for (const wrong of [
    dispatcherWith("00000000-0000-4000-8000-000000000001"),
    { ...dispatcher, d1_databases: dispatcher.d1_databases.slice(0, 1) },
  ]) {
    const row = report([signer("attester"), signer("relayer"), wrong], {
      "base-sepolia": "https://base-sepolia.rpc.example",
    }).find((item) => item.network === "base-sepolia");
    assert.equal(row?.ready, false);
    assert.equal(row?.executor, "missing");
    assert(
      row?.reasons.includes(
        "dispatcher REGISTRY_DB is not the project registry database",
      ),
    );
  }
  console.log(
    `registry vault discovery: snapshot block ${row.block_number}, deposited ${row.total_deposited}; readiness ${sepolia?.ready ? "ready" : "not ready"} for base-sepolia; router binding stored for chain ${binding.chain_id}; production base-mainnet attester ${mainnetReport(false)?.attester}, executor ${mainnetReport(false)?.executor}`,
  );
} finally {
  anvil.kill();
  sql.close();
  payments.close();
}
