import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_START_BLOCKS,
} from "../src/lib/submission-fee.mjs";
import {
  parseConfig,
  type SubmissionFeeEnv,
} from "../workers/submission-fee/config";
import { DEPOSIT_CRON, RATE_CRON } from "../workers/submission-fee/index";
import { assertActiveVersionTagged } from "./worker-release.mjs";

interface ReleaseConfig {
  name: string;
  workers_dev: boolean;
  preview_urls: boolean;
  routes?: unknown[];
  triggers?: { crons?: string[] };
  d1_databases: {
    binding: string;
    database_name: string;
    database_id: string;
  }[];
  vars: SubmissionFeeEnv;
}

const SECRET = "SUBMISSION_FEE_RESOLVER_KEY";
const OPTIONAL_SECRETS = [
  "RPC_URL_SUBMISSION_FEE_BASE",
  "RPC_URL_SUBMISSION_FEE_ROBINHOOD",
];

/**
 * What the reviewed configuration must be before a release. `secretNames` is
 * read only for `live`. Returns the mode it found.
 */
export function assertSubmissionFeeRelease(
  config: ReleaseConfig,
  production: Pick<ReleaseConfig, "d1_databases">,
  secretNames: () => string[],
  tables: {
    contracts: Record<string, string | null>;
    startBlocks: Record<string, number | null>;
  } = {
    contracts: SUBMISSION_FEE_CONTRACTS,
    startBlocks: SUBMISSION_FEE_START_BLOCKS,
  },
): string {
  const database = config.d1_databases;
  const crons = config.triggers?.crons ?? [];
  if (
    config.name !== "slop-submission-fee" ||
    config.workers_dev !== false ||
    config.preview_urls !== false ||
    (config.routes !== undefined &&
      (!Array.isArray(config.routes) || config.routes.length !== 0)) ||
    crons.length !== 2 ||
    !crons.includes(DEPOSIT_CRON) ||
    !crons.includes(RATE_CRON) ||
    !Array.isArray(database) ||
    database.length !== 1 ||
    database[0].binding !== "SUBMISSION_FEE_DB" ||
    !Array.isArray(production.d1_databases) ||
    !production.d1_databases.some(
      (entry) =>
        entry.database_name === "slop-private" &&
        entry.database_id === database[0].database_id,
    )
  )
    throw new Error(
      "Submission fee release must use the private production database",
    );
  // A key in the reviewed file would be a published secret.
  if (
    Object.keys(config.vars).some(
      (name) => name === SECRET || OPTIONAL_SECRETS.includes(name),
    )
  )
    throw new Error("Submission fee secrets must not be in wrangler.toml");
  // Off reads no other value. Any other mode must parse completely.
  const settings = parseConfig({
    ...config.vars,
    SUBMISSION_FEE_MODE:
      config.vars.SUBMISSION_FEE_MODE === "off"
        ? "dry_run"
        : config.vars.SUBMISSION_FEE_MODE,
  });
  const mode = (config.vars.SUBMISSION_FEE_MODE ?? "off").trim();
  if (mode !== "off" && mode !== settings.mode)
    throw new Error("Submission fee mode is not recognised");
  if (mode === "live") {
    if (
      Object.keys(tables.contracts).length === 0 ||
      Object.keys(tables.contracts).some(
        (network) =>
          !/^0x[0-9a-fA-F]{40}$/u.test(tables.contracts[network] ?? "") ||
          !Number.isSafeInteger(tables.startBlocks[network]),
      )
    )
      throw new Error(
        "Submission fee live mode needs every contract address and start block",
      );
    // Read names only. The resolver key stays in the Worker and never enters CI.
    const inventory = secretNames();
    if (
      !inventory.includes(SECRET) ||
      inventory.some(
        (name) => name !== SECRET && !OPTIONAL_SECRETS.includes(name),
      )
    )
      throw new Error("Submission fee resolver secret inventory is not ready");
  }
  return mode;
}

if (import.meta.main) {
  const sha = process.env.GITHUB_SHA;
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !/^[0-9a-f]{40}$/u.test(sha ?? "") ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
      sha
  )
    throw new Error(
      "Submission fee releases require the exact main workflow commit",
    );
  const configPath = "workers/submission-fee/wrangler.toml";
  const config = Bun.TOML.parse(
    readFileSync(configPath, "utf8"),
  ) as ReleaseConfig;
  const production = Bun.TOML.parse(
    readFileSync("wrangler.toml", "utf8"),
  ) as Pick<ReleaseConfig, "d1_databases">;
  const wrangler = "./node_modules/.bin/wrangler";
  const read = (args: string[]) =>
    JSON.parse(execFileSync(wrangler, args, { encoding: "utf8" }));
  const mode = assertSubmissionFeeRelease(config, production, () => {
    const inventory = read(["secret", "list", "--config", configPath]);
    if (!Array.isArray(inventory))
      throw new Error("Submission fee secret inventory is unreadable");
    return inventory.map((entry) => String(entry.name));
  });
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
  const status = read([
    "deployments",
    "status",
    "--name",
    config.name,
    "--json",
  ]);
  const versions = read(["versions", "list", "--name", config.name, "--json"]);
  assertActiveVersionTagged({
    deployment: status,
    versions,
    sha: sha as string,
    message: "Submission fee release is not bound to the workflow commit",
  });
  console.log(`Verified ${config.name} at ${sha}; mode ${mode}`);
}
