// The slopbot:ready label (operator decision, 16 November 2026; PRD section 5).
// When a project owner turns it on, Slopbot labels an open pull request
// `slopbot:ready` and adds one line to its review comment while all five
// conditions hold at the pull request's exact head commit:
//   1. GitHub reports the branch mergeable with every check passing;
//   2. Slopbot's own review of that head has no finding;
//   3. enough approvals at that head from distinct accounts with write access;
//   4. the change is under the size cap;
//   5. it touches no protected path.
// The label comes off on any new push or as soon as a condition stops
// holding. Slopbot never merges; a person does, or on Slop's own repository
// the repository's ready-auto-merge workflow (pilot, operator decision of
// 25 November 2026, scripts/ready-auto-merge.ts). Points are not affected.
import {
  type ReadyLabelSettings,
  readyLabelSettings,
} from "../../src/lib/slopbot-ready.mjs";
import type { Job } from "./contracts";
import { findReviewComment, GitHubClient, GitHubError } from "./github";
import * as store from "./persistence";
import { registeredProject, requireScope } from "./registry";
import { feeMode, feeUnpaid } from "./submission-fee";

export const READY_LABEL = "slopbot:ready";
export const READY_LINE_MARKER = "<!-- slopbot:ready -->";
/** More deleted lines than this is a large deletion and never ready. */
export const LARGE_DELETION_LINES = 300;
/** Pending checks have no webhook (Slopbot has no Checks permission). */
export const PENDING_RECHECK_MS = 10 * 60_000;
/** A labelled pull request is checked again in case a check is re-run. */
export const READY_RECHECK_MS = 60 * 60_000;
/** Pending rechecks stop after this long on one head commit. */
export const PENDING_WINDOW_MS = 14 * 86_400_000;
export const READY_DISPATCH_BATCH = 20;
const MAX_REVIEW_PAGES = 10;
const MAX_PERMISSION_LOOKUPS = 25;

export type ReadyJob = Extract<Job, { kind: "ready_label" }>;
export type ReadyEnv = {
  SLOPBOT_DB: store.D1Database;
  SLOPBOT_APP_ID: string;
  SLOPBOT_APP_PRIVATE_KEY: string;
  SLOPBOT_APP_USER_ID: string;
  /** The submission fee switch (PRD section 5). Absent means off. */
  SUBMISSION_FEE_MODE?: string;
};
type Queue = { send(body: Job): Promise<void> };
type RepositoryRef = Pick<Job, "owner" | "repo" | "repositoryId">;

// ---------------------------------------------------------------------------
// Protected paths. The default set always applies; an owner can only add.

const CI = "CI or GitHub settings";
const DEPENDENCIES = "a dependency manifest or lockfile";
const PAYMENTS = "contracts or payment code";
const POLICY = "a skill, agent or policy file";
const MANIFEST = "the Slop project manifest";
const SECURITY = "SECURITY.md";
const BINARY = "a binary file or a file without a text diff";
const DELETED = "a deleted file";
const OWNER = "a path this project protects";

/** Directories at the repository root. */
const ROOT_DIRECTORIES: ReadonlyMap<string, string> = new Map([
  [".github", CI],
  [".circleci", CI],
  [".buildkite", CI],
  [".woodpecker", CI],
  [".gitlab", CI],
  [".azure-pipelines", CI],
]);

/** Directory names at any depth (compared case-insensitively). */
const ANY_DIRECTORIES: ReadonlyMap<string, string> = new Map([
  ["contracts", PAYMENTS],
  ["contract", PAYMENTS],
  ["payments", PAYMENTS],
  ["payment", PAYMENTS],
  ["escrow", PAYMENTS],
  ["billing", PAYMENTS],
  ["wallet", PAYMENTS],
  ["wallets", PAYMENTS],
  ["skills", POLICY],
  [".claude", POLICY],
  [".cursor", POLICY],
  [".windsurf", POLICY],
]);

