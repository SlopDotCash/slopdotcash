// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
import { type KeyObject, createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

export type Permission = "admin" | "maintain" | "write" | "triage" | "read";
export type Access = "read" | "write" | "admin";
export type Permissions = Readonly<Record<string, Access>>;
export type AccountKind = "User" | "Organization" | "Bot";
export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
export type FileStatus = "added" | "modified" | "removed" | "renamed";
export type StateReason = "completed" | "not_planned" | "reopened";

export interface Account {
  readonly kind: AccountKind;
  readonly id: number;
  readonly nodeId: string;
  login: string;
  readonly name: string | null;
  readonly createdAt: string;
  readonly members: Map<number, "admin" | "member">;
}

export interface Commit {
  readonly sha: string;
  readonly nodeId: string;
  readonly tree: string;
  readonly message: string;
  readonly author: Account | undefined;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly date: string;
  readonly parents: ReadonlyArray<string>;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export interface Label { readonly id: number; readonly nodeId: string; readonly name: string; readonly color: string; readonly description: string | null }

export interface Comment {
  readonly id: number;
  readonly nodeId: string;
  readonly author: Account;
  body: string;
  readonly createdAt: string;
  updatedAt: string;
  readonly path?: string;
  readonly line?: number;
  readonly reviewId?: number;
}

export interface Review {
  readonly id: number;
  readonly nodeId: string;
  readonly author: Account;
  readonly state: ReviewState;
  readonly body: string;
  readonly submittedAt: string;
  readonly commitId: string;
}

export interface TimelineEvent {
  readonly id: number;
  readonly nodeId: string;
  readonly event: string;
  readonly actor: Account | undefined;
  readonly createdAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: FileStatus;
  readonly previousPath?: string;
  readonly patch?: string;
}

interface ItemFields {
  readonly id: number;
  readonly nodeId: string;
  readonly number: number;
  readonly repository: Repository;
  title: string;
  body: string;
  readonly author: Account;
  state: "open" | "closed";
  stateReason: StateReason | null;
  readonly createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  labels: Label[];
  readonly assignees: Account[];
  readonly comments: Comment[];
  readonly timeline: TimelineEvent[];
}

export interface Issue extends ItemFields { readonly kind: "issue" }

export interface Pull extends ItemFields {
  readonly kind: "pull";
  readonly draft: boolean;
  mergedAt: string | null;
  mergeCommit: string | null;
  mergedBy: Account | null;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly files: ReadonlyArray<ChangedFile>;
  readonly additions: number;
  readonly deletions: number;
  readonly commits: ReadonlyArray<string>;
  readonly reviews: Review[];
  readonly reviewComments: Comment[];
  readonly requestedReviewers: ReadonlyArray<Account>;
}

export type Item = Issue | Pull;

export interface Advisory {
  readonly ghsaId: string;
  readonly author: Account;
  readonly summary: string;
  readonly description: string;
  readonly severity: string | null;
  readonly cvssVector: string | null;
  readonly cweIds: ReadonlyArray<string>;
  readonly vulnerabilities: ReadonlyArray<unknown> | null;
  readonly credits: ReadonlyArray<{ readonly user: Account; readonly type: string }>;
  readonly submission: { readonly accepted: boolean } | null;
  readonly state: string;
  readonly createdAt: string;
}

export interface DeploymentStatus {
  readonly id: number;
  readonly state: string;
  readonly logUrl: string | null;
  readonly createdAt: string;
}

export interface Deployment {
  readonly id: number;
  readonly nodeId: string;
  readonly sha: string;
  readonly ref: string;
  readonly environment: string;
  readonly productionEnvironment: boolean;
  readonly createdAt: string;
  readonly statuses: DeploymentStatus[];
}

export interface WorkflowRun {
  readonly id: number;
  readonly nodeId: string;
  readonly headSha: string;
  readonly headBranch: string | null;
  readonly path: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly createdAt: string;
}

export interface Repository {
  readonly id: number;
  readonly nodeId: string;
  owner: Account;
  name: string;
  readonly private: boolean;
  readonly fork: boolean;
  readonly archived: boolean;
  readonly description: string | null;
  readonly defaultBranch: string;
  readonly createdAt: string;
  updatedAt: string;
  readonly licenseSpdx: string | null;
  readonly branches: Map<string, string>;
  readonly commits: Map<string, Commit>;
  readonly permissions: Map<number, Permission>;
  readonly labels: Map<string, Label>;
  readonly items: Map<number, Item>;
  privateReporting: boolean;
  readonly advisories: Advisory[];
  readonly deployments: Deployment[];
  readonly runs: Map<number, WorkflowRun>;
}

export interface App {
  readonly id: string;
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly privateKeyPem: string;
  readonly publicKey: KeyObject;
  readonly bot: Account;
}

export interface Installation {
  readonly id: number;
  readonly app: App;
  readonly account: Account;
  readonly repositories: "all" | ReadonlySet<number>;
  readonly permissions: Permissions;
  suspendedAt: string | null;
  readonly createdAt: string;
}

export const permissionRank: Readonly<Record<Permission | "none", number>> = { none: 0, read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };
export const accessRank: Readonly<Record<Access | "none", number>> = { none: 0, read: 1, write: 2, admin: 3 };

const ghsaAlphabet = "23456789cfghjmpqrvwx";
const encoder = new TextEncoder();

/** @throws {never} */
export function bytesOf(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

/** @throws {never} */
export function blobSha(content: Uint8Array): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

function treeSha(files: ReadonlyMap<string, Uint8Array>, prefix = ""): string {
  const entries = new Map<string, { mode: string; sha: string }>();
  for (const path of files.keys()) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (entries.has(name)) continue;
    entries.set(name, slash === -1
      ? { mode: "100644", sha: blobSha(files.get(path) ?? new Uint8Array()) }
      : { mode: "40000", sha: treeSha(files, `${prefix}${name}/`) });
  }
  const sorted = [...entries].sort(([a, x], [b, y]) => {
    const left = x.mode === "40000" ? `${a}/` : a, right = y.mode === "40000" ? `${b}/` : b;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const body = Buffer.concat(sorted.map(([name, entry]) => Buffer.concat([Buffer.from(`${entry.mode} ${name}\0`), Buffer.from(entry.sha, "hex")])));
  return createHash("sha1").update(`tree ${body.length}\0`).update(body).digest("hex");
}

/** @throws {never} */
export function treeOf(commit: Commit, prefix = ""): string {
  return treeSha(commit.files, prefix);
}

/** @throws {never} */
export function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** @throws {never} */
export function sortedByTime<T extends { readonly createdAt: string; readonly id: number }>(values: ReadonlyArray<T>): T[] {
  return [...values].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

export interface UserInput { readonly id: number; readonly login: string; readonly nodeId?: string; readonly createdAt?: string; readonly type?: "User" | "Bot"; readonly name?: string }
export interface OrgInput { readonly id: number; readonly login: string; readonly nodeId?: string; readonly createdAt?: string; readonly name?: string }
export interface RepoInput {
  readonly id: number;
  readonly nodeId?: string;
  readonly owner: string;
  readonly name: string;
  readonly private?: boolean;
  readonly fork?: boolean;
  readonly archived?: boolean;
  readonly description?: string;
  readonly defaultBranch?: string;
  readonly createdAt?: string;
  readonly license?: { readonly spdx: string; readonly path?: string; readonly text?: string };
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
}
export interface CommitInput {
  readonly branch?: string;
  readonly parents?: ReadonlyArray<string>;
  readonly message?: string;
  readonly author?: string;
  readonly date?: string;
  readonly files?: Readonly<Record<string, string | Uint8Array | null>>;
}
export interface PullInput {
  readonly repo: string;
  readonly number?: number;
  readonly author: string;
  readonly title?: string;
  readonly body?: string;
  readonly state?: "open" | "closed";
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly closedAt?: string;
  readonly mergedAt?: string;
  readonly mergeCommit?: string;
  readonly mergedBy?: string;
  readonly files?: ReadonlyArray<ChangedFile>;
  readonly additions?: number;
  readonly deletions?: number;
  readonly labels?: ReadonlyArray<string>;
  readonly draft?: boolean;
  readonly requestedReviewers?: ReadonlyArray<string>;
  readonly headRef?: string;
  readonly headSha?: string;
  readonly baseRef?: string;
  readonly commits?: ReadonlyArray<string>;
}
export interface IssueInput {
  readonly repo: string;
  readonly number?: number;
  readonly author: string;
  readonly title?: string;
  readonly body?: string;
  readonly state?: "open" | "closed";
  readonly stateReason?: StateReason;
  readonly createdAt?: string;
  readonly closedAt?: string;
  readonly labels?: ReadonlyArray<string>;
  readonly assignees?: ReadonlyArray<string>;
}
export interface ReviewInput { readonly author: string; readonly state: ReviewState; readonly body?: string; readonly submittedAt?: string; readonly commitId?: string }
export interface CommentInput { readonly author: string; readonly body: string; readonly createdAt?: string; readonly path?: string; readonly line?: number; readonly reviewId?: number }
export interface EventInput { readonly event: string; readonly actor?: string; readonly createdAt?: string; readonly [detail: string]: unknown }
export interface InstallationInput {
  readonly id: number;
  readonly account: string;
  readonly repositories: "all" | ReadonlyArray<string>;
  readonly permissions: Permissions;
  readonly app?: string;
  readonly suspendedAt?: string;
}
export interface AppInput {
  readonly id: string;
  readonly slug: string;
  readonly botId: number;
  readonly privateKeyPem?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly webhookSecret?: string;
}
export interface DeploymentInput {
  readonly sha: string;
  readonly ref: string;
  readonly environment: string;
  readonly productionEnvironment?: boolean;
  readonly createdAt?: string;
}

export interface DeploymentStatusInput {
  readonly state: string;
  readonly logUrl?: string;
  readonly createdAt?: string;
}

export interface WorkflowRunInput {
  readonly headSha: string;
  readonly path: string;
  readonly headBranch?: string;
  readonly status?: string;
  readonly conclusion?: string;
  readonly createdAt?: string;
}

export interface AdvisoryInput {
  readonly author: string;
  readonly summary: string;
  readonly description?: string;
  readonly severity?: string;
  readonly cvssVector?: string;
  readonly cweIds?: ReadonlyArray<string>;
  readonly vulnerabilities?: ReadonlyArray<unknown>;
  readonly createdAt?: string;
  readonly state?: string;
  readonly submission?: { readonly accepted: boolean } | null;
  readonly credits?: ReadonlyArray<{ readonly login: string; readonly type: string }>;
}

export class GitHubWorld {
  readonly #accounts = new Map<number, Account>();
  readonly #logins = new Map<string, Account>();
  readonly #repos = new Map<number, Repository>();
  readonly #moved = new Map<string, number>();
  readonly #nodes = new Map<string, { readonly type: string; readonly value: unknown }>();
  readonly #installations = new Map<number, Installation>();
  readonly #apps = new Map<string, App>();
  #serial = 1_000_000;
  #advisories = 0;

  constructor(readonly now: () => number) {}

  #at(iso: string | undefined): string {
    return iso ?? new Date(this.now()).toISOString();
  }

  #next(): number {
    this.#serial += 1;
    return this.#serial;
  }

  #node<T>(type: string, nodeId: string, value: T): T {
    this.#nodes.set(nodeId, { type, value });
    return value;
  }

  /** @throws {Error} */
  account(login: string): Account {
    const found = this.findAccount(login);
    if (found === undefined) throw new Error(`no GitHub account ${login}`);
    return found;
  }

  /** @throws {never} */
  findAccount(login: string): Account | undefined {
    return this.#logins.get(login.toLowerCase());
  }

  /** @throws {never} */
  accountById(id: number): Account | undefined {
    return this.#accounts.get(id);
  }

  /** @throws {Error} */
  repo(fullName: string): Repository {
    const found = this.findRepo(fullName);
    if (found === undefined) throw new Error(`no GitHub repository ${fullName}`);
    return found;
  }

  /** @throws {never} */
  findRepo(fullName: string): Repository | undefined {
    const key = fullName.toLowerCase();
    return [...this.#repos.values()].find((repo) => `${repo.owner.login}/${repo.name}`.toLowerCase() === key);
  }

  /** @throws {never} */
  movedRepo(fullName: string): Repository | undefined {
    const id = this.#moved.get(fullName.toLowerCase());
    return id === undefined ? undefined : this.#repos.get(id);
  }

  /** @throws {never} */
  repoById(id: number): Repository | undefined {
    return this.#repos.get(id);
  }

  /** @throws {never} */
  repositories(): ReadonlyArray<Repository> {
    return [...this.#repos.values()];
  }

  /** @throws {never} */
  node(nodeId: string): { readonly type: string; readonly value: unknown } | undefined {
    return this.#nodes.get(nodeId);
  }

  /** @throws {never} */
  installation(id: number): Installation | undefined {
    return this.#installations.get(id);
  }

  /** @throws {never} */
  installations(app: App): ReadonlyArray<Installation> {
    return [...this.#installations.values()].filter((installation) => installation.app === app);
  }

  /** @throws {never} */
  app(idOrClient: string): App | undefined {
    return this.#apps.get(idOrClient) ?? [...this.#apps.values()].find((app) => app.clientId === idOrClient);
  }

  /** @throws {Error} */
  item(fullName: string, number: number): Item {
    const found = this.repo(fullName).items.get(number);
    if (found === undefined) throw new Error(`no issue or pull request ${fullName}#${number}`);
    return found;
  }

  /** @throws {Error} */
  pull(fullName: string, number: number): Pull {
    const found = this.item(fullName, number);
    if (found.kind !== "pull") throw new Error(`${fullName}#${number} is an issue`);
    return found;
  }

  /** @throws {Error} */
  addUser(input: UserInput): Account {
    return this.#addAccount(input.type ?? "User", input);
  }

  /** @throws {Error} */
  addOrg(input: OrgInput): Account {
    return this.#addAccount("Organization", input);
  }

  #addAccount(kind: AccountKind, input: UserInput | OrgInput): Account {
    if (this.#accounts.has(input.id)) throw new Error(`GitHub account id ${input.id} already exists`);
    if (this.findAccount(input.login) !== undefined) throw new Error(`GitHub login ${input.login} already exists`);
    const prefix = kind === "Organization" ? "O" : kind === "Bot" ? "BOT" : "U";
    const account: Account = {
      kind,
      id: input.id,
      nodeId: input.nodeId ?? `${prefix}_kgDO${input.id.toString(36)}`,
      login: input.login,
      name: input.name ?? null,
      createdAt: this.#at(input.createdAt),
      members: new Map(),
    };
    this.#accounts.set(account.id, account);
    this.#logins.set(account.login.toLowerCase(), account);
    return this.#node(kind, account.nodeId, account);
  }

  /** @throws {Error} */
  renameUser(login: string, to: string): Account {
    const account = this.account(login);
    if (this.findAccount(to) !== undefined) throw new Error(`GitHub login ${to} already exists`);
    for (const repo of this.#repos.values()) if (repo.owner === account) this.#moved.set(`${account.login}/${repo.name}`.toLowerCase(), repo.id);
    this.#logins.delete(account.login.toLowerCase());
    account.login = to;
    this.#logins.set(to.toLowerCase(), account);
    return account;
  }

  /** @throws {Error} */
  addMember(org: string, login: string, role: "admin" | "member" = "member"): void {
    const organization = this.account(org);
    if (organization.kind !== "Organization") throw new Error(`${org} is not an organization`);
    organization.members.set(this.account(login).id, role);
  }

  /** @throws {Error} */
  removeMember(org: string, login: string): void {
    this.account(org).members.delete(this.account(login).id);
  }

  /** @throws {Error} */
  addRepo(input: RepoInput): Repository {
    if (this.#repos.has(input.id)) throw new Error(`GitHub repository id ${input.id} already exists`);
    const owner = this.account(input.owner);
    if (this.findRepo(`${owner.login}/${input.name}`) !== undefined) throw new Error(`GitHub repository ${input.owner}/${input.name} already exists`);
    const createdAt = this.#at(input.createdAt);
    const repo: Repository = {
      id: input.id,
      nodeId: input.nodeId ?? `R_kgDO${input.id.toString(36)}`,
      owner,
      name: input.name,
      private: input.private ?? false,
      fork: input.fork ?? false,
      archived: input.archived ?? false,
      description: input.description ?? null,
      defaultBranch: input.defaultBranch ?? "main",
      createdAt,
      updatedAt: createdAt,
      licenseSpdx: input.license?.spdx ?? null,
      branches: new Map(),
      commits: new Map(),
      permissions: new Map(),
      labels: new Map(),
      items: new Map(),
      privateReporting: true,
      advisories: [],
      deployments: [],
      runs: new Map(),
    };
    if (owner.kind !== "Organization") repo.permissions.set(owner.id, "admin");
    this.#repos.set(repo.id, repo);
    this.#node("Repository", repo.nodeId, repo);
    const files: Record<string, string | Uint8Array> = { ...input.files ?? { "README.md": `# ${input.name}\n` } };
    if (input.license !== undefined) files[input.license.path ?? "LICENSE"] = input.license.text ?? `${input.license.spdx} license\n`;
    this.addCommit(`${owner.login}/${repo.name}`, { message: "Initial commit", author: owner.kind === "Organization" ? undefined : owner.login, date: createdAt, files, parents: [] });
    return repo;
  }

  /** @throws {Error} */
  renameRepo(fullName: string, to: string): Repository {
    const repo = this.repo(fullName);
    const [ownerLogin = "", name = ""] = to.split("/");
    const owner = this.account(ownerLogin);
    const taken = this.findRepo(to);
    if (taken !== undefined && taken !== repo) throw new Error(`GitHub repository ${to} already exists`);
    this.#moved.set(`${repo.owner.login}/${repo.name}`.toLowerCase(), repo.id);
    this.#moved.delete(to.toLowerCase());
    repo.owner = owner;
    repo.name = name;
    return repo;
  }

  /** @throws {Error} */
  setPermission(fullName: string, login: string, permission: Permission | "none"): void {
    const repo = this.repo(fullName), account = this.account(login);
    if (permission === "none") repo.permissions.delete(account.id);
    else repo.permissions.set(account.id, permission);
  }

  /** @throws {Error} */
  permission(repo: Repository, account: Account): Permission | "none" {
    const direct = repo.permissions.get(account.id);
    const org = repo.owner.kind === "Organization" ? repo.owner.members.get(account.id) : undefined;
    const levels: Array<Permission | "none"> = [direct ?? "none", org === "admin" ? "admin" : "none", repo.private ? "none" : "read"];
    return levels.reduce((best, level) => (permissionRank[level] > permissionRank[best] ? level : best), "none");
  }

  /** @throws {Error} */
  addCommit(fullName: string, input: CommitInput = {}): string {
    const repo = this.repo(fullName);
    const branch = input.branch ?? repo.defaultBranch;
    const head = repo.branches.get(branch);
    const parents = input.parents ?? (head === undefined ? [] : [head]);
    for (const parent of parents) if (!repo.commits.has(parent)) throw new Error(`no commit ${parent} in ${fullName}`);
    const files = new Map(parents[0] === undefined ? [] : repo.commits.get(parents[0])?.files ?? []);
    for (const [path, content] of Object.entries(input.files ?? {})) {
      if (content === null) files.delete(path);
      else files.set(path, bytesOf(content));
    }
    const author = input.author === undefined ? undefined : this.account(input.author);
    const date = this.#at(input.date);
    const message = input.message ?? `Commit ${this.#next()}`;
    const authorName = author?.login ?? "GitHub";
    const authorEmail = author === undefined ? "noreply@github.com" : `${author.id}+${author.login}@users.noreply.github.com`;
    const tree = treeSha(files);
    const stamp = `${authorName} <${authorEmail}> ${epochSeconds(date)} +0000`;
    const text = [`tree ${tree}`, ...parents.map((parent) => `parent ${parent}`), `author ${stamp}`, `committer ${stamp}`, "", message].join("\n");
    const sha = createHash("sha1").update(`commit ${Buffer.byteLength(text)}\0${text}`).digest("hex");
    const commit: Commit = { sha, nodeId: `C_kwDO${sha.slice(0, 16)}`, tree, message, author, authorName, authorEmail, date, parents, files };
    repo.commits.set(sha, this.#node("Commit", commit.nodeId, commit));
    repo.branches.set(branch, sha);
    repo.updatedAt = date;
    return sha;
  }

  /** @throws {Error} */
  setBranch(fullName: string, branch: string, sha: string): void {
    const repo = this.repo(fullName);
    if (!repo.commits.has(sha)) throw new Error(`no commit ${sha} in ${fullName}`);
    repo.branches.set(branch, sha);
  }

  /** @throws {Error} */
  addLabel(fullName: string, input: { readonly name: string; readonly color?: string; readonly description?: string }): Label {
    const repo = this.repo(fullName);
    const found = repo.labels.get(input.name.toLowerCase());
    if (found !== undefined) return found;
    const id = this.#next();
    const label: Label = { id, nodeId: `LA_kwDO${id.toString(36)}`, name: input.name, color: input.color ?? "ededed", description: input.description ?? null };
    repo.labels.set(input.name.toLowerCase(), this.#node("Label", label.nodeId, label));
    return label;
  }

  #number(repo: Repository, requested: number | undefined): number {
    const number = requested ?? Math.max(0, ...repo.items.keys()) + 1;
    if (repo.items.has(number)) throw new Error(`${repo.owner.login}/${repo.name}#${number} already exists`);
    return number;
  }

  #fields(repo: Repository, input: IssueInput | PullInput, prefix: string) {
    const id = this.#next();
    const createdAt = this.#at(input.createdAt);
    const number = this.#number(repo, input.number);
    return {
      id,
      nodeId: `${prefix}_kwDO${id.toString(36)}`,
      number,
      repository: repo,
      title: input.title ?? `${prefix === "PR" ? "Pull request" : "Issue"} ${number}`,
      body: input.body ?? "",
      author: this.account(input.author),
      state: input.state ?? "open",
      createdAt,
      updatedAt: createdAt,
      closedAt: input.closedAt ?? null,
      labels: (input.labels ?? []).map((name) => this.addLabel(`${repo.owner.login}/${repo.name}`, { name })),
      comments: [],
      timeline: [],
    } as const;
  }

  /** @throws {Error} */
  addIssue(input: IssueInput): number {
    const repo = this.repo(input.repo);
    const fields = this.#fields(repo, input, "I");
    const issue: Issue = {
      kind: "issue",
      ...fields,
      labels: [...fields.labels],
      comments: [],
      timeline: [],
      assignees: (input.assignees ?? []).map((login) => this.account(login)),
      stateReason: input.stateReason ?? (input.state === "closed" ? "completed" : null),
      closedAt: input.closedAt ?? (input.state === "closed" ? fields.createdAt : null),
    };
    repo.items.set(issue.number, this.#node("Issue", issue.nodeId, issue));
    return issue.number;
  }

  /** @throws {Error} */
  addPull(input: PullInput): number {
    const repo = this.repo(input.repo);
    const fields = this.#fields(repo, input, "PR");
    const merged = input.mergedAt !== undefined;
    const files = input.files ?? [];
    const baseRef = input.baseRef ?? repo.defaultBranch;
    const baseSha = repo.branches.get(baseRef) ?? "";
    const headSha = input.headSha ?? createHash("sha1").update(`${repo.id}#${fields.number}:head`).digest("hex");
    const pull: Pull = {
      kind: "pull",
      ...fields,
      labels: [...fields.labels],
      comments: [],
      timeline: [],
      assignees: [],
      state: merged ? "closed" : fields.state,
      stateReason: null,
      closedAt: input.closedAt ?? input.mergedAt ?? (fields.state === "closed" ? fields.createdAt : null),
      updatedAt: input.updatedAt ?? input.mergedAt ?? input.closedAt ?? fields.createdAt,
      draft: input.draft ?? false,
      mergedAt: input.mergedAt ?? null,
      mergeCommit: input.mergeCommit ?? null,
      mergedBy: merged ? this.account(input.mergedBy ?? repo.owner.login) : null,
      headRef: input.headRef ?? `${fields.author.login}-patch-${fields.number}`,
      headSha,
      baseRef,
      baseSha,
      files,
      additions: input.additions ?? files.reduce((sum, file) => sum + file.additions, 0),
      deletions: input.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0),
      commits: input.commits ?? [headSha],
      reviews: [],
      reviewComments: [],
      requestedReviewers: (input.requestedReviewers ?? []).map((login) => this.account(login)),
    };
    repo.items.set(pull.number, this.#node("PullRequest", pull.nodeId, pull));
    return pull.number;
  }

  /** @throws {Error} */
  addReview(fullName: string, number: number, input: ReviewInput): number {
    const pull = this.pull(fullName, number);
    const id = this.#next();
    const review: Review = {
      id,
      nodeId: `PRR_kwDO${id.toString(36)}`,
      author: this.account(input.author),
      state: input.state,
      body: input.body ?? "",
      submittedAt: this.#at(input.submittedAt),
      commitId: input.commitId ?? pull.headSha,
    };
    pull.reviews.push(this.#node("PullRequestReview", review.nodeId, review));
    return id;
  }

  /** @throws {Error} */
  addComment(fullName: string, number: number, input: CommentInput): number {
    const item = this.item(fullName, number);
    const id = this.#next();
    const createdAt = this.#at(input.createdAt);
    const inline = input.path !== undefined;
    const comment: Comment = {
      id,
      nodeId: `${inline ? "PRRC" : "IC"}_kwDO${id.toString(36)}`,
      author: this.account(input.author),
      body: input.body,
      createdAt,
      updatedAt: createdAt,
      ...(inline ? { path: input.path, line: input.line ?? 1, ...(input.reviewId === undefined ? {} : { reviewId: input.reviewId }) } : {}),
    };
    if (inline) {
      if (item.kind !== "pull") throw new Error(`${fullName}#${number} is an issue and has no review comments`);
      item.reviewComments.push(this.#node("PullRequestReviewComment", comment.nodeId, comment));
    } else item.comments.push(this.#node("IssueComment", comment.nodeId, comment));
    item.updatedAt = createdAt;
    return id;
  }

  /** @throws {Error} */
  addTimelineEvent(fullName: string, number: number, input: EventInput): number {
    const item = this.item(fullName, number);
    const { event, actor, createdAt, ...details } = input;
    const id = this.#next();
    const entry: TimelineEvent = { id, nodeId: `E_kwDO${id.toString(36)}`, event, actor: actor === undefined ? undefined : this.account(actor), createdAt: this.#at(createdAt), details };
    item.timeline.push(this.#node("TimelineEvent", entry.nodeId, entry));
    return id;
  }

  /** @throws {Error} */
  addApp(input: AppInput): App {
    if (this.#apps.has(input.id)) throw new Error(`GitHub App ${input.id} already exists`);
    const privateKeyPem = input.privateKeyPem ?? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const app: App = {
      id: input.id,
      slug: input.slug,
      clientId: input.clientId ?? `Iv1.${input.slug}`,
      clientSecret: input.clientSecret ?? `${input.slug}-client-secret`,
      webhookSecret: input.webhookSecret ?? `${input.slug}-webhook-secret`,
      privateKeyPem,
      publicKey: createPublicKey(createPrivateKey(privateKeyPem)),
      bot: this.addUser({ id: input.botId, login: `${input.slug}[bot]`, type: "Bot" }),
    };
    this.#apps.set(app.id, app);
    return app;
  }

  /** @throws {Error} */
  addInstallation(input: InstallationInput): Installation {
    const app = input.app === undefined ? [...this.#apps.values()][0] : [...this.#apps.values()].find((candidate) => candidate.slug === input.app || candidate.id === input.app);
    if (app === undefined) throw new Error(`no GitHub App ${input.app ?? "(default)"}`);
    const account = this.account(input.account);
    const repositories = input.repositories === "all" ? "all" as const : new Set(input.repositories.map((name) => this.repo(name.includes("/") ? name : `${account.login}/${name}`).id));
    const installation: Installation = { id: input.id, app, account, repositories, permissions: { metadata: "read", ...input.permissions }, suspendedAt: input.suspendedAt ?? null, createdAt: this.#at(undefined) };
    this.#installations.set(installation.id, installation);
    return installation;
  }

  /** @throws {Error} */
  suspendInstallation(id: number, suspended: boolean): void {
    const installation = this.#installations.get(id);
    if (installation === undefined) throw new Error(`no installation ${id}`);
    installation.suspendedAt = suspended ? this.#at(undefined) : null;
  }

  /** @throws {never} */
  removeInstallation(id: number): void {
    this.#installations.delete(id);
  }

  /** @throws {never} */
  covers(installation: Installation, repo: Repository): boolean {
    return installation.account === repo.owner && (installation.repositories === "all" || installation.repositories.has(repo.id));
  }

  /** @throws {Error} */
  setPrivateReporting(fullName: string, enabled: boolean): void {
    this.repo(fullName).privateReporting = enabled;
  }

  #ghsa(): string {
    this.#advisories += 1;
    let n = this.#advisories * 7919 + 101;
    const part = () => {
      let out = "";
      for (let i = 0; i < 4; i += 1) {
        out += ghsaAlphabet[n % ghsaAlphabet.length];
        n = Math.floor(n / ghsaAlphabet.length) + 3;
      }
      return out;
    };
    return `GHSA-${part()}-${part()}-${part()}`;
  }

  /** @throws {Error} */
  addDeployment(fullName: string, input: DeploymentInput): Deployment {
    const repo = this.repo(fullName);
    const id = this.#next();
    const deployment: Deployment = {
      id,
      nodeId: `DE_kwDO${id.toString(36)}`,
      sha: input.sha,
      ref: input.ref,
      environment: input.environment,
      productionEnvironment: input.productionEnvironment ?? false,
      createdAt: this.#at(input.createdAt),
      statuses: [],
    };
    repo.deployments.push(deployment);
    return deployment;
  }

  /** @throws {Error} */
  addDeploymentStatus(fullName: string, deploymentId: number, input: DeploymentStatusInput): DeploymentStatus {
    const deployment = this.repo(fullName).deployments.find((candidate) => candidate.id === deploymentId);
    if (deployment === undefined) throw new Error(`no deployment ${deploymentId} in ${fullName}`);
    const status: DeploymentStatus = { id: this.#next(), state: input.state, logUrl: input.logUrl ?? null, createdAt: this.#at(input.createdAt) };
    deployment.statuses.push(status);
    return status;
  }

  /** @throws {Error} */
  addWorkflowRun(fullName: string, input: WorkflowRunInput): WorkflowRun {
    const repo = this.repo(fullName);
    const id = this.#next();
    const run: WorkflowRun = {
      id,
      nodeId: `WFR_kwDO${id.toString(36)}`,
      headSha: input.headSha,
      headBranch: input.headBranch ?? null,
      path: input.path,
      status: input.status ?? "completed",
      conclusion: input.conclusion ?? "success",
      createdAt: this.#at(input.createdAt),
    };
    repo.runs.set(id, run);
    return run;
  }

  /** @throws {Error} */
  addAdvisory(fullName: string, input: AdvisoryInput): Advisory {
    const repo = this.repo(fullName);
    const author = this.account(input.author);
    const advisory: Advisory = {
      ghsaId: this.#ghsa(),
      author,
      summary: input.summary,
      description: input.description ?? "",
      severity: input.severity ?? null,
      cvssVector: input.cvssVector ?? null,
      cweIds: input.cweIds ?? [],
      vulnerabilities: input.vulnerabilities ?? null,
      credits: input.credits === undefined ? [{ user: author, type: "reporter" }] : input.credits.map((credit) => ({ user: this.account(credit.login), type: credit.type })),
      submission: input.submission === undefined ? { accepted: false } : input.submission,
      state: input.state ?? "triage",
      createdAt: this.#at(input.createdAt),
    };
    repo.advisories.push(advisory);
    return advisory;
  }

  /** @throws {never} */
  touch(item: Item, at: string): void {
    item.updatedAt = at;
    item.repository.updatedAt = at;
  }

  /** @throws {never} */
  record(item: Item, event: string, actor: Account | undefined, details: Readonly<Record<string, unknown>> = {}): void {
    const id = this.#next();
    const createdAt = new Date(this.now()).toISOString();
    item.timeline.push(this.#node("TimelineEvent", `E_kwDO${id.toString(36)}`, { id, nodeId: `E_kwDO${id.toString(36)}`, event, actor, createdAt, details }));
    this.touch(item, createdAt);
  }

  /** @throws {never} */
  serial(): number {
    return this.#next();
  }

  /** @throws {never} */
  register<T>(type: string, nodeId: string, value: T): T {
    return this.#node(type, nodeId, value);
  }

  /** @throws {Error} */
  search(query: string, visible: (repo: Repository) => boolean): Item[] {
    const terms = query.match(/(?:[^\s"]+|"[^"]*")+/gu) ?? [];
    const tests: Array<(item: Item) => boolean> = [];
    let order: [string, "asc" | "desc"] = ["created", "desc"];
    for (const term of terms) {
      const colon = term.indexOf(":");
      const negate = term.startsWith("-");
      const key = colon === -1 ? "" : term.slice(negate ? 1 : 0, colon).toLowerCase();
      const value = colon === -1 ? term.replaceAll('"', "").toLowerCase() : term.slice(colon + 1).replaceAll('"', "");
      const test = qualifier(key, value, this);
      if (key === "sort") {
        const [field = "created", direction = "desc"] = value.split("-");
        order = [field, direction === "asc" ? "asc" : "desc"];
        continue;
      }
      if (test === undefined) throw new Error(`the GitHub fake does not support the search qualifier ${term}`);
      tests.push(negate ? (item) => !test(item) : test);
    }
    const field = order[0] === "updated" ? "updatedAt" : "createdAt";
    return this.repositories()
      .filter(visible)
      .flatMap((repo) => [...repo.items.values()])
      .filter((item) => tests.every((test) => test(item)))
      .sort((a, b) => (order[1] === "asc" ? 1 : -1) * (a[field].localeCompare(b[field]) || a.id - b.id));
  }
}

function within(value: string | null, range: string): boolean {
  if (value === null) return false;
  const [low, high] = range.includes("..") ? range.split("..") as [string, string] : [undefined, undefined];
  if (low !== undefined && high !== undefined) return (low === "*" || value.slice(0, low.length) >= low) && (high === "*" || value.slice(0, high.length) <= high);
  const [, operator = "", bound = ""] = /^(>=|<=|>|<)?(.*)$/u.exec(range) ?? [];
  const slice = value.slice(0, bound.length);
  return operator === ">=" ? slice >= bound : operator === "<=" ? slice <= bound : operator === ">" ? slice > bound : operator === "<" ? slice < bound : slice === bound;
}

function qualifier(key: string, value: string, world: GitHubWorld): ((item: Item) => boolean) | undefined {
  const lower = value.toLowerCase();
  const fullName = (item: Item) => `${item.repository.owner.login}/${item.repository.name}`.toLowerCase();
  switch (key) {
    case "": return (item) => `${item.title}\n${item.body}`.toLowerCase().includes(lower);
    case "repo": return (item) => fullName(item) === lower || world.movedRepo(lower) === item.repository;
    case "org":
    case "user": return (item) => item.repository.owner.login.toLowerCase() === lower;
    case "author": return (item) => item.author.login.toLowerCase() === lower;
    case "label": return (item) => item.labels.some((label) => label.name.toLowerCase() === lower);
    case "type": return (item) => (lower === "pr" ? item.kind === "pull" : item.kind === "issue");
    case "is":
      return lower === "pr" ? (item) => item.kind === "pull"
        : lower === "issue" ? (item) => item.kind === "issue"
        : lower === "open" || lower === "closed" ? (item) => item.state === lower
        : lower === "merged" ? (item) => item.kind === "pull" && item.mergedAt !== null
        : lower === "unmerged" ? (item) => item.kind === "pull" && item.mergedAt === null && item.state === "closed"
        : lower === "draft" ? (item) => item.kind === "pull" && item.draft
        : undefined;
    case "state": return (item) => item.state === lower;
    case "base": return (item) => item.kind === "pull" && item.baseRef === value;
    case "head": return (item) => item.kind === "pull" && item.headRef === value;
    case "created": return (item) => within(item.createdAt, value);
    case "updated": return (item) => within(item.updatedAt, value);
    case "closed": return (item) => within(item.closedAt, value);
    case "merged": return (item) => item.kind === "pull" && within(item.mergedAt, value);
    case "sort": return () => true;
    default: return undefined;
  }
}
