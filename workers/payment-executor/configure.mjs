import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { fetchProjectRegistry } from "../../scripts/sync-project-registry.mjs";
import {
  ESCROW_NETWORKS,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import { HISTORICAL_PROJECTS } from "../../src/lib/projects.mjs";
import {
  readMonthlySchedule,
  readRegistryDatabase,
} from "../payments/registry-database.mjs";
import { SIGNER_STACKS } from "./signer-stacks.mjs";

// Local generation only: no resource creation, signing, secret reads, or deployment.
const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const ROLES = ["attester", "relayer", "dispatcher"];
// PRD PAY-04: the relayer key is held by the project or a permissionless
// executor, never by Slop, and Slop runs no scheduled job that starts a
// payment. The PAY-05 identity attester is the only Slop-held payment key.
const PRODUCTION_ROLES = ["attester"];
// deploymentOrigins("staging").api in src/lib/deployment.ts.
const STAGING_REGISTRY_ORIGIN = "https://staging.slop.cash";

/**
 * Builds the Wrangler configurations of one payment stack for one network.
 *
 * A `test` stack serves one registry test network with its own isolated
 * payment database. A `production` stack serves one registry mainnet. Its
 * payment database is the registry database (`SLOP_DB` in wrangler.toml),
 * because the account API writes wallet claims and binding authorizations
 * there; the Pages release applies its migrations, so no configuration here
 * migrates it. A production stack has the identity attester only (PRD
 * PAY-04, PAY-05): no relayer and no dispatcher, because the project or a
 * permissionless executor holds the relayer key and submits payments. The
 * attester reads only the production secret and journal of
 * `signer-stacks.mjs`, and it refuses the mainnet until the network's
 * reviewed `MAINNET_EXECUTION` value is `true`. Every deployment must equal
 * its canonical project manifest in `registry`.
 *
 * A `staging` test stack serves the staging site instead of an isolated
 * frontend. Like production, its payment database is the staging registry
 * database (`SLOP_DB` in wrangler.staging.toml), so the staging account API
 * and pages read what its signers and dispatcher record, and its pins are
 * every deployment of the network in the staging registry. Its `keeper`
 * topology runs as production does: the attester binds on its schedule, the
 * dispatcher has no schedule, and an independent keeper submits payments.
 */
export function paymentStack({
  stack = "test",
  environment = "isolated",
  topology = "relayer",
  singleNonceBindings = false,
  scope = "ordinary",
  network,
  databaseId,
  databaseName,
  deployments,
  registry,
  registryDatabase,
  monthlySchedule,
}) {
  if (!["ordinary", "security-bounty"].includes(scope))
    throw new Error("Unknown payment scope");
  const policy = Object.hasOwn(ESCROW_NETWORKS, network ?? "")
    ? ESCROW_NETWORKS[network]
    : undefined;
  if (!["isolated", "staging"].includes(environment))
    throw new Error("Unknown test environment");
  if (!["relayer", "keeper"].includes(topology))
    throw new Error("Unknown payment topology");
  const staging = environment === "staging";
  if ((staging || topology === "keeper") && (stack !== "test" || !staging))
    throw new Error("Only a staging test stack has a staging topology");
  const projects = assertProjectRegistry(registry);
  if (staging) {
    if (
      policy?.testnet !== true ||
      scope !== "ordinary" ||
      databaseId !== undefined ||
      databaseName !== undefined ||
      deployments !== undefined
    )
      throw new Error(
        "A staging stack serves one registry test network from the staging registry; do not name a database or deployments",
      );
    // The staging registry database only, never production storage.
    if (registryDatabase.database_name !== "slop-staging")
      throw new Error("A staging stack requires the slop-staging database");
    deployments = projects.flatMap((project) =>
      (project.escrow?.deployments ?? [])
        .filter((deployment) => deployment.network === network)
        .map((deployment) => paymentDeploymentRecord(project.id, deployment)),
    );
    if (!deployments.length)
      throw new Error("The staging registry has no deployment on this network");
  } else if (stack === "test") {
    if (
      // Test stacks only: every registry test network, never a mainnet.
      policy?.testnet !== true ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        databaseId ?? "",
      ) ||
      !new RegExp(`^slop-payments-${network}(?:-[a-z0-9]+)*$`).test(
        databaseName ?? "",
      ) ||
      databaseName.length > 43
    )
      throw new Error(
        "Explicit test network and isolated slop-payments-NETWORK database identity required",
      );
    // The dispatcher finds vaults in the project registry, which is the Pages
    // SLOP_DB, not the isolated payment database (its projects table is empty).
    if (registryDatabase.database_id === databaseId)
      throw new Error(
        "The isolated payment database must not be the project registry database",
      );
  } else if (stack === "production") {
    if (policy?.testnet !== false)
      throw new Error("A production stack serves one registry mainnet");
    if (databaseId !== undefined || databaseName !== undefined)
      throw new Error(
        "A production stack uses the registry database; do not name another database",
      );
  } else throw new Error("Select --stack test or --stack production");
  if (
    !Array.isArray(deployments) ||
    (stack !== "production" && !deployments.length)
  )
    throw new Error("Expected reviewed deployment array");
  if (
    !deployments.length &&
    projects.some((project) =>
      (scope === "security-bounty"
        ? project.securityBounty?.settlement
        : project.escrow
      )?.deployments.some((deployment) => deployment.network === network),
    )
  )
    throw new Error("Empty attester configuration omits reviewed deployments");
  const seen = new Set();
  for (const deployment of deployments) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(deployment.projectId ?? "") ||
      deployment.network !== network ||
      seen.has(deployment.projectId)
    )
      throw new Error(
        "Exactly one network and one deployment per project required",
      );
    seen.add(deployment.projectId);
    const project = projects.find((item) => item.id === deployment.projectId);
    const settlement =
      scope === "security-bounty"
        ? project?.securityBounty?.settlement
        : project?.escrow;
    const reviewed = settlement?.deployments.find(
      (item) => item.network === network,
    );
    const expected = reviewed && {
      ...paymentDeploymentRecord(project.id, reviewed),
      ...(scope === "security-bounty" ? { payoutPolicy: scope } : {}),
    };
    if (!expected || !isDeepStrictEqual(expected, deployment))
      throw new Error(
        "Deployment differs from canonical project manifest; publish real chain evidence first",
      );
  }
  const production = stack === "production";
  const roles = production ? PRODUCTION_ROLES : ROLES;
  // A factory uses one identity key for ordinary and bounty vaults. Keep
  // its nonce and signed-binding journal in one production Durable Object.
  const scopedDeployments = (kind) =>
    projects.flatMap((project) =>
      (
        (kind === "security-bounty"
          ? project.securityBounty?.settlement
          : project.escrow
        )?.deployments ?? []
      )
        .filter((deployment) => deployment.network === network)
        .map((deployment) => ({
          ...paymentDeploymentRecord(project.id, deployment),
          ...(kind === "security-bounty" ? { payoutPolicy: kind } : {}),
        })),
    );
  const ordinaryPins = production ? scopedDeployments("ordinary") : deployments;
  const privatePins = production ? scopedDeployments("security-bounty") : [];
  const prefix = `${production ? `slop-payments-${network}` : staging ? `slop-payments-${network}-staging` : databaseName}${!production && scope === "security-bounty" ? "-bounty" : ""}`;
  const names = Object.fromEntries(
    roles.map((role) => [role, `${prefix}-${role}`]),
  );
  const paymentsDatabase =
    production || staging
      ? // No migrations_dir: the Pages release migrates the registry database.
        { binding: "PAYMENTS_DB", ...registryDatabase }
      : {
          binding: "PAYMENTS_DB",
          database_name: databaseName,
          database_id: databaseId,
          migrations_dir: resolve(repository, "migrations"),
        };
  const common = {
    compatibility_date: "2026-10-06",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    routes: [],
    d1_databases: [paymentsDatabase],
  };
  const family = policy.family;
  if (typeof singleNonceBindings !== "boolean")
    throw new Error("Invalid single-nonce binding configuration");
  if (
    singleNonceBindings &&
    (!staging || stack !== "test" || topology !== "keeper" || family !== "evm")
  )
    throw new Error(
      "Single-nonce bindings require the staging EVM keeper topology",
    );
  const configs = {};
  for (const role of roles) {
    const signer = role !== "dispatcher";
    const scheduledAttester =
      role === "attester" && (production || scope === "ordinary");
    configs[role] = {
      ...common,
      name: names[role],
      ...(role === "attester"
        ? {
            observability: {
              enabled: true,
              head_sampling_rate: 1,
              logs: {
                enabled: true,
                head_sampling_rate: 1,
                persist: true,
                invocation_logs: false,
              },
              traces: { enabled: false },
            },
          }
        : {}),
      main: resolve(
        root,
        signer
          ? "entrypoint.ts"
          : scope === "security-bounty"
            ? "../security-payments/index.ts"
            : "../payments/index.ts",
      ),
      // Signers sign only for the deployments pinned here at review time. The
      // monthly attester also checks current registry policy before signing;
      // the dispatcher discovers its vaults from that registry.
      ...(signer && !scheduledAttester
        ? {}
        : {
            d1_databases: [
              ...common.d1_databases,
              // No migrations_dir: this configuration never migrates the registry.
              {
                binding: "REGISTRY_DB",
                ...(scope === "security-bounty"
                  ? {
                      database_name: paymentsDatabase.database_name,
                      database_id: paymentsDatabase.database_id,
                    }
                  : registryDatabase),
              },
            ],
          }),
      vars: signer
        ? {
            PAYMENT_DEPLOYMENTS: JSON.stringify(ordinaryPins),
            ...(privatePins.length
              ? { SECURITY_PAYMENT_DEPLOYMENTS: JSON.stringify(privatePins) }
              : {}),
            ...(!production && scope === "security-bounty"
              ? { PAYMENT_SCOPE: scope }
              : {}),
            SIGNER_ROLE: role,
            SIGNER_STACK: stack,
            CHAIN_FAMILY: family,
            ...(scheduledAttester && monthlySchedule !== undefined
              ? { MONTHLY_PAYMENT_SCHEDULE: monthlySchedule }
              : {}),
            ...(role === "attester" && topology === "keeper"
              ? {
                  SCHEDULED_BINDINGS: "on",
                  ...(singleNonceBindings
                    ? { TEST_BINDING_NONCE_LIMIT: "1" }
                    : {}),
                }
              : {}),
          }
        : {
            PAYMENT_NETWORKS: JSON.stringify([network]),
            // The ordinary dispatcher runs the monthly coordinator with the
            // owner-decided cutoff of the Pages configuration (decision D1).
            ...(scope === "ordinary" && monthlySchedule !== undefined
              ? { MONTHLY_PAYMENT_SCHEDULE: monthlySchedule }
              : {}),
          },
      ...(signer
        ? {
            ...(scheduledAttester
              ? {
                  triggers: {
                    crons:
                      production &&
                      ordinaryPins.length + privatePins.length === 0
                        ? []
                        : ["*/5 * * * *"],
                  },
                }
              : {}),
            durable_objects: {
              bindings: [
                { name: "JOURNAL", class_name: "PaymentSignerJournal" },
              ],
            },
            migrations: [
              { tag: "v1", new_sqlite_classes: ["PaymentSignerJournal"] },
            ],
          }
        : {
            // The keeper topology submits no payment from Slop.
            triggers: { crons: topology === "keeper" ? [] : ["*/5 * * * *"] },
          }),
      ...(role === "attester"
        ? {}
        : {
            services: [
              {
                binding:
                  role === "relayer"
                    ? "IDENTITY_ATTESTER"
                    : family === "evm"
                      ? "EVM_PAYMENT_EXECUTOR"
                      : "SOLANA_PAYMENT_EXECUTOR",
                service: names[role === "relayer" ? "attester" : "relayer"],
              },
            ],
          }),
    };
  }
  return {
    names,
    configs,
    secret:
      family === "evm"
        ? SIGNER_STACKS[stack].evmSecret
        : SIGNER_STACKS[stack].solanaSecret,
  };
}

