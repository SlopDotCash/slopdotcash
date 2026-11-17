// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
import { type Credential, type Credentials, granted } from "./oauth.ts";
import {
  type Access, type Account, type Advisory, type App, type Comment, type Commit, type GitHubWorld, type Installation, type Item, type Label,
  type Permission, type Pull, type Repository, type Review, type TimelineEvent, blobSha, permissionRank, sortedByTime, treeOf,
} from "./world.ts";

export interface Context {
  readonly world: GitHubWorld;
  readonly credentials: Credentials;
  readonly credential: Credential;
  readonly method: string;
  readonly url: URL;
  readonly accept: string;
  readonly authority: string;
  readonly body: unknown;
}

type Params = Readonly<Record<string, string>>;
type Answer = Response | Promise<Response>;

interface Need {
  readonly permission: string | ReadonlyArray<string>;
  readonly level: Access;
}

interface Route { readonly method: string; readonly path: string; readonly run: (ctx: Context, params: Params) => Answer }
interface RepoRoute { readonly method: string; readonly path: string; readonly need: Need; readonly run: (ctx: Context, repo: Repository, params: Params) => Answer }

const docs = "https://docs.github.com/rest";
const read = (permission: string | ReadonlyArray<string>): Need => ({ permission, level: "read" });
const write = (permission: string | ReadonlyArray<string>): Need => ({ permission, level: "write" });
const items = ["issues", "pull_requests"] as const;

/** @throws {never} */
export function reply(status: number, body?: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-github-media-type": "github.v3; format=json", ...headers },
  });
}

/** @throws {never} */
export function failure(status: number, message: string, headers: Readonly<Record<string, string>> = {}): Response {
  return reply(status, { message, documentation_url: docs, status: String(status) }, headers);
}

function match(template: string, path: string): Params | undefined {
  if (template === path) return {};
  const want = template.split("/"), have = path.split("/");
  const params: Record<string, string> = {};
  for (const [index, part] of want.entries()) {
    if (part.startsWith("*")) {
      params[part.slice(1)] = have.slice(index).map(decodeURIComponent).join("/");
      return params;
    }
    const value = have[index];
    if (value === undefined) return undefined;
    if (part.startsWith(":") && value !== "") params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return undefined;
  }
  return want.length === have.length ? params : undefined;
}

function actorOf(ctx: Context): Account | undefined {
  switch (ctx.credential.kind) {
    case "user": return ctx.credential.account;
    case "installation": return ctx.credential.installation.app.bot;
    default: return undefined;
  }
}

function access(world: GitHubWorld, credential: Credential, repo: Repository): Permission | "none" {
  switch (credential.kind) {
    case "user": return world.permission(repo, credential.account);
    case "installation": return granted(credential, repo, world, "metadata", "read") === "hidden" ? "none" : "read";
    case "anonymous": return repo.private ? "none" : "read";
    case "app": return "none";
    default: {
      const _exhaustive: never = credential;
      return _exhaustive;
    }
  }
}

/** @throws {never} */
export function visibleTo(world: GitHubWorld, credential: Credential): (repo: Repository) => boolean {
  return (repo) => access(world, credential, repo) !== "none";
}

function effective(ctx: Context, repo: Repository): Permission | "none" {
  return access(ctx.world, ctx.credential, repo);
}

function explicit(world: GitHubWorld, repo: Repository, account: Account): Permission | "none" {
  const org = repo.owner.kind === "Organization" && repo.owner.members.get(account.id) === "admin" ? "admin" : "none";
  const direct = repo.permissions.get(account.id) ?? "none";
  return permissionRank[org] > permissionRank[direct] ? org : direct;
}

function association(world: GitHubWorld, repo: Repository, account: Account): string {
  if (repo.owner === account) return "OWNER";
  if (repo.owner.members.has(account.id)) return "MEMBER";
  if (explicit(world, repo, account) !== "none") return "COLLABORATOR";
  const merged = [...repo.items.values()].some((item) => item.kind === "pull" && item.mergedAt !== null && item.author === account);
  return merged ? "CONTRIBUTOR" : "NONE";
}

/** @throws {never} */
export function userJson(authority: string, account: Account, full = false) {
  const base = {
    login: account.login,
    id: account.id,
    node_id: account.nodeId,
    avatar_url: `https://avatars.githubusercontent.com/u/${account.id}?v=4`,
    url: `${authority}/users/${encodeURIComponent(account.login)}`,
    html_url: `https://github.com/${account.login}`,
    type: account.kind,
    site_admin: false,
  };
  return full ? { ...base, name: account.name, created_at: account.createdAt, updated_at: account.createdAt } : base;
}

const fullName = (repo: Repository) => `${repo.owner.login}/${repo.name}`;

/** @throws {never} */
export function repositoryJson(authority: string, repo: Repository) {
  return {
    id: repo.id,
    node_id: repo.nodeId,
    name: repo.name,
    full_name: fullName(repo),
    private: repo.private,
    visibility: repo.private ? "private" : "public",
    owner: userJson(authority, repo.owner),
    html_url: `https://github.com/${fullName(repo)}`,
    description: repo.description,
    fork: repo.fork,
    archived: repo.archived,
    disabled: false,
    url: `${authority}/repos/${fullName(repo)}`,
    default_branch: repo.defaultBranch,
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
    pushed_at: repo.updatedAt,
    license: repo.licenseSpdx === null ? null : { key: repo.licenseSpdx.toLowerCase(), name: repo.licenseSpdx, spdx_id: repo.licenseSpdx, url: `${authority}/licenses/${repo.licenseSpdx.toLowerCase()}`, node_id: `L_${repo.licenseSpdx}` },
  };
}

function labelJson(authority: string, repo: Repository, label: Label) {
  return { id: label.id, node_id: label.nodeId, url: `${authority}/repos/${fullName(repo)}/labels/${encodeURIComponent(label.name)}`, name: label.name, color: label.color, description: label.description, default: false };
}

/** @throws {never} */
export function issueJson(authority: string, world: GitHubWorld, item: Item) {
  const repo = item.repository;
  const path = `${fullName(repo)}/${item.kind === "pull" ? "pull" : "issues"}/${item.number}`;
  return {
    id: item.id,
    node_id: item.nodeId,
    url: `${authority}/repos/${fullName(repo)}/issues/${item.number}`,
    repository_url: `${authority}/repos/${fullName(repo)}`,
    html_url: `https://github.com/${path}`,
    number: item.number,
    title: item.title,
    body: item.body,
    user: userJson(authority, item.author),
    labels: item.labels.map((label) => labelJson(authority, repo, label)),
    state: item.state,
    state_reason: item.kind === "issue" ? item.stateReason : null,
    locked: false,
    assignee: item.assignees[0] === undefined ? null : userJson(authority, item.assignees[0]),
    assignees: item.assignees.map((account) => userJson(authority, account)),
    comments: item.comments.length,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    closed_at: item.closedAt,
    author_association: association(world, repo, item.author),
    ...(item.kind === "pull"
      ? { draft: item.draft, pull_request: { url: `${authority}/repos/${fullName(repo)}/pulls/${item.number}`, html_url: `https://github.com/${path}`, merged_at: item.mergedAt } }
      : {}),
  };
}

