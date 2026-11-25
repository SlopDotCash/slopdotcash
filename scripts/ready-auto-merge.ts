/**
 * Ready auto-merge pilot (operator decision, 25 November 2026; PRD section 5).
 * On Slop's own repository only, the repository's own workflow merges an open
 * pull request that carries the `slopbot:ready` label. Slopbot applies the
 * label and never merges; this script runs with the workflow's GITHUB_TOKEN.
 *
 * It trusts nothing about the label itself. For each labelled pull request it
 * re-reads GitHub and merges only when every one of these holds, treating any
 * unreadable or unexpected answer as a reason to skip:
 *   1. the base is this repository's registered integration branch, read from
 *      `.github/slop-project.json` on that branch, and never `main`,
 *      `vibestack` or the default branch;
 *   2. the label's most recent labeled or unlabeled event is a `labeled` event
 *      by the Slopbot App's bot account, the head commit was already in the
 *      pull request when it was made, and no force push followed it;
 *   3. at least one approval at the exact head commit comes from an account
 *      with write, maintain or admin permission other than the author, and no
 *      such account has an open change request;
 *   4. GitHub reports the pull request mergeable and clean;
 *   5. the change touches nothing under `.github/`;
 *   6. a second read just before merging shows the same head commit.
 * The merge is a merge commit pinned to that head commit. It never checks out
 * or runs pull request code. The switch is the repository variable
 * SLOPBOT_AUTO_MERGE; anything other than `on` does nothing.
 */
import { appendFileSync } from "node:fs";

export const PILOT_REPOSITORY = "SlopDotCash/slopdotcash";
export const PILOT_REPOSITORY_ID = 1319812413;
export const READY_LABEL = "slopbot:ready";
/** The Slopbot GitHub App (github.com/apps/slopdotcash) acts as this account. */
export const SLOPBOT_BOT = Object.freeze({
  id: 340374191,
  login: "slopdotcash[bot]",
});
/** Bases the workflow never merges into, whatever any file declares. */
export const NEVER_BASES: readonly string[] = ["main", "vibestack"];
export const MAX_MERGES_PER_RUN = 5;
export const PROJECT_FILE = ".github/slop-project.json";
const MAX_LIST_PAGES = 5;
const MAX_EVENT_PAGES = 10;
const MAX_REVIEW_PAGES = 10;
const MAX_FILE_PAGES = 30;
const MAX_PERMISSION_LOOKUPS = 25;
const REQUEST_TIMEOUT_MS = 20_000;

export type ApiResponse = { status: number; data: unknown };
export type Api = (
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: unknown,
) => Promise<ApiResponse>;

export type Outcome =
  | { number: number; action: "merged" | "would-merge"; detail: string }
  | { number: number; action: "skipped"; detail: string };

type Pull = {
  number: number;
  state: string;
  merged: boolean;
  draft: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  headSha: string;
  baseRef: string;
  baseRepositoryId: number;
  authorId: number;
  changedFiles: number;
  labels: string[];
};

/** A reason this pull request is not merged. Thrown, then logged as a skip. */
class Skip extends Error {}

function skip(reason: string): never {
  throw new Skip(reason);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    skip(`${what} is unreadable`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0)
    skip(`${what} is unreadable`);
  return value as string;
}

function integer(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    skip(`${what} is unreadable`);
  return value as number;
}

function time(value: unknown, what: string): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) skip(`${what} has no readable time`);
  return parsed;
}

async function read(api: Api, path: string, what: string): Promise<unknown> {
  const response = await api("GET", path);
  if (response.status !== 200)
    skip(`${what} could not be read (HTTP ${response.status})`);
  return response.data;
}

