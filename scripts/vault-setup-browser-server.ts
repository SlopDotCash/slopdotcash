/** Local-only browser harness: real API handlers, migrations and D1-compatible SQLite. */
import { deepStrictEqual } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { handlePaymentsApi } from "../backend/payments/handler";
import { handlePointsApi, sessionGithubActor } from "../backend/points/handler";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { ownerVaultSetupService } from "../backend/projects/vault-setup";
import { readSecurityProgramFunds } from "../backend/security/program-funds";
import type { SolanaEscrowConfig } from "../contracts/solana/adapter";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { sqliteD1 } from "../tests/sqlite-d1";
import securityPayments from "../workers/security-payments";
import { paymentDeployments } from "./prepare-payment-deployments";

if (process.env.SLOP_E2E_VAULT_ACTIONS !== "1")
  throw new Error("Local vault harness requires explicit opt-in");
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const port = Number(process.argv[3]);
const rpcUrl = String(process.argv[4]);
if (
  new URL(rpcUrl).hostname !== "127.0.0.1" ||
  !Number.isInteger(port) ||
  port < 1024
)
  throw new Error("Local endpoints required");
const origin = `http://127.0.0.1:${port}`;
const servedNetwork = (input.factory?.network ??
  input.template.escrow.deployments[0].network) as keyof typeof ESCROW_NETWORKS;
const { sqlite, db } = sqliteD1(
  readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort(),
);
const persistence = new CloudflareProjectPersistence(db);
const now = () => new Date();
for (const manifest of [
  input.project,
  ...(input.template ? [input.template] : []),
]) {
  const text = JSON.stringify(manifest);
  const digest = sha256Hex(text);
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(manifest.id, text, digest, "Local fixture", now().toISOString());
  sqlite
    .prepare(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
    )
    .run(
      manifest.id,
      manifest.status,
      text,
      digest,
      now().toISOString(),
      now().toISOString(),
    );
}
const actor = { githubId: "900000071", githubLogin: "vault-owner" };
const token = "vault_setup_local_session_".padEnd(64, "x");
sqlite
  .prepare(
    "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
  )
  .run("vault-owner", actor.githubId, actor.githubLogin, now().toISOString());
sqlite
  .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
  .run(
    sha256Hex(token),
    "vault-owner",
    new Date(Date.now() + 3_600_000).toISOString(),
  );
