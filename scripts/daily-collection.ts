/**
 * Keeps slop.cash's contribution data fresh without a person watching it.
 *
 * `start` (daily schedule) dispatches one fresh production collection on main,
 * unless a collection is already running: every collection spends the same
 * collector GitHub App allowance.
 *
 * `follow-up` (after each main release) reads that release and does at most
 * one thing:
 * - publish: its own fresh collection succeeded but it did not publish Pages
 *   (main moved meanwhile, or a later job failed). A retained-data release
 *   names it in `data_from_run`; that release still refuses data older than
 *   the live site. A superseded publish is dispatched again, at most three
 *   times; a failed one has its failed jobs rerun once.
 * - resume: its collection step failed after saving a checkpoint, and it was
 *   not itself a resume. A fresh release names it in `discussion_resume_run`,
 *   once, after any other running collection ends.
 *
 * It reads and dispatches workflow runs only. It never publishes anything
 * itself, never edits a run's data and never touches a non-main run.
 */

import { githubAppJwt } from "./github-app-token-refresh";

const API = "https://api.github.com";
const DEPLOY = "deploy.yml";
const MONTHLY = "monthly-rewards.yml";
const PREPARE_JOB = "Prepare checked browser bundle";
const COLLECT_STEP = "Generate live contribution data";
const PROFILES_STEP = "Generate live contributor profiles";
const RESTORE_JOB = "Restore trusted production discussion reads";
const DEPLOY_JOB = "Deploy trusted production bundle";
// Runs only after Pages was deployed and not superseded.
const PUBLISHED_STEP = "Verify Cloudflare deployment commit metadata";
const FAST = { skip_proofs: "true", skip_browser_tests: "true" };
const STALE_MS = 48 * 60 * 60 * 1000;

export type Step = {
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
};
export type Job = {
  name: string;
  status: string;
  conclusion: string | null;
  steps?: Step[];
};
export type Run = {
  id: number;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string;
  head_sha: string;
  path: string;
  run_attempt: number;
  created_at: string;
  repository: { full_name: string };
  head_repository: { full_name: string } | null;
};
export type Artifact = { name: string; expired: boolean };

export type Env = {
  repo: string;
  token: () => Promise<string>;
  request: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
};

function step(job: Job | undefined, name: string) {
  const found = (job?.steps ?? []).filter((s) => s.name === name);
  return found.length === 1 ? found[0] : undefined;
}

/** What a completed release did, read only from its job and step results. */
export function readRelease(jobs: Job[]) {
  const prepare = jobs.filter((j) => j.name === PREPARE_JOB);
  const job = prepare.length === 1 ? prepare[0] : undefined;
  const collect = step(job, COLLECT_STEP);
  const restore = jobs.find((j) => j.name === RESTORE_JOB);
  const deploy = jobs.find((j) => j.name === DEPLOY_JOB);
  return {
    collected:
      job?.conclusion === "success" && collect?.conclusion === "success",
    collectionFailed: collect?.conclusion === "failure",
    resumed: restore?.conclusion === "success",
    published: step(deploy, PUBLISHED_STEP)?.conclusion === "success",
    profilesStartedAt: step(job, PROFILES_STEP)?.started_at ?? undefined,
  };
}

export function trustedMainRelease(run: Run, repo: string) {
  return (
    run.repository.full_name === repo &&
    run.head_repository?.full_name === repo &&
    run.head_branch === "main" &&
    (run.event === "push" || run.event === "workflow_dispatch") &&
    run.path === `.github/workflows/${DEPLOY}`
  );
}

export type Decision =
  | { action: "publish"; reason: string }
  | { action: "resume"; reason: string }
  | { action: "none"; reason: string };

export function decide(
  run: Run,
  jobs: Job[],
  artifacts: Artifact[],
  repo: string,
): Decision {
  if (!trustedMainRelease(run, repo) || run.status !== "completed")
    return { action: "none", reason: "not a completed trusted main release" };
  const release = readRelease(jobs);
  if (release.collected && !release.published)
    return {
      action: "publish",
      reason: "its fresh collection succeeded but it did not publish",
    };
  if (release.collectionFailed) {
    if (release.resumed)
      return {
        action: "none",
        reason: "a resumed collection is not resumed again",
      };
    const checkpoint = artifacts.some(
      (a) =>
        a.name === `leaderboard-discussions-${run.run_attempt}` && !a.expired,
    );
    if (!checkpoint)
      return {
        action: "none",
        reason: "the failed collection saved no checkpoint",
      };
    return {
      action: "resume",
      reason: "its collection failed after a checkpoint",
    };
  }
  return { action: "none", reason: "nothing to publish or resume" };
}

