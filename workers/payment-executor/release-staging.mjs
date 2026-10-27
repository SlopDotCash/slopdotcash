import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { paymentDeployments } from "../../scripts/prepare-payment-deployments.ts";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { HISTORICAL_PROJECTS } from "../../src/lib/projects.mjs";
import {
  readMonthlySchedule,
  readRegistryDatabase,
} from "../payments/registry-database.mjs";
import { paymentStack } from "./configure.mjs";

// Capabilities only. Project and vault pins always come from the staging registry.
export const STAGING_MONTHLY_RELEASES = Object.freeze({
  "base-sepolia": "MONTHLY_RELEASE_BASE",
  "ethereum-sepolia": "MONTHLY_RELEASE_ETHEREUM",
  "robinhood-testnet": "MONTHLY_RELEASE_ROBINHOOD",
  "solana-devnet": "MONTHLY_RELEASE_SOLANA",
});

export function runStagingWrangler(args, env = process.env) {
  return spawnSync(
    // The release entry point runs under Bun; Wrangler uses the installed Node runtime.
    "node",
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    { env, encoding: "utf8", timeout: 120_000 },
  );
}

async function readSecretInventory(run, path, network) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const output = await run(["secret", "list", "--config", path]);
    try {
      return JSON.parse(output);
    } catch {
      // Retry only an unreadable metadata response, never a failed command or
      // a complete inventory whose names differ from the approved test stack.
    }
  }
  throw new Error(
    `${network} test attester secret inventory did not return valid JSON after 3 reads`,
  );
}

export function stagingReleasePlan({
  registry,
  registryDatabase,
  monthlySchedule,
  singleNonceBindings = false,
}) {
  if (typeof singleNonceBindings !== "boolean")
    throw new Error("Invalid staging binding nonce policy");
  return Object.entries(STAGING_MONTHLY_RELEASES).flatMap(
    ([network, binding]) => {
      if (!paymentDeployments(registry, "testnet", network).length) return [];
      const { configs, secret } = paymentStack({
        stack: "test",
        environment: "staging",
        topology: "keeper",
        singleNonceBindings:
          singleNonceBindings && ESCROW_NETWORKS[network].family === "evm",
        network,
        registry,
        registryDatabase,
        monthlySchedule,
      });
      return [
        {
          network,
          config: configs.attester,
          secrets: ["PAYMENT_RPC_URLS", secret].sort(),
          binding: {
            binding,
            service: configs.attester.name,
            entrypoint: "MonthlyReserveRelease",
          },
        },
      ];
    },
  );
}

/** Publish reviewed test attesters before exposing their named owner entrypoints. */
export async function releaseStagingPayments({
  directory,
  path,
  sha,
  registry,
  provider,
  singleNonceBindings = false,
}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw new Error("Exact staging source required");
  const pages = JSON.parse(await readFile(path, "utf8"));
  if (
    pages.name !== "slop-staging" ||
    pages.vars?.SLOP_ENVIRONMENT !== "staging"
  )
    throw new Error(
      "Only the staging Pages artifact may receive test attesters",
    );
  const registryDatabase = await readRegistryDatabase("wrangler.staging.toml");
  const monthlySchedule = await readMonthlySchedule("wrangler.staging.toml");
  const databases = pages.d1_databases ?? [];
  if (
    databases.length !== 1 ||
    databases[0].binding !== "SLOP_DB" ||
    databases[0].database_id !== registryDatabase.database_id ||
    databases[0].database_name !== registryDatabase.database_name ||
    pages.vars.MONTHLY_PAYMENT_SCHEDULE !== monthlySchedule
  )
    throw new Error("Staging Pages and attester storage or schedule differ");
  const entries = stagingReleasePlan({
    registry,
    registryDatabase,
    monthlySchedule,
    singleNonceBindings,
  });
  await mkdir(directory, { recursive: true });
  const run = async (args) => {
    const result = await provider(args);
    if (result.status !== 0)
      throw new Error(`Staging attester ${args[0]} failed`);
    return result.stdout;
  };
  // Inspect every secret name before publishing any service. Never install or read keys.
  for (const entry of entries) {
    entry.path = join(directory, `${entry.config.name}.json`);
    const bytes = `${JSON.stringify(entry.config, null, 2)}\n`;
    entry.configSha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(entry.path, bytes);
    const secrets = await readSecretInventory(run, entry.path, entry.network);
    if (
      !Array.isArray(secrets) ||
      JSON.stringify(secrets.map((s) => s?.name).sort()) !==
        JSON.stringify(entry.secrets)
    )
      throw new Error(
        `${entry.network} test attester secret inventory differs`,
      );
  }
  const published = [];
  for (const entry of entries) {
    if (
      createHash("sha256")
        .update(await readFile(entry.path))
        .digest("hex") !== entry.configSha256
    )
      throw new Error("Prepared staging attester configuration changed");
    await run([
      "deploy",
      "--config",
      entry.path,
      `--tag=${sha}`,
      `--message=slop.cash staging ${sha}`,
    ]);
    const versions = JSON.parse(
      await run(["versions", "list", "--name", entry.config.name, "--json"]),
    );
    const deployment = JSON.parse(
      await run([
        "deployments",
        "status",
        "--name",
        entry.config.name,
        "--json",
      ]),
    );
    const active = deployment?.versions;
    if (
      !Array.isArray(active) ||
      active.length !== 1 ||
      active[0].percentage !== 100 ||
      !Array.isArray(versions) ||
      !versions.some(
        (version) =>
          version.id === active[0].version_id &&
          version.annotations?.["workers/tag"] === sha,
      )
    )
      throw new Error(
        `${entry.network} test attester does not match the released source`,
      );
    published.push({
      network: entry.network,
      name: entry.config.name,
      configSha256: entry.configSha256,
      version: active[0].version_id,
      binding: entry.binding,
    });
  }
  // An unpinned network never receives a binding to an absent or stale Worker.
  const reserved = new Set(Object.values(STAGING_MONTHLY_RELEASES));
  pages.services = (pages.services ?? []).filter(
    (entry) => !reserved.has(entry.binding),
  );
  pages.services.push(...published.map((entry) => entry.binding));
  await writeFile(path, `${JSON.stringify(pages, null, 2)}\n`);
  const proof = { sha, services: published };
  await writeFile(
    join(directory, "release.json"),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  return proof;
}

export function stagingBindingNoncePolicy(value) {
  if (value === undefined || value === "") return false;
  if (value === "1") return true;
  throw new Error("Unknown staging binding nonce policy");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/development" ||
    !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)
  )
    throw new Error(
      "Test attester publication requires the development release",
    );
  const [directory, path] = process.argv.slice(2);
  if (!directory || !path)
    throw new Error("Release directory and staging Pages artifact required");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0 || head.stdout.trim() !== process.env.GITHUB_SHA)
    throw new Error(
      "Staging attester checkout does not match the released source",
    );
  await releaseStagingPayments({
    directory,
    path,
    sha: process.env.GITHUB_SHA,
    registry: HISTORICAL_PROJECTS,
    provider: runStagingWrangler,
    singleNonceBindings: stagingBindingNoncePolicy(
      process.env.SLOP_STAGING_BINDING_NONCE_LIMIT,
    ),
  });
}
