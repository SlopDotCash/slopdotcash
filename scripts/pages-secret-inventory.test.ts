import { expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { bashCommand } from "./bash-command";

if (process.platform === "win32") setDefaultTimeout(60_000);

const workflow = readFileSync(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const validator = workflow
  .split("node - \"$pages_secrets\" <<'NODE'\n")[1]
  .split("\n          NODE")[0];

function validate(names: string[]) {
  runInNewContext(validator, {
    require: () => ({
      readFileSync: () =>
        names.map((name) => `- ${name}: Value Encrypted`).join("\n"),
    }),
    process: { argv: ["node", "-", "inventory.txt"] },
  });
}

const required = ["OPERATOR_GITHUB_IDS", "TRACE_AUTH_SECRET"];

test("production accepts the provisioned Solana mint RPC and public GitHub read token without weakening its inventory gate", () => {
  const provisioned = [
    ...required,
    "REWARD_RPC_SOLANA",
    "SLOP_GITHUB_READ_TOKEN",
    "PAYMENT_RPC_URLS",
    "GITHUB_INTAKE_APP_CLIENT_ID",
    "GITHUB_INTAKE_APP_CLIENT_SECRET",
    "GITHUB_INTAKE_APP_ID",
    "GITHUB_INTAKE_APP_PRIVATE_KEY",
    "SLOP_INTAKE_GRANT_KEY",
    "SURPLUS_API_KEY",
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
  ];
  expect(() => validate(provisioned)).not.toThrow();
  expect(() => validate(required)).not.toThrow();
  expect(() => validate([...provisioned, "UNREVIEWED_SECRET"])).toThrow(
    "Pages secret inventory",
  );
  expect(() =>
    validate(provisioned.filter((name) => name !== "TRACE_AUTH_SECRET")),
  ).toThrow("Pages secret inventory");
  expect(() =>
    validate(provisioned.filter((name) => name !== "X_CLIENT_SECRET")),
  ).toThrow("X OAuth credentials must be configured together");
});

const parsed = Bun.YAML.parse(workflow) as {
  jobs: {
    deploy: {
      environment: { name: string };
      steps: {
        name?: string;
        run?: string;
        env?: Record<string, string>;
      }[];
    };
  };
};
const production = parsed.jobs.deploy;
const publication = production.steps.find(
  (step) => step.name === "Deploy private identity and Cloudflare Pages",
);
if (!publication?.run)
  throw new Error("Production publication shell step is missing");
const secretStart = publication.run.indexOf('slopbot_secrets="');
const secretEnd = publication.run.indexOf(
  "# Version deployments do not apply the scheduler or queue triggers.",
  secretStart,
);
if (secretStart < 0 || secretEnd < 0)
  throw new Error("Slopbot version secret publication contract is missing");
const secretPublication = publication.run
  .slice(secretStart, secretEnd)
  .replaceAll(
    "./node_modules/.bin/wrangler",
    '"$SLOP_TEST_RUNTIME" "$SLOP_TEST_CLI"',
  );
const appAndSurplus = [
  "SLOPBOT_APP_ID",
  "SLOPBOT_APP_PRIVATE_KEY",
  "SLOPBOT_APP_USER_ID",
  "SLOPBOT_WEBHOOK_SECRET",
  "SURPLUS_API_KEY",
];
const allSecrets = [...appAndSurplus, "ORBIO_API_KEY"];
const versionId = "12345678-1234-1234-1234-123456789abc";
const sourceSha = "a".repeat(40);
type Binding = { name: string; type: string };
const secretBindings = (names: readonly string[]): Binding[] =>
  names.map((name) => ({ name, type: "secret_text" }));

function publishSlopbot(
  options: {
    before?: readonly string[];
    bindings?: readonly Binding[];
    key?: string | null;
    id?: string;
    sha?: string;
    failure?: "upload" | "view" | "malformed-id";
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "slopbot-release-secret-"));
  const stub = join(root, "wrangler.cjs");
  const history = join(root, "calls.jsonl");
  // Execute the checked-in shell with a CLI boundary stub. It inspects the
  // temporary file in place without copying or recording its credential.
  writeFileSync(
    stub,
    `const fs = require("node:fs");
const assert = require("node:assert/strict");
const args = process.argv.slice(2);
const scenario = JSON.parse(process.env.SLOP_TEST_SCENARIO);
const record = (extra = {}) => fs.appendFileSync(process.env.SLOP_TEST_HISTORY, JSON.stringify({args, ...extra}) + "\\n");
if (args[0] === "secret" && args[1] === "list") {
  record();
  console.log(JSON.stringify(scenario.before.map(name => ({name, type: "secret_text"}))));
} else if (args[0] === "versions" && args[1] === "upload") {
  const file = args.find(arg => arg.startsWith("--secrets-file="))?.slice("--secrets-file=".length);
  assert.ok(file, "version upload must receive a secret file");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(value), ["ORBIO_API_KEY"]);
  assert.ok(value.ORBIO_API_KEY === process.env.ORBIO_API_KEY, "upload credential must come from the protected environment");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  record({file});
  if (scenario.failure === "upload") process.exit(9);
  console.log("Worker Version ID: " + (scenario.failure === "malformed-id" ? "invalid" : "${versionId}"));
} else if (args[0] === "versions" && args[1] === "view") {
  assert.equal(args[2], "${versionId}");
  assert.ok(args.includes("--name") && args.includes("slop-slopbot") && args.includes("--json"));
  const calls = fs.readFileSync(process.env.SLOP_TEST_HISTORY, "utf8").trim().split("\\n").map(JSON.parse);
  assert.ok(!fs.existsSync(calls.find(call => call.file).file), "secret file must be removed before readback");
  const metadata = fs.readdirSync(process.env.RUNNER_TEMP).filter(name => name.startsWith("slopbot-uploaded-version."));
  assert.equal(metadata.length, 1);
  if (process.platform !== "win32") assert.equal(fs.statSync(require("node:path").join(process.env.RUNNER_TEMP, metadata[0])).mode & 0o777, 0o600);
  record();
  if (scenario.failure === "view") process.exit(9);
  console.log(JSON.stringify(scenario.version));
} else if (args[0] === "versions" && args[1] === "deploy") {
  assert.ok(args.includes("--version-id=${versionId}") && args.includes("--percentage=100"));
  record();
} else throw new Error("Unreviewed release command");
`,
  );
  writeFileSync(join(root, "slopbot-value-args"), "");
  const key =
    options.key === undefined ? "fixture-only-provider-key" : options.key;
  try {
    const result = spawnSync(
      bashCommand(),
      [
        "-euc",
        `set -o pipefail\ntrap 'touch "$RUNNER_TEMP/parent-cleanup"' EXIT\n${secretPublication}`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          RUNNER_TEMP: root,
          GITHUB_SHA: sourceSha,
          ...(key === null ? {} : { ORBIO_API_KEY: key }),
          SLOP_TEST_RUNTIME: process.execPath,
          SLOP_TEST_CLI: stub,
          SLOP_TEST_HISTORY: history,
          SLOP_TEST_SCENARIO: JSON.stringify({
            before: options.before ?? appAndSurplus,
            failure: options.failure,
            version: {
              id: options.id ?? versionId,
              annotations: { "workers/tag": options.sha ?? sourceSha },
              resources: {
                bindings: options.bindings ?? [
                  ...secretBindings(allSecrets),
                  { name: "SLOP_ENVIRONMENT", type: "plain_text" },
                  { name: "DB", type: "d1" },
                ],
              },
            },
          }),
        },
      },
    );
    const calls = existsSync(history)
      ? readFileSync(history, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).args as string[])
      : [];
    expect(
      readdirSync(root).filter((name) =>
        name.startsWith("slopbot-upload-secrets."),
      ),
    ).toEqual([]);
    expect(existsSync(join(root, "parent-cleanup"))).toBe(true);
    if (key?.trim()) expect(result.stdout + result.stderr).not.toContain(key);
    return { ...result, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the protected production step supplies Orbio to its own version upload", () => {
  expect(production.environment.name).toBe("slop-production");
  expect(publication.env?.ORBIO_API_KEY).toBe(
    "$" + "{{ secrets.ORBIO_API_KEY }}",
  );
});

