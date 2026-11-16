// Shared owner vault-setup harness for the EVM and Solana setup tests. It
// seeds a paused project revision and the owner's verified wallet (claim,
// consumed challenge and authorization), then serves the project API with
// the reviewed factories or programs. Each test keeps its own RPC fixture.
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { ownerVaultSetupService } from "../backend/projects/vault-setup";
import type { ReviewedEvmFactory } from "../contracts/evm/factories";
import type { ReviewedSolanaProgram } from "../contracts/solana/programs";
import { sha256Hex } from "../src/lib/sha256";
import { sqliteD1 } from "./sqlite-d1";

export function vaultSetupHarness(options: {
  projectId: string;
  manifest: Record<string, unknown>;
  chain: "base" | "solana";
  claim: string;
  owner: { githubId: string; githubLogin: string };
  ownerWallet: string;
  now: string;
  network: string;
  rpcUrl: () => string;
  reviewed:
    | { factories: readonly ReviewedEvmFactory[] }
    | { programs: readonly ReviewedSolanaProgram[] };
}) {
  const { projectId, claim, owner, now } = options;
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const manifestText = JSON.stringify(options.manifest);
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Fixture',?)",
    )
    .run(projectId, manifestText, sha256Hex(manifestText), now);
  sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
    )
    .run(projectId, manifestText, sha256Hex(manifestText), now, now);
  // The owner's current wallet, confirmed by a signed challenge.
  sqlite
    .prepare(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(?,?,?,?,'d1_registry',?,?,?,?,?)",
    )
    .run(
      claim,
      owner.githubId,
      owner.githubLogin,
      options.ownerWallet,
      "a".repeat(64),
      now,
      "b".repeat(64),
      now,
      options.chain,
    );
  sqlite
    .prepare(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES('challenge-1',?,?,'fixture',?,?)",
    )
    .run(claim, owner.githubId, now, now);
  sqlite
    .prepare(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,'challenge-1','0x00')",
    )
    .run(claim, owner.githubId, now);

  const persistence = new CloudflareProjectPersistence(db);
  const deps: ProjectApiDependencies = {
    persistence,
    adminGithubIds: new Set(),
    moderatorGithubIds: new Set(),
    now: () => new Date(now),
    randomId: () => crypto.randomUUID(),
    sessionActor: async () => owner,
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
      networks: () => [options.network],
      rpcUrl: () => options.rpcUrl(),
      ...options.reviewed,
    }),
  };

  // POSTs one owner vault-setup step for the project.
  async function vaultSetup(body: Record<string, unknown>) {
    const response = await handleProjectApi(
      new Request(`https://slop.cash/api/v1/project-vaults/${projectId}`, {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      deps,
    );
    if (!response) throw new Error("The project API did not answer");
    return { status: response.status, body: await response.json() };
  }

  return { db, sqlite, persistence, deps, vaultSetup };
}
