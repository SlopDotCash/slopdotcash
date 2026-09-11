/** Resolve the deployed revision against GitHub's successful release history. */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const repository = "SlopDotCash/slopdotcash";
const response = await fetch("https://slop.cash/skill-manifest.json", {
  redirect: "error",
  cache: "no-store",
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error("Cannot read the deployed skill revision");
const chunks = [];
let size = 0;
for await (const chunk of response.body) {
  size += chunk.byteLength;
  if (size > 65536)
    throw new Error("Deployed skill manifest exceeds its contract");
  chunks.push(chunk);
}
const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const sha = manifest.revision;
if (
  manifest.repository !== repository ||
  manifest.revisionStatus !== "committed" ||
  !/^[a-f0-9]{40}$/.test(sha)
)
  throw new Error("Invalid deployed source revision");
execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/develop"]);
const gh = (...args) =>
  JSON.parse(execFileSync("gh", args, { encoding: "utf8", timeout: 30000 }));
const runs = gh(
  "api",
  `repos/${repository}/actions/workflows/deploy.yml/runs?head_sha=${sha}&status=success&per_page=100`,
).workflow_runs;
const released = runs.find(
  (run) =>
    run.conclusion === "success" &&
    run.head_repository?.full_name === repository &&
    run.head_sha === sha &&
    run.head_branch === "develop" &&
    ["push", "workflow_dispatch"].includes(run.event),
);
if (!released)
  throw new Error("Deployed source has no successful approved release");
let baseline = released.id;
let baselineName = `slop-pages-${baseline}`;
const artifacts = gh(
  "api",
  `repos/${repository}/actions/artifacts?name=slop-source-${sha}&per_page=100`,
).artifacts;
for (const artifact of artifacts) {
  if (
    artifact.name !== `slop-source-${sha}` ||
    artifact.expired ||
    artifact.workflow_run?.head_branch !== "develop"
  )
    continue;
  const run = gh(
    "api",
    `repos/${repository}/actions/runs/${artifact.workflow_run.id}`,
  );
  if (
    run.workflow_id !== released.workflow_id ||
    run.conclusion !== "success" ||
    !["push", "workflow_dispatch", "schedule"].includes(run.event) ||
    run.head_repository?.full_name !== repository
  )
    continue;
  baseline = run.id;
  baselineName = artifact.name;
  break;
}
if (process.argv.includes("--check")) {
  if (sha !== process.env.RELEASE_SHA)
    throw new Error(
      "Production changed while refresh was building; discard this refresh",
    );
} else {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `sha=${sha}\nbaseline=${baseline}\nbaseline_name=${baselineName}\n`,
  );
}
