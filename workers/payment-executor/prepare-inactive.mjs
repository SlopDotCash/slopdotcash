import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORICAL_PROJECTS } from "../../src/lib/projects.mjs";
import {
  readMonthlySchedule,
  readRegistryDatabase,
} from "../payments/registry-database.mjs";
import { paymentStack } from "./configure.mjs";
import { mainnetExecutionEnabled } from "./mainnet-execution.mjs";

// Preparation only. Network activation and pinned-vault releases stay separate.
const networks = ["solana-mainnet", "ethereum", "robinhood-mainnet"];

export async function prepareInactiveAttesters({
  registry,
  directory,
  account,
  sha,
  provider,
}) {
  if (
    !/^[a-f0-9]{32}$/.test(account ?? "") ||
    !/^[a-f0-9]{40}$/.test(sha ?? "")
  )
    throw new Error("Exact release account and source required");
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const network of networks) {
    const hasVault = registry.some((project) =>
      [project.escrow, project.securityBounty?.settlement].some((settlement) =>
        settlement?.deployments.some(
          (deployment) => deployment.network === network,
        ),
      ),
    );
    if (hasVault || mainnetExecutionEnabled(network)) {
      results.push({ network, status: "requires_network_release" });
      continue;
    }
    const { configs } = paymentStack({
      stack: "production",
      network,
      deployments: [],
      registry,
      registryDatabase: await readRegistryDatabase(),
      monthlySchedule: await readMonthlySchedule(),
    });
    const config = configs.attester;
    if (
      config.workers_dev !== false ||
      config.preview_urls !== false ||
      config.routes.length ||
      config.services !== undefined ||
      config.triggers.crons.length ||
      JSON.parse(config.vars.PAYMENT_DEPLOYMENTS).length ||
      JSON.parse(config.vars.SECURITY_PAYMENT_DEPLOYMENTS ?? "[]").length ||
      config.vars.SIGNER_STACK !== "production" ||
      config.vars.SIGNER_ROLE !== "attester"
    )
      throw new Error("Inactive attester boundary drifted");
    const path = join(directory, `${config.name}.json`);
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    const existing = await provider([
      "deployments",
      "list",
      "--name",
      config.name,
      "--config",
      path,
      "--json",
    ]);
    if (existing.status === 0) {
      results.push({ network, status: "existing_unchanged" });
      continue;
    }
    const output = `${existing.stdout}\n${existing.stderr}`;
    const resource = `/accounts/${account}/workers/scripts/${config.name}/deployments`;
    if (
      !output.includes(
        `A request to the Cloudflare API (${resource}) failed.`,
      ) ||
      !/\[code: 10007\]/.test(output)
    )
      throw new Error(`Cannot prove ${network} attester absent`);
    const deployed = await provider([
      "deploy",
      "--config",
      path,
      `--tag=${sha}`,
      `--message=Inactive attester preparation ${sha}`,
    ]);
    if (deployed.status !== 0)
      throw new Error(`${network} inactive attester deployment failed`);
    const versions = await provider([
      "versions",
      "list",
      "--name",
      config.name,
      "--json",
    ]);
    const deployment = await provider([
      "deployments",
      "status",
      "--name",
      config.name,
      "--json",
    ]);
    if (versions.status !== 0 || deployment.status !== 0)
      throw new Error(`${network} deployment readback failed`);
    const active = JSON.parse(deployment.stdout)?.versions;
    const published = JSON.parse(versions.stdout);
    if (
      !Array.isArray(active) ||
      active.length !== 1 ||
      active[0].percentage !== 100 ||
      !Array.isArray(published) ||
      !published.some(
        (version) =>
          version.id === active[0].version_id &&
          version.annotations?.["workers/tag"] === sha,
      )
    )
      throw new Error(`${network} deployment does not match tested source`);
    results.push({ network, status: "inactive_released" });
  }
  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)
  )
    throw new Error(
      "Inactive service publication requires the protected main release",
    );
  const directory = process.argv[2];
  if (!directory) throw new Error("Output directory required");
  const results = await prepareInactiveAttesters({
    registry: HISTORICAL_PROJECTS,
    directory,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    sha: process.env.GITHUB_SHA,
    provider: (args) =>
      spawnSync(
        process.execPath,
        ["node_modules/wrangler/bin/wrangler.js", ...args],
        { encoding: "utf8", timeout: 120_000 },
      ),
  });
  await writeFile(
    join(directory, "result.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(JSON.stringify(results));
}