let permitted = true;
let templatesEnabled = true;
let privateReadUnavailable = false;
let scanReads = 0;
const solanaFundingConfig = async (
  projectId: string,
  network: string,
  vault: string,
  bounty = false,
): Promise<SolanaEscrowConfig> => {
  const project = await persistence.getProject(projectId);
  const deployments = bounty
    ? project?.manifest.securityBounty?.settlement?.deployments
    : project?.manifest.escrow?.deployments;
  const deployment = deployments?.find(
    (d) => d.network === network && d.vault === vault,
  );
  if (!deployment || ESCROW_NETWORKS[deployment.network].family !== "solana")
    throw new Error("Unknown Solana vault");
  return {
    ...deployment,
    projectId,
    payoutPolicy: bounty ? "security-bounty" : "ordinary",
    mint: deployment.asset,
    rpcUrl,
    genesisHash: ESCROW_NETWORKS[deployment.network].genesisHash,
  } as SolanaEscrowConfig;
};
const repositoryFacts = (manifest: ProjectDefinition) => ({
  id: Number(manifest.authority.repositoryId),
  node_id: manifest.authority.repositoryNodeId,
  full_name: manifest.repositories[0].id,
  private: false,
  owner: {
    id: Number(manifest.steward.github.actorId),
    node_id: manifest.steward.github.nodeId,
    login: manifest.steward.github.login,
    type: manifest.steward.github.type,
  },
});
const deps: ProjectApiDependencies = {
  persistence,
  securitySolanaFundingConfig: (projectId, network, vault) =>
    solanaFundingConfig(projectId, network, vault, true),
  adminGithubIds: new Set(),
  moderatorGithubIds: new Set(),
  now,
  randomId: () => crypto.randomUUID(),
  sessionActor: (r) => sessionGithubActor(r, db, now().toISOString()),
  repositoryControl: async (manifest, facts) => {
    deepStrictEqual(facts, repositoryFacts(manifest));
    return { state: "matched" };
  },
  repositoryAccess: async ({ path }) => {
    const project = (await persistence.listProjects()).find(
      (project) => project.manifest.repositories[0].id === path,
    );
    if (!project) throw new Error("Unknown fixture repository");
    return {
      installation: "installed",
      installationId: 1,
      permission: permitted ? "admin" : "read",
      roleName: null,
      repository: repositoryFacts(project.manifest),
    };
  },
  readTokenMetadata: async () => {
    throw new Error("No asset edit in this workflow");
  },
  github: {
    fetch: async () => {
      throw new Error("Unexpected public lookup");
    },
  },
  vettingClearance: async () => {
    scanReads++;
    return { state: "cleared", assessment: null, grandfathered: true };
  },
  vaultSetup: ownerVaultSetupService({
    factories: input.factory ? [input.factory] : [],
    db,
    projects: () => persistence.listProjects(),
    networks: () => (templatesEnabled ? [servedNetwork] : []),
    rpcUrl: () => rpcUrl,
  }),
  securityProgramFunds: (projectId, program) =>
    readSecurityProgramFunds({ db, now }, projectId, program),
};
const root = resolve("dist");
Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/__fixture") {
        if (request.method === "POST") {
          const body = await request.json();
          if (input.factory && body.factoryReview)
            Object.assign(input.factory, body.factoryReview);
          if (typeof body.permitted === "boolean") permitted = body.permitted;
          if (typeof body.templatesEnabled === "boolean")
            templatesEnabled = body.templatesEnabled;
          if (typeof body.privateReadUnavailable === "boolean")
            privateReadUnavailable = body.privateReadUnavailable;
          if (body.scanSecurity === true)
            await securityPayments.scheduled(null, {
              PAYMENTS_DB: db,
              REGISTRY_DB: db,
              PAYMENT_NETWORKS: JSON.stringify([servedNetwork]),
              PAYMENT_RPC_URLS: JSON.stringify({ [servedNetwork]: rpcUrl }),
              // This zero-award fixture exercises the real scanner, not payouts.
              EVM_PAYMENT_EXECUTOR: {
                fetch: async () => {
                  throw new Error("Unexpected payment in zero-award fixture");
                },
              },
            });
        }
        return Response.json({
          token,
          scanReads,
          projects: (await persistence.listProjects()).length,
          paymentPins: paymentDeployments(
            (await persistence.listProjects()).map((p) => p.manifest),
            "testnet",
            servedNetwork,
          ),
          project: await persistence.getProject(input.project.id),
          revisions: sqlite
            .prepare(
              "SELECT COUNT(*) n FROM project_revisions WHERE project_id=?",
            )
            .get(input.project.id),
          publicSnapshots: sqlite
            .prepare(
              "SELECT COUNT(*) n FROM vault_snapshots WHERE project_id=?",
            )
            .get(input.project.id),
          privateSnapshots: sqlite
            .prepare(
              "SELECT COUNT(*) n FROM security_vault_snapshots WHERE project_id=?",
            )
            .get(input.project.id),
        });
      }
      // The prepared browser build points its boot inventory at this local URL.
      // Serve the real D1 registry handler there, not the static fixture snapshot.
      const projectRequest =
        url.pathname === "/data/fixture-project-registry.json"
          ? new Request(`${origin}/api/v1/projects`, request)
          : request;
      if (
        privateReadUnavailable &&
        request.method === "GET" &&
        url.pathname === `/api/v1/project-vaults/${input.project.id}` &&
        url.searchParams.get("purpose") === "security-bounty"
      )
        return Response.json(
          {
            error: "unavailable",
            message: "Private balance read is unavailable.",
          },
          { status: 503 },
        );
      const projectResponse = await handleProjectApi(projectRequest, deps);
      if (projectResponse) return projectResponse;
      if (url.pathname.startsWith("/api/v1/payments"))
        return handlePaymentsApi(request, {
          db,
          allowedOrigins: [origin],
          solanaFundingConfig,
        });
      if (url.pathname.startsWith("/api/v1/points"))
        return handlePointsApi(request, {
          db,
          allowedOrigins: [origin],
          rateLimitSecret: "local-only-rate-limit-fixture",
          identity: { fetch: async () => new Response(null, { status: 503 }) },
        });
      if (url.pathname.startsWith("/api/"))
        return new Response("Not found", { status: 404 });
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(`${root}${sep}`))
        return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      return new Response(
        (await file.exists()) ? file : Bun.file(resolve(root, "index.html")),
      );
    } catch (error) {
      console.error(error);
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
});
console.log(`Vault setup API ready ${origin}`);
