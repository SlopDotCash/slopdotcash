import { execFileSync } from "node:child_process";
import { assertActiveVersionTagged } from "./worker-release.mjs";

const target = process.argv[2];
if (target !== "staging" && target !== "production")
  throw new Error("Choose a release environment");
const branch = target === "production" ? "main" : "development";
const sha = process.env.GITHUB_SHA;
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REF !== `refs/heads/${branch}` ||
  !/^[0-9a-f]{40}$/.test(sha ?? "") ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
    sha
)
  throw new Error(
    "Scanner backup releases require the exact workflow branch commit",
  );
const name =
  target === "production"
    ? "slop-vetting-backup"
    : "slop-staging-vetting-backup";
const config = `workers/vetting-backup/wrangler${target === "staging" ? ".staging" : ""}.toml`;
const wrangler = "./node_modules/.bin/wrangler";
const retention = process.env.SLOP_VETTING_RETENTION_RELEASE || "off";
if (retention !== "off" && retention !== "enabled")
  throw new Error("Invalid scanner retention release setting");
execFileSync(
  wrangler,
  [
    "deploy",
    "--config",
    config,
    "--tag",
    sha,
    "--message",
    `Release ${sha}`,
    "--var",
    "EVIDENCE_BACKUP_MODE:enabled",
    "--var",
    `EVIDENCE_RETENTION_MODE:${retention}`,
  ],
  { stdio: "inherit" },
);
const read = (args) =>
  JSON.parse(execFileSync(wrangler, args, { encoding: "utf8" }));
const status = read(["deployments", "status", "--name", name, "--json"]);
const versions = read(["versions", "list", "--name", name, "--json"]);
assertActiveVersionTagged({
  deployment: status,
  versions,
  sha: sha,
  message: "Scanner backup release is not bound to the workflow commit",
});
console.log(`Verified ${name} at ${sha}`);
