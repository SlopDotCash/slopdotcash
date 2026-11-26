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
 * The Worker's keyed chain endpoints, taken from the release's
 * `PAYMENT_RPC_URLS` map (network name to https URL), which the payment
 * Workers already read. The public endpoints refuse the Worker's log reads
 * from Cloudflare (Base "limit exceeded", Robinhood Chain HTTP 429, both read
 * on 19 November 2026). A network the map does not name gets no secret and
 * keeps the public default. Returns secret name to URL.
 */
export function endpointSecrets(
  raw: string | undefined,
): Record<string, string> {
  if (raw === undefined || raw.trim() === "") return {};
  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch {
    // Never echo the value: it holds endpoint keys.
    throw new Error("PAYMENT_RPC_URLS is not JSON");
  }
  if (typeof map !== "object" || map === null || Array.isArray(map))
    throw new Error("PAYMENT_RPC_URLS is not a JSON object");
  const secrets: Record<string, string> = {};
  for (const [network, name] of [
    ["base-mainnet", OPTIONAL_SECRETS[0]],
    ["robinhood-mainnet", OPTIONAL_SECRETS[1]],
  ] as const) {
    const url = (map as Record<string, unknown>)[network];
    if (url === undefined) continue;
    if (typeof url !== "string" || !/^https:\/\/[^\s]+$/u.test(url))
      throw new Error(`PAYMENT_RPC_URLS has no https URL for ${network}`);
    secrets[name] = url;
  }
  return secrets;
}

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
  const secretNames = () => {
    const inventory = read(["secret", "list", "--config", configPath]);
    if (!Array.isArray(inventory))
      throw new Error("Submission fee secret inventory is unreadable");
    return inventory.map((entry) => String(entry.name));
  };
  // Bind a keyed endpoint the Worker does not hold yet, before the tagged
  // deploy so the deployed version is still the one this release tags. The
  // value goes to wrangler on stdin and is never printed. To replace one,
  // delete the Worker secret; the next release binds it again.
  const held = secretNames();
  for (const [name, url] of Object.entries(
    endpointSecrets(process.env.PAYMENT_RPC_URLS),
  )) {
    if (held.includes(name)) {
      console.log(`${config.name} already holds ${name}`);
      continue;
    }
    execFileSync(wrangler, ["secret", "put", name, "--config", configPath], {
      input: url,
      stdio: ["pipe", "ignore", "inherit"],
    });
    console.log(`Bound ${name} for ${config.name}`);
  }
  for (const name of OPTIONAL_SECRETS)
    if (!secretNames().includes(name))
      console.log(
        `${config.name} has no ${name}; it reads the public endpoint`,
      );
  const mode = assertSubmissionFeeRelease(config, production, secretNames);
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
