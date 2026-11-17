/**
 * Run only while holding the workflow's slop-staging concurrency lock.
 * Each pass fetches development and reads at most ten 100-record history pages.
 * Nonancestor records may also need status and workflow creator reads.
 * Failed attempts count: they may have already changed a Worker or database.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

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
const retryBudgetMs = 120_000;
const guardStartedAt = Date.now();

class GitHubRateLimit extends Error {
  constructor(retryAt) {
    super("GitHub staging deployment history quota exhausted");
    this.retryAt = retryAt;
  }
}

function callOptions(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw new Error("Staging order retry exceeded its deadline");
  return { ...options, timeout: Math.min(options.timeout, remaining) };
}

function rateLimitRetryAt(status, headerBlock, now) {
  if (status !== 403 && status !== 429) return null;
  const headers = new Headers();
  for (const line of headerBlock.split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1));
  }
  let retryAt = null;
  // Match the ingestion reader's primary-limit contract: an exhausted bucket
  // and a numeric reset, with a second of margin for the server's epoch clock.
  if (headers.get("x-ratelimit-remaining") === "0") {
    const reset = headers.get("x-ratelimit-reset");
    if (!/^\d+$/u.test(reset ?? "")) return null;
    retryAt = Number(reset) * 1_000 + 1_000;
    if (!Number.isSafeInteger(retryAt) || retryAt <= now) return null;
  }
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    if (!/^\d+$/u.test(retryAfter)) return null;
    const retryAfterAt = now + Number(retryAfter) * 1_000;
    if (!Number.isSafeInteger(retryAfterAt)) return null;
    retryAt = Math.max(retryAt ?? now, retryAfterAt);
  }
  return retryAt;
}

function readGitHub(path, deadline) {
  // `gh api --include` emits the HTTP status and headers even on a refusal.
  // Keep its existing workflow-token resolution and never print the response.
  const result = spawnSync(
    "gh",
    ["api", "--include", path],
    callOptions(deadline),
  );
  const response =
    /^HTTP\/\d+(?:\.\d+)? ([1-5]\d{2})[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n/u.exec(
      result.stdout ?? "",
    );
  const status = Number(response?.[1]);
  if (result.error || result.signal || !response)
    throw new Error("GitHub staging provenance read could not complete");
  if (result.status !== 0 || status !== 200) {
    const retryAt = rateLimitRetryAt(status, response[2], Date.now());
    if (retryAt !== null) throw new GitHubRateLimit(retryAt);
    throw new Error(`GitHub staging provenance read failed (HTTP ${status})`);
  }
  try {
    return JSON.parse(result.stdout.slice(response[0].length));
  } catch {
    throw new Error("Invalid GitHub staging provenance response");
  }
}

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
function createdByNonReleaseWorkflow(deployment, deadline) {
  if (!Number.isSafeInteger(deployment.id)) return false;
  try {
    const statuses = readGitHub(
      `repos/SlopDotCash/slopdotcash/deployments/${deployment.id}/statuses?per_page=100`,
      deadline,
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
    const workflow = readGitHub(
      `repos/SlopDotCash/slopdotcash/actions/runs/${run}`,
      deadline,
    );
    return (
      workflow?.head_sha === deployment.sha &&
      NON_RELEASE_WORKFLOWS.has(workflow?.path)
    );
  } catch (error) {
    if (error instanceof GitHubRateLimit) throw error;
    return false;
  }
}

function verifyOrder(deadline = Infinity) {
  if (
    execFileSync("git", ["rev-parse", "HEAD"], callOptions(deadline)).trim() !==
    revision
  ) {
    throw new Error("Staging checkout does not match the checked revision");
  }
  // A newer branch tip does not invalidate a fully checked ancestor. A force-push
  // that removes it does. Fetch again on retry before inspecting any history.
  execFileSync(
    "git",
    ["fetch", "--no-tags", "origin", "refs/heads/development"],
    callOptions(deadline),
  );
  const tip = execFileSync(
    "git",
    ["rev-parse", "FETCH_HEAD"],
    callOptions(deadline),
  ).trim();
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", revision, tip],
    callOptions(deadline),
  );

  const checked = new Set();
  for (let page = 1; page <= 10; page++) {
    const history = readGitHub(
      `repos/SlopDotCash/slopdotcash/deployments?environment=slop-staging&per_page=100&page=${page}`,
      deadline,
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
          callOptions(deadline),
        );
      } catch (cause) {
        // Judge each such deployment by its own creator: a release of the same
        // revision may appear later in the history.
        if (createdByNonReleaseWorkflow(deployment, deadline)) {
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
      if (Date.now() >= deadline) {
        throw new Error("Staging order retry exceeded its deadline");
      }
      console.log(`Staging order verified for ${revision}`);
      return;
    }
  }
  throw new Error("Staging history exceeds its bound; require human review");
}

try {
  verifyOrder();
} catch (error) {
  if (!(error instanceof GitHubRateLimit)) throw error;
  const jobDeadline = process.env.STAGING_ORDER_RETRY_UNTIL;
  const deadline = Math.min(
    guardStartedAt + retryBudgetMs,
    Number(jobDeadline) * 1_000,
  );
  const waitMs = Math.max(0, error.retryAt - Date.now());
  if (
    !/^\d+$/u.test(jobDeadline ?? "") ||
    !Number.isSafeInteger(Number(jobDeadline) * 1_000) ||
    Date.now() + waitMs >= deadline
  ) {
    throw new Error(
      `GitHub staging quota reset is outside the staging order retry budget (retry at epoch seconds ${Math.ceil(error.retryAt / 1_000)})`,
      { cause: error },
    );
  }
  console.log(
    `GitHub staging quota exhausted; retrying the full order check after ${Math.ceil(waitMs / 1_000)}s`,
  );
  await wait(waitMs);
  verifyOrder(deadline);
}