/** @throws {never} */
export function pullJson(authority: string, world: GitHubWorld, pull: Pull) {
  const repo = pull.repository;
  const side = (ref: string, sha: string) => ({ label: `${repo.owner.login}:${ref}`, ref, sha, user: userJson(authority, repo.owner), repo: repositoryJson(authority, repo) });
  return {
    id: pull.id,
    node_id: pull.nodeId,
    url: `${authority}/repos/${fullName(repo)}/pulls/${pull.number}`,
    html_url: `https://github.com/${fullName(repo)}/pull/${pull.number}`,
    issue_url: `${authority}/repos/${fullName(repo)}/issues/${pull.number}`,
    number: pull.number,
    state: pull.state,
    locked: false,
    title: pull.title,
    body: pull.body,
    user: userJson(authority, pull.author),
    labels: pull.labels.map((label) => labelJson(authority, repo, label)),
    assignees: pull.assignees.map((account) => userJson(authority, account)),
    requested_reviewers: pull.requestedReviewers.map((account) => userJson(authority, account)),
    draft: pull.draft,
    created_at: pull.createdAt,
    updated_at: pull.updatedAt,
    closed_at: pull.closedAt,
    merged_at: pull.mergedAt,
    merge_commit_sha: pull.mergeCommit,
    merged: pull.mergedAt !== null,
    mergeable: null,
    merged_by: pull.mergedBy === null ? null : userJson(authority, pull.mergedBy),
    head: side(pull.headRef, pull.headSha),
    base: side(pull.baseRef, pull.baseSha),
    author_association: association(world, repo, pull.author),
    comments: pull.comments.length,
    review_comments: pull.reviewComments.length,
    commits: pull.commits.length,
    additions: pull.additions,
    deletions: pull.deletions,
    changed_files: pull.files.length,
  };
}

function commentJson(authority: string, world: GitHubWorld, item: Item, comment: Comment) {
  const repo = item.repository;
  const inline = comment.path !== undefined;
  return {
    id: comment.id,
    node_id: comment.nodeId,
    url: `${authority}/repos/${fullName(repo)}/${inline ? "pulls" : "issues"}/comments/${comment.id}`,
    html_url: `https://github.com/${fullName(repo)}/${item.kind === "pull" ? "pull" : "issues"}/${item.number}#${inline ? "discussion_r" : "issuecomment-"}${comment.id}`,
    user: userJson(authority, comment.author),
    body: comment.body,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    author_association: association(world, repo, comment.author),
    ...(inline
      ? { path: comment.path, line: comment.line, pull_request_review_id: comment.reviewId ?? null, pull_request_url: `${authority}/repos/${fullName(repo)}/pulls/${item.number}` }
      : { issue_url: `${authority}/repos/${fullName(repo)}/issues/${item.number}` }),
  };
}

function reviewJson(authority: string, world: GitHubWorld, pull: Pull, review: Review) {
  return {
    id: review.id,
    node_id: review.nodeId,
    user: userJson(authority, review.author),
    body: review.body,
    state: review.state,
    submitted_at: review.submittedAt,
    commit_id: review.commitId,
    author_association: association(world, pull.repository, review.author),
    html_url: `https://github.com/${fullName(pull.repository)}/pull/${pull.number}#pullrequestreview-${review.id}`,
    pull_request_url: `${authority}/repos/${fullName(pull.repository)}/pulls/${pull.number}`,
  };
}

function eventJson(authority: string, world: GitHubWorld, event: TimelineEvent) {
  const source = event.details.source;
  const referenced = typeof source === "object" && source !== null && "repo" in source && "number" in source ? world.findRepo(String(source.repo))?.items.get(Number(source.number)) : undefined;
  return {
    id: event.id,
    node_id: event.nodeId,
    event: event.event,
    actor: event.actor === undefined ? null : userJson(authority, event.actor),
    created_at: event.createdAt,
    ...event.details,
    ...(referenced === undefined ? {} : { source: { type: "issue", issue: issueJson(authority, world, referenced) } }),
  };
}

function timeline(authority: string, world: GitHubWorld, item: Item) {
  const entries: Array<{ readonly createdAt: string; readonly id: number; readonly json: unknown }> = [
    ...item.timeline.map((event) => ({ createdAt: event.createdAt, id: event.id, json: eventJson(authority, world, event) })),
    ...item.comments.map((comment) => ({ createdAt: comment.createdAt, id: comment.id, json: { event: "commented", actor: userJson(authority, comment.author), ...commentJson(authority, world, item, comment) } })),
    ...(item.kind === "pull" ? item.reviews.map((review) => ({ createdAt: review.submittedAt, id: review.id, json: { event: "reviewed", ...reviewJson(authority, world, item, review) } })) : []),
  ];
  return sortedByTime(entries).map((entry) => entry.json);
}

/** @throws {never} */
export function advisoryJson(authority: string, repo: Repository, advisory: Advisory) {
  return {
    ghsa_id: advisory.ghsaId,
    cve_id: null,
    url: `${authority}/repos/${fullName(repo)}/security-advisories/${advisory.ghsaId}`,
    html_url: `https://github.com/${fullName(repo)}/security/advisories/${advisory.ghsaId}`,
    summary: advisory.summary,
    description: advisory.description,
    severity: advisory.severity,
    cvss: advisory.cvssVector === null ? null : { vector_string: advisory.cvssVector, score: null },
    cwe_ids: advisory.cweIds,
    vulnerabilities: advisory.vulnerabilities,
    author: userJson(authority, advisory.author),
    publisher: null,
    credits_detailed: advisory.credits.map((credit) => ({ user: userJson(authority, credit.user), type: credit.type, state: "accepted" })),
    submission: advisory.submission,
    state: advisory.state,
    created_at: advisory.createdAt,
    updated_at: advisory.createdAt,
    published_at: advisory.state === "published" ? advisory.createdAt : null,
  };
}

/** @throws {never} */
export function installationJson(authority: string, installation: Installation) {
  return {
    id: installation.id,
    account: userJson(authority, installation.account),
    repository_selection: installation.repositories === "all" ? "all" : "selected",
    access_tokens_url: `${authority}/app/installations/${installation.id}/access_tokens`,
    repositories_url: `${authority}/installation/repositories`,
    app_id: Number(installation.app.id),
    app_slug: installation.app.slug,
    target_id: installation.account.id,
    target_type: installation.account.kind,
    permissions: installation.permissions,
    events: [],
    created_at: installation.createdAt,
    updated_at: installation.createdAt,
    suspended_at: installation.suspendedAt,
  };
}

function appJson(authority: string, app: App) {
  return { id: Number(app.id), slug: app.slug, client_id: app.clientId, name: app.slug, owner: null, html_url: `https://github.com/apps/${app.slug}`, permissions: {}, events: [], installations_count: 0, url: `${authority}/app` };
}

function lines(bytes: Uint8Array | undefined): string[] {
  return bytes === undefined || bytes.length === 0 ? [] : new TextDecoder().decode(bytes).split("\n");
}