/** Every page of a list, or a skip when the list is longer than the cap. */
async function pages(
  api: Api,
  path: string,
  what: string,
  maxPages: number,
): Promise<unknown[]> {
  const items: unknown[] = [];
  const joiner = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page++) {
    if (page > maxPages) skip(`${what} is too long to read in full`);
    const data = await read(
      api,
      `${path}${joiner}per_page=100&page=${page}`,
      what,
    );
    if (!Array.isArray(data)) skip(`${what} is unreadable`);
    items.push(...(data as unknown[]));
    if ((data as unknown[]).length < 100) return items;
  }
}

function parsePull(data: unknown): Pull {
  const pull = record(data, "the pull request");
  const head = record(pull.head, "the head");
  const base = record(pull.base, "the base");
  const baseRepository = record(base.repo, "the base repository");
  const author = record(pull.user, "the author");
  if (typeof pull.merged !== "boolean" || typeof pull.draft !== "boolean")
    skip("the pull request is unreadable");
  if (pull.mergeable !== null && typeof pull.mergeable !== "boolean")
    skip("the pull request is unreadable");
  if (!Array.isArray(pull.labels)) skip("the labels are unreadable");
  return {
    number: integer(pull.number, "the number"),
    state: text(pull.state, "the state"),
    merged: pull.merged as boolean,
    draft: pull.draft as boolean,
    mergeable: pull.mergeable as boolean | null,
    mergeableState: text(pull.mergeable_state, "the mergeable state"),
    headSha: text(head.sha, "the head commit"),
    baseRef: text(base.ref, "the base branch"),
    baseRepositoryId: integer(baseRepository.id, "the base repository"),
    authorId: integer(author.id, "the author"),
    changedFiles: integer(pull.changed_files, "the changed file count"),
    labels: (pull.labels as unknown[]).map((label) =>
      text(record(label, "a label").name, "a label"),
    ),
  };
}

/** Open, labelled, not a draft, mergeable and clean, into a permitted base. */
function requireMergeable(pull: Pull, defaultBranch: string) {
  if (pull.state !== "open" || pull.merged) skip("it is not open");
  if (pull.draft) skip("it is a draft");
  if (!pull.labels.includes(READY_LABEL))
    skip(`it does not carry ${READY_LABEL}`);
  if (pull.baseRepositoryId !== PILOT_REPOSITORY_ID)
    skip("its base is another repository");
  if (NEVER_BASES.includes(pull.baseRef) || pull.baseRef === defaultBranch)
    skip(`its base is ${pull.baseRef}, which this workflow never merges into`);
  if (pull.mergeable !== true)
    skip(
      pull.mergeable === null
        ? "GitHub has not worked out whether it can merge yet"
        : "GitHub reports it cannot merge",
    );
  if (pull.mergeableState !== "clean")
    skip(`GitHub reports its merge state as ${pull.mergeableState}, not clean`);
}

/** The base must declare itself the project's integration branch. */
async function requireIntegrationBranch(
  api: Api,
  repository: string,
  baseRef: string,
  known: Map<string, boolean>,
) {
  let registered = known.get(baseRef);
  if (registered === undefined) {
    const file = record(
      await read(
        api,
        `/repos/${repository}/contents/${PROJECT_FILE}?ref=${encodeURIComponent(baseRef)}`,
        `${PROJECT_FILE} on ${baseRef}`,
      ),
      PROJECT_FILE,
    );
    if (file.encoding !== "base64") skip(`${PROJECT_FILE} is unreadable`);
    let declared: Record<string, unknown>;
    try {
      declared = record(
        JSON.parse(
          Buffer.from(text(file.content, PROJECT_FILE), "base64").toString(
            "utf8",
          ),
        ),
        PROJECT_FILE,
      );
    } catch (error) {
      if (error instanceof Skip) throw error;
      skip(`${PROJECT_FILE} on ${baseRef} is not valid JSON`);
    }
    const declaredRepository = record(
      declared.repository,
      `${PROJECT_FILE} repository`,
    );
    registered =
      declaredRepository.fullName === repository &&
      declaredRepository.id === String(PILOT_REPOSITORY_ID) &&
      declaredRepository.integrationBranch === baseRef;
    known.set(baseRef, registered);
  }
  if (!registered)
    skip(`${baseRef} is not the project's registered integration branch`);
}

