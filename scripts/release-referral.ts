import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  parseConfig,
  type ReferralAccrualEnv,
} from "../workers/referral-accrual/config";

interface ReleaseConfig {
  name: string;
  workers_dev: boolean;
  preview_urls: boolean;
  routes?: unknown[];
  d1_databases: {
    binding: string;
    database_name: string;
    database_id: string;
  }[];
  vars: ReferralAccrualEnv & {
    REFERRAL_DEPLOYMENT_BLOCK?: string;
    REFERRAL_DISTRIBUTOR_CODE_HASH?: string;
  };
}

const sha = process.env.GITHUB_SHA;
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REF !== "refs/heads/main" ||
  !/^[0-9a-f]{40}$/u.test(sha ?? "") ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
    sha
)
  throw new Error("Referral releases require the exact main workflow commit");

const configPath = "workers/referral-accrual/wrangler.toml";
const config = Bun.TOML.parse(
  readFileSync(configPath, "utf8"),
) as ReleaseConfig;
const production = Bun.TOML.parse(
  readFileSync("wrangler.toml", "utf8"),
) as Pick<ReleaseConfig, "d1_databases">;
const database = config.d1_databases;
const productionDatabases = production.d1_databases;
if (
  config.name !== "slop-referral-accrual" ||
  config.workers_dev !== false ||
  config.preview_urls !== false ||
  (config.routes !== undefined &&
    (!Array.isArray(config.routes) || config.routes.length !== 0)) ||
  !Array.isArray(database) ||
  database.length !== 1 ||
  database[0].binding !== "REFERRAL_DB" ||
  !Array.isArray(productionDatabases) ||
  !productionDatabases.some(
    (entry) =>
      entry.database_name === "slop-private" &&
      entry.database_id === database[0].database_id,
  )
)
  throw new Error("Referral release must use the private production database");
const settings = parseConfig(config.vars);
const wrangler = "./node_modules/.bin/wrangler";
const read = (args: string[]) =>
  JSON.parse(execFileSync(wrangler, args, { encoding: "utf8" }));
if (settings.mode === "live") {
  if (
    !/^(0|[1-9][0-9]*)$/u.test(config.vars.REFERRAL_DEPLOYMENT_BLOCK ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(config.vars.REFERRAL_DISTRIBUTOR_CODE_HASH ?? "")
  )
    throw new Error("Referral deployment evidence is missing");
  // Read names only. The poster key stays in the Worker and never enters CI.
  const inventory = read(["secret", "list", "--config", configPath]);
  if (
    !Array.isArray(inventory) ||
    !inventory.some((entry) => entry.name === "REFERRAL_POSTER_KEY") ||
    inventory.some(
      (entry) =>
        !["REFERRAL_POSTER_KEY", "RPC_URL_REFERRAL"].includes(entry.name),
    )
  )
    throw new Error("Referral poster secret inventory is not ready");
}

execFileSync(
  wrangler,
  [
    "deploy",
    "--config",
    configPath,
    "--tag",
    sha as string,
    "--message",
    `slop.cash release ${sha}`,
  ],
  { stdio: "inherit" },
);
const status = read(["deployments", "status", "--name", config.name, "--json"]);
const versions = read(["versions", "list", "--name", config.name, "--json"]);
const active = status?.versions;
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
  throw new Error("Referral release is not bound to the workflow commit");
console.log(`Verified ${config.name} at ${sha}; mode ${settings.mode}`);