function counted(from: ReadonlyArray<string>, to: ReadonlyArray<string>): number {
  const left = new Map<string, number>();
  for (const line of from) left.set(line, (left.get(line) ?? 0) + 1);
  let only = 0;
  for (const line of to) {
    const count = left.get(line) ?? 0;
    if (count === 0) only += 1;
    else left.set(line, count - 1);
  }
  return only;
}

function changes(before: ReadonlyMap<string, Uint8Array>, after: ReadonlyMap<string, Uint8Array>) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.flatMap((path) => {
    const old = before.get(path), now = after.get(path);
    if (old !== undefined && now !== undefined && blobSha(old) === blobSha(now)) return [];
    const additions = counted(lines(old), lines(now)), deletions = counted(lines(now), lines(old));
    const status = old === undefined ? "added" : now === undefined ? "removed" : "modified";
    return [{ sha: now === undefined ? null : blobSha(now), filename: path, status, additions, deletions, changes: additions + deletions }];
  });
}

function commitJson(authority: string, world: GitHubWorld, repo: Repository, commit: Commit, detailed: boolean) {
  const person = { name: commit.authorName, email: commit.authorEmail, date: commit.date };
  const base = {
    sha: commit.sha,
    node_id: commit.nodeId,
    url: `${authority}/repos/${fullName(repo)}/commits/${commit.sha}`,
    html_url: `https://github.com/${fullName(repo)}/commit/${commit.sha}`,
    commit: { author: person, committer: person, message: commit.message, tree: { sha: commit.tree, url: `${authority}/repos/${fullName(repo)}/git/trees/${commit.tree}` }, comment_count: 0 },
    author: commit.author === undefined ? null : userJson(authority, commit.author),
    committer: commit.author === undefined ? null : userJson(authority, commit.author),
    parents: commit.parents.map((sha) => ({ sha, url: `${authority}/repos/${fullName(repo)}/commits/${sha}` })),
  };
  if (!detailed) return base;
  const files = changes(repo.commits.get(commit.parents[0] ?? "")?.files ?? new Map(), commit.files);
  const additions = files.reduce((sum, file) => sum + file.additions, 0), deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return { ...base, stats: { total: additions + deletions, additions, deletions }, files };
}

