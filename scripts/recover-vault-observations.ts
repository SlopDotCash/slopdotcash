/** Protected release repair of missing public Solana observations; never signs. */
import { execFileSync } from "node:child_process";
import type {
  D1Result,
  D1Statement,
  D1TransactionalDatabase,
} from "../backend/d1";
import { storeVaultSnapshot } from "../backend/payments/vault-snapshots";
import { readRegisteredVaultTotals } from "../backend/projects/vault-setup";
import { loadRegistryPaymentDeployments } from "../workers/payments/deployments";
import { readRegistryDatabase } from "../workers/payments/registry-database.mjs";

export function requireTrustedObservationRecovery(
  env: Record<string, string | undefined>,
  checkout: string,
) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_WORKFLOW_REF !==
      "SlopDotCash/slopdotcash/.github/workflows/deploy.yml@refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME ?? "") ||
    !/^[0-9a-f]{40}$/.test(checkout) ||
    env.GITHUB_SHA !== checkout
  )
    throw new Error("The exact trusted main release is required");
}

/** D1 REST transport for the canonical registry reader and snapshot writer. */
export function observationDatabase({
  account,
  token,
  databaseId,
  fetcher = fetch,
}: {
  account: string;
  token: string;
  databaseId: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}): D1TransactionalDatabase {
  async function query(sql: string, params: unknown[]) {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      },
    );
    const body = (await response.json()) as {
      success?: boolean;
      result?: D1Result<Record<string, unknown>>[];
    };
    if (
      !response.ok ||
      body.success !== true ||
      body.result?.length !== 1 ||
      body.result[0].success !== true
    )
      throw new Error("Vault observation database request failed");
    return body.result[0];
  }
  function statement(sql: string, params: unknown[] = []): D1Statement {
    return {
      bind: (...values) => statement(sql, values),
      async first<T>() {
        return ((await query(sql, params)).results?.[0] ?? null) as T | null;
      },
      run: () => query(sql, params),
    };
  }
  return {
    prepare: statement,
    batch: async () => {
      throw new Error("Observation recovery uses only canonical single writes");
    },
  };
}

/** Skip existing rows. The canonical writer also protects concurrent newer rows. */
export async function recoverMissingVaultObservations({
  db,
  rpcUrl,
  read = readRegisteredVaultTotals,
  now = new Date(),
}: {
  db: D1TransactionalDatabase;
  rpcUrl: string;
  read?: typeof readRegisteredVaultTotals;
  now?: Date;
}) {
  const registry = await loadRegistryPaymentDeployments(db, ["solana-mainnet"]);
  if (registry.failures.length)
    throw new Error("Current vault registry cannot be reconciled");
  let stored = 0,
    retained = 0;
  for (const deployment of registry.deployments) {
    const prior = await db
      .prepare(
        "SELECT 1 present FROM vault_snapshots WHERE project_id=? AND network=? AND vault=?",
      )
      .bind(deployment.projectId, deployment.network, deployment.vault)
      .first();
    if (prior) {
      retained++;
      continue;
    }
    const result = await storeVaultSnapshot(
      db,
      deployment,
      await read(deployment, rpcUrl),
      now.toISOString(),
    );
    if (result === "stored") stored++;
    else retained++;
  }
  return { stored, retained };
}

async function main() {
  const env = process.env;
  requireTrustedObservationRecovery(
    env,
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  );
  const rpcUrls = JSON.parse(env.PAYMENT_RPC_URLS ?? "null") as Record<
    string,
    string
  > | null;
  if (
    !rpcUrls ||
    Object.keys(rpcUrls).join() !== "solana-mainnet" ||
    typeof rpcUrls["solana-mainnet"] !== "string" ||
    new URL(rpcUrls["solana-mainnet"]).protocol !== "https:" ||
    !/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN
  )
    throw new Error("Protected Solana observation configuration is required");
  const registry = await readRegistryDatabase();
  const db = observationDatabase({
    account: env.CLOUDFLARE_ACCOUNT_ID as string,
    token: env.CLOUDFLARE_API_TOKEN,
    databaseId: registry.database_id,
  });
  const report = await recoverMissingVaultObservations({
    db,
    rpcUrl: rpcUrls["solana-mainnet"],
  });
  console.log(
    `Vault observations: ${report.stored} stored, ${report.retained} retained`,
  );
}

if (import.meta.main)
  await main().catch(() => {
    console.error(
      "Vault observation recovery failed; no provider data or credentials are logged.",
    );
    process.exitCode = 1;
  });