async function api<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await env.request(`${API}${path}`, {
      ...init,
      redirect: "follow",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${await env.token()}`,
        "x-github-api-version": "2022-11-28",
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    });
    const body = await response.text();
    if (response.ok) return (body ? JSON.parse(body) : undefined) as T;
    const limited =
      response.status === 429 ||
      (response.status === 403 && /rate limit/iu.test(body));
    if ((limited || response.status >= 500) && attempt < 6) {
      // A spent quota resets hourly: wait for the reset GitHub names.
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const wait = limited
        ? Math.min(Math.max(reset - env.now() + 5000, 30_000), 65 * 60_000)
        : attempt * 30_000;
      env.log(
        `GitHub answered ${response.status} on ${path}; retrying in ${Math.round(wait / 1000)}s.`,
      );
      await env.sleep(wait);
      continue;
    }
    throw new Error(
      `GitHub ${response.status} on ${path}: ${body.slice(0, 200)}`,
    );
  }
}

async function listRuns(env: Env, workflow: string, query: string) {
  const path = `/repos/${env.repo}/actions/workflows/${workflow}/runs?${query}`;
  return (await api<{ workflow_runs: Run[] }>(env, path)).workflow_runs;
}

async function jobsOf(env: Env, id: number) {
  return (
    await api<{ jobs: Job[] }>(
      env,
      `/repos/${env.repo}/actions/runs/${id}/jobs?per_page=100`,
    )
  ).jobs;
}

/**
 * A collection is running when a main release is past neither its
 * preparation job (which holds the whole collection) nor an unstarted queue,
 * or when the monthly close is collecting. A retained-data release finishes
 * preparation in minutes, so a short wait tells the two apart.
 */
export async function collectionRunning(env: Env) {
  const monthly = await listRuns(env, MONTHLY, "branch=main&per_page=20");
  if (monthly.some((r) => r.status !== "completed")) return "the monthly close";
  const releases = await listRuns(env, DEPLOY, "branch=main&per_page=30");
  for (const run of releases) {
    if (run.status === "completed") continue;
    if (!trustedMainRelease(run, env.repo)) continue;
    const prepare = (await jobsOf(env, run.id)).find(
      (j) => j.name === PREPARE_JOB,
    );
    if (prepare?.status !== "completed") return `release ${run.id}`;
  }
  return null;
}

async function waitForQuiet(env: Env, budgetMs: number, pollMs: number) {
  const until = env.now() + budgetMs;
  for (;;) {
    const busy = await collectionRunning(env);
    if (!busy) return true;
    if (env.now() + pollMs > until) {
      env.log(`A collection is still running (${busy}).`);
      return false;
    }
    env.log(`Waiting: a collection is running (${busy}).`);
    await env.sleep(pollMs);
  }
}

/** Dispatch deploy.yml on main and return the new run's ID. */
export async function dispatch(env: Env, inputs: Record<string, string>) {
  const before = new Set(
    (
      await listRuns(
        env,
        DEPLOY,
        "branch=main&event=workflow_dispatch&per_page=20",
      )
    ).map((r) => r.id),
  );
  const startedAt = env.now();
  const answer = await api<{ workflow_run_id?: number } | undefined>(
    env,
    `/repos/${env.repo}/actions/workflows/${DEPLOY}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: "main", inputs, return_run_details: true }),
    },
  );
  if (answer?.workflow_run_id) return answer.workflow_run_id;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await env.sleep(15_000);
    const fresh = (
      await listRuns(
        env,
        DEPLOY,
        "branch=main&event=workflow_dispatch&per_page=20",
      )
    )
      .filter(
        (r) =>
          !before.has(r.id) && Date.parse(r.created_at) >= startedAt - 60_000,
      )
      .sort((a, b) => a.id - b.id);
    if (fresh.length) return fresh[0].id;
  }
  throw new Error("The dispatched release did not appear");
}

async function runOf(env: Env, id: number) {
  return api<Run>(env, `/repos/${env.repo}/actions/runs/${id}`);
}

async function waitForRun(env: Env, id: number) {
  for (;;) {
    const run = await runOf(env, id);
    if (run.status === "completed") return run;
    await env.sleep(60_000);
  }
}

async function liveProfilesAt(env: Env) {
  const response = await env.request(
    `https://slop.cash/data/profiles.json?snapshot=${env.now()}`,
    { redirect: "error", cache: "no-store" },
  );
  if (!response.ok) return undefined;
  const generatedAt = ((await response.json()) as { generatedAt?: unknown })
    .generatedAt;
  return typeof generatedAt === "string" ? Date.parse(generatedAt) : undefined;
}

export async function start(env: Env) {
  const quiet = await waitForQuiet(env, 30 * 60_000, 2 * 60_000);
  if (quiet) {
    const id = await dispatch(env, FAST);
    env.log(`Dispatched fresh collection release ${id}.`);
  } else {
    env.log("Skipped today's collection: one is already running.");
  }
  // A freeze must be visible: fail this run when live data is two days old.
  const live = await liveProfilesAt(env);
  if (live === undefined || env.now() - live > STALE_MS) {
    env.log(
      `::error::Live contribution data is ${live === undefined ? "unreadable" : `from ${new Date(live).toISOString()}`}; it should be under 48 hours old.`,
    );
    return 1;
  }
  return 0;
}