/** File names at any depth (compared case-insensitively). */
const FILE_NAMES: ReadonlyMap<string, string> = new Map([
  ...[
    ".gitlab-ci.yml",
    ".travis.yml",
    "azure-pipelines.yml",
    "jenkinsfile",
    "appveyor.yml",
    "bitbucket-pipelines.yml",
    ".drone.yml",
    ".woodpecker.yml",
    "cloudbuild.yaml",
    "cloudbuild.yml",
    ".pre-commit-config.yaml",
    ".gitmodules",
  ].map((name) => [name, CI] as const),
  ...[
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    ".yarnrc",
    ".yarnrc.yml",
    ".npmrc",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "bun.lock",
    "bun.lockb",
    "bunfig.toml",
    "deno.json",
    "deno.jsonc",
    "deno.lock",
    "cargo.toml",
    "cargo.lock",
    "go.mod",
    "go.sum",
    "go.work",
    "go.work.sum",
    "pipfile",
    "pipfile.lock",
    "pyproject.toml",
    "poetry.lock",
    "uv.lock",
    "setup.py",
    "setup.cfg",
    "gemfile",
    "gemfile.lock",
    "composer.json",
    "composer.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradle.lockfile",
    "libs.versions.toml",
    "packages.lock.json",
    "directory.packages.props",
    "mix.exs",
    "mix.lock",
    "package.swift",
    "package.resolved",
    "podfile",
    "podfile.lock",
    "pubspec.yaml",
    "pubspec.lock",
    "flake.nix",
    "flake.lock",
    "vcpkg.json",
    "conanfile.txt",
    "conanfile.py",
  ].map((name) => [name, DEPENDENCIES] as const),
  ...["foundry.toml", "anchor.toml", "remappings.txt"].map(
    (name) => [name, PAYMENTS] as const,
  ),
  ...[
    "skill.md",
    "agents.md",
    "claude.md",
    "gemini.md",
    "contributing.md",
    "codeowners",
    "code_of_conduct.md",
    ".cursorrules",
    ".windsurfrules",
  ].map((name) => [name, POLICY] as const),
  ["slop-project.json", MANIFEST],
  ["slopbot.json", MANIFEST],
  ["security.md", SECURITY],
]);

/** File-name patterns at any depth (tested on the lower-cased name). */
const FILE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^requirements[^/]*\.(?:txt|in)$/u, DEPENDENCIES],
  [/\.(?:gemspec|csproj|fsproj|vbproj|nuspec)$/u, DEPENDENCIES],
  [/\.(?:sol|vy|move|cairo)$/u, PAYMENTS],
  [/^hardhat\.config\.[a-z]+$/u, PAYMENTS],
  [/^(?:license|licence|copying)(?:\.[^/]*)?$/u, POLICY],
];

const BINARY_EXTENSIONS = new Set([
  "exe",
  "dll",
  "so",
  "dylib",
  "a",
  "o",
  "obj",
  "lib",
  "bin",
  "class",
  "jar",
  "war",
  "ear",
  "wasm",
  "pyc",
  "pyo",
  "whl",
  "egg",
  "node",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "zst",
  "7z",
  "rar",
  "iso",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "apk",
  "ipa",
  "msi",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "pdf",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "mov",
  "wav",
  "ogg",
  "webm",
  "sqlite",
  "db",
]);

function escapeRegExp(text: string) {
  return text.replace(/[.+^${}()|[\]\\@-]/gu, (c) => `\\${c}`);
}

/**
 * An owner pattern, gitignore-like: `*` matches within one path segment and
 * `**` across segments. A pattern without `/` matches that name at any depth;
 * a pattern with `/` is anchored at the repository root. Either form also
 * covers everything below a matching directory.
 */
export function ownerPatternRegExp(pattern: string): RegExp {
  const trimmed = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  const anchored = trimmed.includes("/");
  const body = trimmed
    .split(/(\*\*\/|\*\*|\*)/u)
    .map((part) =>
      part === "**/"
        ? "(?:[^/]*/)*"
        : part === "**"
          ? ".*"
          : part === "*"
            ? "[^/]*"
            : escapeRegExp(part),
    )
    .join("");
  return new RegExp(`${anchored ? "^" : "(?:^|/)"}${body}(?:/.*)?$`, "u");
}