async function main() {
  const args = {};
  const allowed = new Set([
    "stack",
    "environment",
    "topology",
    "scope",
    "network",
    "database-id",
    "database-name",
    "deployments",
    "output",
  ]);
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]?.replace(/^--/, "");
    if (
      !process.argv[index]?.startsWith("--") ||
      !allowed.has(key) ||
      args[key] ||
      !process.argv[index + 1]
    )
      throw new Error(
        "Use [--stack test] --network NETWORK --database-id ID --database-name NAME --deployments PATH --output DIRECTORY, --environment staging [--topology keeper] --network NETWORK --output DIRECTORY, or --stack production --network MAINNET --deployments PATH --output DIRECTORY",
      );
    args[key] = process.argv[index + 1];
  }
  const staging = args.environment === "staging";
  if ((!staging && !args.deployments) || !args.output)
    throw new Error("--deployments and --output are required");
  const stack = args.stack ?? "test";
  const network = args.network;
  const pages = staging ? "wrangler.staging.toml" : "wrangler.toml";
  const { names, configs, secret } = paymentStack({
    stack,
    environment: args.environment,
    topology: args.topology,
    scope: args.scope,
    network,
    databaseId: args["database-id"],
    databaseName: args["database-name"],
    deployments: args.deployments
      ? JSON.parse(await readFile(args.deployments, "utf8"))
      : undefined,
    // The D1 project registry is the reviewed source: the production
    // snapshot (`bun run projects:sync`), or the live staging registry.
    registry: staging
      ? (await fetchProjectRegistry(STAGING_REGISTRY_ORIGIN)).projects
      : HISTORICAL_PROJECTS,
    registryDatabase: await readRegistryDatabase(pages),
    monthlySchedule: await readMonthlySchedule(pages),
  });
  const output = resolve(args.output);
  await mkdir(output, { recursive: true });
  const paths = {};
  for (const role of Object.keys(configs)) {
    paths[role] = resolve(output, `${names[role]}.json`);
    await writeFile(paths[role], `${JSON.stringify(configs[role], null, 2)}\n`);
    console.log(paths[role]);
  }
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const wrangler = quote(resolve(repository, "node_modules/.bin/wrangler"));
  const command = (role, operation) =>
    `${wrangler} ${operation} --config ${quote(paths[role])}`;
  const signerSetup = (role) => [
    command(role, "deploy"),
    command(role, "secret put PAYMENT_RPC_URLS"),
    command(role, `secret put ${secret}`),
  ];
  if (stack === "production") {
    // Operator-run only (contracts/DEPLOY-MAINNET.md section 3.2). The
    // attester refuses this network until its reviewed MAINNET_EXECUTION
    // value is true. Slop deploys no relayer and no dispatcher (PRD PAY-04).
    const plan = [
      "#!/bin/sh",
      "set -eu",
      `# Production identity attester for ${network}; the secret is entered at a Wrangler prompt.`,
      "# The Pages release migrates the registry database; this script never migrates it.",
      `cd ${quote(repository)}`,
      command("attester", "deploy --dry-run"),
      ...signerSetup("attester"),
      "",
    ];
    await writeFile(
      resolve(output, "apply-production-stack.sh"),
      plan.join("\n"),
      { mode: 0o700 },
    );
    return;
  }
  const inactiveDispatcher = resolve(
    output,
    `${names.dispatcher}-inactive.json`,
  );
  await writeFile(
    inactiveDispatcher,
    `${JSON.stringify({ ...configs.dispatcher, triggers: { crons: [] } }, null, 2)}\n`,
  );
  const solana = ESCROW_NETWORKS[network].family === "solana";
  const dispatcherSecrets = [
    command("dispatcher", "secret put PAYMENT_RPC_URLS"),
    ...(solana
      ? [command("dispatcher", "secret put PAYMENT_SOLANA_GENESIS")]
      : []),
  ];
  const signers = ["attester", "relayer"].flatMap(signerSetup);
  const dryRuns = ROLES.map((role) => command(role, "deploy --dry-run"));
  const plan = [
    "#!/bin/sh",
    "set -eu",
    "# Explicit isolated test backend apply; secrets are entered at Wrangler prompts.",
    `cd ${quote(repository)}`,
    ...dryRuns,
    `node ${quote(resolve(root, "assert-fresh-test-stack.mjs"))} ${Object.values(names).map(quote).join(" ")}`,
    // The staging Pages release migrates slop-staging.
    ...(staging
      ? []
      : [command("dispatcher", "d1 migrations apply PAYMENTS_DB --remote")]),
    ...signers,
    `${wrangler} deploy --config ${quote(inactiveDispatcher)}`,
    // Fresh-only admission prevents modifying any existing active stack.
    ...dispatcherSecrets,
    command("dispatcher", "deploy"),
    "",
  ];
  await writeFile(resolve(output, "apply-test-backend.sh"), plan.join("\n"), {
    mode: 0o700,
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