/**
 * The time Slopbot applied the label. The newest labeled or unlabeled event
 * for the label must be Slopbot's own `labeled`; a label a person added never
 * counts. A force push at or after that time means the label is stale.
 */
async function slopbotLabelTime(
  api: Api,
  repository: string,
  number: number,
): Promise<number> {
  const events = await pages(
    api,
    `/repos/${repository}/issues/${number}/events`,
    "the event history",
    MAX_EVENT_PAGES,
  );
  let newest: { at: number; event: Record<string, unknown> } | null = null;
  let lastForcePush = Number.NEGATIVE_INFINITY;
  for (const item of events) {
    const event = record(item, "an event");
    const kind = text(event.event, "an event");
    if (kind === "head_ref_force_pushed") {
      lastForcePush = Math.max(
        lastForcePush,
        time(event.created_at, "a force push"),
      );
      continue;
    }
    if (kind !== "labeled" && kind !== "unlabeled") continue;
    if (record(event.label, "a label event").name !== READY_LABEL) continue;
    const at = time(event.created_at, "a label event");
    // GitHub lists events oldest first, so a later equal time is newer.
    if (newest === null || at >= newest.at) newest = { at, event };
  }
  if (newest === null) skip("its event history shows no ready label");
  if (newest.event.event !== "labeled")
    skip("the newest ready label event is a removal");
  const actor = record(newest.event.actor, "the labelling account");
  if (
    actor.id !== SLOPBOT_BOT.id ||
    actor.login !== SLOPBOT_BOT.login ||
    actor.type !== "Bot"
  )
    skip(
      `the ready label was last added by ${String(actor.login)}, not Slopbot`,
    );
  if (lastForcePush >= newest.at)
    skip("the head was force pushed after Slopbot added the label");
  return newest.at;
}

type Review = {
  userId: number;
  login: string;
  state: string;
  commit: string | null;
};

/**
 * The accounts with write access whose approval stands at the head commit.
 * Skips when none does, when such an account has an open change request, or
 * when no review shows the head commit was in the pull request before the
 * label (Slopbot labels only after an approval at the head, so a label older
 * than every review of the head belongs to an earlier commit).
 */
async function standingApprovers(
  api: Api,
  repository: string,
  pull: Pull,
  labelledAt: number,
): Promise<string[]> {
  const reviews = await pages(
    api,
    `/repos/${repository}/pulls/${pull.number}/reviews`,
    "the reviews",
    MAX_REVIEW_PAGES,
  );
  const latest = new Map<number, Review>();
  let headSeenBeforeLabel = false;
  for (const item of reviews) {
    const review = record(item, "a review");
    const state = text(review.state, "a review");
    const commit =
      typeof review.commit_id === "string" ? review.commit_id : null;
    if (
      commit === pull.headSha &&
      state !== "PENDING" &&
      time(review.submitted_at, "a review") <= labelledAt
    )
      headSeenBeforeLabel = true;
    if (review.user === null) continue;
    const user = record(review.user, "a reviewer");
    if (user.type !== "User") continue;
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state))
      continue;
    // GitHub lists reviews oldest first; a later decision replaces one.
    latest.set(integer(user.id, "a reviewer"), {
      userId: user.id as number,
      login: text(user.login, "a reviewer"),
      state,
      commit,
    });
  }
  const approvals: Review[] = [];
  const requests: Review[] = [];
  for (const review of latest.values()) {
    if (review.userId === pull.authorId) continue;
    if (review.state === "APPROVED" && review.commit === pull.headSha)
      approvals.push(review);
    if (review.state === "CHANGES_REQUESTED") requests.push(review);
  }
  if (approvals.length === 0) skip("no approval stands at its head commit");
  if (approvals.length + requests.length > MAX_PERMISSION_LOOKUPS)
    skip("it has too many reviews to check");
  const writes = async (review: Review) => {
    const permission = record(
      await read(
        api,
        `/repos/${repository}/collaborators/${encodeURIComponent(review.login)}/permission`,
        `the permission of ${review.login}`,
      ),
      `the permission of ${review.login}`,
    );
    const user = record(permission.user, `the permission of ${review.login}`);
    // GitHub reports maintain as write here; custom role names are not levels.
    return (
      user.id === review.userId &&
      (permission.permission === "admin" || permission.permission === "write")
    );
  };
  for (const review of requests)
    if (await writes(review))
      skip(`${review.login} has an open change request`);
  const approvers: string[] = [];
  for (const review of approvals)
    if (await writes(review)) approvers.push(review.login);
  if (approvers.length === 0)
    skip("no approval at its head commit is from an account with write access");
  if (!headSeenBeforeLabel)
    skip("the ready label is older than every review of its head commit");
  return approvers.sort();
}

