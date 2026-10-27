// Browser review and signing checks for an approved Token-2022 reward asset
// (PRD sections 6 and 11, issues #1363 and #904). The server plans Solana
// vault creation and funding with the mint's verified Token-2022 program, and
// the browser must rebuild and verify the exact same message before signing.
import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { handlePaymentsApi } from "../backend/payments/handler";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { ownerVaultSetupService } from "../backend/projects/vault-setup";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  type SolanaEscrowConfig,
  solanaBase58,
  solanaConfigAddress,
  solanaVaultAddress,
} from "../contracts/solana/adapter";
import { buildInitializeVaultInstructions } from "../contracts/solana/owner-instructions";
import type { ReviewedSolanaProgram } from "../contracts/solana/programs";
import {
  CLASSIC_TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "../contracts/solana/token";
import { ata, bytes } from "../contracts/solana/transactions";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { sha256Hex } from "../src/lib/sha256";
import {
  reviewSolanaVaultAction,
  sendSolanaVaultAction,
} from "../src/lib/solana-vault-actions";
import {
  checkedVaultSetupReview,
  registryProjectDigest,
  solanaVaultCreationMessage,
  type VaultSetupReview,
} from "../src/lib/vault-setup";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";

const NOW = "2026-10-27T00:00:00.000Z";
const OWNER = { githubId: "900000002", githubLogin: "owner" };
const CLAIM = "verified-owner-wallet";
const PMUP_MINT = "35fWL6pdJqpconRZPrawUAQegw1QF3p2tgN7mzhTpump";
const pmupMintBytes = new Uint8Array(
  readFileSync(
    new URL(
      "../contracts/solana/integration/fixtures/pmup-mint.bin",
      import.meta.url,
    ),
  ),
);
const key = (byte: number) => solanaBase58(new Uint8Array(32).fill(byte));
const base64 = (value: Uint8Array) => Buffer.from(value).toString("base64");
const ownerSecret = new Uint8Array(32).fill(2);
const OWNER_WALLET = solanaBase58(ed25519.getPublicKey(ownerSecret));
const BLOCKHASH = key(9);
const network = ESCROW_NETWORKS["solana-mainnet"];

const programCode = new Uint8Array([1, 2, 3, 4]);
const program: ReviewedSolanaProgram = {
  network: "solana-mainnet",
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  programId: key(5),
  codeSha256: createHash("sha256").update(programCode).digest("hex"),
  upgradeAuthority: null,
  identityAuthority: key(3),
  feeRecipient: key(4),
  rotationAuthority: key(6),
  networkDomain: "ab".repeat(32),
  bindingDelaySeconds: "0",
  rotationDelaySeconds: "0",
} as ReviewedSolanaProgram;

const configBytes = new Uint8Array(CONFIG_SIZE);
configBytes.set(Buffer.from(CONFIG_DISCRIMINATOR, "hex"));
configBytes.set(new Uint8Array(32).fill(3), 8);
configBytes.set(new Uint8Array(32).fill(4), 40);
configBytes.set(new Uint8Array(32).fill(6), 72);

const projectDigest = registryProjectDigest("pmup-vault");
const creationPlan = buildInitializeVaultInstructions({
  programId: program.programId,
  owner: OWNER_WALLET,
  mint: PMUP_MINT,
  tokenProgram: TOKEN_2022_PROGRAM,
  projectDigest,
  networkDomain: program.networkDomain,
  identityAuthority: program.identityAuthority,
  feeRecipient: program.feeRecipient,
  bindingDelaySeconds: program.bindingDelaySeconds,
  rotationDelaySeconds: program.rotationDelaySeconds,
  payoutPolicy: "ordinary",
  monthlyCap: "250000000",
  automaticMonthly: true,
});
const projectPda = creationPlan.projectPda;
const vaultAddress = solanaVaultAddress(program.programId, projectPda);
const ownerAta = ata(PMUP_MINT, OWNER_WALLET, TOKEN_2022_PROGRAM);

function token2022Account(owner: string, amount: bigint): Uint8Array {
  const raw = new Uint8Array(170);
  raw.set(bytes(PMUP_MINT), 0);
  raw.set(bytes(owner), 32);
  new DataView(raw.buffer).setBigUint64(64, amount, true);
  raw[108] = 1;
  raw[165] = 2; // AccountType::Account with an empty extension TLV trailer
  return raw;
}

const projectBytes = new Uint8Array(PROJECT_SIZE);
projectBytes.set(Buffer.from(PROJECT_DISCRIMINATOR, "hex"), 0);
projectBytes.set(bytes(OWNER_WALLET), 8);
projectBytes.set(Buffer.from(projectDigest, "hex"), 40);
projectBytes.set(Buffer.from(program.networkDomain, "hex"), 72);
projectBytes.set(bytes(program.identityAuthority), 104);
projectBytes.set(bytes(program.feeRecipient), 136);
projectBytes.set(bytes(PMUP_MINT), 168);
new DataView(projectBytes.buffer).setBigUint64(208, 500_000_000n, true);

let projectInitialized = false;
const accounts = (): Record<string, unknown> => ({
  [program.programId]: {
    owner: "BPFLoader2111111111111111111111111111111111",
    executable: true,
    data: [base64(programCode), "base64"],
  },
  [solanaConfigAddress(program.programId)]: {
    owner: program.programId,
    executable: false,
    data: [base64(configBytes), "base64"],
  },
  [PMUP_MINT]: {
    owner: TOKEN_2022_PROGRAM,
    executable: false,
    data: [base64(pmupMintBytes), "base64"],
  },
  [ownerAta]: {
    owner: TOKEN_2022_PROGRAM,
    executable: false,
    data: [base64(token2022Account(OWNER_WALLET, 900_000_000n)), "base64"],
  },
  ...(projectInitialized
    ? {
        [projectPda]: {
          owner: program.programId,
          executable: false,
          data: [base64(projectBytes), "base64"],
        },
        [vaultAddress]: {
          owner: TOKEN_2022_PROGRAM,
          executable: false,
          data: [base64(token2022Account(projectPda, 500_000_000n)), "base64"],
        },
      }
    : {}),
});

const rpc = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const { method, params } = (await request.json()) as {
      method: string;
      params: [string];
    };
    const answer = (result: unknown) =>
      Response.json({ jsonrpc: "2.0", id: 1, result });
    if (method === "getGenesisHash") return answer(network.genesisHash);
    if (method === "getAccountInfo")
      return answer({
        context: { slot: 1 },
        value: accounts()[params[0] as string] ?? null,
      });
    if (method === "getMultipleAccounts")
      return answer({
        context: { slot: 1 },
        value: (params[0] as unknown as string[]).map(
          (address) => accounts()[address] ?? null,
        ),
      });
    if (method === "getBlockTime") return answer(1_761_523_200);
    if (method === "getLatestBlockhash")
      return answer({
        context: { slot: 1 },
        value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100 },
      });
    if (method === "getFeeForMessage")
      return answer({ context: { slot: 1 }, value: 5000 });
    if (method === "getBalance")
      return answer({ context: { slot: 1 }, value: 10_000_000 });
    if (method === "simulateTransaction")
      return answer({ context: { slot: 1 }, value: { err: null } });
    return new Response("unexpected method", { status: 400 });
  },
});
afterAll(() => rpc.stop(true));
const rpcUrl = `http://127.0.0.1:${rpc.port}`;

