/**
 * Runs the fee-converter release preflight from deploy.yml as the workflow
 * runs it: `bash -e`, with the running Bun first on PATH. CI runs this file
 * with the pinned BUN_VERSION. A refused configuration must stop the release
 * before the Worker upload that follows the preflight.
 */
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const source = resolve(import.meta.dir, "..");
const workflow = Bun.YAML.parse(
  readFileSync(join(source, ".github/workflows/deploy.yml"), "utf8"),
) as { jobs: Record<string, { steps?: { name?: string; run?: string }[] }> };
const lines =
  Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .find(
      (step) => step.name === "Deploy private identity and Cloudflare Pages",
    )
    ?.run?.split("\n") ?? [];
const start = lines.findIndex((line) =>
  line.includes(
    `"$converter_secrets" workers/fee-converter/wrangler.toml <<'NODE'`,
  ),
);
const end = lines.findIndex(
  (line, index) => index > start && line.startsWith("converter_upload="),
);
if (start === -1 || end === -1)
  throw new Error("deploy.yml lacks the fee-converter release preflight");
const preflight = lines.slice(start, end).join("\n");

// The checkout layout the preflight reads: the Worker's own parser and a
// wrangler.toml derived from the reviewed one.
const root = mkdtempSync(join(tmpdir(), "slop-fee-converter-preflight-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "workers/fee-converter"), { recursive: true });
// Load the real parser and its dependencies without a file symlink, which
// requires elevated privileges or Developer Mode on Windows.
writeFileSync(
  join(root, "workers/fee-converter/config.ts"),
  `export { parseConfig } from ${JSON.stringify(join(source, "workers/fee-converter/config.ts"))};\n`,
);
const reviewed = readFileSync(
  join(source, "workers/fee-converter/wrangler.toml"),
  "utf8",
);

function release(mode: string, networks: string, secrets: string[]) {
  const toml = reviewed
    .replace(/^FEE_CONVERTER_MODE = ".*"$/mu, `FEE_CONVERTER_MODE = "${mode}"`)
    .replace(
      /^FEE_CONVERTER_NETWORKS = ".*"$/mu,
      `FEE_CONVERTER_NETWORKS = "${networks}"`,
    );
  writeFileSync(join(root, "workers/fee-converter/wrangler.toml"), toml);
  const inventory = join(root, "secrets.json");
  writeFileSync(
    inventory,
    JSON.stringify(secrets.map((name) => ({ name, type: "secret_text" }))),
  );
  return spawnSync(
    "bash",
    [
      "-e",
      "-c",
      `converter_secrets="$1"\n${preflight}\necho "fee-converter upload reached"`,
      "bash",
      inventory,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
      },
    },
  );
}

test.each([
  [
    "an unreviewed Worker secret",
    "live",
    "base",
    ["FEE_WALLET_KEY_BASE", "UNREVIEWED_SECRET"],
  ],
  ["a network the Worker parser refuses", "dry_run", "base,polygon", []],
  [
    "live mode without an enabled network's key",
    "live",
    "base,ethereum",
    ["FEE_WALLET_KEY_BASE"],
  ],
])("the release stops before upload on %s", (_, mode, networks, secrets) => {
  const result = release(mode, networks, secrets);
  expect(result.status).not.toBe(0);
  expect(result.stdout).not.toContain("fee-converter upload reached");
});

test("the release continues when every enabled live network has its key", () => {
  const result = release("live", "base,ethereum", [
    "FEE_WALLET_KEY_BASE",
    "FEE_WALLET_KEY_ETHEREUM",
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(
    "fee-converter mode live; networks base,ethereum\nfee-converter upload reached\n",
  );
});