/** @throws {never} */
export function resolveRef(repo: Repository, ref: string): string | undefined {
  const name = ref.replace(/^refs\//u, "").replace(/^heads\//u, "");
  const branch = repo.branches.get(name);
  if (branch !== undefined) return branch;
  if (!/^[0-9a-f]{4,40}$/u.test(ref)) return undefined;
  const found = [...repo.commits.keys()].filter((sha) => sha.startsWith(ref));
  return found.length === 1 ? found[0] : undefined;
}

function ancestors(repo: Repository, sha: string): string[] {
  const seen: string[] = [], queue = [sha];
  while (queue.length > 0) {
    const next = queue.shift() ?? "";
    if (seen.includes(next)) continue;
    seen.push(next);
    queue.push(...(repo.commits.get(next)?.parents ?? []));
  }
  return seen;
}

function history(repo: Repository, sha: string): Commit[] {
  return ancestors(repo, sha).flatMap((found) => repo.commits.get(found) ?? []).sort((a, b) => b.date.localeCompare(a.date));
}

function page<T>(ctx: Context, values: ReadonlyArray<T>, render: (value: T) => unknown, wrap: (items: unknown[]) => unknown = (rendered) => rendered, limit = 100): Response {
  const perPage = Math.min(limit, Math.max(1, Number(ctx.url.searchParams.get("per_page") ?? 30) || 30));
  const number = Math.max(1, Number(ctx.url.searchParams.get("page") ?? 1) || 1);
  const last = Math.max(1, Math.ceil(values.length / perPage));
  const link = (target: number, rel: string) => {
    const url = new URL(`${ctx.authority}${ctx.url.pathname}${ctx.url.search}`);
    url.searchParams.set("page", String(target));
    url.searchParams.set("per_page", String(perPage));
    return `<${url.href}>; rel="${rel}"`;
  };
  const links = [
    ...(number < last ? [link(number + 1, "next"), link(last, "last")] : []),
    ...(number > 1 ? [link(1, "first"), link(number - 1, "prev")] : []),
  ];
  return reply(200, wrap(values.slice((number - 1) * perPage, number * perPage).map(render)), links.length === 0 ? {} : { link: links.join(", ") });
}

function fields(body: unknown): Readonly<Record<string, unknown>> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function itemOf(repo: Repository, params: Params): Item | undefined {
  return repo.items.get(Number(params.number));
}

function pullOf(repo: Repository, params: Params): Pull | undefined {
  const item = itemOf(repo, params);
  return item?.kind === "pull" ? item : undefined;
}

const notFound = () => failure(404, "Not Found");

function setState(ctx: Context, item: Item, body: Readonly<Record<string, unknown>>): Response | undefined {
  const actor = actorOf(ctx);
  const writer = ctx.credential.kind !== "user" || permissionRank[ctx.world.permission(item.repository, ctx.credential.account)] >= permissionRank.triage;
  const own = ctx.credential.kind === "user" && ctx.credential.account === item.author;
  const at = new Date(ctx.world.now()).toISOString();
  if (typeof body.title === "string" || typeof body.body === "string") {
    if (!writer && !own) return failure(403, "Must have push access to repository");
    if (typeof body.title === "string") item.title = body.title;
    if (typeof body.body === "string") item.body = body.body;
    ctx.world.touch(item, at);
  }
  if (body.state === "open" || body.state === "closed") {
    if (!writer && !own) return failure(403, "Must have push access to repository");
    if (item.kind === "pull" && item.mergedAt !== null && body.state === "open") return failure(422, "Validation Failed");
    if (item.state !== body.state) {
      item.state = body.state;
      item.closedAt = body.state === "closed" ? at : null;
      if (item.kind === "issue") item.stateReason = body.state === "closed" ? (body.state_reason === "not_planned" ? "not_planned" : "completed") : "reopened";
      ctx.world.record(item, body.state === "closed" ? "closed" : "reopened", actor, item.kind === "issue" && body.state === "closed" ? { state_reason: item.stateReason } : {});
    }
  }
  if (Array.isArray(body.labels)) return replaceLabels(ctx, item, body.labels);
  return undefined;
}

function canLabel(ctx: Context, item: Item): boolean {
  return ctx.credential.kind !== "user" || permissionRank[ctx.world.permission(item.repository, ctx.credential.account)] >= permissionRank.triage;
}

function labelNames(body: unknown): string[] | undefined {
  const list = Array.isArray(body) ? body : fields(body).labels;
  if (!Array.isArray(list)) return undefined;
  const names = list.map((entry: unknown) => (typeof entry === "string" ? entry : typeof entry === "object" && entry !== null && "name" in entry ? String(entry.name) : ""));
  return names.every((name) => name !== "") ? names : undefined;
}

function addLabels(ctx: Context, item: Item, names: ReadonlyArray<string>): Response {
  if (!canLabel(ctx, item)) return failure(403, "Must have push access to repository");
  for (const name of names) {
    if (item.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) continue;
    const label = ctx.world.addLabel(fullName(item.repository), { name });
    item.labels.push(label);
    ctx.world.record(item, "labeled", actorOf(ctx), { label: { name: label.name, color: label.color } });
  }
  return reply(200, item.labels.map((label) => labelJson(ctx.authority, item.repository, label)));
}

function replaceLabels(ctx: Context, item: Item, list: ReadonlyArray<unknown>): Response {
  const names = labelNames(list);
  if (names === undefined) return failure(422, "Validation Failed");
  if (!canLabel(ctx, item)) return failure(403, "Must have push access to repository");
  for (const label of item.labels.filter((label) => !names.some((name) => name.toLowerCase() === label.name.toLowerCase()))) removeLabel(ctx, item, label);
  return addLabels(ctx, item, names);
}

function removeLabel(ctx: Context, item: Item, label: Label): void {
  item.labels = item.labels.filter((kept) => kept !== label);
  ctx.world.record(item, "unlabeled", actorOf(ctx), { label: { name: label.name, color: label.color } });
}

function advisoriesVisible(ctx: Context, repo: Repository): (advisory: Advisory) => boolean {
  const credential = ctx.credential;
  if (credential.kind === "installation") return () => true;
  const admin = credential.kind === "user" && permissionRank[ctx.world.permission(repo, credential.account)] >= permissionRank.maintain;
  const viewer = credential.kind === "user" ? credential.account : undefined;
  return (advisory) => admin || advisory.state === "published" || (viewer !== undefined && (advisory.author === viewer || advisory.credits.some((credit) => credit.user === viewer)));
}

function contents(ctx: Context, repo: Repository, path: string): Response {
  const ref = ctx.url.searchParams.get("ref") ?? repo.defaultBranch;
  const sha = resolveRef(repo, ref);
  const commit = sha === undefined ? undefined : repo.commits.get(sha);
  if (commit === undefined) return failure(404, `No commit found for the ref ${ref}`);
  const file = commit.files.get(path);
  const base = `${ctx.authority}/repos/${fullName(repo)}/contents`;
  if (file !== undefined) {
    if (/vnd\.github(\.v3)?\.raw/u.test(ctx.accept)) return new Response(Buffer.from(file), { headers: { "content-type": "application/vnd.github.raw; charset=utf-8" } });
    const large = file.length > 1_048_576;
    return reply(200, {
      type: "file",
      encoding: large ? "none" : "base64",
      size: file.length,
      name: path.split("/").at(-1),
      path,
      content: large ? "" : (Buffer.from(file).toString("base64").match(/.{1,60}/gu) ?? []).join("\n") + "\n",
      sha: blobSha(file),
      url: `${base}/${path}?ref=${ref}`,
      download_url: `https://raw.githubusercontent.com/${fullName(repo)}/${commit.sha}/${path}`,
    });
  }
  const prefix = path === "" ? "" : `${path}/`;
  const children = new Map<string, "file" | "dir">();
  for (const name of commit.files.keys()) {
    if (!name.startsWith(prefix)) continue;
    const [first = "", ...rest] = name.slice(prefix.length).split("/");
    children.set(first, rest.length === 0 ? "file" : "dir");
  }
  if (children.size === 0) return notFound();
  return reply(200, [...children].sort(([a], [b]) => a.localeCompare(b)).map(([name, type]) => {
    const child = `${prefix}${name}`;
    const bytes = commit.files.get(child);
    return { type, name, path: child, size: bytes?.length ?? 0, sha: type === "file" && bytes !== undefined ? blobSha(bytes) : treeOf(commit, `${child}/`), url: `${base}/${child}?ref=${ref}` };
  }));
}

function tree(ctx: Context, repo: Repository, sha: string): Response {
  const resolved = resolveRef(repo, sha);
  const commit = resolved === undefined ? [...repo.commits.values()].find((candidate) => candidate.tree === sha) : repo.commits.get(resolved);
  if (commit === undefined) return notFound();
  const recursive = ctx.url.searchParams.has("recursive");
  const entries = new Map<string, { path: string; mode: string; type: string; sha: string; size?: number }>();
  for (const [path, bytes] of commit.files) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const dir = parts.slice(0, depth).join("/");
      if (recursive || depth === 1) entries.set(dir, { path: dir, mode: "040000", type: "tree", sha: treeOf(commit, `${dir}/`) });
    }
    if (recursive || parts.length === 1) entries.set(path, { path, mode: "100644", type: "blob", sha: blobSha(bytes), size: bytes.length });
  }
  return reply(200, { sha: commit.tree, url: `${ctx.authority}/repos/${fullName(repo)}/git/trees/${commit.tree}`, tree: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)), truncated: false });
}

function compare(ctx: Context, repo: Repository, spec: string): Response {
  const [baseRef = "", headRef = ""] = spec.split("...");
  const base = resolveRef(repo, baseRef), head = resolveRef(repo, headRef);
  if (base === undefined || head === undefined) return failure(404, "Not Found");
  const fromHead = ancestors(repo, head), fromBase = ancestors(repo, base);
  const mergeBase = fromHead.find((sha) => fromBase.includes(sha));
  const ahead = fromHead.filter((sha) => !fromBase.includes(sha)), behind = fromBase.filter((sha) => !fromHead.includes(sha));
  const status = base === head ? "identical" : behind.length === 0 ? "ahead" : ahead.length === 0 ? "behind" : "diverged";
  const commitOf = (sha: string | undefined) => (sha === undefined ? undefined : repo.commits.get(sha));
  const baseCommit = commitOf(mergeBase), baseHead = commitOf(base);
  if (baseHead === undefined) return notFound();
  return reply(200, {
    status,
    ahead_by: ahead.length,
    behind_by: behind.length,
    total_commits: ahead.length,
    base_commit: commitJson(ctx.authority, ctx.world, repo, baseHead, false),
    merge_base_commit: baseCommit === undefined ? null : commitJson(ctx.authority, ctx.world, repo, baseCommit, false),
    commits: ahead.flatMap((sha) => commitOf(sha) ?? []).sort((a, b) => a.date.localeCompare(b.date)).map((commit) => commitJson(ctx.authority, ctx.world, repo, commit, false)),
    files: changes(baseCommit?.files ?? new Map(), commitOf(head)?.files ?? new Map()),
  });
}

function created(ctx: Context): string {
  return new Date(ctx.world.now()).toISOString();
}

