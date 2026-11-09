// An owner who sets up an EVM vault must learn whether the chain was not read
// or a reviewed fact did not match. An RPC that answers HTTP 429 or refuses
// the connection is a retryable network failure; it is never a factory that
// "needs review" and never an invalid creation transaction (PRD sections 4
// and 7, issue #904). A real factory code mismatch keeps its refusal.
import { afterAll, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { toFunctionSelector } from "viem";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { ownerVaultSetupService } from "../backend/projects/vault-setup";
import { buildCreateVaultCalldata } from "../contracts/evm/adapter";
import type { ReviewedEvmFactory } from "../contracts/evm/factories";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { registryProjectDigest } from "../src/lib/vault-setup";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";

const NOW = "2026-10-27T00:00:00.000Z";
const OWNER = { githubId: "900000002", githubLogin: "owner" };
const OWNER_WALLET = "0x2000000000000000000000000000000000000002";
const CLAIM = "verified-owner-wallet";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const address = (digit: string) => `0x${digit.repeat(40)}`;
const word = (value: string) =>
  `0x${value.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
const codeSha256 = (code: string) =>
  createHash("sha256")
    .update(Buffer.from(code.slice(2), "hex"))
    .digest("hex");

// Chain facts that the local RPC serves for the reviewed factory below.
const code = {
  [address("5")]: "0x6080604052",
  [address("7")]: "0x60806040527f",
  [address("8")]: "0x608060405260",
};
const factory: ReviewedEvmFactory = {
  network: "base-mainnet",
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  codeSha256: "ab".repeat(32),
  bindingDelaySeconds: "0",
  identityAuthority: address("3"),
  feeRecipient: address("4"),
  factory: address("5"),
  factoryCodeSha256: codeSha256(code[address("5")]),
  registrar: address("6"),
  evmUpgrade: {
    authority: address("9"),
    vaultImplementation: address("7"),
    vaultImplementationCodeSha256: codeSha256(code[address("7")]),
    factoryImplementation: address("8"),
    factoryImplementationCodeSha256: codeSha256(code[address("8")]),
  },
};
const reviewedFactories = [factory];
const SECOND_FACTORY = address("b");
const CREATED_VAULT = address("a");
const CREATION_HASH = `0x${"ab".repeat(32)}`;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;
let creationData = "0x";
let creationStatus: "pending" | "failed" | "valid" = "valid";
let vaultGetters: Record<string, string> = {};
const creationMethods: string[] = [];
const getters = Object.fromEntries(
  Object.entries({
    "registrar()": factory.registrar,
    "feeRecipient()": factory.feeRecipient,
    "bindingDelay()": "0",
    "AUTHORITY_ROTATION_DELAY()": "0",
    "upgradeAuthority()": address("9"),
    "vaultImplementation()": address("7"),
    "identityAuthority()": factory.identityAuthority,
    // The owner's vault exists, so registration reaches the creation reads.
    "vaults(bytes32)": address("a"),
  }).map(([signature, value]) => [toFunctionSelector(signature), word(value)]),
);

// "limited": every read answers HTTP 429. "factory": the factory facts are
// served and every transaction, receipt and block read answers HTTP 429.
let mode: "limited" | "factory" | "creation" = "limited";
let reads = 0;
const rpc = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    reads++;
    const { method, params } = (await request.json()) as {
      method: string;
      params: [Record<string, string> | string, string];
    };
    const answer = (result: unknown) =>
      Response.json({ jsonrpc: "2.0", id: 1, result });
    if (mode === "creation") {
      creationMethods.push(method);
      if (method === "eth_getTransactionReceipt")
        return answer(
          creationStatus === "pending"
            ? null
            : {
                transactionHash: CREATION_HASH,
                blockNumber: "0x1",
                blockHash: BLOCK_HASH,
                status: creationStatus === "failed" ? "0x0" : "0x1",
              },
        );
      if (method === "eth_getTransactionByHash")
        return answer({
          hash: CREATION_HASH,
          from: OWNER_WALLET,
          to: SECOND_FACTORY,
          input: creationData,
          value: "0x0",
          blockHash: BLOCK_HASH,
        });
      if (method === "eth_getBlockByNumber")
        return answer({ number: "0x1", hash: BLOCK_HASH });
    }
    if (mode === "factory" || mode === "creation") {
      if (method === "eth_chainId") return answer("0x2105");
      if (method === "eth_getCode")
        return answer(code[String(params[0]).toLowerCase()] ?? "0x");
      if (method === "eth_getStorageAt" && params[1] === IMPLEMENTATION_SLOT)
        return answer(
          word(params[0] === CREATED_VAULT ? address("7") : address("8")),
        );
      if (method === "eth_call" && typeof params[0] === "object")
        return answer(
          (params[0].to?.toLowerCase() === CREATED_VAULT
            ? vaultGetters
            : getters)[params[0].data.slice(0, 10)] ?? "0x",
        );
    }
    return new Response("rate limited", { status: 429 });
  },
});
// A server that is stopped refuses the connection.
const closed = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(),
});
const closedUrl = `http://127.0.0.1:${closed.port}`;
closed.stop(true);
let rpcUrl = `http://127.0.0.1:${rpc.port}`;
afterAll(() => rpc.stop(true));

const { db, sqlite } = sqliteD1(
  readdirSync(new URL("../migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort(),
);
const manifest = applicationManifest("vault-network", "example/vault-network", {
  rewardAsset: {
    network: "base",
    kind: "stablecoin",
    address: ESCROW_NETWORKS["base-mainnet"].asset,
    symbol: "USDC",
    decimals: 6,
    chainId: ESCROW_NETWORKS["base-mainnet"].chainId,
    cluster: null,
    verifiedAt: NOW,
  },
  reward: {
    ...(applicationManifest("vault-network", "example/vault-network")
      .reward as Record<string, unknown>),
    chain: "base",
    feeBasisPoints: 200,
  },
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "base",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  },
});
const manifestText = JSON.stringify(manifest);
sqlite
  .prepare(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('vault-network',1,?,?,'Fixture',?)",
  )
  .run(manifestText, sha256Hex(manifestText), NOW);
sqlite
  .prepare(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('vault-network','paused',1,?,?,?,?)",
  )
  .run(manifestText, sha256Hex(manifestText), NOW, NOW);
// The owner's current Base wallet, confirmed by a signed challenge.
sqlite
  .prepare(
    "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,'base')",
  )
  .run(
    CLAIM,
    OWNER.githubId,
    OWNER.githubLogin,
    OWNER_WALLET,
    "a".repeat(64),
    NOW,
    "b".repeat(64),
    NOW,
  );
sqlite
  .prepare(
    "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES('challenge-1',?,?,'fixture',?,?)",
  )
  .run(CLAIM, OWNER.githubId, NOW, NOW);
sqlite
  .prepare(
    "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,'challenge-1','0x00')",
  )
  .run(CLAIM, OWNER.githubId, NOW);

const persistence = new CloudflareProjectPersistence(db);
const deps: ProjectApiDependencies = {
  persistence,
  adminGithubIds: new Set(),
  moderatorGithubIds: new Set(),
  now: () => new Date(NOW),
  randomId: () => crypto.randomUUID(),
  sessionActor: async () => OWNER,
  readTokenMetadata: async () => {
    throw new Error("No asset edit in this workflow");
  },
  github: {
    fetch: async () => {
      throw new Error("Unexpected public lookup");
    },
  },
  vettingClearance: async () => ({ state: "unscanned" }),
  repositoryControl: async () => ({ state: "matched" }),
  repositoryAccess: async () => ({
    installation: "installed",
    installationId: 42,
    permission: "admin",
    roleName: "admin",
  }),
  vaultSetup: ownerVaultSetupService({
    db,
    projects: () => persistence.listProjects(),
    networks: () => ["base-mainnet"],
    rpcUrl: () => rpcUrl,
    factories: reviewedFactories,
  }),
};
async function vaultSetup(step: "review" | "register") {
  const response = await handleProjectApi(
    new Request("https://slop.cash/api/v1/project-vaults/vault-network", {
      method: "POST",
      headers: {
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        step,
        expectedRevision: 1,
        network: "base-mainnet",
        claimId: CLAIM,
        automatic: false,
        ...(step === "register"
          ? { transactionId: `0x${"ab".repeat(32)}` }
          : {}),
      }),
    }),
    deps,
  );
  if (!response) throw new Error("The project API did not answer");
  return { status: response.status, body: await response.json() };
}
const retry = {
  error: "vault_network_unavailable",
};

test("an unreadable RPC is a retry, while a factory mismatch still refuses", async () => {
  const logged: unknown[][] = [];
  const log = spyOn(console, "error").mockImplementation((...args) => {
    logged.push(args);
  });
  try {
    // Owner review: the RPC answers HTTP 429 for every read.
    mode = "limited";
    expect(await vaultSetup("review")).toMatchObject({
      status: 503,
      body: retry,
    });
    // Owner review: the RPC refuses the connection.
    rpcUrl = closedUrl;
    expect(await vaultSetup("review")).toMatchObject({
      status: 503,
      body: retry,
    });
    rpcUrl = `http://127.0.0.1:${rpc.port}`;
    // Registration: the factory verifies, then the transaction reads answer
    // HTTP 429. The creation request is valid, so this is not 422.
    mode = "factory";
    reads = 0;
    expect(await vaultSetup("register")).toMatchObject({
      status: 503,
      body: retry,
    });
    // The 12 factory reads passed, so the 429 came from the creation reads.
    expect(reads).toBeGreaterThan(12);
    // A factory whose code differs from its review stays unavailable for
    // review and for registration.
    code[address("5")] = "0x6080604053";
    for (const step of ["review", "register"] as const)
      expect(await vaultSetup(step)).toMatchObject({
        status: 503,
        body: {
          error: "vault_setup_unavailable",
        },
      });
    // Each server failure logs only the fixed label: no RPC URL or body.
    expect(logged).toEqual(Array(5).fill(["project API failure"]));
  } finally {
    log.mockRestore();
  }
  expect((await persistence.getProject("vault-network"))?.revision).toBe(1);
});

test("registration tries the next reviewed EVM factory for the exact creation", async () => {
  const { monthlyCapMinor } = manifest.reward as { monthlyCapMinor: string };
  const asset = ESCROW_NETWORKS["base-mainnet"].asset as string;
  rpcUrl = `http://127.0.0.1:${rpc.port}`;
  code[address("5")] = "0x6080604052";
  code[SECOND_FACTORY] = code[address("5")];
  code[CREATED_VAULT] = "0x60806040526000";
  const common = { ...factory, codeSha256: codeSha256(code[CREATED_VAULT]) };
  reviewedFactories.splice(0, reviewedFactories.length, common, {
    ...common,
    factory: SECOND_FACTORY,
  });
  creationData = buildCreateVaultCalldata({
    projectId: `0x${registryProjectDigest("vault-network")}`,
    asset,
    monthlyCap: monthlyCapMinor,
    automaticMonthly: false,
  });
  vaultGetters = Object.fromEntries(
    Object.entries({
      "token()": asset,
      "owner()": OWNER_WALLET,
      "feeRecipient()": factory.feeRecipient,
      "factory()": SECOND_FACTORY,
      "bindingDelay()": "0",
      "purpose()": "0",
      "projectId()": registryProjectDigest("vault-network"),
      "monthlyCap()": BigInt(monthlyCapMinor).toString(16),
      "monthlyEnabled()": "0",
    }).map(([signature, value]) => [
      toFunctionSelector(signature),
      word(value),
    ]),
  );
  creationMethods.length = 0;
  mode = "creation";
  try {
    creationStatus = "pending";
    expect(await vaultSetup("register")).toMatchObject({
      status: 200,
      body: { status: "pending" },
    });
    creationStatus = "failed";
    expect(await vaultSetup("register")).toMatchObject({
      status: 422,
      body: { error: "vault_creation_failed" },
    });
    creationStatus = "valid";
    expect(await vaultSetup("register")).toMatchObject({
      status: 200,
      body: {
        status: "registered",
        deployment: { factory: SECOND_FACTORY, vault: CREATED_VAULT },
      },
    });
    expect((await persistence.getProject("vault-network"))?.revision).toBe(2);
    expect(creationMethods.some((method) => /send|sign/iu.test(method))).toBe(
      false,
    );
  } finally {
    reviewedFactories.splice(0, reviewedFactories.length, factory);
    mode = "factory";
  }
});
