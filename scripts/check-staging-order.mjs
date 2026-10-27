/**
 * Run only while holding the workflow's slop-staging concurrency lock.
 * Cost: one development fetch and up to ten 100-record GitHub history reads.
 * Failed attempts count: they may have already changed a Worker or database.
 */
import { execFileSync } from "node:child_process";

const revision = process.env.GITHUB_SHA;
if (
  process.env.GITHUB_REPOSITORY !== "SlopDotCash/slopdotcash" ||
  process.env.GITHUB_REF !== "refs/heads/development" ||
  !/^[a-f0-9]{40}$/.test(revision ?? "")
) {
  throw new Error("Staging order requires a canonical development revision");
}
const options = {
  encoding: "utf8",
  timeout: 30000,
  maxBuffer: 2 * 1024 * 1024,
};
if (execFileSync("git", ["rev-parse", "HEAD"], options).trim() !== revision) {
  throw new Error("Staging checkout does not match the checked revision");
}
// A newer branch tip does not invalidate a fully checked ancestor. A force-push
// that removes it does. Fetch before comparing; checkout-time refs may be stale.
execFileSync(
  "git",
  ["fetch", "--no-tags", "origin", "refs/heads/development"],
  options,
);
const tip = execFileSync("git", ["rev-parse", "FETCH_HEAD"], options).trim();
execFileSync("git", ["merge-base", "--is-ancestor", revision, tip], options);

// These jobs use the staging environment's secrets without publishing staging
// code or applying migrations. Qualification uses disposable resources; the
// controller records scan data and calls the already deployed sandbox. Those data
// writes do not establish a newer code release. Any other or unknown creator
// still counts, including a failed release at the same revision.
const NON_RELEASE_WORKFLOWS = new Set([
  ".github/workflows/vetting-recovery-qualification.yml",
  ".github/workflows/vetting-sandbox-qualification.yml",
  ".github/workflows/vetting-controller.yml",
]);
function createdByNonReleaseWorkflow(deployment) {
  if (!Number.isSafeInteger(deployment.id)) return false;
  try {
    const statuses = JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          `repos/SlopDotCash/slopdotcash/deployments/${deployment.id}/statuses?per_page=100`,
        ],
        options,
      ),
    );
    if (!Array.isArray(statuses) || statuses.length === 0) return false;
    const runs = new Set(
      statuses.map(
        (status) =>
          /^https:\/\/github\.com\/SlopDotCash\/slopdotcash\/actions\/runs\/(\d+)\//.exec(
            status?.log_url ?? "",
          )?.[1] ?? null,
      ),
    );
    if (runs.size !== 1 || runs.has(null)) return false;
    const [run] = runs;
    const workflow = JSON.parse(
      execFileSync(
        "gh",
        ["api", `repos/SlopDotCash/slopdotcash/actions/runs/${run}`],
        options,
      ),
    );
    return (
      workflow?.head_sha === deployment.sha &&
      NON_RELEASE_WORKFLOWS.has(workflow?.path)
    );
  } catch {
    return false;
  }
}

const checked = new Set();
for (let page = 1; page <= 10; page++) {
  const history = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        `repos/SlopDotCash/slopdotcash/deployments?environment=slop-staging&per_page=100&page=${page}`,
      ],
      options,
    ),
  );
  if (!Array.isArray(history) || history.length > 100) {
    throw new Error("Invalid staging deployment history");
  }
  for (const deployment of history) {
    if (
      deployment?.environment !== "slop-staging" ||
      deployment.ref !== "development" ||
      deployment.production_environment !== false ||
      !/^[a-f0-9]{40}$/.test(deployment.sha ?? "")
    ) {
      throw new Error(
        "Unknown staging deployment provenance; require human review",
      );
    }
    if (checked.has(deployment.sha)) continue;
    // Do not inspect only successful Pages releases: a failed newer attempt may
    // have applied migrations or published identity before the Pages failure.
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", deployment.sha, revision],
        options,
      );
    } catch (cause) {
      // Judge each such deployment by its own creator: a release of the same
      // revision may appear later in the history.
      if (createdByNonReleaseWorkflow(deployment)) {
        console.log(
          `Ignoring non-release staging environment record ${deployment.sha}`,
        );
        continue;
      }
      throw new Error(
        `Refusing staging rollback across attempted revision ${deployment.sha}`,
        { cause },
      );
    }
    checked.add(deployment.sha);
  }
  if (history.length < 100) {
    if (!checked.has(revision)) {
      throw new Error(
        "Current staging attempt is absent from deployment history",
      );
    }
    console.log(`Staging order verified for ${revision}`);
    process.exit(0);
  }
}
throw new Error("Staging history exceeds its bound; require human review");