/** Why a changed path is protected, or null. */
export function protectedPathReason(
  path: string,
  ownerPatterns: readonly string[] = [],
): string | null {
  const segments = path.split("/");
  const name = (segments.at(-1) ?? "").toLowerCase();
  const directories = segments.slice(0, -1);
  const root = ROOT_DIRECTORIES.get(directories[0] ?? "");
  if (root) return root;
  for (const directory of directories) {
    const reason = ANY_DIRECTORIES.get(directory.toLowerCase());
    if (reason) return reason;
  }
  const named = FILE_NAMES.get(name);
  if (named) return named;
  for (const [pattern, reason] of FILE_PATTERNS)
    if (pattern.test(name)) return reason;
  const extension = name.includes(".") ? name.split(".").at(-1) : undefined;
  if (extension !== undefined && BINARY_EXTENSIONS.has(extension))
    return BINARY;
  if (ownerPatterns.some((pattern) => ownerPatternRegExp(pattern).test(path)))
    return OWNER;
  return null;
}

export type ChangedFile = {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

/** The first protected change in the list, or null. */
export function protectedChange(
  files: readonly ChangedFile[],
  ownerPatterns: readonly string[],
): string | null {
  for (const file of files) {
    if (file.status === "removed") return `${DELETED} (${file.filename})`;
    for (const path of [file.filename, file.previous_filename]) {
      if (path === undefined) continue;
      const reason = protectedPathReason(path, ownerPatterns);
      if (reason) return `${reason} (${path})`;
    }
    // GitHub omits the patch of binary and very large files.
    const pureRename =
      file.status === "renamed" && file.additions + file.deletions === 0;
    if (typeof file.patch !== "string" && !pureRename)
      return `${BINARY} (${file.filename})`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The decision. Pure: every fact is read by the caller at one head commit.

export type SlopbotVerdict =
  | "none"
  | "finding"
  | "limited"
  | "running"
  | "missing";

export type ReadyFacts = {
  open: boolean;
  draft: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  verdict: SlopbotVerdict;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** null when the change is over the size cap and the list was not read. */
  files: readonly ChangedFile[] | null;
  approvals: number;
  changesRequested: boolean;
  /** Slopbot asked a submission fee for this pull request and none is paid. */
  feeUnpaid?: boolean;
};

export type ReadyDecision = {
  ready: boolean;
  reason: string;
  /** True when only a condition that no webhook announces is missing. */
  pending: boolean;
};

const MERGEABLE_STATES = new Set(["clean", "has_hooks"]);

export function readyDecision(
  facts: ReadyFacts,
  settings: ReadyLabelSettings,
): ReadyDecision {
  const no = (reason: string, pending = false): ReadyDecision => ({
    ready: false,
    reason,
    pending,
  });
  if (!facts.open) return no("the pull request is not open");
  if (facts.draft) return no("the pull request is a draft");
  // An unpaid pull request is never ready, whatever else holds (PRD section 5).
  if (facts.feeUnpaid === true)
    return no("its submission fee has not been paid");
  if (facts.verdict === "running")
    return no("Slopbot is still reviewing this commit", true);
  if (facts.verdict === "missing")
    return no("Slopbot has not reviewed this commit");
  if (facts.verdict === "limited")
    return no("Slopbot could not review every changed file");
  if (facts.verdict === "finding")
    return no("Slopbot's review of this commit has a finding");
  const lines = facts.additions + facts.deletions;
  if (lines > settings.maxChangedLines)
    return no(
      `${lines} changed lines is over the cap of ${settings.maxChangedLines}`,
    );
  if (facts.changedFiles > settings.maxChangedFiles)
    return no(
      `${facts.changedFiles} changed files is over the cap of ${settings.maxChangedFiles}`,
    );
  if (facts.deletions > LARGE_DELETION_LINES)
    return no(
      `${facts.deletions} deleted lines is a large deletion (over ${LARGE_DELETION_LINES})`,
    );
  if (facts.files === null || facts.files.length !== facts.changedFiles)
    return no("the changed file list could not be read in full");
  const protectedReason = protectedChange(facts.files, settings.protectedPaths);
  if (protectedReason) return no(`it touches ${protectedReason}`);
  if (facts.changesRequested)
    return no("an account with write access requested changes");
  if (facts.approvals < settings.approvals)
    return no(
      `${facts.approvals} of ${settings.approvals} required approvals at this commit from accounts with write access`,
    );
  if (
    facts.mergeable !== true ||
    !MERGEABLE_STATES.has(facts.mergeableState ?? "")
  )
    return no(
      `GitHub does not report every check passing and the branch mergeable (${facts.mergeableState ?? "unknown"})`,
      facts.mergeableState === null ||
        ["unknown", "unstable", "blocked", "behind"].includes(
          facts.mergeableState,
        ),
    );
  return {
    ready: true,
    reason: "all conditions hold",
    pending: false,
  };
}

/** The one line Slopbot adds to its review comment. */
export function readyLine(
  decision: ReadyDecision,
  headSha: string,
  facts: Pick<
    ReadyFacts,
    "additions" | "deletions" | "changedFiles" | "approvals"
  >,
  settings: ReadyLabelSettings,
): string {
  const at = `\`${headSha.slice(0, 7)}\``;
  if (!decision.ready)
    return `${READY_LINE_MARKER} **Not labelled \`${READY_LABEL}\`** at ${at}: ${decision.reason}.`;
  return `${READY_LINE_MARKER} **Labelled \`${READY_LABEL}\`** at ${at}. Checked: GitHub reports every check passing and the branch mergeable, Slopbot's review has no finding, ${facts.approvals} approval${facts.approvals === 1 ? "" : "s"} at this commit from accounts with write access (${settings.approvals} required), ${facts.additions + facts.deletions} changed lines in ${facts.changedFiles} file${facts.changedFiles === 1 ? "" : "s"} (caps ${settings.maxChangedLines} and ${settings.maxChangedFiles}), no protected path. Not checked: whether the change is correct or wanted, and anything the checks do not test. A maintainer merges; Slopbot never merges.`;
}

/** The review comment with its ready line replaced, added or removed. */
export function withReadyLine(body: string, line: string | null): string {
  const kept = body
    .split("\n")
    .filter((existing) => !existing.startsWith(READY_LINE_MARKER));
  if (line === null) return kept.join("\n");
  // After the heading, the summary and the advisory sentence.
  const details = kept.indexOf("<details><summary>Review details</summary>");
  const at = details > 0 ? details : kept.length;
  const before = kept.slice(0, at);
  while (before.length > 0 && before.at(-1) === "") before.pop();
  return [...before, "", line, "", ...kept.slice(at)].join("\n");
}

// ---------------------------------------------------------------------------
// GitHub and D1 reads.

type Pull = {
  node_id: string;
  number: number;
  state: string;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  head: { sha: string };
  user: { id: number; type: string } | null;
  labels?: { name: string }[];
  additions: number;
  deletions: number;
  changed_files: number;
};

type ReviewRow = {
  status: string;
  action: string | null;
  verdict: string | null;
};

/** Slopbot's own latest review of this item at exactly this head commit. */
export async function slopbotVerdict(
  db: store.D1Database,
  repositoryId: number,
  itemNodeId: string,
  headSha: string,
): Promise<SlopbotVerdict> {
  const row = await db
    .prepare(
      `SELECT status, action, verdict FROM slopbot_reviews
       WHERE repository_id = ? AND item_node_id = ? AND revision = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(repositoryId, itemNodeId, headSha)
    .first<ReviewRow>();
  if (row === null) return "missing";
  if (row.status === "running") return "running";
  if (row.status !== "completed" || row.verdict === null) return "missing";
  let verdict: { category?: unknown; limitations?: unknown };
  try {
    verdict = JSON.parse(row.verdict);
  } catch {
    return "missing";
  }
  if (verdict.category !== "none") return "finding";
  if (row.action !== "comment") return "missing";
  if (!Array.isArray(verdict.limitations) || verdict.limitations.length > 0)
    return "limited";
  return "none";
}

type Review = {
  user: { id: number; login: string; type: string } | null;
  state: string;
  commit_id: string | null;
};

/** Approvals at the head and open change requests, write access only. */
export async function maintainerReviews(
  github: GitHubClient,
  job: RepositoryRef & { number: number },
  headSha: string,
  authorId: number | null,
): Promise<{ approvals: number; changesRequested: boolean } | null> {
  const latest = new Map<number, Review>();
  for (let page = 1; ; page++) {
    if (page > MAX_REVIEW_PAGES) return null;
    const response = await github.request<Review[]>(
      "GET",
      `/repos/${job.owner}/${job.repo}/pulls/${job.number}/reviews?per_page=100&page=${page}`,
    );
    if (response.status !== 200 || !Array.isArray(response.data)) return null;
    for (const review of response.data) {
      if (
        review.user === null ||
        review.user.type !== "User" ||
        !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)
      )
        continue;
      // GitHub lists reviews oldest first; a later decision replaces one.
      latest.set(review.user.id, review);
    }
    if (response.data.length < 100) break;
  }
  const approvers: Review[] = [];
  const requesters: Review[] = [];
  for (const [id, review] of latest) {
    if (id === authorId) continue;
    if (review.state === "APPROVED" && review.commit_id === headSha)
      approvers.push(review);
    if (review.state === "CHANGES_REQUESTED") requesters.push(review);
  }
  if (approvers.length + requesters.length > MAX_PERMISSION_LOOKUPS)
    return null;
  const writes = async (review: Review) => {
    const user = review.user;
    if (user === null) return false;
    const permission = await github.get<{
      permission: string;
      user?: { id: number } | null;
    }>(
      `/repos/${job.owner}/${job.repo}/collaborators/${encodeURIComponent(user.login)}/permission`,
    );
    return (
      permission !== null &&
      (permission.user === undefined ||
        permission.user === null ||
        permission.user.id === user.id) &&
      // GitHub maps maintain to write; custom role names are not access levels.
      ["admin", "write"].includes(permission.permission)
    );
  };
  let approvals = 0;
  for (const review of approvers) if (await writes(review)) approvals++;
  let changesRequested = false;
  for (const review of requesters)
    if (await writes(review)) {
      changesRequested = true;
      break;
    }
  return { approvals, changesRequested };
}

async function changedFiles(
  github: GitHubClient,
  job: RepositoryRef & { number: number },
  expected: number,
): Promise<ChangedFile[] | null> {
  const files: ChangedFile[] = [];
  for (let page = 1; files.length < expected; page++) {
    if (page > 4) return null;
    const response = await github.request<ChangedFile[]>(
      "GET",
      `/repos/${job.owner}/${job.repo}/pulls/${job.number}/files?per_page=100&page=${page}`,
    );
    if (response.status !== 200 || !Array.isArray(response.data)) return null;
    files.push(...response.data);
    if (response.data.length < 100) break;
  }
  return files;
}

export async function readyFacts(
  db: store.D1Database,
  github: GitHubClient,
  job: RepositoryRef & { number: number },
  pull: Pull,
  settings: ReadyLabelSettings,
): Promise<ReadyFacts> {
  const head = pull.head.sha;
  const overCap =
    pull.additions + pull.deletions > settings.maxChangedLines ||
    pull.changed_files > settings.maxChangedFiles;
  const open = pull.state === "open" && pull.merged !== true;
  const verdict = await slopbotVerdict(
    db,
    job.repositoryId,
    pull.node_id,
    head,
  );
  const reviewable = open && pull.draft !== true && verdict === "none";
  const files =
    reviewable && !overCap
      ? await changedFiles(github, job, pull.changed_files)
      : null;
  const reviews =
    reviewable && !overCap && files !== null
      ? await maintainerReviews(github, job, head, pull.user?.id ?? null)
      : null;
  return {
    open,
    draft: pull.draft === true,
    mergeable: pull.mergeable ?? null,
    mergeableState: pull.mergeable_state ?? null,
    verdict,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
    files,
    approvals: reviews?.approvals ?? 0,
    changesRequested: reviews?.changesRequested ?? false,
  };
}

// ---------------------------------------------------------------------------
// D1 state and GitHub writes.

type ReadyRow = {
  state: "ready" | "not-ready" | "off";
  head_sha: string | null;
  first_seen_at: string;
};

async function readyRow(db: store.D1Database, job: ReadyJob) {
  return db
    .prepare(
      "SELECT state, head_sha, first_seen_at FROM slopbot_ready_labels WHERE repository_id = ? AND pull_number = ?",
    )
    .bind(job.repositoryId, job.number)
    .first<ReadyRow>();
}

async function saveRow(
  db: store.D1Database,
  job: ReadyJob,
  row: {
    headSha: string | null;
    state: ReadyRow["state"];
    reason: string;
    firstSeenAt: string;
    nextCheckAt: string | null;
  },
  at: string,
) {
  await db
    .prepare(
      `INSERT INTO slopbot_ready_labels (repository_id, pull_number, installation_id, owner, repo, head_sha, state, reason, first_seen_at, updated_at, next_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repository_id, pull_number) DO UPDATE SET
         installation_id = excluded.installation_id, owner = excluded.owner, repo = excluded.repo,
         head_sha = excluded.head_sha, state = excluded.state, reason = excluded.reason,
         first_seen_at = excluded.first_seen_at, updated_at = excluded.updated_at,
         next_check_at = excluded.next_check_at`,
    )
    .bind(
      job.repositoryId,
      job.number,
      job.installationId,
      job.owner,
      job.repo,
      row.headSha,
      row.state,
      row.reason.slice(0, 500),
      row.firstSeenAt,
      at,
      row.nextCheckAt,
    )
    .run();
}

function hasReadyLabel(pull: Pull) {
  return (pull.labels ?? []).some((label) => label.name === READY_LABEL);
}

async function addReadyLabel(
  db: store.D1Database,
  github: GitHubClient,
  job: ReadyJob,
) {
  await requireScope(db, job, "contributor");
  const result = await github.request<{ name: string }[]>(
    "POST",
    `/repos/${job.owner}/${job.repo}/issues/${job.number}/labels`,
    { labels: [READY_LABEL] },
  );
  if (
    result.status !== 200 ||
    !Array.isArray(result.data) ||
    !result.data.some((entry) => entry.name === READY_LABEL)
  )
    throw new GitHubError(
      result.status,
      "GitHub did not confirm the label addition",
    );
}

async function removeReadyLabel(github: GitHubClient, job: ReadyJob) {
  const removed = await github.request<unknown>(
    "DELETE",
    `/repos/${job.owner}/${job.repo}/issues/${job.number}/labels/${encodeURIComponent(READY_LABEL)}`,
  );
  if (removed.status !== 200 && removed.status !== 404)
    throw new GitHubError(
      removed.status,
      "GitHub did not confirm the label removal",
    );
}

type Comment = { id: number; body: string | null; user: { id: number } | null };

/** The bot's review comment; null when it is missing or not the bot's. */
async function reviewComment(
  env: ReadyEnv,
  github: GitHubClient,
  job: ReadyJob,
  itemNodeId: string,
): Promise<Comment | null> {
  let id = await store.commentId(env.SLOPBOT_DB, itemNodeId);
  if (id === null) {
    id = await findReviewComment(
      github,
      job.owner,
      job.repo,
      job.number,
      env.SLOPBOT_APP_USER_ID,
    );
    if (id === null) return null;
  }
  const comment = await github.get<Comment>(
    `/repos/${job.owner}/${job.repo}/issues/comments/${id}`,
  );
  if (
    comment === null ||
    comment.id !== id ||
    typeof comment.body !== "string" ||
    String(comment.user?.id) !== env.SLOPBOT_APP_USER_ID ||
    !comment.body.startsWith("<!-- slopbot:review -->")
  )
    return null;
  return comment;
}

async function writeReadyLine(
  github: GitHubClient,
  job: ReadyJob,
  comment: Comment,
  line: string | null,
) {
  const body = withReadyLine(comment.body ?? "", line);
  if (body === comment.body) return;
  const updated = await github.request<{ id: number }>(
    "PATCH",
    `/repos/${job.owner}/${job.repo}/issues/comments/${comment.id}`,
    { body },
  );
  if (updated.status !== 200 || updated.data?.id !== comment.id)
    throw new GitHubError(
      updated.status,
      "GitHub did not confirm the comment update",
    );
}

/** True when a webhook for this pull request should queue a ready check. */
export async function readyLabelWanted(
  db: store.D1Database,
  job: RepositoryRef & { number: number },
): Promise<boolean> {
  if (readyLabelSettings(await registeredProject(db, job)) !== null)
    return true;
  const row = await db
    .prepare(
      "SELECT state FROM slopbot_ready_labels WHERE repository_id = ? AND pull_number = ?",
    )
    .bind(job.repositoryId, job.number)
    .first<{ state: string }>();
  return row?.state === "ready";
}

/** The ready-check job for a pull request event, or a review's result. */
export function readyJob(base: Omit<ReadyJob, "kind" | "itemKind">): ReadyJob {
  return { kind: "ready_label", itemKind: "pull_request", ...base };
}

/**
 * Re-read the pull request at its current head and add or remove the label.
 * Every GitHub write re-checks that the head commit has not moved.
 */
export async function refreshReadyLabel(
  env: ReadyEnv,
  job: ReadyJob,
  now: Date = new Date(),
): Promise<string> {
  const db = env.SLOPBOT_DB;
  const at = now.toISOString();
  const settings = readyLabelSettings(await registeredProject(db, job));
  const row = await readyRow(db, job);
  if (settings === null && row?.state !== "ready")
    return "ready label is off for this project";
  if (!(await store.installationActive(db, job.installationId)))
    return "installation removed or suspended";
  const github = await GitHubClient.forInstallation(
    env.SLOPBOT_APP_ID,
    env.SLOPBOT_APP_PRIVATE_KEY,
    job.installationId,
  );
  const pull = await github.get<Pull>(
    `/repos/${job.owner}/${job.repo}/pulls/${job.number}`,
  );
  if (pull === null) return "pull request not readable";
  const head = pull.head.sha;
  const firstSeenAt =
    row !== null && row.head_sha === head ? row.first_seen_at : at;
  if (settings === null) {
    // The owner turned the label off, or the project stopped contributor work.
    // A closed or merged pull request keeps its last label as history.
    if (pull.state === "open" && pull.merged !== true) {
      if (hasReadyLabel(pull)) await removeReadyLabel(github, job);
      const comment = await reviewComment(env, github, job, pull.node_id);
      if (comment) await writeReadyLine(github, job, comment, null);
    }
    await saveRow(
      db,
      job,
      {
        headSha: head,
        state: "off",
        reason: "ready label is off for this project",
        firstSeenAt,
        nextCheckAt: null,
      },
      at,
    );
    return "ready label removed: setting off";
  }
  const labelled = hasReadyLabel(pull);
  if (pull.state !== "open" || pull.merged === true) {
    // A closed or merged pull request keeps its last label as history.
    await saveRow(
      db,
      job,
      {
        headSha: head,
        state: labelled ? "ready" : "not-ready",
        reason: "the pull request is not open",
        firstSeenAt,
        nextCheckAt: null,
      },
      at,
    );
    return "pull request is not open";
  }
  const facts = {
    ...(await readyFacts(db, github, job, pull, settings)),
    feeUnpaid:
      feeMode(env.SUBMISSION_FEE_MODE) === "live" &&
      (await feeUnpaid(db, job.repositoryId, job.number)),
  };
  let decision = readyDecision(facts, settings);
  const comment =
    facts.verdict === "none" || labelled
      ? await reviewComment(env, github, job, pull.node_id)
      : null;
  if (decision.ready && comment === null)
    decision = {
      ready: false,
      reason: "Slopbot's review comment is unavailable",
      pending: false,
    };
  if (decision.ready !== labelled || comment !== null) {
    // A push between the reads and the write leaves the decision stale.
    const current = await github.get<Pull>(
      `/repos/${job.owner}/${job.repo}/pulls/${job.number}`,
    );
    if (current === null || current.head.sha !== head) {
      if (labelled && current !== null) await removeReadyLabel(github, job);
      await saveRow(
        db,
        job,
        {
          headSha: current?.head.sha ?? head,
          state: "not-ready",
          reason: "a new commit arrived during the check",
          firstSeenAt: at,
          nextCheckAt: at,
        },
        at,
      );
      return "head moved during the ready check";
    }
    if (decision.ready && !labelled) await addReadyLabel(db, github, job);
    if (!decision.ready && labelled) await removeReadyLabel(github, job);
    if (comment !== null)
      await writeReadyLine(
        github,
        job,
        comment,
        readyLine(decision, head, facts, settings),
      );
  }
  const pendingOpen =
    decision.pending &&
    now.getTime() - Date.parse(firstSeenAt) < PENDING_WINDOW_MS;
  await saveRow(
    db,
    job,
    {
      headSha: head,
      state: decision.ready ? "ready" : "not-ready",
      reason: decision.reason,
      firstSeenAt,
      nextCheckAt: decision.ready
        ? new Date(now.getTime() + READY_RECHECK_MS).toISOString()
        : pendingOpen
          ? new Date(now.getTime() + PENDING_RECHECK_MS).toISOString()
          : null,
    },
    at,
  );
  return decision.ready
    ? labelled
      ? "ready label kept"
      : "ready label added"
    : labelled
      ? `ready label removed: ${decision.reason}`
      : `not ready: ${decision.reason}`;
}

/** Scheduled: queue rechecks that no webhook would trigger. */
export async function dispatchReadyChecks(
  db: store.D1Database<store.D1QueryStatement>,
  queue: Queue,
  now: Date = new Date(),
): Promise<number> {
  const at = now.toISOString();
  const due = await db
    .prepare(
      `SELECT repository_id, pull_number, installation_id, owner, repo
       FROM slopbot_ready_labels WHERE next_check_at IS NOT NULL AND next_check_at <= ?
       ORDER BY next_check_at LIMIT ?`,
    )
    .bind(at, READY_DISPATCH_BATCH)
    .all<{
      repository_id: number;
      pull_number: number;
      installation_id: number;
      owner: string;
      repo: string;
    }>();
  const rows = due.results;
  for (const row of rows) {
    // Claim before sending, so an overlapping run does not queue it twice;
    // the job sets the next time itself.
    await db
      .prepare(
        "UPDATE slopbot_ready_labels SET next_check_at = ? WHERE repository_id = ? AND pull_number = ?",
      )
      .bind(
        new Date(now.getTime() + PENDING_RECHECK_MS).toISOString(),
        row.repository_id,
        row.pull_number,
      )
      .run();
    await queue.send(
      readyJob({
        deliveryId: `ready:${row.repository_id}:${row.pull_number}:${at}`,
        installationId: row.installation_id,
        repositoryId: row.repository_id,
        owner: row.owner,
        repo: row.repo,
        number: row.pull_number,
      }),
    );
  }
  return rows.length;
}
