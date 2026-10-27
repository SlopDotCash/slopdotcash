import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORICAL_PROJECTS } from "../../src/lib/projects.mjs";
import {
  readMonthlySchedule,
  readRegistryDatabase,
} from "../payments/registry-database.mjs";
import { MAINNET_EXECUTION } from "./mainnet-execution.mjs";
import { mainnetReleasePlan } from "./release-plan.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = async (provider, args) => {
  const result = await provider(args);
  if (result.status !== 0) throw new Error(`Attester ${args[0]} failed`);
  return result.stdout;
};

// Preflight every enabled network before changing any deployed service.
export async function prepareMainnetRelease({
  directory,
  account,
  sha,
  registry,
  provider,
}) {
  if (
    !/^[a-f0-9]{32}$/.test(account ?? "") ||
    !/^[a-f0-9]{40}$/.test(sha ?? "")
  )
    throw new Error("Exact release account and source required");
  await mkdir(directory, { recursive: true });
  const entries = mainnetReleasePlan({
    registry,
    registryDatabase: await readRegistryDatabase(),
    monthlySchedule: await readMonthlySchedule(),
  });
  const services = [];
  for (const entry of entries) {
    const path = join(directory, `${entry.config.name}.json`);
    const bytes = `${JSON.stringify(entry.config, null, 2)}\n`;
    await writeFile(path, bytes);
    let release = true;
    if (entry.pinCount) {
      const inventory = JSON.parse(
        await run(provider, ["secret", "list", "--config", path]),
      );
      if (
        !Array.isArray(inventory) ||
        JSON.stringify(inventory.map((item) => item?.name).sort()) !==
          JSON.stringify(entry.secrets)
      )
        throw new Error(
          `${entry.network} attester secret inventory is incomplete or unexpected`,
        );
    } else {
      const existing = await provider([
        "deployments",
        "list",
        "--name",
        entry.config.name,
        "--config",
        path,
        "--json",
      ]);
      if (existing.status === 0) release = false;
      else {
        const output = `${existing.stdout}\n${existing.stderr}`;
        const resource = `/accounts/${account}/workers/scripts/${entry.config.name}/deployments`;
        if (
          !output.includes(
            `A request to the Cloudflare API (${resource}) failed.`,
          ) ||
          !/\[code: 10007\]/.test(output)
        )
          throw new Error(`Cannot prove ${entry.network} attester absent`);
      }
    }
    services.push({
      network: entry.network,
      name: entry.config.name,
      bindings: entry.bindings,
      configSha256: digest(bytes),
      release,
      published: false,
    });
  }
  const plan = { sha, services };
  await writeFile(
    join(directory, "plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  return plan;
}

async function readPlan(directory, sha) {
  const plan = JSON.parse(await readFile(join(directory, "plan.json"), "utf8"));
  if (
    plan.sha !== sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !Array.isArray(plan.services) ||
    JSON.stringify(plan.services.map((entry) => entry.network)) !==
      JSON.stringify(
        Object.entries(MAINNET_EXECUTION)
          .filter(([, enabled]) => enabled)
          .map(([network]) => network),
      )
  )
    throw new Error("Attester plan does not match current release policy");
  return plan;
}

export async function publishMainnetRelease({ directory, sha, provider }) {
  const plan = await readPlan(directory, sha);
  for (const entry of plan.services) {
    if (!entry.release) continue; // Never replace an existing journal/pin set with an empty one.
    const path = join(directory, `${entry.name}.json`);
    if (digest(await readFile(path)) !== entry.configSha256)
      throw new Error("Prepared attester configuration changed");
    await run(provider, [
      "deploy",
      "--config",
      path,
      `--tag=${sha}`,
      `--message=slop.cash release ${sha}`,
    ]);
    const versions = JSON.parse(
      await run(provider, ["versions", "list", "--name", entry.name, "--json"]),
    );
    const deployment = JSON.parse(
      await run(provider, [
        "deployments",
        "status",
        "--name",
        entry.name,
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
        `${entry.network} attester version does not match tested source`,
      );
    entry.published = true;
  }
  await writeFile(
    join(directory, "plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
}

export async function assembleMainnetBindings({ directory, sha, path }) {
  const plan = await readPlan(directory, sha);
  const config = JSON.parse(await readFile(path, "utf8"));
  const reserved = new Set([
    "BINDING_RECOVERY",
    "BINDING_RECOVERY_ETHEREUM",
    "BINDING_RECOVERY_ROBINHOOD",
    "MONTHLY_RELEASE_BASE",
    "MONTHLY_RELEASE_ETHEREUM",
    "MONTHLY_RELEASE_ROBINHOOD",
    "MONTHLY_RELEASE_SOLANA",
    "SOLANA_IDENTITY_ATTESTER",
    "SECURITY_SOLANA_IDENTITY_ATTESTER",
  ]);
  if (plan.services.some((entry) => entry.release && !entry.published))
    throw new Error("Attester publication is not verified");
  config.vars.PAYMENT_NETWORKS = JSON.stringify(
    plan.services.map((entry) => entry.network),
  );
  config.services = (config.services ?? []).filter(
    (entry) => !reserved.has(entry.binding),
  );
  config.services.push(
    ...plan.services
      .filter((entry) => entry.published)
      .flatMap((entry) => entry.bindings),
  );
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
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
    throw new Error("Attester publication requires the protected main release");
  const [command, directory, path] = process.argv.slice(2);
  if (!directory) throw new Error("Release directory required");
  const sha = process.env.GITHUB_SHA;
  const provider = (args) =>
    spawnSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args],
      { encoding: "utf8", timeout: 120_000 },
    );
  if (command === "prepare")
    await prepareMainnetRelease({
      directory,
      sha,
      account: process.env.CLOUDFLARE_ACCOUNT_ID,
      registry: HISTORICAL_PROJECTS,
      provider,
    });
  else if (command === "publish")
    await publishMainnetRelease({ directory, sha, provider });
  else if (command === "assemble" && path)
    await assembleMainnetBindings({ directory, sha, path });
  else throw new Error("Select prepare, publish or assemble");
}
