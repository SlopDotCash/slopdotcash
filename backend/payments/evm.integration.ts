import { createHash } from "node:crypto";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
/** Local-only workflow: real Anvil contracts + SQLite + GitHub-session API + signed wallet authorization. */

import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import {
  type BindingInput,
  buildBindCalldata,
  buildPayCalldata,
  evmAwardId,
  evmBindingDigest,
  type evmBindingTypedData,
  evmVaultKey,
  readEvmBindingVersion,
  verifyBinding,
} from "../../contracts/evm/adapter";
import { sha256Hex } from "../../workers/identity/crypto";
import {
  assertEvmMonthlySources,
  createEvmAttester,
  createEvmExecutor,
  type JournalStore,
  lookupAttempt,
  preflightEvmDeployment,
  retireUnsignedAttempt,
} from "../../workers/payment-executor/core";
import { readDeploymentVaultTotals } from "../../workers/payments/index";
import { scanEvmPayments } from "../../workers/payments/scanner";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import { sessionGithubActor } from "../points/handler";
import { handleReferralClaims } from "../referrals/claims";
import { dispatchPayment } from "./dispatch";
import { evmPaymentAdapter } from "./evm-adapter";
import { handlePaymentsApi, type PaymentDeploymentIdentity } from "./handler";
import { indexPaymentEvent } from "./ledger";
import { personalMessageHash } from "./possession";
import { refreshVaultSnapshots } from "./vault-snapshots";