/** Every changed path, or a skip when the list is incomplete. */
async function requireNoWorkflowPaths(
  api: Api,
  repository: string,
  pull: Pull,
) {
  if (pull.changedFiles < 1) skip("it changes no file");
  if (pull.changedFiles > MAX_FILE_PAGES * 100)
    skip("it changes too many files to check");
  const files = await pages(
    api,
    `/repos/${repository}/pulls/${pull.number}/files`,
    "the changed files",
    MAX_FILE_PAGES,
  );
  if (files.length !== pull.changedFiles)
    skip("the changed file list is incomplete");
  for (const item of files) {
    const file = record(item, "a changed file");
    const paths = [text(file.filename, "a changed file")];
    if (file.previous_filename !== undefined && file.previous_filename !== null)
      paths.push(text(file.previous_filename, "a renamed file"));
    for (const path of paths)
      if (path.toLowerCase().startsWith(".github/") || path === ".github")
        skip(`it touches ${path}, and nothing under .github/ merges this way`);
  }
}

export function mergeComment(headSha: string, approvers: readonly string[]) {
  return [
    `Merged automatically by this repository's ready auto-merge workflow at ${headSha}.`,
    `It carried the \`${READY_LABEL}\` label and was approved at that commit by ${approvers.join(", ")}.`,
    "Slopbot applied the label and did not merge.",
  ].join(" ");
}

async function consider(
  api: Api,
  repository: string,
  defaultBranch: string,
  number: number,
  dryRun: boolean,
  branches: Map<string, boolean>,
): Promise<Outcome> {
  const path = `/repos/${repository}/pulls/${number}`;
  const pull = parsePull(await read(api, path, "the pull request"));
  if (pull.number !== number) skip("the pull request is unreadable");
  requireMergeable(pull, defaultBranch);
  await requireIntegrationBranch(api, repository, pull.baseRef, branches);
  const labelledAt = await slopbotLabelTime(api, repository, number);
  const approvers = await standingApprovers(api, repository, pull, labelledAt);
  await requireNoWorkflowPaths(api, repository, pull);
  // Second read: nothing may have moved while the checks ran.
  const again = parsePull(await read(api, path, "the pull request"));
  if (again.headSha !== pull.headSha || again.baseRef !== pull.baseRef)
    skip("its head or base changed during the checks");
  requireMergeable(again, defaultBranch);
  const detail = `head ${pull.headSha} into ${pull.baseRef}, approved by ${approvers.join(", ")}`;
  if (dryRun) return { number, action: "would-merge", detail };
  const merge = await api("PUT", `${path}/merge`, {
    sha: pull.headSha,
    merge_method: "merge",
  });
  if (
    merge.status !== 200 ||
    (merge.data as { merged?: unknown } | null)?.merged !== true
  )
    skip(`GitHub refused the merge (HTTP ${merge.status})`);
  const comment = await api(
    "POST",
    `/repos/${repository}/issues/${number}/comments`,
    { body: mergeComment(pull.headSha, approvers) },
  );
  return {
    number,
    action: "merged",
    detail:
      comment.status === 201
        ? detail
        : `${detail}; the comment was not posted (HTTP ${comment.status})`,
  };
}