export async function followUp(env: Env, id: number) {
  const run = await runOf(env, id);
  const jobs = await jobsOf(env, id);
  const artifacts = (
    await api<{ artifacts: Artifact[] }>(
      env,
      `/repos/${env.repo}/actions/runs/${id}/artifacts?per_page=100`,
    )
  ).artifacts;
  const decision = decide(run, jobs, artifacts, env.repo);
  env.log(`Release ${id}: ${decision.action} (${decision.reason}).`);

  if (decision.action === "resume") {
    if (!(await waitForQuiet(env, 5 * 60 * 60_000, 5 * 60_000))) {
      env.log("::warning::Not resumed: another collection ran for five hours.");
      return 1;
    }
    const resumed = await dispatch(env, {
      ...FAST,
      discussion_resume_run: String(id),
    });
    env.log(`Dispatched resumed collection ${resumed} from release ${id}.`);
    return 0;
  }
  if (decision.action !== "publish") return 0;

  // Nothing to do once the live site serves this collection or a later one,
  // which the publishing release's freshness check would refuse anyway.
  const started = readRelease(jobs).profilesStartedAt;
  const servedNewer = async () => {
    const live = await liveProfilesAt(env);
    return live !== undefined && !!started && live >= Date.parse(started);
  };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await servedNewer()) {
      env.log("The live site already serves this collection or a newer one.");
      return 0;
    }
    const publish = await dispatch(env, {
      ...FAST,
      use_published_data: "true",
      data_from_run: String(id),
    });
    env.log(
      `Publishing release ${id}'s collection through release ${publish}.`,
    );
    let result = await waitForRun(env, publish);
    if (
      result.conclusion !== "success" &&
      result.conclusion !== "cancelled" &&
      !(await servedNewer())
    ) {
      env.log(
        `Release ${publish} ended ${result.conclusion}; rerunning its failed jobs once.`,
      );
      await api(
        env,
        `/repos/${env.repo}/actions/runs/${publish}/rerun-failed-jobs`,
        {
          method: "POST",
        },
      );
      await env.sleep(30_000);
      result = await waitForRun(env, publish);
    }
    if (readRelease(await jobsOf(env, publish)).published) {
      env.log(`Published release ${id}'s collection.`);
      return 0;
    }
    if (result.conclusion !== "success") {
      if (await servedNewer()) {
        env.log("Newer data went live meanwhile; nothing left to publish.");
        return 0;
      }
      env.log(
        `::error::Release ${publish} ended ${result.conclusion} without publishing.`,
      );
      return 1;
    }
    env.log(
      `Release ${publish} was superseded by a newer main; publishing again.`,
    );
  }
  env.log("::error::Three publishing releases in a row were superseded.");
  return 1;
}

/**
 * An Actions-write token for this repository. The scan dispatch App has its
 * own quota; its installation tokens last an hour and a follow-up can wait
 * five, so a new one is minted ten minutes before expiry. Without the App,
 * or when minting fails, the job's GITHUB_TOKEN is used.
 */
export function tokenSource(
  environment: Record<string, string | undefined>,
  request: typeof fetch,
  now: () => number,
) {
  const fallback = environment.FALLBACK_TOKEN ?? "";
  const clientId = environment.DISPATCH_APP_CLIENT_ID?.trim();
  const privateKey = environment.DISPATCH_APP_PRIVATE_KEY;
  const installation = environment.DISPATCH_APP_INSTALLATION_ID?.trim();
  const repository = environment.GITHUB_REPOSITORY?.split("/")[1];
  let current = "";
  let expiresAt = 0;
  return async () => {
    if (
      !clientId ||
      !privateKey ||
      !installation ||
      !/^[1-9]\d{0,17}$/u.test(installation)
    )
      return fallback;
    if (current && now() < expiresAt - 10 * 60_000) return current;
    try {
      const response = await request(
        `${API}/app/installations/${installation}/access_tokens`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${githubAppJwt(clientId, privateKey, now())}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({
            repositories: [repository],
            permissions: { actions: "write" },
          }),
        },
      );
      if (response.status !== 201) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        token?: unknown;
        expires_at?: unknown;
      };
      const expiry = Date.parse(String(body.expires_at));
      if (
        typeof body.token !== "string" ||
        !body.token ||
        !Number.isFinite(expiry)
      )
        throw new Error("invalid token");
      current = body.token;
      expiresAt = expiry;
      return current;
    } catch (error) {
      console.log(
        `Dispatch App token unavailable (${error instanceof Error ? error.message : "unknown"}); using GITHUB_TOKEN.`,
      );
      return now() < expiresAt ? current : fallback;
    }
  };
}

if (import.meta.main) {
  const now = () => Date.now();
  const env: Env = {
    repo: process.env.GITHUB_REPOSITORY ?? "",
    token: tokenSource(process.env, fetch, now),
    request: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now,
    log: (line) => console.log(line),
  };
  const [command, id] = process.argv.slice(2);
  if (!/^[\w.-]+\/[\w.-]+$/u.test(env.repo))
    throw new Error("GITHUB_REPOSITORY is required");
  if (command === "start") process.exitCode = await start(env);
  else if (command === "follow-up" && /^[1-9]\d{0,17}$/u.test(id ?? ""))
    process.exitCode = await followUp(env, Number(id));
  else throw new Error("Usage: daily-collection.ts start | follow-up <run id>");
}
