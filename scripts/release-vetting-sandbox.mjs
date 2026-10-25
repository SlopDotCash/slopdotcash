/** Release the exact container image from the checked-in Actions workflow only. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [target] = process.argv.slice(2);
const sha = process.env.GITHUB_SHA;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const branch = target === "production" ? "main" : "development";
if (
  !["production", "staging"].includes(target) ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REF !== `refs/heads/${branch}` ||
  !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME) ||
  !/^[a-f0-9]{40}$/.test(sha ?? "") ||
  !/^[a-f0-9]{32}$/.test(account ?? "") ||
  !process.env.RUNNER_TEMP ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim() !== sha
)
  throw new Error("The exact trusted Actions release checkout is required");

const source = resolve(root, "workers/vetting-sandbox");
await import("./prepare-vetting-sandbox.mjs");
const configPath = resolve(
  source,
  target === "production" ? "wrangler.toml" : "wrangler.staging.toml",
);
const config = Bun.TOML.parse(readFileSync(configPath, "utf8"));
const wrangler = resolve(root, "node_modules/.bin/wrangler");
const tag = `${config.name}:${sha}`;
execFileSync(
  wrangler,
  ["containers", "build", source, "--tag", tag, "--config", configPath],
  { cwd: root, stdio: "inherit" },
);
execFileSync(wrangler, ["containers", "push", tag, "--config", configPath], {
  cwd: root,
  stdio: "inherit",
});
const repository = `registry.cloudflare.com/${account}/${config.name}`;
const digests = JSON.parse(
  execFileSync(
    "docker",
    [
      "image",
      "inspect",
      `${repository}:${sha}`,
      "--format",
      "{{json .RepoDigests}}",
    ],
    { encoding: "utf8" },
  ),
);
const matching = Array.isArray(digests)
  ? digests.filter(
      (value) =>
        typeof value === "string" && value.startsWith(`${repository}@sha256:`),
    )
  : [];
if (
  matching.length !== 1 ||
  !new RegExp(
    `^${repository.replaceAll(".", "\\.")}@sha256:[a-f0-9]{64}$`,
  ).test(matching[0])
)
  throw new Error("The uploaded container has no unique immutable digest");
const image = matching[0];
config.main = resolve(source, config.main);
config.containers = config.containers.map((container) => ({
  ...container,
  image,
}));
config.vars = {
  ...config.vars,
  SLOP_RELEASE_SHA: sha,
  RUNNER_IMAGE_SHA256: image.split("@sha256:")[1],
};
const output = resolve(
  process.env.RUNNER_TEMP,
  `slop-vetting-sandbox-${target}`,
);
mkdirSync(output, { recursive: true });
const generated = resolve(output, "wrangler.json");
writeFileSync(generated, JSON.stringify(config, null, 2));
execFileSync(wrangler, ["deploy", "--config", generated], {
  cwd: root,
  stdio: "inherit",
});
writeFileSync(
  resolve(output, "image.json"),
  JSON.stringify({ sourceSha: sha, image, target }, null, 2),
);
