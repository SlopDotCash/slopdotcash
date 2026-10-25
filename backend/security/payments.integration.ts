/** Synthetic SEC-12 workflow on an actual local EVM chain and migrated database.
 * No public RPC, real wallet, live award, or payment signer is used. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildBindCalldata,
  evmAwardId,
  evmBindingTypedData,
  evmVaultKey,
} from "../../contracts/evm/adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { paymentStack } from "../../workers/payment-executor/configure.mjs";
import {
  createEvmExecutor,
  type JournalStore,
} from "../../workers/payment-executor/core";
import attesterWorker, {
  PaymentSignerJournal,
} from "../../workers/payment-executor/index";
import {
  type PaymentDeployment,
  readDeploymentVaultTotals,
} from "../../workers/payments";
import { readMonthlySchedule } from "../../workers/payments/registry-database.mjs";
import { type DispatchPayment, dispatchPayment } from "../payments/dispatch";
import { evmPaymentAdapter } from "../payments/evm-adapter";
import { handlePaymentsApi } from "../payments/handler";
import { indexPaymentEvent } from "../payments/ledger";
import { storeVaultSnapshot } from "../payments/vault-snapshots";
import { handleSecurityApi } from "./handler";
import { securityPaymentDatabase } from "./payment-database";
import {
  securityLedgerPolicy,
  securityPaymentNotices,
  securitySettlementView,
} from "./payments";

const productionAttester = process.argv.includes("--production-attester");
const bindingGuard = process.argv.includes("--binding-guard");
const staleOnly = process.argv.includes("--stale-only");
assert(!staleOnly || bindingGuard);
const sharedScopes =
  productionAttester && !process.argv.includes("--private-only");
assert(!bindingGuard || sharedScopes, "Binding guard requires both scopes");
const network = productionAttester ? "base-mainnet" : "base-sepolia";
const chainId = productionAttester ? "8453" : "84532";
const bindingDelay = productionAttester ? "0" : "3600";
const port = Number(
  process.env.SLOP_SECURITY_ANVIL_PORT ?? (productionAttester ? 18559 : 18558),
);
assert(Number.isSafeInteger(port) && port > 1024 && port < 65536);
const rpcUrl = `http://127.0.0.1:${port}`;
const chain = spawn(
  "anvil",
  ["--port", String(port), "--chain-id", chainId, "--silent"],
  { stdio: "ignore" },
);
let dropAttesterBroadcast = false;
let droppedBindings = 0;
let dropVault: string | null = null;
const broadcastHashes: string[] = [];
let receiptFault: {
  transactionId: string;
  kind: "missing" | "wrong-block" | "wrong-transaction";
} | null = null;
const attesterProxy = productionAttester
  ? Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.text();
        const input = JSON.parse(body);
        if (input.method === "eth_sendRawTransaction") {
          broadcastHashes.push(digest(input.params[0]));
          if (
            dropAttesterBroadcast ||
            parseTransaction(input.params[0]).to?.toLowerCase() === dropVault
          ) {
            droppedBindings += 1;
            return new Response("Lost binding broadcast", { status: 502 });
          }
        }
        const fault =
          receiptFault &&
          input.method === "eth_getTransactionReceipt" &&
          input.params[0] === receiptFault.transactionId
            ? receiptFault
            : null;
        if (fault?.kind === "missing")
          return Response.json({ jsonrpc: "2.0", id: input.id, result: null });
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        if (
          fault?.kind === "wrong-block" ||
          fault?.kind === "wrong-transaction"
        ) {
          const value = await response.json();
          return Response.json({
            ...value,
            result: {
              ...value.result,
              [fault.kind === "wrong-block" ? "blockHash" : "transactionHash"]:
                `0x${"f".repeat(64)}`,
            },
          });
        }
        return response;
      },
    })
  : null;
const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const registrar = productionAttester
  ? "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"
  : owner;
const authority = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const fee = "0x0000000000000000000000000000000000000fee";
const wallet = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const technical = { githubId: "91001", githubLogin: "synthetic-security" };
const reporter = { githubId: "91002", githubLogin: "synthetic-reporter" };
const finance = { githubId: "91003", githubLogin: "synthetic-finance" };
const dispute = { githubId: "91004", githubLogin: "synthetic-dispute" };
const origin = "https://slop.test";
const { db: database, sqlite } = sqliteD1(
  readdirSync("migrations")
    .filter((p) => p.endsWith(".sql"))
    .sort(),
);
const privateDb = securityPaymentDatabase(database);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
async function rpc(method: string, params: unknown[]) {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const b = await r.json();
  if (b.error) throw new Error(JSON.stringify(b.error));
  return b.result;
}
async function send(
  to: string,
  signature: string,
  args: string[] = [],
  from = owner,
) {
  const data = execFileSync("cast", ["calldata", signature, ...args], {
    encoding: "utf8",
  }).trim();
  const tx = await rpc("eth_sendTransaction", [
    { from, to, data, gas: "0x7a1200" },
  ]);
  await rpc("anvil_mine", ["0x1"]);
  return tx as string;
}
function deploy(contract: string, args: string[] = []) {
  if (contract === "src/ProjectEscrow.sol:EscrowFactory" && args.length)
    return deployUpgradeableFactory(deploy, args);

  return JSON.parse(
    execFileSync(
      "forge",
      [
        "create",
        "--root",
        "contracts/evm",
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
  ).deployedTo as string;
}
const codeDigest = async (address: string) =>
  createHash("sha256")
    .update(
      Buffer.from(
        (await rpc("eth_getCode", [address, "latest"])).slice(2),
        "hex",
      ),
    )
    .digest("hex");
let serial = 0;
const received = new Date(Date.now() - 60_000).toISOString();
async function call(
  actor: typeof reporter,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await handleSecurityApi(
    new Request(`${origin}/api/v1/${path}`, {
      method,
      headers: { origin, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    {
      db: database,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
      sessionActor: async () => actor,
      github: { fetch, apiOrigin: "https://api.github.invalid" },
      // The synthetic private report that GitHub received from the reporter.
      advisories: {
        privateReports: async () => ({
          state: "ok" as const,
          reports: [
            {
              ghsa: "GHSA-2345-6789-cfgh",
              createdAt: received,
              state: "triage",
              author: reporter,
              summary: "Synthetic report",
              description: "Synthetic local funds-loss example.",
              severity: null,
              cweIds: [],
              packages: [],
            },
          ],
        }),
        privateReport: async () => ({ state: "unavailable" as const }),
      },
    },
  );
  assert(response);
  return { status: response.status, body: await response.json() };
}
async function act(
  actor: typeof reporter,
  id: string,
  action: string,
  fields: Record<string, unknown> = {},
) {
  const current = await call(actor, "GET", `security-cases/${id}`);
  return call(actor, "POST", `security-cases/${id}/actions`, {
    action,
    expectedRevision: current.body.case.revision,
    idempotencyKey: `synthetic-action-${++serial}`,
    ...fields,
  });
}
try {
  for (let i = 0; i < 80; i++) {
    try {
      await rpc("eth_chainId", []);
      break;
    } catch {
      await Bun.sleep(50);
    }
  }
  let token = deploy("integration/TestDollar.sol:TestDollar");
  if (productionAttester) {
    // Anvil-only TestDollar runtime at the registry stablecoin address. No
    // real USDC, fork, public RPC or production storage is used.
    const runtime = await rpc("eth_getCode", [token, "latest"]);
    token = ESCROW_NETWORKS[network].assets[0].address;
    await rpc("anvil_setCode", [token, runtime]);
  }
  const factory = deploy("src/ProjectEscrow.sol:EscrowFactory", [
    registrar,
    fee,
    authority,
    bindingDelay,
  ]);
  const projectKey = `0x${"9".repeat(64)}`;
  // Private bounties use the owner's separate bounty-purpose vault (purpose 1).
  const creation = await send(factory, "create(bytes32,address,uint8)", [
    projectKey,
    token,
    "1",
  ]);
  const vault = execFileSync(
    "cast",
    [
      "call",
      factory,
      "vaults(bytes32)(address)",
      evmVaultKey({
        owner,
        projectId: projectKey,
        asset: token,
        payoutPolicy: "security-bounty",
      }),
      "--rpc-url",
      rpcUrl,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .toLowerCase();
  const deployment = {
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
    network,
    vault,
    asset: token,
    owner,
    identityAuthority: authority,
    feeRecipient: fee,
    codeSha256: await codeDigest(vault),
    factory: factory.toLowerCase(),
    factoryCodeSha256: await codeDigest(factory),
    registrar,
    bindingDelaySeconds: bindingDelay,
    programId: null,
    projectPda: null,
    networkDomain: null,
    rotationDelaySeconds: null,
    upgradeAuthority: null,
    sourceCommit: "a".repeat(40),
    deploymentTransaction: creation,
  } satisfies EscrowDeployment;
  const ordinarySource = `0x${"6".repeat(64)}`;
  let ordinaryDeployment: EscrowDeployment | null = null;
  let ordinaryAwardId: string | null = null;
  if (sharedScopes) {
    const creation = await send(factory, "create(bytes32,address,uint8)", [
      projectKey,
      token,
      "0",
    ]);
    const vault = execFileSync(
      "cast",
      [
        "call",
        factory,
        "vaults(bytes32)(address)",
        evmVaultKey({ owner, projectId: projectKey, asset: token }),
        "--rpc-url",
        rpcUrl,
      ],
      { encoding: "utf8" },
    )
      .trim()
      .toLowerCase();
    ordinaryDeployment = {
      ...deployment,
      vault,
      deploymentTransaction: creation,
      evmUpgrade: await captureUpgrade(rpc, factory, vault),
      codeSha256: await codeDigest(vault),
    };
    ordinaryAwardId = evmAwardId(BigInt(chainId), vault, ordinarySource);
  }
  const program = {
    status: "open",
    intake: { repository: "synthetic/private" },
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "base",
      grossMinor: "100000000",
    },
    sponsor: { name: "Synthetic sponsor", githubId: null },
    funding: {
      state: "verified-available",
      evidence: "synthetic-local-vault-funding",
      verifiedAt: received,
    },
    capacity: { awards: 1, closesAt: null },
    responseTargets: { acknowledgeHours: 24 },
    approvers: {
      technical: [technical],
      financial: [finance],
      dispute: [dispute],
    },
    settlement: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "base",
      feeBasisPoints: 2500,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  };
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/projects/eliza.json", "utf8"),
  );
  const projectId = productionAttester ? fixture.id : "synthetic-private";
  const terms = productionAttester
    ? {
        ...program,
        version: "1",
        rewardMode: "separate",
        eligibility: "critical-loss-of-funds",
        split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
        intake: {
          kind: "github-private-vulnerability-reporting",
          repository: fixture.repositories[0].id,
        },
        capacity: {
          ...program.capacity,
          exhaustionRule:
            "Keep additional reports private without promising another award.",
        },
        responseTargets: {
          acknowledgeHours: 24,
          triageBusinessDays: 3,
          updateIntervalDays: 7,
        },
        scope: {
          sourceRevisions: [
            { repository: fixture.repositories[0].id, commit: "a".repeat(40) },
          ],
          deployments: [],
          includedAssets: ["Local test vault"],
          excludedDependencies: [],
          testingPermission: "Use only this isolated local test chain.",
          severityRubric:
            "Critical means a demonstrated potential loss of covered funds.",
          lossDefinition: "Unauthorized loss of covered test assets.",
        },
        dispute: {
          authority: "advisory",
          process:
            "A moderator decides escalated disputes after private triage.",
        },
        disclosure:
          "Require separate exact-content approval before any disclosure.",
        safeHarbor:
          "This local fixture authorizes no activity on a real deployment.",
      }
    : program;
  const manifestObject = productionAttester
    ? assertProjectDefinition({
        ...fixture,
        reward: {
          ...fixture.reward,
          chain: "base",
          ...(ordinaryDeployment ? { feeBasisPoints: 200 } : {}),
        },
        ...(ordinaryDeployment
          ? {
              escrow: {
                schemaVersion: "1",
                effectiveCycle: "2026-11",
                chain: "base",
                feeBasisPoints: 200,
                withdrawalFeeBasisPoints: 200,
                feeMode: "deduct-from-gross",
                deployments: [ordinaryDeployment],
              },
            }
          : {}),
        securityBounty: terms,
      })
    : { id: projectId, status: "active", securityBounty: terms };
  const manifest = JSON.stringify(manifestObject);
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'synthetic',?)",
    )
    .run(projectId, manifest, digest(manifest), received);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(projectId, manifest, digest(manifest), received, received);
  const imported = await call(technical, "POST", "security-cases", {
    mode: "import",
    projectId,
  });
  assert.deepEqual(imported.body, { state: "ok", received: 1 });
  const caseId = (
    sqlite
      .query("SELECT id FROM security_cases WHERE advisory_ghsa = ?")
      .get("GHSA-2345-6789-cfgh") as { id: string }
  ).id;
  assert.equal(
    (
      await act(technical, caseId, "decide", {
        outcome: "confirmed",
        severity: "critical",
        loss: "verified-potential",
        inScope: true,
        relatedParty: false,
        rootCauseKey: "synthetic-root",
        reason: "Synthetic local funds-loss example.",
        evidenceReference: "private-local-example",
        evidenceDigest: "d".repeat(64),
      })
    ).status,
    200,
  );
  const awardDecision = () =>
    act(technical, caseId, "award", {
      decision: "amount",
      grossMinor: "100000000",
      paymentDeadline: new Date(Date.now() + 86400000).toISOString(),
      confirmation: true,
      reason: "Synthetic owner award for the local example.",
    });
  // Owner decision D10: an empty vault without a finalized snapshot has no
  // funds to reserve, whatever the published terms say.
  assert.equal((await awardDecision()).body.error, "funds_unavailable");
  await send(token, "mint(address,uint256)", [owner, "100000000"]);
  await send(token, "approve(address,uint256)", [vault, "100000000"]);
  await send(vault, "deposit(uint128)", ["100000000"]);
  await rpc("anvil_mine", ["0x40"]);
  const config = {
    ...deployment,
    projectId,
    chain: "base" as const,
    chainId,
    payoutPolicy: "security-bounty" as const,
  };
  await storeVaultSnapshot(
    privateDb,
    { ...config, projectPda: undefined },
    await readDeploymentVaultTotals(
      config as unknown as PaymentDeployment,
      rpcUrl,
    ),
    new Date().toISOString(),
  );
  // The finalized free balance now covers it: the award reserves exactly
  // this gross amount.
  const awarded = await awardDecision();
  assert.equal(awarded.status, 200, JSON.stringify(awarded.body));
  const missingConsent = await act(finance, caseId, "prepare-payment", {
    network,
    confirmation: true,
  });
  assert.equal(missingConsent.body.error, "payment_consent_required");
  assert.equal(
    (
      await act(reporter, caseId, "consent-payment", {
        network,
        confirmation: true,
      })
    ).status,
    200,
  );
  const prepared = await act(technical, caseId, "prepare-payment", {
    network,
    confirmation: true,
  });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const plan = await securitySettlementView(database, caseId);
  assert(plan?.ownerRequest);
  assert.equal(plan.netBase, "75000000");
  assert.equal(plan.feeBase, "25000000");
  const tx = await rpc("eth_sendTransaction", [
    { ...plan.ownerRequest, network: undefined, gas: "0x7a1200" },
  ]);
  await rpc("anvil_mine", ["0x40"]);
  if (ordinaryDeployment) {
    await send(token, "mint(address,uint256)", [owner, "1000000"]);
    await send(token, "approve(address,uint256)", [
      ordinaryDeployment.vault,
      "1000000",
    ]);
    await send(ordinaryDeployment.vault, "deposit(uint128)", ["1000000"]);
    await send(
      ordinaryDeployment.vault,
      "commitAward(bytes32,uint64,uint128,bytes32)",
      [ordinaryAwardId as string, reporter.githubId, "1000000", ordinarySource],
    );
    await rpc("anvil_mine", ["0x40"]);
  }
  sqlite.exec(
    "CREATE TABLE signer_journal(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  const journal: JournalStore = {
    async get<T>(key: string) {
      const row = sqlite
        .query<{ value: string }, [string]>(
          "SELECT value FROM signer_journal WHERE key=?",
        )
        .get(key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async put<T>(key: string, value: T) {
      sqlite
        .query(
          "INSERT INTO signer_journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    async transaction<T>(callback: (store: JournalStore) => Promise<T>) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(journal);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const privateAttester = productionAttester
    ? await (async () => {
        const stack = paymentStack({
          stack: "production",
          scope: sharedScopes ? "security-bounty" : "ordinary",
          network,
          deployments: sharedScopes
            ? [
                {
                  ...paymentDeploymentRecord(projectId, deployment),
                  payoutPolicy: "security-bounty",
                },
              ]
            : [],
          registry: [manifestObject],
          monthlySchedule: await readMonthlySchedule(),
          registryDatabase: {
            database_name: "slop-private",
            database_id: "1b453124-2709-45af-8389-151a8105c461",
          },
        });
        const env = {
          ...stack.configs.attester.vars,
          PAYMENTS_DB: database,
          REGISTRY_DB: database,
          PAYMENT_RPC_URLS: JSON.stringify({
            [network]: attesterProxy
              ? `http://127.0.0.1:${attesterProxy.port}`
              : rpcUrl,
          }),
          SIGNER_PRIVATE_KEY:
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
          JOURNAL: { idFromName: (name: string) => name, get: () => signer },
        };
        let signer = new PaymentSignerJournal(
          { storage: journal },
          env as never,
        );
        return {
          get signer() {
            return signer;
          },
          restart: () => {
            signer = new PaymentSignerJournal(
              { storage: journal },
              env as never,
            );
          },
          scheduled: () => attesterWorker.scheduled(undefined, env as never),
        };
      })()
    : null;
  const adapter = evmPaymentAdapter(privateDb, {
    ...config,
    rpcUrl,
    chainId: BigInt(chainId),
  });
  const policy = securityLedgerPolicy(database);
  if (privateAttester) {
    await privateAttester.scheduled();
    assert.equal(
      await rpc("eth_getTransactionCount", [authority, "latest"]),
      "0x0",
      "No binding before wallet consent",
    );
  } else {
    await indexPaymentEvent(
      privateDb,
      adapter,
      {
        transactionId: tx,
        eventIndex: 0,
        kind: "reserved",
        obligationId: plan.obligationId,
      },
      new Date().toISOString(),
      policy,
    );
  }
  assert.equal(
    (await securitySettlementView(database, caseId))?.state,
    "needs-wallet",
  );
  assert.equal(
    sqlite
      .query<{ n: number }, []>("SELECT count(*) n FROM payment_obligations")
      .get()?.n,
    ordinaryDeployment ? 1 : 0,
  );
  // Register and prove the destination through the canonical account API,
  // then bind that same destination on chain with its EIP-712 signature.
  // Populate the canonical wallet through the account API below.
  const session = "s".repeat(43);
  const now = new Date().toISOString();
  sqlite
    .query(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
    )
    .run("U_private", reporter.githubId, reporter.githubLogin, now);
  sqlite
    .query(
      "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
    )
    .run(
      digest(session),
      "U_private",
      new Date(Date.now() + 3600000).toISOString(),
    );
  const accountCall = async (path: string, data?: unknown) => {
    const r = await handlePaymentsApi(
      new Request(`https://slop.cash/api/v1/payments/${path}`, {
        method: data ? "POST" : "GET",
        headers: {
          cookie: `__Host-slop_points=${session}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
      {
        db: database,
        paymentDeployments: [
          config,
          ...(ordinaryDeployment
            ? [paymentDeploymentRecord(projectId, ordinaryDeployment)]
            : []),
        ],
      },
    );
    return { status: r.status, body: await r.json() };
  };
  const registration = await accountCall("wallets/register", {
    chain: "base",
    address: wallet.address.toLowerCase(),
  });
  assert.equal(registration.status, 200, JSON.stringify(registration.body));
  const claimId = registration.body.claimId;
  const challenge = await accountCall("wallets/challenge", { claimId });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const signature = await wallet.signMessage({
    message: challenge.body.message,
  });
  assert.equal(
    (
      await accountCall("wallets/authorize", {
        claimId,
        challengeId: challenge.body.challengeId,
        signature,
      })
    ).status,
    200,
  );
  const claimRow = sqlite
    .query("SELECT record_sha256 FROM wallet_claims WHERE id=?")
    .get(claimId) as { record_sha256: string };
  const binding = {
    githubUserId: reporter.githubId,
    destination: wallet.address,
    expectedVersion: "0",
    claimDigest: `0x${claimRow.record_sha256}`,
    expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
  };
  const walletSignature = await wallet.signTypedData(
    evmBindingTypedData(
      BigInt(chainId),
      vault,
      binding,
    ) as unknown as Parameters<typeof wallet.signTypedData>[0],
  );
  if (privateAttester) {
    const challenge = await accountCall("wallets/bind-challenge", {
      claimId,
      network,
      vault,
      expectedVersion: "0",
    });
    assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    const consent = challenge.body.typedData;
    const authorized = await accountCall("wallets/bind-authorize", {
      claimId,
      network,
      vault,
      expectedVersion: "0",
      expiresAt: consent.message.expiresAt,
      signature: await wallet.signTypedData(consent),
    });
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
    if (ordinaryDeployment) {
      const ordinaryChallenge = await accountCall("wallets/bind-challenge", {
        claimId,
        network,
        vault: ordinaryDeployment.vault,
        expectedVersion: "0",
      });
      // The account API receives both canonical scopes, as Pages supplies them.
      assert.equal(
        ordinaryChallenge.status,
        200,
        JSON.stringify(ordinaryChallenge.body),
      );
      const ordinaryConsent = ordinaryChallenge.body.typedData;
      const ordinaryAuthorization = await accountCall(
        "wallets/bind-authorize",
        {
          claimId,
          network,
          vault: ordinaryDeployment.vault,
          expectedVersion: "0",
          expiresAt: ordinaryConsent.message.expiresAt,
          signature: await wallet.signTypedData(ordinaryConsent),
        },
      );
      assert.equal(
        ordinaryAuthorization.status,
        200,
        JSON.stringify(ordinaryAuthorization.body),
      );
    }
    // Neither raw binding reaches the chain. The shared journal must still
    // allocate two different nonces to this factory's one identity key.
    dropAttesterBroadcast = true;
    await assert.rejects(privateAttester.scheduled(), AggregateError);
    const bindingCount = ordinaryDeployment ? 2 : 1;
    assert(droppedBindings >= bindingCount);
    assert.equal(
      await rpc("eth_getTransactionCount", [authority, "latest"]),
      "0x0",
    );
    assert.equal(
      await journal.get(`nonce:${chainId}:${authority}`),
      bindingCount,
    );
    if (bindingGuard) {
      assert(ordinaryDeployment);
      type Saved = { rawTransaction: `0x${string}`; transactionId: string };
      const attempts = () =>
        sqlite
          .query<{ key: string; value: string }, []>(
            "SELECT key,value FROM signer_journal WHERE key LIKE 'bind:stored:%' OR key LIKE 'security:bind:stored:%' ORDER BY key",
          )
          .all()
          .map((row) => ({
            key: row.key,
            ...(JSON.parse(row.value) as Saved),
          }));
      const saved = attempts();
      assert.equal(saved.length, 2);
      const privateAttempt = saved.find((entry) =>
        entry.key.startsWith("security:"),
      );
      assert(privateAttempt);
      const privateRaw = JSON.stringify(await journal.get(privateAttempt.key));
      const oldBroadcasts = () =>
        broadcastHashes.filter(
          (hash) => hash === digest(privateAttempt.rawTransaction),
        ).length;
      const privatePending = () =>
        journal.get<string[]>("security:pending-stored-bindings");
      const nonce = async () =>
        Number(
          BigInt(await rpc("eth_getTransactionCount", [authority, "latest"])),
        );
      const scopeReport = async (scope: "ordinary" | "private") => {
        const response = await privateAttester.signer.fetch(
          new Request(
            `https://attester.internal/v1/${scope === "private" ? "security/" : ""}bind-destinations`,
            { method: "POST" },
          ),
        );
        assert.equal(response.status, 200);
        return response.json();
      };
      const unchanged = async () => {
        assert.equal(
          JSON.stringify(await journal.get(privateAttempt.key)),
          privateRaw,
        );
        assert.deepEqual(await privatePending(), [
          privateAttempt.key.slice("security:".length),
        ]);
      };
      // Land the ordinary binding first. Its later reconciliation is valid
      // even though actor+chain-wide wallet succession affects both scopes.
      dropAttesterBroadcast = false;
      dropVault = vault.toLowerCase();
      await assert.rejects(privateAttester.scheduled(), AggregateError);
      await rpc("anvil_mine", ["0x40"]);
      await assert.rejects(privateAttester.scheduled(), AggregateError);
      assert.equal(await nonce(), 1);
      assert.deepEqual(await journal.get("pending-stored-bindings"), []);
      await unchanged();
      privateAttester.restart();
      await assert.rejects(privateAttester.scheduled(), AggregateError);
      assert.deepEqual(attempts(), saved);

      if (!staleOnly) {
        // The account appends renewed consent, but the saved transaction must
        // still use its original exact signature and expiry.
        const renewed = {
          ...consent,
          message: {
            ...consent.message,
            expiresAt: String(Number(consent.message.expiresAt) + 3600),
          },
        };
        const renewal = await accountCall("wallets/bind-authorize", {
          claimId,
          network,
          vault,
          expectedVersion: "0",
          expiresAt: renewed.message.expiresAt,
          signature: await wallet.signTypedData(renewed),
        });
        assert.equal(renewal.status, 200, JSON.stringify(renewal.body));
        await assert.rejects(privateAttester.scheduled(), AggregateError);
        await unchanged();
        assert.equal(attempts().length, 2);
        const originalNow = Date.now;
        const expirySnapshot = await rpc("evm_snapshot", []);
        const expiredAt = Number(consent.message.expiresAt) + 1;
        const beforeExpired = oldBroadcasts();
        try {
          await rpc("evm_setNextBlockTimestamp", [expiredAt]);
          await rpc("anvil_mine", ["0x40"]);
          Date.now = () => expiredAt * 1000;
          dropVault = null;
          privateAttester.restart();
          let expiryRefused = false;
          try {
            await privateAttester.scheduled();
          } catch (error) {
            assert(error instanceof AggregateError);
            expiryRefused = true;
          }
          console.log(
            JSON.stringify({
              observation: "original-private-consent-expired",
              refused: expiryRefused,
              oldBroadcastsBefore: beforeExpired,
              oldBroadcastsAfter: oldBroadcasts(),
              chainNonce: await nonce(),
              journalNonce: await journal.get(`nonce:${chainId}:${authority}`),
            }),
          );
          assert.equal(expiryRefused, true);
          assert.equal(oldBroadcasts(), beforeExpired);
          assert.equal(await nonce(), 1);
          await unchanged();
        } finally {
          Date.now = originalNow;
          assert.equal(await rpc("evm_revert", [expirySnapshot]), true);
        }
      }
      dropVault = null;
      // This chain-clock fault is rolled back only for the independent D1
      // successor case. No wallet history or journal row is rolled back.
      const successorWallet = privateKeyToAccount(`0x${"0".repeat(63)}2`);
      const successor = await accountCall("wallets/register", {
        chain: "base",
        address: successorWallet.address.toLowerCase(),
      });
      assert.equal(successor.status, 200, JSON.stringify(successor.body));
      assert.equal(
        sqlite
          .query<{ supersedes_claim_id: string }, [string]>(
            "SELECT supersedes_claim_id FROM wallet_claims WHERE id=?",
          )
          .get(successor.body.claimId)?.supersedes_claim_id,
        claimId,
      );
      const staleBroadcasts = oldBroadcasts();
      privateAttester.restart();
      let staleRefused = false;
      try {
        await privateAttester.scheduled();
      } catch (error) {
        assert(error instanceof AggregateError);
        staleRefused = true;
      }
      console.log(
        JSON.stringify({
          observation: "private-claim-superseded",
          refused: staleRefused,
          oldBroadcastsBefore: staleBroadcasts,
          oldBroadcastsAfter: oldBroadcasts(),
          chainNonce: await nonce(),
          journalNonce: await journal.get(`nonce:${chainId}:${authority}`),
          oldReceipt:
            (
              await rpc("eth_getTransactionReceipt", [
                privateAttempt.transactionId,
              ])
            )?.status ?? null,
        }),
      );
      assert.equal(staleRefused, true);
      assert.equal(oldBroadcasts(), staleBroadcasts);
      assert.equal(
        await rpc("eth_getTransactionByHash", [privateAttempt.transactionId]),
        null,
      );
      assert.equal(await nonce(), 1);
      await unchanged();

      // A current ordinary authorization may be signed at nonce2, but the
      // obsolete private nonce1 still prevents it from landing. Preserve
      // that honest shared-nonce hold; no cancellation or replacement exists.
      const successorChallenge = await accountCall("wallets/challenge", {
        claimId: successor.body.claimId,
      });
      assert.equal(successorChallenge.status, 200);
      const successorAuthorization = await accountCall("wallets/authorize", {
        claimId: successor.body.claimId,
        challengeId: successorChallenge.body.challengeId,
        signature: await successorWallet.signMessage({
          message: successorChallenge.body.message,
        }),
      });
      assert.equal(successorAuthorization.status, 200);
      const ordinaryChallenge = await accountCall("wallets/bind-challenge", {
        claimId: successor.body.claimId,
        network,
        vault: ordinaryDeployment.vault,
        expectedVersion: "1",
      });
      assert.equal(ordinaryChallenge.status, 200);
      const ordinaryRenewal = await accountCall("wallets/bind-authorize", {
        claimId: successor.body.claimId,
        network,
        vault: ordinaryDeployment.vault,
        expectedVersion: "1",
        expiresAt: ordinaryChallenge.body.typedData.message.expiresAt,
        signature: await successorWallet.signTypedData(
          ordinaryChallenge.body.typedData,
        ),
      });
      assert.equal(ordinaryRenewal.status, 200);
      await assert.rejects(privateAttester.scheduled(), AggregateError);
      const successorAttempt = attempts().find(
        (entry) => !saved.some((prior) => prior.key === entry.key),
      );
      assert(successorAttempt && !successorAttempt.key.startsWith("security:"));
      assert.equal(parseTransaction(successorAttempt.rawTransaction).nonce, 2);
      assert.equal(await journal.get(`nonce:${chainId}:${authority}`), 3);
      assert.equal(await nonce(), 1);
      assert.equal(
        await rpc("eth_getTransactionReceipt", [
          successorAttempt.transactionId,
        ]),
        null,
      );
      const queuedOrdinary = await rpc("eth_getTransactionByHash", [
        successorAttempt.transactionId,
      ]);
      assert(queuedOrdinary);
      assert.equal(queuedOrdinary.blockNumber, null);
      assert.equal(queuedOrdinary.from.toLowerCase(), authority);
      assert.equal(
        queuedOrdinary.to.toLowerCase(),
        ordinaryDeployment.vault.toLowerCase(),
      );
      const successorRaw = JSON.stringify(
        await journal.get(successorAttempt.key),
      );
      privateAttester.restart();
      await assert.rejects(privateAttester.scheduled(), AggregateError);
      assert.equal(oldBroadcasts(), staleBroadcasts);
      assert.equal(attempts().length, 3);
      assert.equal(
        JSON.stringify(await journal.get(successorAttempt.key)),
        successorRaw,
      );
      await unchanged();
      const heldReport = await scopeReport("private");
      assert(heldReport.failed > 0);
      assert.deepEqual(heldReport.submitted, []);

      // Model late delivery of already-signed bytes directly to local Anvil.
      // The service itself never rebroadcasts this obsolete authorization.
      assert.equal(
        await rpc("eth_sendRawTransaction", [privateAttempt.rawTransaction]),
        privateAttempt.transactionId,
      );
      await rpc("anvil_mine", ["0x1"]);
      receiptFault = {
        transactionId: privateAttempt.transactionId,
        kind: "missing",
      };
      assert((await scopeReport("private")).failed > 0);
      await unchanged();
      receiptFault = null;
      const realReceipt = await rpc("eth_getTransactionReceipt", [
        privateAttempt.transactionId,
      ]);
      assert.equal(realReceipt.status, "0x1");
      const earlyFinalized = await rpc("eth_getBlockByNumber", [
        "finalized",
        false,
      ]);
      assert(BigInt(realReceipt.blockNumber) > BigInt(earlyFinalized.number));
      assert.equal((await scopeReport("private")).failed, 0);
      await unchanged();
      await rpc("anvil_mine", ["0x40"]);
      receiptFault = {
        transactionId: privateAttempt.transactionId,
        kind: "wrong-block",
      };
      assert((await scopeReport("private")).failed > 0);
      await unchanged();
      receiptFault = {
        transactionId: privateAttempt.transactionId,
        kind: "wrong-transaction",
      };
      assert((await scopeReport("private")).failed > 0);
      await unchanged();
      receiptFault = null;
      privateAttester.restart();
      await privateAttester.scheduled();
      await privateAttester.scheduled();
      assert.deepEqual(await privatePending(), []);
      assert.deepEqual(await journal.get("pending-stored-bindings"), []);
      assert.equal(
        JSON.stringify(await journal.get(privateAttempt.key)),
        privateRaw,
      );
      assert.equal(oldBroadcasts(), staleBroadcasts);
      assert.equal(await nonce(), 3);
      assert.equal(attempts().length, 3);
      const totals = await readDeploymentVaultTotals(
        config as unknown as PaymentDeployment,
        rpcUrl,
      );
      assert.equal(totals.reservedPrincipal, "75000000");
      assert.equal(totals.reservedFees, "25000000");
      assert.equal(totals.accruedFees, "0");
      assert.equal(
        sqlite
          .query<{ n: number }, []>(
            "SELECT count(*) n FROM security_payment_events WHERE kind='paid'",
          )
          .get()?.n,
        0,
      );
      const publicPayments = (await accountCall("me")).body.payments;
      assert.deepEqual(
        publicPayments.map((payment: { id: string }) => payment.id),
        [ordinaryAwardId],
      );
      console.log(
        JSON.stringify({
          proof: "private-binding-current-claim",
          result: "passed",
          privateTransaction: privateAttempt.transactionId,
          ordinarySuccessor: successorAttempt.transactionId,
          attempts: 3,
          chainNonce: 3,
          heldNonceBeforeDelayedDelivery: 1,
          privateGrossStillReserved: (
            BigInt(totals.reservedPrincipal) + BigInt(totals.reservedFees)
          ).toString(),
          originalConsentExpiryRefused: !staleOnly,
          renewedConsentDidNotReplaceRaw: !staleOnly,
          missingWrongNonfinalReceiptHeld: true,
          finalReceiptReconciledWithoutResend: true,
          cancellationOrReplacement: false,
        }),
      );
    } else {
      dropAttesterBroadcast = false;
      await privateAttester.scheduled();
      await rpc("anvil_mine", ["0x40"]);
      await privateAttester.scheduled();
      assert.equal(
        await rpc("eth_getTransactionCount", [authority, "latest"]),
        `0x${bindingCount.toString(16)}`,
        "One binding per scope after uncertain sends and replay",
      );
    }
    // The attester never submits either an award payment or a monthly allocation.
    for (const path of [
      "/v1/pay",
      "/v1/commit-monthly",
      "/v1/monthly-authorization",
    ]) {
      const refused = await privateAttester.signer.fetch(
        new Request(`https://attester.internal/v1/security/${path.slice(4)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            network,
            vault,
            obligationId: plan.obligationId,
          }),
        }),
      );
      assert.equal(refused.status, 404, path);
    }
    assert.equal(
      sqlite
        .query<{ n: number }, []>("SELECT count(*) n FROM payment_obligations")
        .get()?.n,
      ordinaryDeployment ? 1 : 0,
    );
    assert.equal(
      sqlite
        .query<{ n: number }, []>("SELECT count(*) n FROM monthly_payment_runs")
        .get()?.n,
      0,
    );
  } else {
    await rpc("eth_sendTransaction", [
      {
        from: authority,
        to: vault,
        gas: "0x7a1200",
        data: buildBindCalldata({ ...binding, walletSignature }),
      },
    ]);
    await rpc("evm_increaseTime", [3601]);
    await rpc("anvil_mine", ["0x40"]);
  }
  if (!bindingGuard) {
    await privateDb
      .prepare(
        "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
      )
      .bind(plan.obligationId, new Date().toISOString())
      .run();
    await rpc("anvil_setBalance", [wallet.address, "0x56bc75e2d63100000"]);
    const makeExecutor = () =>
      createEvmExecutor({
        PAYMENTS_DB: privateDb,
        PAYMENT_DEPLOYMENTS: JSON.stringify([
          { ...config, gasCeiling: "500000" },
        ]),
        PAYMENT_RPC_URLS: JSON.stringify({ [network]: rpcUrl }),
        SIGNER: wallet,
        JOURNAL: journal,
      });
    let sent: string | undefined;
    let submittedInput:
      | (DispatchPayment & { idempotencyKey: string })
      | undefined;
    const execute = {
      submit: async (input: DispatchPayment & { idempotencyKey: string }) => {
        submittedInput = input;
        sent = (await makeExecutor().submit(input)).transactionId;
        throw new Error("Synthetic lost response after submission");
      },
    };
    await assert.rejects(
      dispatchPayment(
        privateDb,
        execute,
        plan.obligationId,
        new Date(),
        (id, at) => securityPaymentNotices(database, id, "held", at),
      ),
      /lost response/,
    );
    assert.equal(
      (await securitySettlementView(database, caseId))?.state,
      "uncertain",
    );
    assert(sent);
    assert(submittedInput);
    // Reconstruct the signer engine after a lost response. Its durable journal
    // returns the same signed transaction rather than paying a second time.
    assert.equal(
      (await makeExecutor().submit(submittedInput)).transactionId,
      sent,
    );
    assert.equal(
      sqlite
        .query<{ n: number }, []>(
          "SELECT count(*) n FROM signer_journal WHERE key LIKE 'pay:%'",
        )
        .get()?.n,
      1,
    );
    await rpc("anvil_mine", ["0x40"]);
    const paid = {
      transactionId: sent,
      eventIndex: 0,
      kind: "paid" as const,
      obligationId: plan.obligationId,
    };
    await indexPaymentEvent(
      privateDb,
      adapter,
      paid,
      new Date().toISOString(),
      policy,
    );
    await indexPaymentEvent(
      privateDb,
      adapter,
      paid,
      new Date().toISOString(),
      policy,
    );
    assert.equal(
      (await securitySettlementView(database, caseId))?.state,
      "paid",
    );
    assert.equal(
      sqlite
        .query<{ n: number }, []>(
          "SELECT count(*) n FROM security_payment_events WHERE kind='paid'",
        )
        .get()?.n,
      1,
    );
    const publicPayments = (await accountCall("me")).body.payments;
    assert.deepEqual(
      publicPayments.map((payment: { id: string }) => payment.id),
      ordinaryDeployment ? [ordinaryAwardId] : [],
    );
    const publicTotals = await accountCall(`projects/${projectId}/totals`);
    assert.equal(publicTotals.status, ordinaryDeployment ? 200 : 503);
    const ordinaryOutput = JSON.stringify({
      publicPayments,
      publicTotals: publicTotals.body,
    });
    assert(!ordinaryOutput.includes(vault));
    assert(!ordinaryOutput.includes(caseId));
    assert.equal(
      (await call(dispute, "GET", `security-cases/${caseId}`)).status,
      404,
    );
    const ordinaryNotices = sqlite
      .query<{ event_key: string }, []>(
        "SELECT event_key FROM notifications WHERE kind IN ('award_reserved','payment_paid','payout_held','payout_exception')",
      )
      .all();
    assert.equal(ordinaryNotices.length, ordinaryDeployment ? 1 : 0);
    for (const notice of ordinaryNotices) {
      assert(notice.event_key.includes(ordinaryAwardId as string));
      assert(!notice.event_key.includes(plan.obligationId));
    }
    const balance = execFileSync(
      "cast",
      [
        "call",
        token,
        "balanceOf(address)(uint256)",
        wallet.address,
        "--rpc-url",
        rpcUrl,
      ],
      { encoding: "utf8" },
    )
      .split(" ")[0]
      .trim();
    assert.equal(balance, "75000000");
    const finalTotals = await readDeploymentVaultTotals(
      config as unknown as PaymentDeployment,
      rpcUrl,
    );
    assert.equal(finalTotals.accruedFees, "25000000");
    assert.equal(finalTotals.reservedPrincipal, "0");
    const backupRoot = mkdtempSync(join(tmpdir(), "slop-private-restore-"));
    const backup = join(backupRoot, "private.sqlite");
    sqlite.query("VACUUM INTO ?").run(backup);
    const restored = sqliteD1([], backup);
    try {
      assert.equal(
        (await securitySettlementView(restored.db, caseId))?.state,
        "paid",
      );
      await indexPaymentEvent(
        securityPaymentDatabase(restored.db),
        adapter,
        paid,
        new Date().toISOString(),
        securityLedgerPolicy(restored.db),
      );
      assert.equal(
        restored.sqlite
          .query<{ n: number }, []>(
            "SELECT count(*) n FROM security_payment_events WHERE kind='paid'",
          )
          .get()?.n,
        1,
      );
      assert.equal(
        restored.sqlite
          .query<{ n: number }, []>(
            "SELECT count(*) n FROM payment_obligations",
          )
          .get()?.n,
        ordinaryDeployment ? 1 : 0,
      );
      assert.equal(
        restored.sqlite
          .query<{ n: number }, []>(
            "SELECT count(*) n FROM security_payment_consents",
          )
          .get()?.n,
        1,
      );
      assert.throws(
        () =>
          restored.sqlite
            .query("DELETE FROM security_settlements WHERE case_id=?")
            .run(caseId),
        /immutable|permanent/,
      );
    } finally {
      restored.sqlite.close();
      rmSync(backupRoot, { recursive: true });
    }

    console.log(
      `${productionAttester ? "Production attester on local Base: " : "Private bounty: "}real API approval and visibility consent, ${productionAttester ? `${sharedScopes ? "two scoped bindings with shared nonces" : "private-only release pins"} after lost broadcasts, ` : ""}finalized vault funding, unsigned owner commitment, late wallet possession, 75/25 payment, lost-response recovery, replay rejection, private notices, backup restore, and public-output isolation passed.`,
    );
  }
} finally {
  attesterProxy?.stop(true);
  chain.kill("SIGTERM");
  sqlite.close();
}