export type RunOptions = {
  api: Api;
  repository: string;
  /** The value of the repository variable SLOPBOT_AUTO_MERGE. */
  enabled: string | undefined;
  dryRun: boolean;
  log?: (line: string) => void;
};

/**
 * One pass. Throws only when the repository or the candidate list cannot be
 * read; a problem with one pull request skips that pull request.
 */
export async function runReadyAutoMerge(
  options: RunOptions,
): Promise<Outcome[]> {
  const log = options.log ?? ((line: string) => console.log(line));
  const { api, repository, dryRun } = options;
  if (repository !== PILOT_REPOSITORY)
    throw new Error(`The pilot covers ${PILOT_REPOSITORY} only`);
  if (!dryRun && options.enabled !== "on") {
    log("SLOPBOT_AUTO_MERGE is not on; nothing was read or merged.");
    return [];
  }
  const outcomes: Outcome[] = [];
  let defaultBranch: string;
  let numbers: number[];
  try {
    const repo = record(
      await read(api, `/repos/${repository}`, "the repository"),
      "the repository",
    );
    if (repo.id !== PILOT_REPOSITORY_ID || repo.full_name !== repository)
      skip("the repository is not the pilot repository");
    defaultBranch = text(repo.default_branch, "the default branch");
    const issues = await pages(
      api,
      `/repos/${repository}/issues?state=open&labels=${encodeURIComponent(READY_LABEL)}&sort=created&direction=asc`,
      "the labelled pull requests",
      MAX_LIST_PAGES,
    );
    numbers = issues
      .map((item) => record(item, "a labelled item"))
      .filter((item) => item.pull_request != null)
      .map((item) => integer(item.number, "a pull request number"))
      .sort((a, b) => a - b);
  } catch (error) {
    throw new Error(
      `Ready auto-merge could not start: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const branches = new Map<string, boolean>();
  let merges = 0;
  for (const number of numbers) {
    let outcome: Outcome;
    if (merges >= MAX_MERGES_PER_RUN)
      outcome = {
        number,
        action: "skipped",
        detail: `this run already reached its limit of ${MAX_MERGES_PER_RUN}`,
      };
    else
      try {
        outcome = await consider(
          api,
          repository,
          defaultBranch,
          number,
          dryRun,
          branches,
        );
        merges++;
      } catch (error) {
        outcome = {
          number,
          action: "skipped",
          detail:
            error instanceof Skip
              ? error.message
              : `a read failed (${error instanceof Error ? error.name : "error"})`,
        };
      }
    outcomes.push(outcome);
    log(`#${outcome.number} ${outcome.action}: ${outcome.detail}`);
  }
  log(
    `${numbers.length} labelled pull request(s); ${outcomes.filter((outcome) => outcome.action === "merged").length} merged${dryRun ? " (dry run, nothing written)" : ""}.`,
  );
  return outcomes;
}

/** A GitHub REST client that can only GET in a dry run. */
export function githubApi(
  token: string,
  dryRun: boolean,
  fetcher: typeof fetch = fetch,
): Api {
  return async (method, path, body) => {
    if (dryRun && method !== "GET")
      throw new Error("A dry run never writes to GitHub");
    const response = await fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "slop-ready-auto-merge",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  };
}

if (import.meta.main) {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const lines: string[] = [];
  await runReadyAutoMerge({
    api: githubApi(token, dryRun),
    repository: process.env.GITHUB_REPOSITORY ?? PILOT_REPOSITORY,
    enabled: process.env.SLOPBOT_AUTO_MERGE,
    dryRun,
    log: (line) => {
      console.log(line);
      lines.push(line);
    },
  });
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${lines.map((line) => `- ${line}`).join("\n")}\n`,
    );
}