const repoRoutes: ReadonlyArray<RepoRoute> = [
  { method: "GET", path: "", need: read("metadata"), run: (ctx, repo) => reply(200, repositoryJson(ctx.authority, repo)) },
  { method: "GET", path: "/branches", need: read("metadata"), run: (ctx, repo) => page(ctx, [...repo.branches].sort(([a], [b]) => a.localeCompare(b)), ([name, sha]) => ({ name, commit: { sha, url: `${ctx.authority}/repos/${fullName(repo)}/commits/${sha}` }, protected: false })) },
  {
    method: "GET", path: "/branches/:branch", need: read("metadata"),
    run: (ctx, repo, { branch = "" }) => {
      const sha = repo.branches.get(branch), commit = sha === undefined ? undefined : repo.commits.get(sha);
      return commit === undefined ? failure(404, "Branch not found") : reply(200, { name: branch, commit: commitJson(ctx.authority, ctx.world, repo, commit, false), protected: false });
    },
  },
  {
    method: "GET", path: "/git/ref/*ref", need: read("contents"),
    run: (ctx, repo, { ref = "" }) => {
      const sha = ref.startsWith("heads/") ? repo.branches.get(ref.slice(6)) : undefined;
      return sha === undefined ? notFound() : reply(200, { ref: `refs/${ref}`, node_id: `REF_${repo.id}_${ref}`, object: { sha, type: "commit", url: `${ctx.authority}/repos/${fullName(repo)}/git/commits/${sha}` } });
    },
  },
  {
    method: "GET", path: "/commits", need: read("contents"),
    run: (ctx, repo) => {
      const sha = resolveRef(repo, ctx.url.searchParams.get("sha") ?? repo.defaultBranch);
      if (sha === undefined) return failure(404, "Not Found");
      const path = ctx.url.searchParams.get("path"), author = ctx.url.searchParams.get("author")?.toLowerCase();
      const since = ctx.url.searchParams.get("since"), until = ctx.url.searchParams.get("until");
      const list = history(repo, sha).filter((commit) =>
        (path === null || blobOf(commit, path) !== blobOf(repo.commits.get(commit.parents[0] ?? ""), path)) &&
        (author === undefined || commit.author?.login.toLowerCase() === author) &&
        (since === null || commit.date >= since) && (until === null || commit.date <= until));
      return page(ctx, list, (commit) => commitJson(ctx.authority, ctx.world, repo, commit, false));
    },
  },
  {
    method: "GET", path: "/commits/:ref", need: read("contents"),
    run: (ctx, repo, { ref = "" }) => {
      const sha = resolveRef(repo, ref), commit = sha === undefined ? undefined : repo.commits.get(sha);
      if (commit === undefined) return failure(422, `No commit found for SHA: ${ref}`);
      if (ctx.accept.includes("vnd.github.sha")) return new Response(commit.sha, { headers: { "content-type": "application/vnd.github.sha; charset=utf-8" } });
      return reply(200, commitJson(ctx.authority, ctx.world, repo, commit, true));
    },
  },
  { method: "GET", path: "/compare/:spec", need: read("contents"), run: (ctx, repo, { spec = "" }) => compare(ctx, repo, spec) },
  { method: "GET", path: "/contents", need: read("contents"), run: (ctx, repo) => contents(ctx, repo, "") },
  { method: "GET", path: "/contents/*path", need: read("contents"), run: (ctx, repo, { path = "" }) => contents(ctx, repo, path) },
  {
    method: "GET", path: "/license", need: read("contents"),
    run: (ctx, repo) => {
      const commit = repo.commits.get(repo.branches.get(repo.defaultBranch) ?? "");
      const path = [...commit?.files.keys() ?? []].find((name) => /^(LICENSE|LICENCE|COPYING)(\.[a-z]+)?$/iu.test(name));
      const bytes = path === undefined ? undefined : commit?.files.get(path);
      if (repo.licenseSpdx === null || path === undefined || bytes === undefined) return notFound();
      const { license } = repositoryJson(ctx.authority, repo);
      return reply(200, { name: path, path, sha: blobSha(bytes), size: bytes.length, type: "file", encoding: "base64", content: Buffer.from(bytes).toString("base64"), license });
    },
  },
  { method: "GET", path: "/git/trees/:sha", need: read("contents"), run: (ctx, repo, { sha = "" }) => tree(ctx, repo, sha) },
  {
    method: "GET", path: "/git/blobs/:sha", need: read("contents"),
    run: (ctx, repo, { sha = "" }) => {
      const bytes = [...repo.commits.values()].flatMap((commit) => [...commit.files.values()]).find((candidate) => blobSha(candidate) === sha);
      if (bytes === undefined) return notFound();
      if (/vnd\.github(\.v3)?\.raw/u.test(ctx.accept)) return new Response(Buffer.from(bytes), { headers: { "content-type": "application/vnd.github.raw" } });
      return reply(200, { sha, node_id: `B_${sha.slice(0, 12)}`, size: bytes.length, url: `${ctx.authority}/repos/${fullName(repo)}/git/blobs/${sha}`, content: Buffer.from(bytes).toString("base64"), encoding: "base64" });
    },
  },
  {
    method: "GET", path: "/git/commits/:sha", need: read("contents"),
    run: (ctx, repo, { sha = "" }) => {
      const commit = repo.commits.get(sha);
      if (commit === undefined) return notFound();
      const person = { name: commit.authorName, email: commit.authorEmail, date: commit.date };
      return reply(200, { sha: commit.sha, node_id: commit.nodeId, author: person, committer: person, message: commit.message, tree: { sha: commit.tree }, parents: commit.parents.map((parent) => ({ sha: parent })) });
    },
  },
  {
    method: "GET", path: "/pulls", need: read("pull_requests"),
    run: (ctx, repo) => {
      const state = ctx.url.searchParams.get("state") ?? "open";
      const base = ctx.url.searchParams.get("base"), head = ctx.url.searchParams.get("head");
      const sort = ctx.url.searchParams.get("sort") ?? "created", direction = ctx.url.searchParams.get("direction") ?? "desc";
      const key = sort === "updated" ? "updatedAt" : "createdAt";
      const pulls = [...repo.items.values()].filter((item): item is Pull => item.kind === "pull")
        .filter((pull) => (state === "all" || pull.state === state) && (base === null || pull.baseRef === base) && (head === null || `${repo.owner.login}:${pull.headRef}` === head))
        .sort((a, b) => (direction === "asc" ? 1 : -1) * (a[key].localeCompare(b[key]) || a.number - b.number));
      return page(ctx, pulls, (pull) => pullJson(ctx.authority, ctx.world, pull));
    },
  },
  { method: "GET", path: "/pulls/:number", need: read("pull_requests"), run: (ctx, repo, params) => withPull(repo, params, (pull) => reply(200, pullJson(ctx.authority, ctx.world, pull))) },
  { method: "GET", path: "/pulls/:number/files", need: read("pull_requests"), run: (ctx, repo, params) => withPull(repo, params, (pull) => page(ctx, pull.files.slice(0, 3000), (file) => ({ sha: null, filename: file.path, status: file.status, additions: file.additions, deletions: file.deletions, changes: file.additions + file.deletions, ...(file.patch === undefined ? {} : { patch: file.patch }), ...(file.previousPath === undefined ? {} : { previous_filename: file.previousPath }) }))) },
  { method: "GET", path: "/pulls/:number/reviews", need: read("pull_requests"), run: (ctx, repo, params) => withPull(repo, params, (pull) => page(ctx, sortedByTime(pull.reviews.map((review) => ({ ...review, createdAt: review.submittedAt }))), (review) => reviewJson(ctx.authority, ctx.world, pull, review))) },
  { method: "GET", path: "/pulls/:number/comments", need: read("pull_requests"), run: (ctx, repo, params) => withPull(repo, params, (pull) => page(ctx, sortedByTime(pull.reviewComments), (comment) => commentJson(ctx.authority, ctx.world, pull, comment))) },
  { method: "GET", path: "/pulls/:number/commits", need: read(["contents", "pull_requests"]), run: (ctx, repo, params) => withPull(repo, params, (pull) => page(ctx, pull.commits.flatMap((sha) => repo.commits.get(sha) ?? []), (commit) => commitJson(ctx.authority, ctx.world, repo, commit, false), undefined, 250)) },
  { method: "GET", path: "/pulls/:number/merge", need: read("pull_requests"), run: (_ctx, repo, params) => withPull(repo, params, (pull) => (pull.mergedAt === null ? notFound() : new Response(null, { status: 204 }))) },
  { method: "PATCH", path: "/pulls/:number", need: write("pull_requests"), run: (ctx, repo, params) => withPull(repo, params, (pull) => setState(ctx, pull, fields(ctx.body)) ?? reply(200, pullJson(ctx.authority, ctx.world, pull))) },
  {
    method: "GET", path: "/issues", need: read("issues"),
    run: (ctx, repo) => {
      const state = ctx.url.searchParams.get("state") ?? "open", creator = ctx.url.searchParams.get("creator")?.toLowerCase();
      const labels = ctx.url.searchParams.get("labels")?.split(",").map((name) => name.trim().toLowerCase()).filter((name) => name !== "") ?? [];
      const since = ctx.url.searchParams.get("since"), direction = ctx.url.searchParams.get("direction") ?? "desc";
      const key = ctx.url.searchParams.get("sort") === "updated" ? "updatedAt" : "createdAt";
      const list = [...repo.items.values()]
        .filter((item) => (state === "all" || item.state === state) && (creator === undefined || item.author.login.toLowerCase() === creator) &&
          labels.every((name) => item.labels.some((label) => label.name.toLowerCase() === name)) && (since === null || item.updatedAt >= since))
        .sort((a, b) => (direction === "asc" ? 1 : -1) * (a[key].localeCompare(b[key]) || a.number - b.number));
      return page(ctx, list, (item) => issueJson(ctx.authority, ctx.world, item));
    },
  },
  { method: "GET", path: "/issues/comments/:id", need: read(items), run: (ctx, repo, { id = "" }) => withComment(repo, id, (item, comment) => reply(200, commentJson(ctx.authority, ctx.world, item, comment))) },
  {
    method: "PATCH", path: "/issues/comments/:id", need: write(items),
    run: (ctx, repo, { id = "" }) => withComment(repo, id, (item, comment) => {
      const body = fields(ctx.body).body;
      if (typeof body !== "string") return failure(422, "Validation Failed");
      if (ctx.credential.kind === "user" && ctx.credential.account !== comment.author && permissionRank[ctx.world.permission(repo, ctx.credential.account)] < permissionRank.maintain) return failure(403, "Must have admin rights to Repository.");
      if (ctx.credential.kind === "installation" && comment.author !== ctx.credential.installation.app.bot) return failure(403, "Resource not accessible by integration");
      comment.body = body;
      comment.updatedAt = created(ctx);
      return reply(200, commentJson(ctx.authority, ctx.world, item, comment));
    }),
  },
  { method: "GET", path: "/issues/:number", need: read(items), run: (ctx, repo, params) => withItem(repo, params, (item) => reply(200, issueJson(ctx.authority, ctx.world, item))) },
  { method: "PATCH", path: "/issues/:number", need: write(items), run: (ctx, repo, params) => withItem(repo, params, (item) => setState(ctx, item, fields(ctx.body)) ?? reply(200, issueJson(ctx.authority, ctx.world, item))) },
  { method: "GET", path: "/issues/:number/comments", need: read(items), run: (ctx, repo, params) => withItem(repo, params, (item) => page(ctx, sortedByTime(item.comments).filter((comment) => comment.createdAt >= (ctx.url.searchParams.get("since") ?? "")), (comment) => commentJson(ctx.authority, ctx.world, item, comment))) },
  {
    method: "POST", path: "/issues/:number/comments", need: write(items),
    run: (ctx, repo, params) => withItem(repo, params, (item) => {
      const body = fields(ctx.body).body;
      const author = actorOf(ctx);
      if (typeof body !== "string" || body === "" || author === undefined) return failure(422, "Validation Failed");
      const id = ctx.world.addComment(fullName(repo), item.number, { author: author.login, body });
      const comment = item.comments.find((candidate) => candidate.id === id);
      return comment === undefined ? notFound() : reply(201, commentJson(ctx.authority, ctx.world, item, comment));
    }),
  },
  { method: "GET", path: "/issues/:number/timeline", need: read(items), run: (ctx, repo, params) => withItem(repo, params, (item) => page(ctx, timeline(ctx.authority, ctx.world, item), (entry) => entry)) },
  { method: "GET", path: "/issues/:number/labels", need: read(items), run: (ctx, repo, params) => withItem(repo, params, (item) => page(ctx, item.labels, (label) => labelJson(ctx.authority, repo, label))) },
  {
    method: "POST", path: "/issues/:number/labels", need: write(items),
    run: (ctx, repo, params) => withItem(repo, params, (item) => {
      const names = labelNames(ctx.body);
      return names === undefined ? failure(422, "Validation Failed") : addLabels(ctx, item, names);
    }),
  },
  { method: "PUT", path: "/issues/:number/labels", need: write(items), run: (ctx, repo, params) => withItem(repo, params, (item) => replaceLabels(ctx, item, Array.isArray(ctx.body) ? ctx.body : [fields(ctx.body).labels].flat())) },
  {
    method: "DELETE", path: "/issues/:number/labels/:name", need: write(items),
    run: (ctx, repo, params) => withItem(repo, params, (item) => {
      if (!canLabel(ctx, item)) return failure(403, "Must have push access to repository");
      const label = item.labels.find((candidate) => candidate.name.toLowerCase() === (params.name ?? "").toLowerCase());
      if (label === undefined) return failure(404, "Label does not exist");
      removeLabel(ctx, item, label);
      return reply(200, item.labels.map((kept) => labelJson(ctx.authority, repo, kept)));
    }),
  },
  { method: "GET", path: "/labels", need: read("metadata"), run: (ctx, repo) => page(ctx, [...repo.labels.values()], (label) => labelJson(ctx.authority, repo, label)) },
  {
    method: "GET", path: "/labels/:name", need: read("metadata"),
    run: (ctx, repo, { name = "" }) => {
      const label = repo.labels.get(name.toLowerCase());
      return label === undefined ? notFound() : reply(200, labelJson(ctx.authority, repo, label));
    },
  },
  {
    method: "GET", path: "/collaborators/:login/permission", need: read("metadata"),
    run: (ctx, repo, { login = "" }) => {
      const account = ctx.world.findAccount(login);
      const level = account === undefined ? "none" : explicit(ctx.world, repo, account);
      if (account === undefined || level === "none") return notFound();
      const legacy = level === "maintain" ? "write" : level === "triage" ? "read" : level;
      return reply(200, { permission: legacy, role_name: level, user: { ...userJson(ctx.authority, account), permissions: { admin: level === "admin", maintain: permissionRank[level] >= permissionRank.maintain, push: permissionRank[level] >= permissionRank.write, triage: permissionRank[level] >= permissionRank.triage, pull: true } } });
    },
  },
  { method: "GET", path: "/private-vulnerability-reporting", need: read("administration"), run: (_ctx, repo) => reply(200, { enabled: repo.privateReporting }) },
  {
    method: "GET", path: "/security-advisories", need: read("repository_advisories"),
    run: (ctx, repo) => {
      const visible = advisoriesVisible(ctx, repo);
      const state = ctx.url.searchParams.get("state");
      const list = repo.advisories.filter((advisory) => visible(advisory) && (state === null || advisory.state === state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const perPage = Math.min(100, Math.max(1, Number(ctx.url.searchParams.get("per_page") ?? 30) || 30));
      const after = Math.max(0, Number(ctx.url.searchParams.get("after") ?? 0) || 0);
      const next = new URL(`${ctx.authority}${ctx.url.pathname}${ctx.url.search}`);
      next.searchParams.set("after", String(after + perPage));
      return reply(200, list.slice(after, after + perPage).map((advisory) => advisoryJson(ctx.authority, repo, advisory)), after + perPage < list.length ? { link: `<${next.href}>; rel="next"` } : {});
    },
  },
  {
    method: "GET", path: "/security-advisories/:ghsa", need: read("repository_advisories"),
    run: (ctx, repo, { ghsa = "" }) => {
      const advisory = repo.advisories.find((candidate) => candidate.ghsaId === ghsa);
      return advisory === undefined || !advisoriesVisible(ctx, repo)(advisory) ? notFound() : reply(200, advisoryJson(ctx.authority, repo, advisory));
    },
  },
  {
    method: "POST", path: "/security-advisories/reports", need: read("metadata"),
    run: (ctx, repo) => {
      if (ctx.credential.kind !== "user") return failure(403, "Resource not accessible by integration");
      if (!repo.privateReporting) return failure(403, "Private vulnerability reporting is not enabled for this repository.");
      const body = fields(ctx.body);
      if (typeof body.summary !== "string" || typeof body.description !== "string") return failure(422, "Validation Failed");
      const advisory = ctx.world.addAdvisory(fullName(repo), {
        author: ctx.credential.account.login,
        summary: body.summary,
        description: body.description,
        ...(typeof body.severity === "string" ? { severity: body.severity } : {}),
        ...(typeof body.cvss_vector_string === "string" ? { cvssVector: body.cvss_vector_string } : {}),
        ...(Array.isArray(body.cwe_ids) ? { cweIds: body.cwe_ids.map(String) } : {}),
        ...(Array.isArray(body.vulnerabilities) ? { vulnerabilities: body.vulnerabilities } : {}),
      });
      return reply(201, advisoryJson(ctx.authority, repo, advisory));
    },
  },
];

function withItem(repo: Repository, params: Params, run: (item: Item) => Answer): Answer {
  const item = itemOf(repo, params);
  return item === undefined ? notFound() : run(item);
}

function withPull(repo: Repository, params: Params, run: (pull: Pull) => Answer): Answer {
  const pull = pullOf(repo, params);
  return pull === undefined ? notFound() : run(pull);
}

function withComment(repo: Repository, id: string, run: (item: Item, comment: Comment) => Answer): Answer {
  for (const item of repo.items.values()) {
    const comment = item.comments.find((candidate) => String(candidate.id) === id);
    if (comment !== undefined) return run(item, comment);
  }
  return notFound();
}

function blobOf(commit: Commit | undefined, path: string): string | undefined {
  const bytes = commit?.files.get(path);
  return bytes === undefined ? undefined : blobSha(bytes);
}

function installationFor(ctx: Context, account: Account, repo?: Repository): Response {
  if (ctx.credential.kind !== "app") return failure(401, "A JSON web token could not be decoded");
  const found = ctx.world.installations(ctx.credential.app).find((installation) => installation.account === account && (repo === undefined || ctx.world.covers(installation, repo)));
  return found === undefined ? notFound() : reply(200, installationJson(ctx.authority, found));
}

function repoRoute(ctx: Context, repo: Repository, rest: string): Answer {
  if (rest === "/installation" && ctx.method === "GET") return installationFor(ctx, repo.owner, repo);
  if (ctx.credential.kind === "app") return failure(401, "A JSON web token could not be decoded");
  for (const route of repoRoutes) {
    if (route.method !== ctx.method) continue;
    const params = match(route.path, rest);
    if (params === undefined) continue;
    if (effective(ctx, repo) === "none") return notFound();
    const credential = ctx.credential;
    if (credential.kind === "installation") {
      const outcomes = [route.need.permission].flat().map((permission) => granted(credential, repo, ctx.world, permission, route.need.level));
      if (!outcomes.includes("granted")) return outcomes.includes("hidden") ? notFound() : failure(403, "Resource not accessible by integration");
    } else if (ctx.method !== "GET" && credential.kind === "anonymous") return failure(401, "Requires authentication");
    return route.run(ctx, repo, params);
  }
  return notFound();
}

function moved(ctx: Context, repo: Repository, rest: string): Response {
  const location = `${ctx.authority}/repositories/${repo.id}${rest}${ctx.url.search}`;
  return failure(ctx.method === "GET" ? 301 : 307, "Moved Permanently", { location });
}

const routes: ReadonlyArray<Route> = [
  {
    method: "GET", path: "/user",
    run: (ctx) => (ctx.credential.kind === "user" ? reply(200, userJson(ctx.authority, ctx.credential.account, true)) : failure(ctx.credential.kind === "anonymous" ? 401 : 403, ctx.credential.kind === "anonymous" ? "Requires authentication" : "Resource not accessible by integration")),
  },
  {
    method: "GET", path: "/user/:id",
    run: (ctx, { id = "" }) => {
      const account = ctx.world.accountById(Number(id));
      return account === undefined ? notFound() : reply(200, userJson(ctx.authority, account, true));
    },
  },
  {
    method: "GET", path: "/users/:login",
    run: (ctx, { login = "" }) => {
      const account = ctx.world.findAccount(login);
      return account === undefined ? notFound() : reply(200, userJson(ctx.authority, account, true));
    },
  },
  {
    method: "GET", path: "/users/:login/repos",
    run: (ctx, { login = "" }) => {
      const account = ctx.world.findAccount(login);
      if (account === undefined) return notFound();
      const owned = ctx.world.repositories().filter((repo) => repo.owner === account && !repo.private).sort((a, b) => a.name.localeCompare(b.name));
      return page(ctx, owned, (repo) => repositoryJson(ctx.authority, repo));
    },
  },
  { method: "GET", path: "/users/:login/installation", run: (ctx, { login = "" }) => withAccount(ctx, login, (account) => installationFor(ctx, account)) },
  { method: "GET", path: "/orgs/:org/installation", run: (ctx, { org = "" }) => withAccount(ctx, org, (account) => installationFor(ctx, account)) },
  { method: "GET", path: "/orgs/:org", run: (ctx, { org = "" }) => withAccount(ctx, org, (account) => (account.kind === "Organization" ? reply(200, userJson(ctx.authority, account, true)) : notFound())) },
  {
    method: "GET", path: "/orgs/:org/members/:login",
    run: (ctx, { org = "", login = "" }) => withAccount(ctx, org, (organization) => {
      const credential = ctx.credential;
      const insider = credential.kind === "user" ? organization.members.has(credential.account.id)
        : credential.kind === "installation" && credential.installation.account === organization && credential.permissions.members !== undefined;
      if (!insider) return new Response(null, { status: 302, headers: { location: `${ctx.authority}/orgs/${encodeURIComponent(organization.login)}/public_members/${encodeURIComponent(login)}` } });
      const member = ctx.world.findAccount(login);
      return member !== undefined && organization.members.has(member.id) ? new Response(null, { status: 204 }) : notFound();
    }),
  },
  { method: "GET", path: "/orgs/:org/public_members/:login", run: () => notFound() },
  {
    method: "GET", path: "/app",
    run: (ctx) => (ctx.credential.kind === "app" ? reply(200, appJson(ctx.authority, ctx.credential.app)) : failure(401, "A JSON web token could not be decoded")),
  },
  {
    method: "GET", path: "/app/installations",
    run: (ctx) => (ctx.credential.kind === "app" ? page(ctx, ctx.world.installations(ctx.credential.app), (installation) => installationJson(ctx.authority, installation)) : failure(401, "A JSON web token could not be decoded")),
  },
  {
    method: "GET", path: "/app/installations/:id",
    run: (ctx, { id = "" }) => {
      if (ctx.credential.kind !== "app") return failure(401, "A JSON web token could not be decoded");
      const installation = ctx.world.installation(Number(id));
      return installation === undefined || installation.app !== ctx.credential.app ? notFound() : reply(200, installationJson(ctx.authority, installation));
    },
  },
  {
    method: "POST", path: "/app/installations/:id/access_tokens",
    run: (ctx, { id = "" }) => {
      if (ctx.credential.kind !== "app") return failure(401, "A JSON web token could not be decoded");
      const installation = ctx.world.installation(Number(id));
      if (installation === undefined || installation.app !== ctx.credential.app) return notFound();
      if (installation.suspendedAt !== null) return failure(403, "This installation has been suspended");
      const body = fields(ctx.body);
      const scope = ctx.credentials.scope(installation, {
        ...(Array.isArray(body.repositories) ? { repositories: body.repositories.map(String) } : {}),
        ...(Array.isArray(body.repository_ids) ? { repositoryIds: body.repository_ids.map(Number) } : {}),
        ...(typeof body.permissions === "object" && body.permissions !== null ? { permissions: body.permissions as Readonly<Record<string, "read" | "write" | "admin">> } : {}),
      });
      if (typeof scope === "string") return failure(422, scope);
      const { token, expiresAt } = ctx.credentials.installation(installation, scope);
      const repositories = scope.repositories === "all" ? undefined : [...scope.repositories].flatMap((repoId) => ctx.world.repoById(repoId) ?? []);
      return reply(201, {
        token,
        expires_at: new Date(expiresAt).toISOString().replace(/\.\d{3}Z$/u, "Z"),
        permissions: scope.permissions,
        repository_selection: repositories === undefined ? "all" : "selected",
        ...(repositories === undefined ? {} : { repositories: repositories.map((repo) => repositoryJson(ctx.authority, repo)) }),
      });
    },
  },
  {
    method: "GET", path: "/installation/repositories",
    run: (ctx) => {
      const credential = ctx.credential;
      if (credential.kind !== "installation") return failure(403, "You must authenticate with an installation access token in order to list repositories for an installation.");
      const list = ctx.world.repositories().filter((repo) => granted(credential, repo, ctx.world, "metadata", "read") === "granted" && (credential.repositories === "all" ? ctx.world.covers(credential.installation, repo) : credential.repositories.has(repo.id)));
      return page(ctx, list, (repo) => repositoryJson(ctx.authority, repo), (rendered) => ({ total_count: list.length, repository_selection: credential.installation.repositories === "all" ? "all" : "selected", repositories: rendered }));
    },
  },
  {
    method: "GET", path: "/search/issues",
    run: (ctx) => {
      const sort = ctx.url.searchParams.get("sort"), order = ctx.url.searchParams.get("order") ?? "desc";
      const query = `${ctx.url.searchParams.get("q") ?? ""}${sort === null ? "" : ` sort:${sort}-${order}`}`;
      let found: Item[];
      try {
        found = ctx.world.search(query, (repo) => effective(ctx, repo) !== "none");
      } catch (error) {
        return failure(422, error instanceof Error ? error.message : "Validation Failed");
      }
      return page(ctx, found.slice(0, 1000), (item) => issueJson(ctx.authority, ctx.world, item), (rendered) => ({ total_count: found.length, incomplete_results: false, items: rendered }));
    },
  },
];

function withAccount(ctx: Context, login: string, run: (account: Account) => Answer): Answer {
  const account = ctx.world.findAccount(login);
  return account === undefined ? notFound() : run(account);
}

/** @throws {never} */
export function rest(ctx: Context): Answer {
  const path = ctx.url.pathname.replace(/\/+$/u, "") || "/";
  const byName = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/u.exec(path);
  const byId = /^\/repositories\/(\d+)(\/.*)?$/u.exec(path);
  if (byName !== null) {
    const name = `${decodeURIComponent(byName[1] ?? "")}/${decodeURIComponent(byName[2] ?? "")}`;
    const rest = byName[3] ?? "";
    const repo = ctx.world.findRepo(name);
    if (repo !== undefined) return repoRoute(ctx, repo, rest);
    const renamed = ctx.world.movedRepo(name);
    return renamed === undefined ? notFound() : moved(ctx, renamed, rest);
  }
  if (byId !== null) {
    const repo = ctx.world.repoById(Number(byId[1]));
    return repo === undefined ? notFound() : repoRoute(ctx, repo, byId[2] ?? "");
  }
  for (const route of routes) {
    if (route.method !== ctx.method) continue;
    const params = match(route.path, path);
    if (params !== undefined) return route.run(ctx, params);
  }
  return notFound();
}

/** @throws {never} */
export function raw(world: GitHubWorld, url: URL): Response {
  const [, owner = "", name = "", ref = "", ...rest] = url.pathname.split("/").map(decodeURIComponent);
  const repo = world.findRepo(`${owner}/${name}`);
  const sha = repo === undefined || repo.private ? undefined : resolveRef(repo, ref);
  const bytes = sha === undefined ? undefined : repo?.commits.get(sha)?.files.get(rest.join("/"));
  return bytes === undefined
    ? new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
    : new Response(Buffer.from(bytes), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
