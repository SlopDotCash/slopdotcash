import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";

// Local generation only: no resource creation, signing, secret reads, or deployment.
const args = {};
const allowed = new Set([
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
      "Use --network NETWORK --database-id ID --database-name NAME --deployments PATH --output DIRECTORY",
    );
  args[key] = process.argv[index + 1];
}
const network = args.network;
if (
  !["base-sepolia", "solana-devnet", "solana-testnet"].includes(network) ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    args["database-id"] ?? "",
  ) ||
  !new RegExp(`^slop-payments-${network}(?:-[a-z0-9]+)*$`).test(
    args["database-name"] ?? "",
  ) ||
  args["database-name"].length > 43 ||
  !args.deployments ||
  !args.output
)
  throw new Error(
    "Explicit test network and isolated slop-payments-NETWORK database identity required",
  );
const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const deployments = JSON.parse(await readFile(args.deployments, "utf8"));
if (!Array.isArray(deployments) || !deployments.length)
  throw new Error("Expected reviewed deployment array");
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
  const project = assertProjectDefinition(
    JSON.parse(
      await readFile(
        resolve(repository, "projects", deployment.projectId, "project.json"),
        "utf8",
      ),
    ),
  );
  const reviewed = project.escrow?.deployments.find(
    (item) => item.network === network,
  );
  const policy = ESCROW_NETWORKS[network];
  const expected = reviewed && {
    projectId: project.id,
    ...reviewed,
    chain: policy.chain,
    ...(policy.chainId ? { chainId: policy.chainId } : {}),
  };
  if (!expected || !isDeepStrictEqual(expected, deployment))
    throw new Error(
      "Deployment differs from canonical project manifest; publish real chain evidence first",
    );
}
const output = resolve(args.output);
await mkdir(output, { recursive: true });
const names = Object.fromEntries(
  ["attester", "relayer", "dispatcher"].map((role) => [
    role,
    `${args["database-name"]}-${role}`,
  ]),
);
const common = {
  compatibility_date: "2026-10-06",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: false,
  preview_urls: false,
  routes: [],
  d1_databases: [
    {
      binding: "PAYMENTS_DB",
      database_name: args["database-name"],
      database_id: args["database-id"],
      migrations_dir: resolve(repository, "migrations"),
    },
  ],
};
const configs = {};
for (const role of ["attester", "relayer", "dispatcher"]) {
  const signer = role !== "dispatcher";
  const config = {
    ...common,
    name: names[role],
    main: resolve(root, signer ? "index.ts" : "../payments/index.ts"),
    vars: {
      PAYMENT_DEPLOYMENTS: JSON.stringify(deployments),
      ...(signer
        ? { SIGNER_ROLE: role, CHAIN_FAMILY: ESCROW_NETWORKS[network].chain }
        : {}),
    },
    ...(signer
      ? {
          durable_objects: {
            bindings: [{ name: "JOURNAL", class_name: "PaymentSignerJournal" }],
          },
          migrations: [
            { tag: "v1", new_sqlite_classes: ["PaymentSignerJournal"] },
          ],
        }
      : { triggers: { crons: ["*/5 * * * *"] } }),
    ...(role === "attester"
      ? {}
      : {
          services: [
            {
              binding:
                role === "relayer"
                  ? "IDENTITY_ATTESTER"
                  : network === "base-sepolia"
                    ? "BASE_PAYMENT_EXECUTOR"
                    : "SOLANA_PAYMENT_EXECUTOR",
              service: names[role === "relayer" ? "attester" : "relayer"],
            },
          ],
        }),
  };
  configs[role] = resolve(output, `${names[role]}.json`);
  await writeFile(configs[role], `${JSON.stringify(config, null, 2)}\n`);
  console.log(configs[role]);
}
const inactiveDispatcher = resolve(output, `${names.dispatcher}-inactive.json`);
const inactive = JSON.parse(await readFile(configs.dispatcher, "utf8"));
inactive.triggers = { crons: [] };
await writeFile(inactiveDispatcher, `${JSON.stringify(inactive, null, 2)}\n`);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const wrangler = quote(resolve(repository, "node_modules/.bin/wrangler"));
const command = (role, operation) =>
  `${wrangler} ${operation} --config ${quote(configs[role])}`;
const key =
  network === "base-sepolia"
    ? "TEST_SIGNER_PRIVATE_KEY"
    : "TEST_SOLANA_SIGNER_SEED";
const plan = [
  "#!/bin/sh",
  "set -eu",
  "# Explicit isolated test backend apply; secrets are entered at Wrangler prompts.",
  `cd ${quote(repository)}`,
  ...Object.keys(configs).map((role) => command(role, "deploy --dry-run")),
  `node ${quote(resolve(root, "assert-fresh-test-stack.mjs"))} ${Object.values(names).map(quote).join(" ")}`,
  command("dispatcher", "d1 migrations apply PAYMENTS_DB --remote"),
  ...["attester", "relayer"].flatMap((role) => [
    command(role, "deploy"),
    command(role, "secret put PAYMENT_RPC_URLS"),
    command(role, `secret put ${key}`),
  ]),
  `${wrangler} deploy --config ${quote(inactiveDispatcher)}`,
  // Fresh-only admission prevents modifying any existing active stack.
  command("dispatcher", "secret put PAYMENT_RPC_URLS"),
  ...(network.startsWith("solana")
    ? [command("dispatcher", "secret put PAYMENT_SOLANA_GENESIS")]
    : []),
  command("dispatcher", "deploy"),
  "",
];
await writeFile(resolve(output, "apply-test-backend.sh"), plan.join("\n"), {
  mode: 0o700,
});
await writeFile(
  resolve(output, "pages-bindings.json"),
  `${JSON.stringify({ network, note: "Merge only into isolated test Pages environment; never production.", d1_databases: [{ binding: "SLOP_DB", database_name: args["database-name"], database_id: args["database-id"] }], services: [{ binding: "SLOP_IDENTITY", service: "slop-identity-test" }], vars: { PAYMENTS_ALLOWED_ORIGIN: "https://slop-staging.pages.dev" }, requiredSecretNames: ["TRACE_AUTH_SECRET"], optionalOperatorVariable: "OPERATOR_GITHUB_IDS" }, null, 2)}\n`,
);