const root = fileURLToPath(new URL("../../", import.meta.url));
const localPort = process.argv.includes("--serve") ? 18547 : 18557;
const rpcUrl = `http://127.0.0.1:${localPort}`;
const anvil = spawn("anvil", ["--port", String(localPort), "--silent"], {
  stdio: "ignore",
});
// Second local chain for the Robinhood Chain Testnet pass, started after the Base flow.
let rcAnvil: ReturnType<typeof spawn> | undefined;
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
// The reviewed deployments the account API trusts; set after deployment.
let paymentDeployments: PaymentDeploymentIdentity[] = [];
// Public deterministic test key 1 controls the recipient; no user wallet or secret is read.
const recipientKey = new Uint8Array(32);
recipientKey[31] = 1;
const recipientAccount = privateKeyToAccount(`0x${"0".repeat(63)}1`);
/** viem signs the same EIP-712 structure the vault hashes; a mismatch fails at the handler. */
function signBinding(
  account: { signTypedData: (data: never) => Promise<`0x${string}`> },
  typedData: ReturnType<typeof evmBindingTypedData>,
) {
  const { EIP712Domain: _domain, ...types } = typedData.types;
  return account.signTypedData({
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
/** The contributor accepts one exact binding through the account API; the attester reuses it later. */
async function authorizeBinding(
  db: D1Database,
  claimId: string,
  vault: string,
  expectedVersion: string,
  account: { signTypedData: (data: never) => Promise<`0x${string}`> },
  network = "anvil",
) {
  const challenge = (await (
    await handlePaymentsApi(
      request("/wallets/bind-challenge", {
        claimId,
        network,
        vault,
        expectedVersion,
      }),
      { db, paymentDeployments },
    )
  ).json()) as { typedData: ReturnType<typeof evmBindingTypedData> };
  assert.equal(challenge.typedData.message.expectedVersion, expectedVersion);
  const response = await handlePaymentsApi(
    request("/wallets/bind-authorize", {
      claimId,
      network,
      vault,
      expectedVersion,
      expiresAt: challenge.typedData.message.expiresAt,
      signature: await signBinding(account, challenge.typedData),
    }),
    { db, paymentDeployments },
  );
  assert.equal(response.status, 200, await response.text());
}
async function rpc(method: string, params: unknown[], url = rpcUrl) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result: unknown; error?: unknown };
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const deploymentTransactions = new Map<string, string>();
/**
 * The payments cron's first step: read the vault counters at the finalized
 * block and store them in vault_snapshots. The ledger takes each award's asset
 * and decimals from that row.
 */
async function snapshotVault(
  db: D1Database,
  config: {
    projectId: string;
    network: string;
    vault: string;
    asset: string;
    chainId: bigint;
    factory: string;
    factoryCodeSha256: string;
    registrar: string;
    owner: string;
    identityAuthority: string;
    feeRecipient: string;
    codeSha256: string;
    bindingDelaySeconds: string;
  },
  chain: "base" | "robinhood",
  url: string,
) {
  await refreshVaultSnapshots(
    db,
    [
      {
        ...config,
        chain,
        chainId: config.chainId.toString(),
        upgradeAuthority: null,
      },
    ],
    { [config.network]: url },
    readDeploymentVaultTotals,
  );
}
/** The factory's vaults(projectId, token) lookup. */
async function factoryVault(factory: string, token: string, url = rpcUrl) {
  return `0x${(
    (await rpc(
      "eth_call",
      [
        {
          to: factory,
          data: execFileSync(
            "cast",
            [
              "calldata",
              "vaults(bytes32)",
              evmVaultKey({ owner, projectId: projectKey, asset: token }),
            ],
            { encoding: "utf8" },
          ).trim(),
        },
        "latest",
      ],
      url,
    )) as string
  ).slice(-40)}`;
}
function deploy(contract: string, args: string[] = [], url = rpcUrl): string {
  if (contract === "src/ProjectEscrow.sol:EscrowFactory" && args.length)
    return deployUpgradeableFactory((c, a) => deploy(c, a, url), args);

  const created = JSON.parse(
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
        owner,
        "--broadcast",
        "--json",
        ...(args.length ? ["--constructor-args", ...args] : []),
      ],
      { encoding: "utf8" },
    ),
  ) as { deployedTo: string; transactionHash: string };
  // Contract addresses can repeat across local chains (same deployer and
  // nonces), so only the first chain's transactions are recorded here.
  if (url === rpcUrl)
    deploymentTransactions.set(created.deployedTo, created.transactionHash);
  return created.deployedTo;
}
async function send(
  to: string,
  signature: string,
  args: string[],
  url = rpcUrl,
) {
  const data = execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
  const hash = (await rpc(
    "eth_sendTransaction",
    [{ from: owner, to, data, gas: "0x7a1200" }],
    url,
  )) as string;
  await rpc("anvil_mine", ["0x1"], url);
  const receipt = (await rpc("eth_getTransactionReceipt", [hash], url)) as {
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
  // The registrar is an explicit constructor parameter (the owner account here);
  // the owner creates its own ordinary vault.
  const factory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    owner,
    fee,
    attester,
    delay,
  ]);
  const createTx = await send(factory, "create(bytes32,address,uint8)", [
    projectKey,
    asset,
    "0",
  ]);
  const vault = await factoryVault(factory, asset);
  deploymentTransactions.set(vault, createTx);
  award = evmAwardId(31337n, vault, source);
  await send(asset, "mint(address,uint256)", [owner, "200000000"]);
  await send(asset, "approve(address,uint256)", [vault, "200000000"]);
  await send(vault, "deposit(uint128)", ["200000000"]);
  const reserveTx = await send(
    vault,
    "commitAward(bytes32,uint64,uint128,bytes32)",
    [award, "123", "100000000", source],
  );
  const runtimeCode = (await rpc("eth_getCode", [vault, "latest"])) as string;
  const factoryCode = (await rpc("eth_getCode", [factory, "latest"])) as string;
  paymentDeployments = [
    { network: "anvil", chain: "base", vault, chainId: "31337" },
  ];
  const config = {
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
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
    factory,
    factoryCodeSha256: createHash("sha256")
      .update(Buffer.from(factoryCode.slice(2), "hex"))
      .digest("hex"),
    registrar: owner,
    projectId: "integration-fixture",
    network: "anvil",
  };
  const adapter = evmPaymentAdapter(db, { ...config, chain: "base" });
  // A scan deployment must state its reviewed page size; the scanner never assumes one.
  await assert.rejects(
    scanEvmPayments(
      db,
      {
        ...config,
        deploymentTransaction: deploymentTransactions.get(vault),
      },
      rpcUrl,
      async () => {},
    ),
  );
  const scan = async () => {
    await snapshotVault(db, config, "base", rpcUrl);
    await scanEvmPayments(
      db,
      {
        ...config,
        scanPageBlocks: "2000",
        deploymentTransaction: deploymentTransactions.get(vault),
      },
      rpcUrl,
      async (event) => {
        await indexPaymentEvent(db, adapter, event, new Date().toISOString());
      },
    );
  };
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
  );
  await rpc("anvil_mine", ["0x40"]);
  await scan();
  assert.equal(
    sql.query<{ n: number }, []>("SELECT count(*) n FROM payment_outbox").get()
      ?.n,
    0,
  );
  // Before signing a month the attester reads each source's finalized award:
  // commitMonthly counts only the identical award once and reverts the whole
  // month for any other, so the attester refuses to sign that month.
  {
    const monthly = {
      ...config,
      chain: "base",
      chainId: "31337",
      gasCeiling: "500000",
    };
    const leaf = {
      githubUserId: "123",
      grossMicro: "100000000",
      sourceDigest: source,
    };
    await assertEvmMonthlySources(monthly, [
      leaf,
      { ...leaf, sourceDigest: `0x${"3".padStart(64, "0")}` },
    ]);
    for (const other of [{ grossMicro: "99999999" }, { githubUserId: "124" }])
      await assert.rejects(
        assertEvmMonthlySources(monthly, [{ ...leaf, ...other }]),
      );
    // An award committed before fees rounded up (#1189) holds floor(gross / 50).
    // Award slots: [actorId | gross << 64, fee, ...] at keccak(id, 11).
    const base = BigInt(
      `0x${Buffer.from(
        keccak_256(
          Buffer.from(`${award.slice(2)}${"b".padStart(64, "0")}`, "hex"),
        ),
      ).toString("hex")}`,
    );
    const slot = (offset: bigint) =>
      `0x${(base + offset).toString(16).padStart(64, "0")}`;
    const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
    const setAward = async (gross: bigint, fee: bigint) => {
      await rpc("anvil_setStorageAt", [
        vault,
        slot(0n),
        word(123n | (gross << 64n)),
      ]);
      await rpc("anvil_setStorageAt", [vault, slot(1n), word(fee)]);
      await rpc("anvil_mine", ["0x40"]);
    };
    await setAward(100_000_049n, 2_000_000n);
    await assertEvmMonthlySources(monthly, [
      { ...leaf, grossMicro: "100000049" },
    ]);
    await setAward(100_000_049n, 1_999_999n);
    await assert.rejects(
      assertEvmMonthlySources(monthly, [{ ...leaf, grossMicro: "100000049" }]),
    );
    await setAward(100_000_000n, 2_000_000n);
    await assertEvmMonthlySources(monthly, [leaf]);
  }
  await assert.rejects(send(vault, "withdrawUnused(uint128)", ["100000001"]));
  await send(vault, "withdrawUnused(uint128)", ["100000000"]);
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
  const signed = secp256k1.sign(
    personalMessageHash(challenge.message),
    recipientKey,
    {
      prehash: false,
      format: "recovered",
    },
  );
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
  // The binding acceptance is checked against the current claim: a stranger's
  // signature and a signature over another version are both refused.
  // Browser consent discovers the finalized version without a contributor RPC or console.
  const discovered = await handlePaymentsApi(
    request("/wallets/bind-challenge", {
      claimId: "claim",
      network: "anvil",
      vault,
    }),
    {
      db,
      paymentDeployments,
      bindingVersion: async (network, address, actor) => {
        assert.equal(network, "anvil");
        assert.equal(address, vault.toLowerCase());
        return readEvmBindingVersion(config, actor);
      },
    },
  );
  assert.equal(discovered.status, 200);
  assert.equal(
    (
      (await discovered.json()) as {
        typedData: ReturnType<typeof evmBindingTypedData>;
      }
    ).typedData.message.expectedVersion,
    "0",
  );
  const bindChallenge = (await (
    await handlePaymentsApi(
      request("/wallets/bind-challenge", {
        claimId: "claim",
        network: "anvil",
        vault,
        expectedVersion: "0",
      }),
      { db, paymentDeployments },
    )
  ).json()) as { typedData: ReturnType<typeof evmBindingTypedData> };
  assert.ok(bindChallenge.typedData, JSON.stringify(bindChallenge));
  assert.equal(bindChallenge.typedData.message.destination, recipient);
  assert.equal(
    (
      await handlePaymentsApi(
        request("/wallets/bind-authorize", {
          claimId: "claim",
          network: "anvil",
          vault,
          expectedVersion: "0",
          expiresAt: bindChallenge.typedData.message.expiresAt,
          signature: await signBinding(
            mnemonicToAccount(
              "test test test test test test test test test test test junk",
              { addressIndex: 3 },
            ),
            bindChallenge.typedData,
          ),
        }),
        { db, paymentDeployments },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handlePaymentsApi(
        request("/wallets/bind-authorize", {
          claimId: "claim",
          network: "anvil",
          vault,
          expectedVersion: "1",
          expiresAt: bindChallenge.typedData.message.expiresAt,
          signature: await signBinding(
            recipientAccount,
            bindChallenge.typedData,
          ),
        }),
        { db, paymentDeployments },
      )
    ).status,
    403,
  );
  // Hosted preflight rules survive the family refactor: a record without a
  // gas ceiling, a mainnet registry network, and an unknown chain string are
  // each refused before any signer secret or RPC is touched.
  const preflightBase = {
    PAYMENT_DEPLOYMENTS: "",
    PAYMENT_RPC_URLS: JSON.stringify({ anvil: rpcUrl, "base-mainnet": rpcUrl }),
    ALLOW_LOCAL_TEST_CHAIN: true,
  };
  const preflightInput = {
    obligationId: award,
    network: "anvil",
    vault,
    githubUserId: "123",
    claimId: "claim",
    claimDigest: "0".repeat(64),
    destination: recipientAccount.address.toLowerCase(),
  };
  const { gasCeiling: _omitted, ...withoutCeiling } = {
    ...config,
    chain: "base",
    chainId: "31337",
    gasCeiling: "500000",
    scanPageBlocks: "2000",
  };
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...preflightBase,
        PAYMENT_DEPLOYMENTS: JSON.stringify([withoutCeiling]),
      },
      preflightInput,
    ),
  );
  // A mainnet whose MAINNET_EXECUTION value is off is refused by the
  // registry check. Base mainnet is on (24 October 2026 activation), so it
  // reaches the RPC chain check, which refuses this local chain.
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...preflightBase,
        PAYMENT_RPC_URLS: JSON.stringify({ ethereum: rpcUrl }),
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          {
            ...withoutCeiling,
            network: "ethereum",
            chain: "ethereum",
            chainId: "1",
            gasCeiling: "500000",
          },
        ]),
      },
      { ...preflightInput, network: "ethereum" },
    ),
  );
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...preflightBase,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          {
            ...withoutCeiling,
            network: "base-mainnet",
            chainId: "8453",
            gasCeiling: "500000",
          },
        ]),
      },
      { ...preflightInput, network: "base-mainnet" },
    ),
  );
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...preflightBase,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...withoutCeiling, chain: "evm", gasCeiling: "500000" },
        ]),
      },
      preflightInput,
    ),
  );
  // A registry network must carry the registry's chain id even under the
  // local override: naming base-sepolia with Anvil's 31337 is refused. (The
  // pre-refactor preflight accepted this combination; the narrowing is
  // deliberate and only reachable with ALLOW_LOCAL_TEST_CHAIN set.)
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...preflightBase,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...withoutCeiling, network: "base-sepolia", gasCeiling: "500000" },
        ]),
      },
      { ...preflightInput, network: "base-sepolia" },
    ),
  );
  // Without the contributor's acceptance the attester cannot bind at all.
  const unsignedAttester = createEvmAttester({
    PAYMENTS_DB: db,
    PAYMENT_DEPLOYMENTS: JSON.stringify([
      {
        ...config,
        chain: "base",
        chainId: "31337",
        gasCeiling: "500000",
        scanPageBlocks: "2000",
      },
    ]),
    PAYMENT_RPC_URLS: JSON.stringify({ anvil: rpcUrl }),
    ALLOW_LOCAL_TEST_CHAIN: true,
    SIGNER: mnemonicToAccount(
      "test test test test test test test test test test test junk",
      { addressIndex: 1 },
    ),
    JOURNAL: journal("unsigned-attester"),
  });
  sql
    .prepare(
      "INSERT INTO payment_attempts VALUES('needs-acceptance',?,'claim',?,NULL,'prepared')",
    )
    .run(award, now);
  await assert.rejects(
    unsignedAttester.submit({
      obligationId: award,
      network: "anvil",
      vault,
      githubUserId: "123",
      claimId: "claim",
      claimDigest,
      destination: recipient,
      idempotencyKey: "needs-acceptance",
    }),
  );
  sql.prepare("DELETE FROM payment_attempts WHERE id='needs-acceptance'").run();
  // The chain ID comes from the reviewed deployment: without the trusted
  // deployment list, or for a vault outside it, nothing is signed or stored.
  const bindAuthorize = (body: Record<string, string>) =>
    handlePaymentsApi(
      request("/wallets/bind-authorize", {
        claimId: "claim",
        network: "anvil",
        vault,
        expectedVersion: "0",
        ...body,
      }),
      { db, paymentDeployments },
    );
  assert.equal(
    (
      await handlePaymentsApi(
        request("/wallets/bind-challenge", {
          claimId: "claim",
          network: "anvil",
          vault,
          expectedVersion: "0",
        }),
        { db },
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await handlePaymentsApi(
        request("/wallets/bind-challenge", {
          claimId: "claim",
          network: "anvil",
          vault: fee,
          expectedVersion: "0",
        }),
        { db, paymentDeployments },
      )
    ).status,
    400,
  );
  const withExpiry = (expiresAt: number) => ({
    ...bindChallenge.typedData,
    message: {
      ...bindChallenge.typedData.message,
      expiresAt: String(expiresAt),
    },
  });
  const nowSeconds = Math.floor(Date.now() / 1000);
  // An authorization the attester could not submit in time is refused.
  const tooSoon = withExpiry(nowSeconds + 600);
  assert.equal(
    (
      await bindAuthorize({
        expiresAt: tooSoon.message.expiresAt,
        signature: await signBinding(recipientAccount, tooSoon),
      })
    ).status,
    400,
  );
  const short = withExpiry(nowSeconds + 3600);
  const shortSignature = await signBinding(recipientAccount, short);
  const recovery = Number.parseInt(shortSignature.slice(130), 16);
  // The same signature with a high s value: valid ECDSA, but the vault rejects it.
  const order =
    0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = `0x${shortSignature.slice(2, 66)}${(order - BigInt(`0x${shortSignature.slice(66, 130)}`)).toString(16).padStart(64, "0")}${(recovery === 27 ? 28 : 27).toString(16)}`;
  assert.equal(
    (
      await bindAuthorize({
        expiresAt: short.message.expiresAt,
        signature: highS,
      })
    ).status,
    403,
  );
  // A wallet that returns a recovery byte of 0 or 1 is accepted, and the row
  // stores the 27 or 28 encoding that bindDestination accepts.
  const zeroOne = `${shortSignature.slice(0, 130)}0${recovery - 27}`;
  assert.equal(
    (
      await bindAuthorize({
        expiresAt: short.message.expiresAt,
        signature: zeroOne,
      })
    ).status,
    200,
  );
  assert.equal(
    sql
      .query<{ signature: string }, [string]>(
        "SELECT signature FROM payment_binding_authorizations WHERE expires_at=?",
      )
      .get(short.message.expiresAt)?.signature,
    shortSignature.toLowerCase(),
  );
  // A renewal with a later expiry is a new row, not a silent no-op, so an
  // expired authorization can never block the claim and version.
  await authorizeBinding(db, "claim", vault, "0", recipientAccount);
  assert.equal(
    sql
      .query<{ n: number }, []>(
        "SELECT count(*) n FROM payment_binding_authorizations WHERE claim_id='claim' AND expected_version='0'",
      )
      .get()?.n,
    2,
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
    {
      ...config,
      chain: "base",
      chainId: "31337",
      gasCeiling: "500000",
      scanPageBlocks: "2000",
    },
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
  const attesterEngine = createEvmAttester({
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
    createEvmExecutor({
      ...shared,
      SIGNER: gasAccount,
      JOURNAL: gasJournal,
      ATTESTER: attesterEngine,
    });
  await assert.rejects(dispatchPayment(db, makeExecutor(), award, new Date()));
  const bindingAttempt = sql
    .query<{ id: string }, []>("SELECT id FROM payment_attempts LIMIT 1")
    .get();
  assert(bindingAttempt);
  const rejectedBinding = await attesterJournal.get<{ transactionId: string }>(
    `bind:${bindingAttempt.id}`,
  );
  assert(rejectedBinding);
  // A send response can precede Anvil mining. Include the revert in one
  // block before reading its receipt; it must still be below finality.
  await rpc("anvil_mine", ["0x1"]);
  const rejectedReceipt = (await rpc("eth_getTransactionReceipt", [
    rejectedBinding.transactionId,
  ])) as { status: string };
  assert.equal(rejectedReceipt.status, "0x0");
  await assert.rejects(dispatchPayment(db, makeExecutor(), award, new Date()));
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
  await assert.rejects(dispatchPayment(db, makeExecutor(), award, new Date()));
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
  // An award inside its commitment period never reaches payment signing.
  await assert.rejects(dispatchPayment(db, makeExecutor(), award, new Date()));
  await rpc("evm_increaseTime", [Number(delay)]);
  await rpc("anvil_mine", ["0x1"]);
  loseNextSend = true;
  await assert.rejects(dispatchPayment(db, makeExecutor(), award, new Date()));
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
    payments: { state: string; netBase: string }[];
    balances: { chain: string; network: string; netBase: string }[];
  };
  assert.equal(account.payments[0].state, "paid");
  assert.equal(account.payments[0].netBase, "98000000");
  // The cron stored every counter from the finalized block; the public route
  // serves that row without any chain RPC.
  const vaultRoute = (await (
    await handlePaymentsApi(
      new Request(
        "https://slop.cash/api/v1/payments/projects/integration-fixture/vault",
      ),
      { db },
    )
  ).json()) as { snapshots: Record<string, unknown>[] };
  assert.equal(vaultRoute.snapshots.length, 1);
  assert.deepEqual(
    {
      ...vaultRoute.snapshots[0],
      blockNumber: undefined,
      blockTime: undefined,
      observedAt: undefined,
    },
    {
      projectId: "integration-fixture",
      network: "anvil",
      chain: "base",
      vault,
      assetAddress: asset,
      assetDecimals: 6,
      totalDeposited: "200000000",
      totalPaid: "98000000",
      totalPayoutFees: "2000000",
      totalGrossWithdrawn: "100000000",
      totalWithdrawalFees: "2000000",
      freeBalance: "0",
      reservedPrincipal: "0",
      reservedFees: "0",
      accruedFees: "4000000",
      reserved: null,
      blockNumber: undefined,
      blockTime: undefined,
      observedAt: undefined,
    },
    "vault_snapshots holds the finalized counters after deposit, commit, withdraw and pay",
  );
  assert.equal(
    sql
      .query<{ asset_address: string; asset_decimals: number }, []>(
        "SELECT asset_address,asset_decimals FROM payment_obligations",
      )
      .get()?.asset_decimals,
    6,
    "The award carries the vault asset decimals",
  );
  assert.equal(account.balances.find((b) => b.chain === "base")?.netBase, "0");
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
  // 2 payout fee and the 2% fee on the 100 withdrawn.
  assert.equal(feeBalance.split(" ")[0], "4000000");
  const refundBalance = execFileSync(
    "cast",
    ["call", asset, "balanceOf(address)(uint256)", owner, "--rpc-url", rpcUrl],
    { encoding: "utf8" },
  ).trim();
  assert.equal(refundBalance.split(" ")[0], "98000000");
  // A later award follows an authenticated successor only without a wallet waiting period.
  const rotationAward = evmAwardId(31337n, vault, `0x${"a".padStart(64, "0")}`);
  await send(asset, "mint(address,uint256)", [owner, "100000000"]);
  await send(asset, "approve(address,uint256)", [vault, "100000000"]);
  await send(vault, "deposit(uint128)", ["100000000"]);
  await send(vault, "commitAward(bytes32,uint64,uint128,bytes32)", [
    rotationAward,
    "123",
    "100000000",
    `0x${"a".padStart(64, "0")}`,
  ]);
  await rpc("anvil_mine", ["0x40"]);
  await scan();
  // The award waits bindingDelay after its commit before any payment can be signed.
  await rpc("evm_increaseTime", [Number(delay)]);
  await rpc("anvil_mine", ["0x1"]);
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
  // The successor wallet accepts the next binding version itself.
  await authorizeBinding(db, "claim-next", vault, "1", successorAccount);
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
  await assert.rejects(inFlightOld);
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
  // A fresh signed successor binds immediately, with no host-clock advance.
  await assert.rejects(
    dispatchPayment(db, makeExecutor(), rotationAward, new Date()),
  );
  await rpc("anvil_mine", ["0x40"]);
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
  // Robinhood Chain Testnet pass on a second Anvil at chain id 46630. The
  // registry entry is a reviewed testnet, so the hosted preflight accepts a
  // record that names it with no local override, rejects a chain-id
  // mismatch, the mainnet entry and an RPC on the wrong chain, and carries
  // the registry gas ceiling. The same executor, attester, scanner and
  // ledger then pay one award there, recorded as chain = robinhood through
  // migration 0017.
  const rcChainId = "46630";
  const rcPort = localPort + 20;
  const rcRpcUrl = `http://127.0.0.1:${rcPort}`;
  const rcNode = spawn(
    "anvil",
    ["--port", String(rcPort), "--chain-id", rcChainId, "--silent"],
    { stdio: "ignore" },
  );
  rcAnvil = rcNode;
  let rcReady = false;
  for (let i = 0; i < 50; i++) {
    if (rcNode.exitCode !== null)
      throw new Error("Robinhood Chain Anvil startup failed");
    try {
      await rpc("eth_chainId", [], rcRpcUrl);
      rcReady = true;
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  assert(rcReady, "Robinhood Chain Anvil startup");
  assert.equal(
    BigInt((await rpc("eth_chainId", [], rcRpcUrl)) as string),
    46630n,
    "Second Anvil reports the Robinhood Chain Testnet chain id",
  );
  const rcAsset = deploy("integration/TestDollar.sol:TestDollar", [], rcRpcUrl);
  const rcFactory = deploy(
    "src/ProjectEscrow.sol:EscrowFactory",
    [owner, fee, attester, delay],
    rcRpcUrl,
  );
  const rcCreateTx = await send(
    rcFactory,
    "create(bytes32,address,uint8)",
    [projectKey, rcAsset, "0"],
    rcRpcUrl,
  );
  const rcVault = await factoryVault(rcFactory, rcAsset, rcRpcUrl);
  const rcSource = `0x${"7".padStart(64, "0")}`;
  const rcAward = evmAwardId(46630n, rcVault, rcSource);
  assert.notEqual(
    rcAward,
    evmAwardId(31337n, rcVault, rcSource),
    "The same vault address and source on another chain is another award",
  );
  const rcRuntimeCode = (await rpc(
    "eth_getCode",
    [rcVault, "latest"],
    rcRpcUrl,
  )) as string;
  const rcConfig = {
    evmUpgrade: await captureUpgrade(
      (method, params) => rpc(method, params, rcRpcUrl),
      rcFactory,
      rcVault,
    ),
    asset: rcAsset,
    owner,
    identityAuthority: attester,
    feeRecipient: fee,
    codeSha256: createHash("sha256")
      .update(Buffer.from(rcRuntimeCode.slice(2), "hex"))
      .digest("hex"),
    rpcUrl: rcRpcUrl,
    chainId: 46630n,
    vault: rcVault,
    bindingDelaySeconds: delay,
    factory: rcFactory,
    factoryCodeSha256: createHash("sha256")
      .update(
        Buffer.from(
          (
            (await rpc(
              "eth_getCode",
              [rcFactory, "latest"],
              rcRpcUrl,
            )) as string
          ).slice(2),
          "hex",
        ),
      )
      .digest("hex"),
    registrar: owner,
    // One settlement network per project (payment_project_network_locked), so
    // the second chain belongs to its own fixture project.
    projectId: "robinhood-fixture",
    network: "robinhood-testnet",
  };
  const rcDeployment = {
    ...rcConfig,
    chain: "robinhood",
    chainId: rcChainId,
    gasCeiling: "2000000",
    scanPageBlocks: "9000",
  };
  const rcEnv = {
    PAYMENT_DEPLOYMENTS: JSON.stringify([rcDeployment]),
    PAYMENT_RPC_URLS: JSON.stringify({
      "robinhood-testnet": rcRpcUrl,
      "robinhood-mainnet": rcRpcUrl,
    }),
  };
  const rcInput = {
    ...preflightInput,
    network: "robinhood-testnet",
    vault: rcVault,
    obligationId: rcAward,
  };
  // Preflight reads the vault at the finalized tag, so let the deployment finalize.
  await rpc("anvil_mine", ["0x40"], rcRpcUrl);
  const rcAccepted = await preflightEvmDeployment(rcEnv, rcInput);
  assert.equal(
    rcAccepted.gasCeiling,
    "2000000",
    "Registry gas ceiling travels with the Robinhood Chain record",
  );
  assert.equal(
    rcAccepted.chainId,
    "46630",
    "Preflight accepts the registry testnet chain id without a local override",
  );
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...rcEnv,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...rcDeployment, chainId: "4663" },
        ]),
      },
      rcInput,
    ),
  );
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...rcEnv,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...rcDeployment, network: "robinhood-mainnet", chainId: "4663" },
        ]),
      },
      { ...rcInput, network: "robinhood-mainnet" },
    ),
  );
  // Cross-labelled records: the registry network fixes the chain, so a
  // Robinhood Chain testnet record labelled `base`, or a Base Sepolia record
  // labelled `robinhood`, is refused before any secret or RPC use.
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...rcEnv,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...rcDeployment, chain: "base" },
        ]),
      },
      rcInput,
    ),
  );
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...rcEnv,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...rcDeployment, network: "base-sepolia", chainId: "84532" },
        ]),
        PAYMENT_RPC_URLS: JSON.stringify({ "base-sepolia": rcRpcUrl }),
      },
      { ...rcInput, network: "base-sepolia" },
    ),
  );
  // Wrong RPC chain: pointing the testnet record at the 31337 Anvil fails the chain-id readback.
  await assert.rejects(
    preflightEvmDeployment(
      {
        ...rcEnv,
        PAYMENT_RPC_URLS: JSON.stringify({ "robinhood-testnet": rpcUrl }),
      },
      rcInput,
    ),
  );
  // Review Focus 2: the same user and the same address bytes get a separate
  // Robinhood Chain claim; the Base lineage (claim, then claim-next) is untouched.
  sql
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES('claim-rc','123','alice',?,'d1_registry',?,?,?,?,'robinhood')",
    )
    .run(successorAccount.address, "a".repeat(64), now, "f".repeat(64), now);
  const rcChallenge = (await (
    await handlePaymentsApi(
      request("/wallets/challenge", { claimId: "claim-rc" }),
      { db },
    )
  ).json()) as { message: string; challengeId: string; chain: string };
  assert.equal(rcChallenge.chain, "robinhood");
  assert.equal(
    (
      await handlePaymentsApi(
        request("/wallets/authorize", {
          claimId: "claim-rc",
          challengeId: rcChallenge.challengeId,
          signature: await successorAccount.signMessage({
            message: rcChallenge.message,
          }),
        }),
        { db },
      )
    ).status,
    200,
    "A Robinhood Chain wallet claim is authorized by its own signature",
  );
  // The account API trusts only reviewed deployment records, and a registry
  // network fixes each record's chain and chain id. A mislabelled record is
  // never used to build binding consent.
  const rcIdentity = {
    network: "robinhood-testnet",
    chain: "robinhood",
    vault: rcVault,
    chainId: rcChainId,
  };
  const rcBindChallenge = (
    claimId: string,
    network: string,
    deployments: PaymentDeploymentIdentity[],
  ) =>
    handlePaymentsApi(
      request("/wallets/bind-challenge", {
        claimId,
        network,
        vault: rcVault,
        expectedVersion: "0",
      }),
      { db, paymentDeployments: deployments },
    );
  for (const [record, reason] of [
    [
      { ...rcIdentity, chain: "base" },
      "A robinhood-testnet record labelled chain base is refused",
    ],
    [
      { ...rcIdentity, chainId: "31337" },
      "A robinhood-testnet record naming another chain id is refused",
    ],
    [
      { ...rcIdentity, chainId: "4663" },
      "A robinhood-testnet record naming the mainnet chain id is refused",
    ],
  ] as const) {
    const response = await rcBindChallenge("claim-rc", "robinhood-testnet", [
      record,
    ]);
    assert.equal(response.status, 400, reason);
    assert.deepEqual(await response.json(), { error: "unknown_deployment" });
  }
  assert.equal(
    (
      await rcBindChallenge("claim-rc", "unlisted-network", [
        { ...rcIdentity, network: "unlisted-network" },
      ])
    ).status,
    400,
    "An unregistered network is refused outside the local Anvil chain id",
  );
  paymentDeployments = [...paymentDeployments, rcIdentity];
  // The registry network also fixes the claim chain: the current Base claim
  // cannot yield Robinhood Chain binding consent.
  const currentBaseClaim = (
    sql
      .query<{ id: string }, []>(
        "SELECT w.id FROM wallet_claims w WHERE w.github_user_id='123' AND w.chain='base' AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
      )
      .get() as { id: string }
  ).id;
  assert.equal(
    (
      await rcBindChallenge(
        currentBaseClaim,
        "robinhood-testnet",
        paymentDeployments,
      )
    ).status,
    409,
    "A Base claim cannot sign Robinhood Chain binding consent",
  );
  await authorizeBinding(
    db,
    "claim-rc",
    rcVault,
    "0",
    successorAccount,
    "robinhood-testnet",
  );
  await send(rcAsset, "mint(address,uint256)", [owner, "100000000"], rcRpcUrl);
  await send(
    rcAsset,
    "approve(address,uint256)",
    [rcVault, "100000000"],
    rcRpcUrl,
  );
  await send(rcVault, "deposit(uint128)", ["100000000"], rcRpcUrl);
  await send(
    rcVault,
    "commitAward(bytes32,uint64,uint128,bytes32)",
    [rcAward, "123", "100000000", rcSource],
    rcRpcUrl,
  );
  await rpc("anvil_mine", ["0x40"], rcRpcUrl);
  const rcAdapter = evmPaymentAdapter(db, {
    ...rcConfig,
    chain: "robinhood",
  });
  const rcScan = async () => {
    await snapshotVault(db, rcConfig, "robinhood", rcRpcUrl);
    await scanEvmPayments(
      db,
      {
        ...rcDeployment,
        deploymentTransaction: rcCreateTx,
      },
      rcRpcUrl,
      async (event) => {
        await indexPaymentEvent(db, rcAdapter, event, new Date().toISOString());
      },
    );
  };
  await rcScan();
  assert.equal(
    (
      sql
        .query<{ chain: string }, [string]>(
          "SELECT chain FROM payment_obligations WHERE id=?",
        )
        .get(rcAward) as { chain: string }
    ).chain,
    "robinhood",
    "Ledger records the Robinhood Chain obligation under its own chain",
  );
  const readAccount = async () =>
    (await (await handlePaymentsApi(request("/me"), { db })).json()) as {
      wallets: { chain: string; claimId: string; address: string }[];
      payments: {
        id: string;
        chain: string;
        state: string;
        netBase: string;
      }[];
      balances: { chain: string; network: string; netBase: string }[];
    };
  const rcReserved = await readAccount();
  assert.equal(
    rcReserved.balances.find((b) => b.chain === "robinhood")?.netBase,
    "98000000",
    "The reserved Robinhood Chain award shows its net before payment",
  );
  assert.deepEqual(
    rcReserved.balances
      .filter((b) => b.chain === "robinhood")
      .map((b) => b.network),
    ["robinhood-testnet"],
    "Balances are reported per network, never summed across assets",
  );
  assert.equal(
    rcReserved.balances.find((b) => b.chain === "base")?.netBase,
    "0",
    "Base balance is unaffected by the Robinhood Chain reservation",
  );
  // The hosted attester and executor, with no local override, bind and pay on 46630.
  const rcShared = { PAYMENTS_DB: db, ...rcEnv };
  const rcAttester = createEvmAttester({
    ...rcShared,
    SIGNER: attesterAccount,
    JOURNAL: journal("rc-attester"),
  });
  const rcRelayerJournal = journal("rc-relayer");
  const rcExecutor = () =>
    createEvmExecutor({
      ...rcShared,
      SIGNER: gasAccount,
      JOURNAL: rcRelayerJournal,
      ATTESTER: rcAttester,
    });
  await assert.rejects(dispatchPayment(db, rcExecutor(), rcAward, new Date()));
  await rpc("anvil_mine", ["0x40"], rcRpcUrl);
  await assert.rejects(dispatchPayment(db, rcExecutor(), rcAward, new Date()));
  await rpc("evm_increaseTime", [Number(delay)], rcRpcUrl);
  await rpc("anvil_mine", ["0x1"], rcRpcUrl);
  assert.equal(
    await dispatchPayment(db, rcExecutor(), rcAward, new Date()),
    "submitted",
  );
  await rpc("anvil_mine", ["0x40"], rcRpcUrl);
  await rcScan();
  const rcPaid = await readAccount();
  assert.equal(
    rcPaid.payments.find((p) => p.id === rcAward)?.state,
    "paid",
    "The Robinhood Chain award is paid from finalized evidence",
  );
  assert.equal(
    rcPaid.balances.find((b) => b.chain === "robinhood")?.netBase,
    "0",
    "Nothing stays reserved on Robinhood Chain after payment",
  );
  assert.equal(
    rcPaid.wallets.filter((w) => w.chain === "base").length,
    1,
    "One current Base wallet",
  );
  assert.equal(
    rcPaid.wallets.filter((w) => w.chain === "robinhood").length,
    1,
    "One current Robinhood Chain wallet",
  );
  const baseWallet = rcPaid.wallets.find((w) => w.chain === "base");
  const rcWallet = rcPaid.wallets.find((w) => w.chain === "robinhood");
  assert.equal(
    baseWallet?.address.toLowerCase(),
    rcWallet?.address.toLowerCase(),
    "Both lineages hold the same address bytes",
  );
  assert.notEqual(
    baseWallet?.claimId,
    rcWallet?.claimId,
    "The Base claim is not a Robinhood Chain wallet and the reverse",
  );
  const rcBalance = execFileSync(
    "cast",
    [
      "call",
      rcAsset,
      "balanceOf(address)(uint256)",
      successorAccount.address,
      "--rpc-url",
      rcRpcUrl,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(
    rcBalance.split(" ")[0],
    "98000000",
    "The Robinhood Chain payment lands net of the 2% fee",
  );
  if (process.argv.includes("--serve")) {
    const browserAward = evmAwardId(
      31337n,
      vault,
      `0x${"5".padStart(64, "0")}`,
    );
    await send(asset, "mint(address,uint256)", [owner, "100000000"]);
    await send(asset, "approve(address,uint256)", [vault, "100000000"]);
    await send(vault, "deposit(uint128)", ["100000000"]);
    const browserReserve = await send(
      vault,
      "commitAward(bytes32,uint64,uint128,bytes32)",
      [browserAward, "456", "100000000", `0x${"5".padStart(64, "0")}`],
    );
    await rpc("anvil_mine", ["0x40"]);
    // As the cron does: refresh the finalized vault totals, then index.
    await snapshotVault(db, config, "base", rpcUrl);
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
              const acceptance: BindingInput = {
                githubUserId: input.githubUserId,
                destination: input.destination,
                expectedVersion: "0",
                claimDigest: `0x${input.claimDigest}`,
                expiresAt: String(Number(BigInt(latest.timestamp)) + 3600),
              };
              // The fixture wallet (key 1) accepts the binding, as the page would.
              const accepted = secp256k1.sign(
                Uint8Array.from(
                  evmBindingDigest(31337n, vault, acceptance)
                    .slice(2)
                    .match(/../g) ?? [],
                  (b) => Number.parseInt(b, 16),
                ),
                recipientKey,
                { prehash: false, format: "recovered" },
              );
              const bindingTx = (await rpc("eth_sendTransaction", [
                {
                  from: attester,
                  to: vault,
                  gas: "0x7a1200",
                  data: buildBindCalldata({
                    ...acceptance,
                    walletSignature: `0x${Array.from(accepted.slice(1), (b) => b.toString(16).padStart(2, "0")).join("")}${(accepted[0] + 27).toString(16)}`,
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
          await snapshotVault(db, config, "base", rpcUrl);
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
        if (url.pathname === "/api/v1/referrals/me") {
          const headers = new Headers(incoming.headers);
          headers.set("cookie", `__Host-slop_points=${browserSession}`);
          const result = await handleReferralClaims(
            new Request(`https://slop.cash${url.pathname}`, {
              method: incoming.method,
              headers,
            }),
            {
              db,
              sessionActor: (request) =>
                sessionGithubActor(request, db, new Date().toISOString()),
              now: () => new Date(),
            },
          );
          assert(result, "The referral claim route must be handled");
          return result;
        }
        if (url.pathname === "/api/v1/points/me")
          return Response.json({
            actor: { id: "browser-node", login: "browser-fixture" },
            public: false,
            welcome: 0,
          });
        // Account-only panels use explicit fixture data; payment routes below
        // still execute their real handlers against SQLite and Anvil.
        if (url.pathname === "/api/v1/project-session")
          return Response.json({
            session: {
              githubId: "456",
              githubLogin: "browser-fixture",
              admin: false,
            },
          });
        if (url.pathname === "/api/v1/project-appeals")
          return Response.json({ appeals: [] });
        if (url.pathname === "/api/v1/points/sessions")
          return Response.json({
            sessions: [
              {
                id: (await sha256Hex(browserSession)).slice(0, 24),
                current: true,
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
              },
            ],
          });
        if (url.pathname === "/api/v1/points/x/me")
          return Response.json({
            configured: false,
            account: null,
            award: null,
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
        rcAnvil?.kill("SIGTERM");
        sql.close();
        process.exit(0);
      });
    await new Promise(() => {});
  }
  console.log(
    "Local EVM workflow passed (Base on 31337, Robinhood Chain Testnet on 46630): escrow, signed consent, separate signed execution, durable ambiguous-send recovery, finalized binding retry, finalized scanner replay, safe unsigned retirement, immediate successor rotation, exact net balances; Robinhood Chain Testnet registry preflight (chain id, mainnet and wrong-RPC refusals, 2,000,000 gas ceiling), chain = robinhood ledger, separate wallet lineages, binding chain id and claim chain guards, cross-labelled record refusals, per-network balances, and a paid award.",
  );
} finally {
  sql.close();
  faultProxy?.stop(true);
  for (const database of journalHandles) database.close();
  rmSync(journalDirectory, { recursive: true, force: true });
  anvil.kill("SIGTERM");
  rcAnvil?.kill("SIGTERM");
}