test.each([
  { before: appAndSurplus },
  {
    before: [...allSecrets, "ORBIO_BASE_URL", "SURPLUS_BASE_URL"],
    bindings: secretBindings([
      ...allSecrets,
      "ORBIO_BASE_URL",
      "SURPLUS_BASE_URL",
    ]),
  },
])(
  "Slopbot uploads the protected key with the tested version and promotes only after readback: %j",
  (options) => {
    const result = publishSlopbot(options);
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls.map((args) => args.slice(0, 2))).toEqual([
      ["secret", "list"],
      ["versions", "upload"],
      ["versions", "view"],
      ["versions", "deploy"],
    ]);
  },
);

test.each(appAndSurplus)(
  "missing existing %s refuses before upload",
  (name) => {
    const result = publishSlopbot({
      before: appAndSurplus.filter((entry) => entry !== name),
    });
    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(1);
  },
);

test.each([null, "", "   "])(
  "absent or empty protected Orbio credential refuses before upload: %j",
  (key) => {
    const result = publishSlopbot({ key });
    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(1);
  },
);

test.each(allSecrets)(
  "uploaded version missing %s remains unpromoted",
  (name) => {
    const result = publishSlopbot({
      bindings: secretBindings(allSecrets.filter((entry) => entry !== name)),
    });
    expect(result.status).not.toBe(0);
    expect(result.calls.map((args) => args[1])).toEqual([
      "list",
      "upload",
      "view",
    ]);
  },
);

test.each([
  { before: [...appAndSurplus, "UNREVIEWED_SECRET"] },
  { bindings: secretBindings([...allSecrets, "UNREVIEWED_SECRET"]) },
  { bindings: secretBindings([...allSecrets, "ORBIO_API_KEY"]) },
  {
    bindings: [
      ...secretBindings(appAndSurplus),
      { name: "ORBIO_API_KEY", type: "plain_text" },
    ],
  },
  { id: "87654321-4321-4321-4321-cba987654321" },
  { sha: "b".repeat(40) },
  { failure: "upload" as const },
  { failure: "view" as const },
  { failure: "malformed-id" as const },
])(
  "Slopbot refuses incomplete or uncertain publication without promotion: %j",
  (options) => {
    const result = publishSlopbot(options);
    expect(result.status).not.toBe(0);
    expect(result.calls.some((args) => args[1] === "deploy")).toBe(false);
  },
);