const { db, sqlite } = sqliteD1(
  readdirSync(new URL("../migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort(),
);
const manifest = applicationManifest("pmup-vault", "example/pmup-vault", {
  rewardAsset: {
    network: "solana",
    kind: "token",
    address: PMUP_MINT,
    symbol: "PMUP",
    decimals: 6,
    tokenSource: "pumpfun",
  },
  reward: {
    ...(applicationManifest("pmup-vault", "example/pmup-vault")
      .reward as Record<string, unknown>),
    chain: "solana",
    monthlyCapMinor: "250000000",
    monthlyCapDisplay: "250 PMUP",
  },
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "solana",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  },
});
const manifestText = JSON.stringify(manifest);
sqlite
  .prepare(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('pmup-vault',1,?,?,'Fixture',?)",
  )
  .run(manifestText, sha256Hex(manifestText), NOW);
sqlite
  .prepare(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('pmup-vault','paused',1,?,?,?,?)",
  )
  .run(manifestText, sha256Hex(manifestText), NOW, NOW);
sqlite
  .prepare(
    "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,'solana')",
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
const projectDeps: ProjectApiDependencies = {
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
    networks: () => ["solana-mainnet"],
    rpcUrl: () => rpcUrl,
    programs: [program],
  }),
};

test("browser vault setup and funding reviews preserve the verified Token-2022 program", async () => {
  const input = {
    network: "solana-mainnet" as const,
    claimId: CLAIM,
    automatic: true,
    payoutPolicy: "ordinary" as const,
  };
  const setupResponse = await handleProjectApi(
    new Request("https://slop.cash/api/v1/project-vaults/pmup-vault", {
      method: "POST",
      headers: {
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...input,
        step: "review",
        expectedRevision: 1,
      }),
    }),
    projectDeps,
  );
  if (!setupResponse) throw new Error("The project API did not answer");
  expect(setupResponse.status).toBe(200);
  const { review } = (await setupResponse.json()) as {
    review: VaultSetupReview;
  };
  expect(review.family).toBe("solana");
  if (review.family !== "solana") throw new Error("Expected Solana review");
  expect(review.creation.tokenProgram).toBe(TOKEN_2022_PROGRAM);

  const projectDef = {
    id: "pmup-vault",
    ...(manifest as unknown as Omit<ProjectDefinition, "id">),
  };
  const checked = checkedVaultSetupReview(
    review,
    projectDef,
    input,
    OWNER_WALLET,
  );
  if (checked.family !== "solana") throw new Error("Expected Solana review");
  expect(solanaVaultCreationMessage(checked).byteLength).toBeGreaterThan(0);

  // Tampering with the token program in the review must fail client verification.
  expect(() =>
    checkedVaultSetupReview(
      {
        ...review,
        creation: { ...review.creation, tokenProgram: CLASSIC_TOKEN_PROGRAM },
      },
      projectDef,
      input,
      OWNER_WALLET,
    ),
  ).toThrow("The transaction differs from the reviewed vault creation.");

  // Once the vault exists, browser deposit and withdraw reviews and signing
  // checks must also reconstruct the exact Token-2022 instructions.
  projectInitialized = true;
  const deployment = {
    ...program,
    factory: null,
    factoryCodeSha256: null,
    registrar: null,
    projectPda,
    vault: vaultAddress,
    owner: OWNER_WALLET,
    asset: PMUP_MINT,
    deploymentTransaction: solanaBase58(new Uint8Array(64).fill(7)),
  };
  const escrowConfig: SolanaEscrowConfig = {
    ...program,
    rpcUrl,
    genesisHash: network.genesisHash as string,
    projectId: projectDigest,
    projectPda,
    vault: vaultAddress,
    owner: OWNER_WALLET,
    mint: PMUP_MINT,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    const target = typeof url === "string" ? url : url.toString();
    if (target.includes("/api/v1/payments/")) {
      return handlePaymentsApi(
        new Request(
          target.startsWith("http") ? target : `https://slop.cash${target}`,
          {
            ...init,
            headers: {
              origin: "https://slop.cash",
              "content-type": "application/json",
            },
          },
        ),
        {
          db,
          solanaFundingConfig: async () => escrowConfig,
        },
      );
    }
    return originalFetch(url, init);
  }) as typeof fetch;

  try {
    const wallet = {
      address: OWNER_WALLET,
      sign: async () => "0x00",
      solanaSend: async (
        wire: Uint8Array,
        _chain: `solana:${string}`,
        before: () => void,
      ) => {
        before();
        return ed25519.sign(wire.slice(65), ownerSecret);
      },
    };
    for (const operation of ["deposit", "withdraw"] as const) {
      const reviewed = await reviewSolanaVaultAction(
        "pmup-vault",
        deployment,
        wallet,
        operation,
        "100",
      );
      expect(reviewed.solanaPlan.tokenProgram).toBe(TOKEN_2022_PROGRAM);
      let marked = false;
      const signature = await sendSolanaVaultAction(
        deployment,
        wallet,
        reviewed.solanaPlan,
        () => {
          marked = true;
        },
      );
      expect(marked).toBe(true);
      expect(signature.length).toBeGreaterThan(40);
      await expect(
        sendSolanaVaultAction(
          deployment,
          wallet,
          { ...reviewed.solanaPlan, tokenProgram: CLASSIC_TOKEN_PROGRAM },
          () => {},
        ),
      ).rejects.toThrow(
        "The prepared transaction differs from the reviewed vault action.",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
