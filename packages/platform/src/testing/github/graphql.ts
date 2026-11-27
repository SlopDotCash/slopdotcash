// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
import {
  type Account, type Comment, type Commit, type GitHubWorld, type Issue, type Item, type Label, type Pull, type Repository, type Review,
  type TimelineEvent, blobSha, treeOf,
} from "./world.ts";
import { lineDiff, resolveRef } from "./rest.ts";

type Value =
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "literal"; readonly value: unknown }
  | { readonly kind: "list"; readonly values: ReadonlyArray<Value> }
  | { readonly kind: "object"; readonly fields: ReadonlyArray<readonly [string, Value]> };

interface Directive { readonly name: string; readonly args: ReadonlyArray<readonly [string, Value]> }
interface Location { readonly line: number; readonly column: number }

type Selection =
  | { readonly kind: "field"; readonly alias: string | undefined; readonly name: string; readonly args: ReadonlyArray<readonly [string, Value]>; readonly directives: ReadonlyArray<Directive>; readonly selections: ReadonlyArray<Selection> | undefined; readonly at: Location }
  | { readonly kind: "inline"; readonly on: string | undefined; readonly directives: ReadonlyArray<Directive>; readonly selections: ReadonlyArray<Selection>; readonly at: Location }
  | { readonly kind: "spread"; readonly name: string; readonly directives: ReadonlyArray<Directive>; readonly at: Location };

interface Operation { readonly name: string | undefined; readonly type: string; readonly variables: ReadonlyArray<{ readonly name: string; readonly fallback: Value | undefined }>; readonly selections: ReadonlyArray<Selection> }
interface Fragment { readonly on: string; readonly selections: ReadonlyArray<Selection> }
interface Document { readonly operations: ReadonlyArray<Operation>; readonly fragments: ReadonlyMap<string, Fragment> }

interface Token { readonly kind: "punct" | "name" | "number" | "string"; readonly text: string; readonly value: unknown; readonly at: Location }

export interface GraphQLError {
  readonly message: string;
  readonly type?: string;
  readonly path?: ReadonlyArray<string | number>;
  readonly locations?: ReadonlyArray<Location>;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface RateLimitView { readonly cost: number; readonly limit: number; readonly remaining: number; readonly used: number; readonly resetAt: string }

export interface GraphQLContext {
  readonly world: GitHubWorld;
  readonly viewer: Account | undefined;
  readonly visible: (repo: Repository) => boolean;
  readonly rateLimit: RateLimitView;
}

class Syntax extends Error {}

class FieldFailure extends Error {
  readonly type: string;
  constructor(message: string, type: string) {
    super(message);
    this.type = type;
  }
}

class Obj {
  readonly type: string;
  readonly value: unknown;
  constructor(type: string, value: unknown) {
    this.type = type;
    this.value = value;
  }
}

const lexeme = /[\s,]+|#[^\n\r]*|(\.\.\.|[!$&():=@[\]{|}])|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|("""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*")|([_A-Za-z][_0-9A-Za-z]*)/uy;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  lexeme.lastIndex = 0;
  while (lexeme.lastIndex < source.length) {
    const start = lexeme.lastIndex;
    const found = lexeme.exec(source);
    const before = source.slice(0, start);
    const at = { line: before.split("\n").length, column: start - before.lastIndexOf("\n") };
    if (found === null) throw new Syntax(`Parse error on "${source[start] ?? ""}" at [${at.line}, ${at.column}]`);
    const [, punct, number, text, name] = found;
    if (punct !== undefined) tokens.push({ kind: "punct", text: punct, value: punct, at });
    else if (number !== undefined) tokens.push({ kind: "number", text: number, value: Number(number), at });
    else if (text !== undefined) tokens.push({ kind: "string", text, value: text.startsWith('"""') ? text.slice(3, -3).trim() : JSON.parse(text), at });
    else if (name !== undefined) tokens.push({ kind: "name", text: name, value: name, at });
  }
  return tokens;
}

class Parser {
  #index = 0;
  readonly tokens: ReadonlyArray<Token>;
  constructor(tokens: ReadonlyArray<Token>) {
    this.tokens = tokens;
  }

  #peek(): Token | undefined {
    return this.tokens[this.#index];
  }

  #take(text?: string): Token {
    const token = this.tokens[this.#index];
    if (token === undefined || (text !== undefined && token.text !== text)) throw new Syntax(`Parse error on "${token?.text ?? "end of query"}" (expected ${text ?? "a token"})${token === undefined ? "" : ` at [${token.at.line}, ${token.at.column}]`}`);
    this.#index += 1;
    return token;
  }

  #is(text: string): boolean {
    return this.#peek()?.text === text;
  }

  #name(): string {
    const token = this.#take();
    if (token.kind !== "name") throw new Syntax(`Parse error on "${token.text}" (expected a name) at [${token.at.line}, ${token.at.column}]`);
    return token.text;
  }

  document(): Document {
    const operations: Operation[] = [];
    const fragments = new Map<string, Fragment>();
    while (this.#peek() !== undefined) {
      if (this.#is("{")) operations.push({ name: undefined, type: "query", variables: [], selections: this.#selections() });
      else if (this.#is("fragment")) {
        this.#take();
        const name = this.#name();
        this.#take("on");
        const on = this.#name();
        this.#directives();
        fragments.set(name, { on, selections: this.#selections() });
      } else operations.push(this.#operation());
    }
    return { operations, fragments };
  }

  #operation(): Operation {
    const type = this.#name();
    const name = this.#peek()?.kind === "name" ? this.#name() : undefined;
    const variables: Array<{ name: string; fallback: Value | undefined }> = [];
    if (this.#is("(")) {
      this.#take("(");
      while (!this.#is(")")) {
        this.#take("$");
        const variable = this.#name();
        this.#take(":");
        this.#type();
        let fallback: Value | undefined;
        if (this.#is("=")) {
          this.#take("=");
          fallback = this.#value();
        }
        this.#directives();
        variables.push({ name: variable, fallback });
      }
      this.#take(")");
    }
    this.#directives();
    return { name, type, variables, selections: this.#selections() };
  }

  #type(): void {
    if (this.#is("[")) {
      this.#take("[");
      this.#type();
      this.#take("]");
    } else this.#name();
    if (this.#is("!")) this.#take("!");
  }

  #value(): Value {
    const token = this.#take();
    if (token.text === "$") return { kind: "variable", name: this.#name() };
    if (token.text === "[") {
      const values: Value[] = [];
      while (!this.#is("]")) values.push(this.#value());
      this.#take("]");
      return { kind: "list", values };
    }
    if (token.text === "{") {
      const fields: Array<readonly [string, Value]> = [];
      while (!this.#is("}")) {
        const name = this.#name();
        this.#take(":");
        fields.push([name, this.#value()]);
      }
      this.#take("}");
      return { kind: "object", fields };
    }
    if (token.kind === "name") return { kind: "literal", value: token.text === "true" ? true : token.text === "false" ? false : token.text === "null" ? null : token.text };
    if (token.kind === "punct") throw new Syntax(`Parse error on "${token.text}" at [${token.at.line}, ${token.at.column}]`);
    return { kind: "literal", value: token.value };
  }

  #arguments(): Array<readonly [string, Value]> {
    const args: Array<readonly [string, Value]> = [];
    if (!this.#is("(")) return args;
    this.#take("(");
    while (!this.#is(")")) {
      const name = this.#name();
      this.#take(":");
      args.push([name, this.#value()]);
    }
    this.#take(")");
    return args;
  }

  #directives(): Directive[] {
    const directives: Directive[] = [];
    while (this.#is("@")) {
      this.#take("@");
      directives.push({ name: this.#name(), args: this.#arguments() });
    }
    return directives;
  }

  #selections(): Selection[] {
    this.#take("{");
    const selections: Selection[] = [];
    while (!this.#is("}")) {
      const at = this.#peek()?.at ?? { line: 0, column: 0 };
      if (this.#is("...")) {
        this.#take("...");
        if (this.#is("on")) {
          this.#take("on");
          const on = this.#name();
          selections.push({ kind: "inline", on, directives: this.#directives(), selections: this.#selections(), at });
        } else if (this.#is("{") || this.#is("@")) selections.push({ kind: "inline", on: undefined, directives: this.#directives(), selections: this.#selections(), at });
        else selections.push({ kind: "spread", name: this.#name(), directives: this.#directives(), at });
        continue;
      }
      const first = this.#name();
      let alias: string | undefined, name = first;
      if (this.#is(":")) {
        this.#take(":");
        alias = first;
        name = this.#name();
      }
      const args = this.#arguments();
      const directives = this.#directives();
      selections.push({ kind: "field", alias, name, args, directives, selections: this.#is("{") ? this.#selections() : undefined, at });
    }
    this.#take("}");
    return selections;
  }
}

type Args = Readonly<Record<string, unknown>>;
interface Field { readonly type: string; readonly resolve: (parent: unknown, args: Args, ctx: GraphQLContext) => unknown }
interface ObjectType { readonly implements: ReadonlyArray<string>; readonly fields: Readonly<Record<string, Field>> }

function fieldsOf<P>(fields: Readonly<Record<string, { readonly type: string; readonly resolve: (parent: P, args: Args, ctx: GraphQLContext) => unknown }>>): Readonly<Record<string, Field>> {
  return fields as unknown as Readonly<Record<string, Field>>;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const scalar = <P>(type: string, resolve: (parent: P, args: Args, ctx: GraphQLContext) => unknown) => ({ type, resolve });
const github = "https://github.com";

function cursor(index: number): string {
  return Buffer.from(`cursor:${index}`).toString("base64");
}

function offset(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const decoded = /^cursor:(\d+)$/u.exec(Buffer.from(value, "base64").toString("utf8"));
  if (decoded === null) throw new FieldFailure(`\`${value}\` does not appear to be a valid cursor.`, "INVALID_CURSOR_ARGUMENTS");
  return Number(decoded[1]);
}

interface Page { readonly nodes: ReadonlyArray<unknown>; readonly start: number; readonly total: number; readonly hasNext: boolean; readonly hasPrevious: boolean }

function connection(type: string, values: ReadonlyArray<unknown>, args: Args): Obj {
  const first = typeof args.first === "number" ? args.first : undefined;
  const last = typeof args.last === "number" ? args.last : undefined;
  const bound = first ?? last ?? 0;
  if (bound > 100 || bound < 0) throw new FieldFailure(`Requesting ${bound} records on the \`${type}\` connection exceeds the \`${first === undefined ? "last" : "first"}\` limit of 100 records.`, "EXCESSIVE_PAGINATION");
  const after = offset(args.after), before = offset(args.before);
  let start = after === undefined ? 0 : after + 1;
  let end = before === undefined ? values.length : Math.min(values.length, before);
  if (first !== undefined) end = Math.min(end, start + first);
  else if (last !== undefined) start = Math.max(start, end - last);
  return new Obj(`${type}Connection`, { nodes: values.slice(start, end), start, total: values.length, hasNext: end < values.length, hasPrevious: start > 0 } satisfies Page);
}

function connectionType(node: string): ObjectType {
  return {
    implements: [],
    fields: fieldsOf<Page>({
      totalCount: scalar("Int", (page) => page.total),
      issueCount: scalar("Int", (page) => page.total),
      repositoryCount: scalar("Int", () => 0),
      userCount: scalar("Int", () => 0),
      nodes: { type: node, resolve: (page) => page.nodes },
      edges: { type: `${node}Edge`, resolve: (page) => page.nodes.map((value, index) => new Obj(`${node}Edge`, { node: value, cursor: cursor(page.start + index) })) },
      pageInfo: {
        type: "PageInfo",
        resolve: (page) => new Obj("PageInfo", {
          hasNextPage: page.hasNext,
          hasPreviousPage: page.hasPrevious,
          startCursor: page.nodes.length === 0 ? null : cursor(page.start),
          endCursor: page.nodes.length === 0 ? null : cursor(page.start + page.nodes.length - 1),
        }),
      },
    }),
  };
}

function edgeType(node: string): ObjectType {
  return { implements: [], fields: fieldsOf<{ node: unknown; cursor: string }>({ node: { type: node, resolve: (edge) => edge.node }, cursor: scalar("String", (edge) => edge.cursor) }) };
}

function actor(account: Account | undefined | null): Obj | null {
  return account === undefined || account === null ? null : new Obj(account.kind, account);
}

const fullName = (repo: Repository) => `${repo.owner.login}/${repo.name}`;

function association(world: GitHubWorld, repo: Repository, account: Account): string {
  if (repo.owner === account) return "OWNER";
  if (repo.owner.members.has(account.id)) return "MEMBER";
  if (repo.permissions.has(account.id)) return "COLLABORATOR";
  return [...repo.items.values()].some((item) => item.kind === "pull" && item.mergedAt !== null && item.author === account) ? "CONTRIBUTOR" : "NONE";
}

function enumList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : undefined;
}

function ordered<T extends Item>(values: ReadonlyArray<T>, args: Args): T[] {
  const order = typeof args.orderBy === "object" && args.orderBy !== null ? args.orderBy as Record<string, unknown> : {};
  const key = order.field === "UPDATED_AT" ? "updatedAt" : "createdAt";
  const sign = order.direction === "DESC" ? -1 : 1;
  return [...values].sort((a, b) => sign * (a[key].localeCompare(b[key]) || a.number - b.number));
}

function itemState(item: Item): string {
  return item.kind === "pull" && item.mergedAt !== null ? "MERGED" : item.state.toUpperCase();
}

function labelled(item: Item, args: Args): boolean {
  const names = enumList(args.labels);
  return names === undefined || names.some((name) => item.labels.some((label) => label.name === name));
}

function itemObj(item: Item): Obj {
  return new Obj(item.kind === "pull" ? "PullRequest" : "Issue", item);
}

const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/giu;

function closedNumbers(pull: Pull): number[] {
  return [...pull.body.matchAll(closing)].map((found) => Number(found[1]));
}

function eventType(event: string): string {
  return `${event.split(/[-_]/u).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("")}Event`;
}

function enumName(type: string): string {
  return type.replace(/([a-z])([A-Z])/gu, "$1_$2").toUpperCase();
}

function timelineItems(item: Item, args: Args): Obj {
  const wanted = enumList(args.itemTypes);
  const since = text(args.since);
  const entries: Array<{ createdAt: string; id: number; obj: Obj }> = [
    ...item.comments.map((comment) => ({ createdAt: comment.createdAt, id: comment.id, obj: new Obj("IssueComment", { comment, item }) })),
    ...item.timeline.map((event) => ({ createdAt: event.createdAt, id: event.id, obj: new Obj(eventType(event.event), { event, item }) })),
    ...(item.kind === "pull" ? item.reviews.map((review) => ({ createdAt: review.submittedAt, id: review.id, obj: new Obj("PullRequestReview", { review, pull: item }) })) : []),
  ];
  const kept = entries
    .filter((entry) => entry.createdAt >= since && (wanted === undefined || wanted.includes(enumName(entry.obj.type))))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
    .map((entry) => entry.obj);
  return connection(item.kind === "pull" ? "PullRequestTimelineItems" : "IssueTimelineItems", kept, args);
}

function commitObj(repo: Repository, sha: string | null | undefined): Obj | null {
  const commit = sha === null || sha === undefined ? undefined : repo.commits.get(sha);
  return commit === undefined ? null : new Obj("Commit", { commit, repo });
}

function counts(repo: Repository, commit: Commit) {
  const parent = repo.commits.get(commit.parents[0] ?? "")?.files ?? new Map<string, Uint8Array>();
  let additions = 0, deletions = 0, changed = 0;
  for (const path of new Set([...parent.keys(), ...commit.files.keys()])) {
    const before = parent.get(path), after = commit.files.get(path);
    if (before !== undefined && after !== undefined && blobSha(before) === blobSha(after)) continue;
    changed += 1;
    const diff = lineDiff(before, after);
    additions += diff?.additions ?? 0;
    deletions += diff?.deletions ?? 0;
  }
  return { additions, deletions, changed };
}

const ownerFields = {
  id: scalar<Account>("ID", (account) => account.nodeId),
  databaseId: scalar<Account>("Int", (account) => account.id),
  login: scalar<Account>("String", (account) => account.login),
  name: scalar<Account>("String", (account) => account.name),
  url: scalar<Account>("URI", (account) => `${github}/${account.login}`),
  resourcePath: scalar<Account>("URI", (account) => `/${account.login}`),
  avatarUrl: scalar<Account>("URI", (account) => `https://avatars.githubusercontent.com/u/${account.id}?v=4`),
  createdAt: scalar<Account>("DateTime", (account) => account.createdAt),
};

const itemFields = {
  id: scalar<Item>("ID", (item) => item.nodeId),
  databaseId: scalar<Item>("Int", (item) => item.id),
  fullDatabaseId: scalar<Item>("BigInt", (item) => String(item.id)),
  number: scalar<Item>("Int", (item) => item.number),
  title: scalar<Item>("String", (item) => item.title),
  body: scalar<Item>("String", (item) => item.body),
  bodyText: scalar<Item>("String", (item) => item.body),
  url: scalar<Item>("URI", (item) => `${github}/${fullName(item.repository)}/${item.kind === "pull" ? "pull" : "issues"}/${item.number}`),
  resourcePath: scalar<Item>("URI", (item) => `/${fullName(item.repository)}/${item.kind === "pull" ? "pull" : "issues"}/${item.number}`),
  state: scalar<Item>("String", itemState),
  createdAt: scalar<Item>("DateTime", (item) => item.createdAt),
  updatedAt: scalar<Item>("DateTime", (item) => item.updatedAt),
  closedAt: scalar<Item>("DateTime", (item) => item.closedAt),
  closed: scalar<Item>("Boolean", (item) => item.state === "closed"),
  lastEditedAt: scalar<Item>("DateTime", () => null),
  editor: { type: "Actor", resolve: () => null },
  author: { type: "Actor", resolve: (item: Item) => actor(item.author) },
  authorAssociation: scalar<Item>("CommentAuthorAssociation", (item, _args, ctx) => association(ctx.world, item.repository, item.author)),
  repository: { type: "Repository", resolve: (item: Item) => new Obj("Repository", item.repository) },
  labels: { type: "LabelConnection", resolve: (item: Item, args: Args) => connection("Label", item.labels.map((label) => new Obj("Label", { label, repo: item.repository })), args) },
  assignees: { type: "UserConnection", resolve: (item: Item, args: Args) => connection("User", item.assignees.map(actor), args) },
  comments: { type: "IssueCommentConnection", resolve: (item: Item, args: Args) => connection("IssueComment", [...item.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((comment) => new Obj("IssueComment", { comment, item })), args) },
};

function reviewDecision(pull: Pull): string | null {
  const latest = new Map<number, Review>();
  for (const review of [...pull.reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) if (review.state !== "COMMENTED" && review.state !== "PENDING") latest.set(review.author.id, review);
  const states = [...latest.values()].map((review) => review.state);
  if (states.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (states.includes("APPROVED")) return "APPROVED";
  return pull.requestedReviewers.length > 0 ? "REVIEW_REQUIRED" : null;
}

function eventFields(extra: Readonly<Record<string, Field>> = {}): ObjectType {
  return {
    implements: ["Node", "IssueTimelineItems", "PullRequestTimelineItems"],
    fields: {
      ...fieldsOf<{ event: TimelineEvent; item: Item }>({
        id: scalar("ID", ({ event }) => event.nodeId),
        createdAt: scalar("DateTime", ({ event }) => event.createdAt),
        actor: { type: "Actor", resolve: ({ event }) => actor(event.actor) },
      }),
      ...extra,
    },
  };
}

function detail<T>(type: string, read: (details: Readonly<Record<string, unknown>>, item: Item, ctx: GraphQLContext) => T) {
  return { type, resolve: ({ event, item }: { event: TimelineEvent; item: Item }, _args: Args, ctx: GraphQLContext) => read(event.details, item, ctx) };
}

function labelFromDetails(details: Readonly<Record<string, unknown>>, item: Item): Obj | null {
  const raw = details.label;
  const name = typeof raw === "object" && raw !== null && "name" in raw ? String(raw.name) : undefined;
  const label = name === undefined ? undefined : item.repository.labels.get(name.toLowerCase());
  return label === undefined ? null : new Obj("Label", { label, repo: item.repository });
}

function sourceFromDetails(details: Readonly<Record<string, unknown>>, ctx: GraphQLContext): Obj | null {
  const raw = details.source;
  if (typeof raw !== "object" || raw === null || !("repo" in raw) || !("number" in raw)) return null;
  const repo = ctx.world.findRepo(String(raw.repo));
  const item = repo?.items.get(Number(raw.number));
  return repo === undefined || item === undefined || !ctx.visible(repo) ? null : itemObj(item);
}

const types: Record<string, ObjectType> = {
  Query: {
    implements: [],
    fields: fieldsOf<undefined>({
      rateLimit: { type: "RateLimit", resolve: (_root, _args, ctx) => new Obj("RateLimit", ctx.rateLimit) },
      viewer: {
        type: "User",
        resolve: (_root, _args, ctx) => {
          if (ctx.viewer === undefined) throw new FieldFailure("Resource not accessible by integration", "FORBIDDEN");
          return actor(ctx.viewer);
        },
      },
      repository: {
        type: "Repository",
        resolve: (_root, args, ctx) => {
          const name = `${String(args.owner)}/${String(args.name)}`;
          const repo = ctx.world.findRepo(name) ?? (args.followRenames === false ? undefined : ctx.world.movedRepo(name));
          if (repo === undefined || !ctx.visible(repo)) throw new FieldFailure(`Could not resolve to a Repository with the name '${name}'.`, "NOT_FOUND");
          return new Obj("Repository", repo);
        },
      },
      user: { type: "User", resolve: (_root, args, ctx) => ownerByLogin(ctx, args.login, "User") },
      organization: { type: "Organization", resolve: (_root, args, ctx) => ownerByLogin(ctx, args.login, "Organization") },
      repositoryOwner: { type: "RepositoryOwner", resolve: (_root, args, ctx) => ownerByLogin(ctx, args.login, undefined) },
      node: { type: "Node", resolve: (_root, args, ctx) => nodeById(ctx, args.id) },
      nodes: {
        type: "Node",
        resolve: (_root, args, ctx) => (Array.isArray(args.ids) ? args.ids : []).map((id: unknown) => {
          try {
            return nodeById(ctx, id);
          } catch (error) {
            if (error instanceof FieldFailure) return error;
            throw error;
          }
        }),
      },
      search: {
        type: "SearchResultItemConnection",
        resolve: (_root, args, ctx) => {
          if (args.type !== "ISSUE" && args.type !== "ISSUE_ADVANCED") throw new FieldFailure(`The GitHub fake answers search(type: ISSUE) only, not ${String(args.type)}.`, "UNSUPPORTED");
          let found: Item[];
          try {
            found = ctx.world.search(text(args.query), ctx.visible);
          } catch (error) {
            throw new FieldFailure(error instanceof Error ? error.message : "Invalid search query", "INVALID_SEARCH");
          }
          return connection("SearchResultItem", found.slice(0, 1000).map(itemObj), args);
        },
      },
    }),
  },
  RateLimit: {
    implements: [],
    fields: fieldsOf<RateLimitView>({
      cost: scalar("Int", (limit) => limit.cost),
      limit: scalar("Int", (limit) => limit.limit),
      remaining: scalar("Int", (limit) => limit.remaining),
      used: scalar("Int", (limit) => limit.used),
      resetAt: scalar("DateTime", (limit) => limit.resetAt),
      nodeCount: scalar("Int", () => 1),
    }),
  },
  PageInfo: {
    implements: [],
    fields: fieldsOf<Readonly<Record<string, unknown>>>({
      hasNextPage: scalar("Boolean", (info) => info.hasNextPage),
      hasPreviousPage: scalar("Boolean", (info) => info.hasPreviousPage),
      startCursor: scalar("String", (info) => info.startCursor),
      endCursor: scalar("String", (info) => info.endCursor),
    }),
  },
  User: { implements: ["Node", "Actor", "RepositoryOwner", "Assignee", "SearchResultItem", "RequestedReviewer"], fields: fieldsOf<Account>(ownerFields) },
  Organization: { implements: ["Node", "Actor", "RepositoryOwner", "SearchResultItem"], fields: fieldsOf<Account>(ownerFields) },
  Bot: { implements: ["Node", "Actor", "Assignee", "RequestedReviewer"], fields: fieldsOf<Account>(ownerFields) },
  Mannequin: { implements: ["Node", "Actor", "Assignee", "RequestedReviewer"], fields: fieldsOf<Account>(ownerFields) },
  EnterpriseUserAccount: { implements: ["Node", "Actor"], fields: fieldsOf<Account>(ownerFields) },
  Repository: {
    implements: ["Node", "SearchResultItem"],
    fields: fieldsOf<Repository>({
      id: scalar("ID", (repo) => repo.nodeId),
      databaseId: scalar("Int", (repo) => repo.id),
      fullDatabaseId: scalar("BigInt", (repo) => String(repo.id)),
      name: scalar("String", (repo) => repo.name),
      nameWithOwner: scalar("String", fullName),
      description: scalar("String", (repo) => repo.description),
      url: scalar("URI", (repo) => `${github}/${fullName(repo)}`),
      isPrivate: scalar("Boolean", (repo) => repo.private),
      isFork: scalar("Boolean", (repo) => repo.fork),
      isArchived: scalar("Boolean", (repo) => repo.archived),
      visibility: scalar("RepositoryVisibility", (repo) => (repo.private ? "PRIVATE" : "PUBLIC")),
      createdAt: scalar("DateTime", (repo) => repo.createdAt),
      updatedAt: scalar("DateTime", (repo) => repo.updatedAt),
      pushedAt: scalar("DateTime", (repo) => repo.updatedAt),
      stargazerCount: scalar("Int", () => 0),
      forkCount: scalar("Int", () => 0),
      owner: { type: "RepositoryOwner", resolve: (repo) => actor(repo.owner) },
      licenseInfo: { type: "License", resolve: (repo) => (repo.licenseSpdx === null ? null : new Obj("License", repo.licenseSpdx)) },
      defaultBranchRef: { type: "Ref", resolve: (repo) => refObj(repo, repo.defaultBranch) },
      ref: {
        type: "Ref",
        resolve: (repo, args) => {
          const name = text(args.qualifiedName).replace(/^refs\/heads\//u, "");
          return refObj(repo, name);
        },
      },
      refs: {
        type: "RefConnection",
        resolve: (repo, args) => {
          if (args.refPrefix !== "refs/heads/") return connection("Ref", [], args);
          const query = text(args.query);
          const order = typeof args.orderBy === "object" && args.orderBy !== null && (args.orderBy as Record<string, unknown>).direction === "DESC" ? -1 : 1;
          const names = [...repo.branches.keys()].filter((name) => name.includes(query)).sort((a, b) => order * a.localeCompare(b));
          return connection("Ref", names.map((name) => refObj(repo, name)), args);
        },
      },
      object: {
        type: "GitObject",
        resolve: (repo, args) => {
          const expression = typeof args.oid === "string" ? args.oid : text(args.expression);
          const colon = expression.indexOf(":");
          const sha = resolveRef(repo, colon === -1 ? expression : expression.slice(0, colon));
          const commit = sha === undefined ? undefined : repo.commits.get(sha);
          if (commit === undefined) return null;
          if (colon === -1) return new Obj("Commit", { commit, repo });
          const path = expression.slice(colon + 1).replace(/\/$/u, "");
          const bytes = commit.files.get(path);
          if (bytes !== undefined) return new Obj("Blob", bytes);
          const prefix = path === "" ? "" : `${path}/`;
          return [...commit.files.keys()].some((name) => name.startsWith(prefix)) ? new Obj("Tree", { commit, prefix }) : null;
        },
      },
      pullRequests: {
        type: "PullRequestConnection",
        resolve: (repo, args) => {
          const states = enumList(args.states);
          const pulls = [...repo.items.values()].filter((item): item is Pull => item.kind === "pull")
            .filter((pull) => (states === undefined || states.includes(itemState(pull))) && labelled(pull, args) &&
              (typeof args.baseRefName !== "string" || pull.baseRef === args.baseRefName) && (typeof args.headRefName !== "string" || pull.headRef === args.headRefName));
          return connection("PullRequest", ordered(pulls, args).map(itemObj), args);
        },
      },
      issues: {
        type: "IssueConnection",
        resolve: (repo, args) => {
          const filter = typeof args.filterBy === "object" && args.filterBy !== null ? args.filterBy as Record<string, unknown> : {};
          const states = enumList(args.states) ?? enumList(filter.states);
          const issues = [...repo.items.values()].filter((item): item is Issue => item.kind === "issue")
            .filter((issue) => (states === undefined || states.includes(itemState(issue))) && labelled(issue, args) &&
              (typeof filter.since !== "string" || issue.updatedAt >= filter.since) && (typeof filter.createdBy !== "string" || issue.author.login === filter.createdBy));
          return connection("Issue", ordered(issues, args).map(itemObj), args);
        },
      },
      pullRequest: { type: "PullRequest", resolve: (repo, args) => numbered(repo, args, "pull") },
      issue: { type: "Issue", resolve: (repo, args) => numbered(repo, args, "issue") },
      issueOrPullRequest: { type: "IssueOrPullRequest", resolve: (repo, args) => numbered(repo, args, undefined) },
      labels: { type: "LabelConnection", resolve: (repo, args) => connection("Label", [...repo.labels.values()].filter((label) => label.name.includes(text(args.query))).map((label) => new Obj("Label", { label, repo })), args) },
      label: { type: "Label", resolve: (repo, args) => {
        const label = repo.labels.get(text(args.name).toLowerCase());
        return label === undefined ? null : new Obj("Label", { label, repo });
      } },
    }),
  },
  License: {
    implements: ["Node"],
    fields: fieldsOf<string>({
      id: scalar("ID", (spdx) => `L_${spdx}`),
      spdxId: scalar("String", (spdx) => spdx),
      key: scalar("String", (spdx) => spdx.toLowerCase()),
      name: scalar("String", (spdx) => spdx),
      url: scalar("URI", (spdx) => `https://choosealicense.com/licenses/${spdx.toLowerCase()}/`),
    }),
  },
  Ref: {
    implements: ["Node"],
    fields: fieldsOf<{ repo: Repository; name: string; sha: string }>({
      id: scalar("ID", (ref) => `REF_${ref.repo.id}_${ref.name}`),
      name: scalar("String", (ref) => ref.name),
      prefix: scalar("String", () => "refs/heads/"),
      target: { type: "GitObject", resolve: (ref) => commitObj(ref.repo, ref.sha) },
    }),
  },
  Commit: {
    implements: ["Node", "GitObject"],
    fields: fieldsOf<{ commit: Commit; repo: Repository }>({
      id: scalar("ID", ({ commit }) => commit.nodeId),
      oid: scalar("GitObjectID", ({ commit }) => commit.sha),
      abbreviatedOid: scalar("String", ({ commit }) => commit.sha.slice(0, 7)),
      message: scalar("String", ({ commit }) => commit.message),
      messageHeadline: scalar("String", ({ commit }) => commit.message.split("\n")[0] ?? ""),
      messageBody: scalar("String", ({ commit }) => commit.message.split("\n").slice(1).join("\n").trim()),
      committedDate: scalar("DateTime", ({ commit }) => commit.date),
      authoredDate: scalar("DateTime", ({ commit }) => commit.date),
      pushedDate: scalar("DateTime", () => null),
      url: scalar("URI", ({ commit, repo }) => `${github}/${fullName(repo)}/commit/${commit.sha}`),
      commitUrl: scalar("URI", ({ commit, repo }) => `${github}/${fullName(repo)}/commit/${commit.sha}`),
      repository: { type: "Repository", resolve: ({ repo }) => new Obj("Repository", repo) },
      additions: scalar("Int", ({ commit, repo }) => counts(repo, commit).additions),
      deletions: scalar("Int", ({ commit, repo }) => counts(repo, commit).deletions),
      changedFiles: scalar("Int", ({ commit, repo }) => counts(repo, commit).changed),
      changedFilesIfAvailable: scalar("Int", ({ commit, repo }) => counts(repo, commit).changed),
      parents: { type: "CommitConnection", resolve: ({ commit, repo }, args) => connection("Commit", commit.parents.map((sha) => commitObj(repo, sha)), args) },
      author: { type: "GitActor", resolve: ({ commit }) => new Obj("GitActor", commit) },
      committer: { type: "GitActor", resolve: ({ commit }) => new Obj("GitActor", commit) },
      tree: { type: "Tree", resolve: ({ commit }) => new Obj("Tree", { commit, prefix: "" }) },
    }),
  },
  GitActor: {
    implements: [],
    fields: fieldsOf<Commit>({
      name: scalar("String", (commit) => commit.authorName),
      email: scalar("String", (commit) => commit.authorEmail),
      date: scalar("GitTimestamp", (commit) => commit.date),
      user: { type: "User", resolve: (commit) => actor(commit.author?.kind === "User" ? commit.author : undefined) },
    }),
  },
  Tree: {
    implements: ["Node", "GitObject"],
    fields: fieldsOf<{ commit: Commit; prefix: string }>({
      id: scalar("ID", (tree) => `T_${treeOf(tree.commit, tree.prefix)}`),
      oid: scalar("GitObjectID", (tree) => treeOf(tree.commit, tree.prefix)),
      abbreviatedOid: scalar("String", (tree) => treeOf(tree.commit, tree.prefix).slice(0, 7)),
    }),
  },
  Blob: {
    implements: ["Node", "GitObject"],
    fields: fieldsOf<Uint8Array>({
      id: scalar("ID", (bytes) => `B_${blobSha(bytes)}`),
      oid: scalar("GitObjectID", blobSha),
      abbreviatedOid: scalar("String", (bytes) => blobSha(bytes).slice(0, 7)),
      byteSize: scalar("Int", (bytes) => bytes.length),
      isBinary: scalar("Boolean", (bytes) => bytes.includes(0)),
      isTruncated: scalar("Boolean", (bytes) => bytes.length > 512_000),
      text: scalar("String", (bytes) => (bytes.includes(0) ? null : new TextDecoder().decode(bytes.slice(0, 512_000)))),
    }),
  },
  PullRequest: {
    implements: ["Node", "SearchResultItem", "ReferencedSubject", "IssueOrPullRequest", "UniformResourceLocatable", "Closable"],
    fields: {
      ...fieldsOf<Item>(itemFields),
      ...fieldsOf<Pull>({
        timelineItems: { type: "PullRequestTimelineItemsConnection", resolve: timelineItems },
        isDraft: scalar("Boolean", (pull) => pull.draft),
        merged: scalar("Boolean", (pull) => pull.mergedAt !== null),
        mergedAt: scalar("DateTime", (pull) => pull.mergedAt),
        mergedBy: { type: "Actor", resolve: (pull) => actor(pull.mergedBy) },
        mergeCommit: { type: "Commit", resolve: (pull) => commitObj(pull.repository, pull.mergeCommit) },
        additions: scalar("Int", (pull) => pull.additions),
        deletions: scalar("Int", (pull) => pull.deletions),
        changedFiles: scalar("Int", (pull) => pull.files.length),
        headRefName: scalar("String", (pull) => pull.headRef),
        headRefOid: scalar("GitObjectID", (pull) => pull.headSha),
        baseRefName: scalar("String", (pull) => pull.baseRef),
        baseRefOid: scalar("GitObjectID", (pull) => pull.baseSha),
        reviewDecision: scalar("PullRequestReviewDecision", reviewDecision),
        permalink: scalar("URI", (pull) => `${github}/${fullName(pull.repository)}/pull/${pull.number}`),
        files: { type: "PullRequestChangedFileConnection", resolve: (pull, args) => connection("PullRequestChangedFile", pull.files.map((file) => new Obj("PullRequestChangedFile", file)), args) },
        commits: { type: "PullRequestCommitConnection", resolve: (pull, args) => connection("PullRequestCommit", pull.commits.map((sha) => new Obj("PullRequestCommit", { sha, pull })), args) },
        reviews: {
          type: "PullRequestReviewConnection",
          resolve: (pull, args) => {
            const states = enumList(args.states);
            const reviews = [...pull.reviews].filter((review) => (states === undefined || states.includes(review.state)) && (typeof args.author !== "string" || review.author.login === args.author))
              .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id - b.id);
            return connection("PullRequestReview", reviews.map((review) => new Obj("PullRequestReview", { review, pull })), args);
          },
        },
        reviewRequests: { type: "ReviewRequestConnection", resolve: (pull, args) => connection("ReviewRequest", pull.requestedReviewers.map((account) => new Obj("ReviewRequest", { account, pull })), args) },
        closingIssuesReferences: {
          type: "IssueConnection",
          resolve: (pull, args) => connection("Issue", closedNumbers(pull).flatMap((number) => {
            const issue = pull.repository.items.get(number);
            return issue?.kind === "issue" ? [itemObj(issue)] : [];
          }), args),
        },
      }),
    },
  },
  Issue: {
    implements: ["Node", "SearchResultItem", "ReferencedSubject", "IssueOrPullRequest", "UniformResourceLocatable", "Closable"],
    fields: {
      ...fieldsOf<Item>(itemFields),
      ...fieldsOf<Issue>({
        timelineItems: { type: "IssueTimelineItemsConnection", resolve: timelineItems },
        stateReason: scalar("IssueStateReason", (issue) => issue.stateReason?.toUpperCase() ?? null),
        closedByPullRequestsReferences: {
          type: "PullRequestConnection",
          resolve: (issue, args) => connection("PullRequest", [...issue.repository.items.values()]
            .filter((item): item is Pull => item.kind === "pull" && closedNumbers(item).includes(issue.number) && (args.includeClosedPrs === true || item.state === "open" || item.mergedAt !== null))
            .map(itemObj), args),
        },
      }),
    },
  },
  Label: {
    implements: ["Node"],
    fields: fieldsOf<{ label: Label; repo: Repository }>({
      id: scalar("ID", ({ label }) => label.nodeId),
      name: scalar("String", ({ label }) => label.name),
      color: scalar("String", ({ label }) => label.color),
      description: scalar("String", ({ label }) => label.description),
      url: scalar("URI", ({ label, repo }) => `${github}/${fullName(repo)}/labels/${encodeURIComponent(label.name)}`),
    }),
  },
  IssueComment: {
    implements: ["Node", "IssueTimelineItems", "PullRequestTimelineItems"],
    fields: fieldsOf<{ comment: Comment; item: Item }>({
      id: scalar("ID", ({ comment }) => comment.nodeId),
      databaseId: scalar("Int", ({ comment }) => comment.id),
      fullDatabaseId: scalar("BigInt", ({ comment }) => String(comment.id)),
      body: scalar("String", ({ comment }) => comment.body),
      bodyText: scalar("String", ({ comment }) => comment.body),
      createdAt: scalar("DateTime", ({ comment }) => comment.createdAt),
      updatedAt: scalar("DateTime", ({ comment }) => comment.updatedAt),
      lastEditedAt: scalar("DateTime", ({ comment }) => (comment.updatedAt === comment.createdAt ? null : comment.updatedAt)),
      isMinimized: scalar("Boolean", () => false),
      url: scalar("URI", ({ comment, item }) => `${github}/${fullName(item.repository)}/${item.kind === "pull" ? "pull" : "issues"}/${item.number}#issuecomment-${comment.id}`),
      author: { type: "Actor", resolve: ({ comment }) => actor(comment.author) },
      editor: { type: "Actor", resolve: () => null },
      authorAssociation: scalar("CommentAuthorAssociation", ({ comment, item }, _args, ctx) => association(ctx.world, item.repository, comment.author)),
    }),
  },
  PullRequestReview: {
    implements: ["Node", "PullRequestTimelineItems"],
    fields: fieldsOf<{ review: Review; pull: Pull }>({
      id: scalar("ID", ({ review }) => review.nodeId),
      databaseId: scalar("Int", ({ review }) => review.id),
      fullDatabaseId: scalar("BigInt", ({ review }) => String(review.id)),
      body: scalar("String", ({ review }) => review.body),
      state: scalar("PullRequestReviewState", ({ review }) => review.state),
      submittedAt: scalar("DateTime", ({ review }) => review.submittedAt),
      createdAt: scalar("DateTime", ({ review }) => review.submittedAt),
      updatedAt: scalar("DateTime", ({ review }) => review.submittedAt),
      url: scalar("URI", ({ review, pull }) => `${github}/${fullName(pull.repository)}/pull/${pull.number}#pullrequestreview-${review.id}`),
      author: { type: "Actor", resolve: ({ review }) => actor(review.author) },
      authorAssociation: scalar("CommentAuthorAssociation", ({ review, pull }, _args, ctx) => association(ctx.world, pull.repository, review.author)),
      commit: { type: "Commit", resolve: ({ review, pull }) => commitObj(pull.repository, review.commitId) },
      comments: { type: "PullRequestReviewCommentConnection", resolve: ({ review, pull }, args) => connection("PullRequestReviewComment", pull.reviewComments.filter((comment) => comment.reviewId === review.id).map((comment) => new Obj("PullRequestReviewComment", { comment, pull })), args) },
    }),
  },
  PullRequestReviewComment: {
    implements: ["Node"],
    fields: fieldsOf<{ comment: Comment; pull: Pull }>({
      id: scalar("ID", ({ comment }) => comment.nodeId),
      databaseId: scalar("Int", ({ comment }) => comment.id),
      body: scalar("String", ({ comment }) => comment.body),
      path: scalar("String", ({ comment }) => comment.path ?? ""),
      line: scalar("Int", ({ comment }) => comment.line ?? null),
      createdAt: scalar("DateTime", ({ comment }) => comment.createdAt),
      updatedAt: scalar("DateTime", ({ comment }) => comment.updatedAt),
      url: scalar("URI", ({ comment, pull }) => `${github}/${fullName(pull.repository)}/pull/${pull.number}#discussion_r${comment.id}`),
      author: { type: "Actor", resolve: ({ comment }) => actor(comment.author) },
    }),
  },
  PullRequestChangedFile: {
    implements: [],
    fields: fieldsOf<Pull["files"][number]>({
      path: scalar("String", (file) => file.path),
      additions: scalar("Int", (file) => file.additions),
      deletions: scalar("Int", (file) => file.deletions),
      changeType: scalar("PatchStatus", (file) => ({ added: "ADDED", modified: "MODIFIED", removed: "DELETED", renamed: "RENAMED" })[file.status]),
    }),
  },
  PullRequestCommit: {
    implements: ["Node"],
    fields: fieldsOf<{ sha: string; pull: Pull }>({
      id: scalar("ID", ({ sha, pull }) => `PURC_${pull.id}_${sha.slice(0, 12)}`),
      url: scalar("URI", ({ sha, pull }) => `${github}/${fullName(pull.repository)}/pull/${pull.number}/commits/${sha}`),
      commit: { type: "Commit", resolve: ({ sha, pull }) => commitObj(pull.repository, sha) },
    }),
  },
  ReviewRequest: {
    implements: ["Node"],
    fields: fieldsOf<{ account: Account; pull: Pull }>({
      id: scalar("ID", ({ account, pull }) => `RR_${pull.id}_${account.id}`),
      requestedReviewer: { type: "RequestedReviewer", resolve: ({ account }) => actor(account) },
    }),
  },
  LabeledEvent: eventFields(fieldsOf({ label: detail("Label", labelFromDetails) })),
  UnlabeledEvent: eventFields(fieldsOf({ label: detail("Label", labelFromDetails) })),
  ClosedEvent: eventFields(fieldsOf({ stateReason: detail("IssueStateReason", (details) => (typeof details.state_reason === "string" ? details.state_reason.toUpperCase() : null)) })),
  ReopenedEvent: eventFields(),
  MergedEvent: eventFields(fieldsOf({ commit: detail("Commit", (details, item) => commitObj(item.repository, typeof details.commit_id === "string" ? details.commit_id : null)) })),
  ReadyForReviewEvent: eventFields(),
  ConvertToDraftEvent: eventFields(),
  HeadRefForcePushedEvent: eventFields(),
  ReviewRequestedEvent: eventFields(fieldsOf({ requestedReviewer: detail("RequestedReviewer", (details, _item, ctx) => actor(typeof details.requested_reviewer === "string" ? ctx.world.findAccount(details.requested_reviewer) : undefined)) })),
  CrossReferencedEvent: eventFields(fieldsOf({
    source: detail("ReferencedSubject", (details, _item, ctx) => sourceFromDetails(details, ctx)),
    target: detail("ReferencedSubject", (_details, item) => itemObj(item)),
    willCloseTarget: detail("Boolean", (details) => details.will_close_target === true),
    isCrossRepository: detail("Boolean", (details, item) => typeof details.source === "object" && details.source !== null && "repo" in details.source && String(details.source.repo).toLowerCase() !== fullName(item.repository).toLowerCase()),
    referencedAt: detail("DateTime", (details) => details.referenced_at ?? null),
  })),
};

const abstracts: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Node: { id: "ID" },
  Actor: { login: "String", avatarUrl: "URI", url: "URI", resourcePath: "URI" },
  RepositoryOwner: { id: "ID", login: "String", avatarUrl: "URI", url: "URI", resourcePath: "URI" },
  Assignee: { id: "ID", login: "String", avatarUrl: "URI", url: "URI" },
  GitObject: { id: "ID", oid: "GitObjectID", abbreviatedOid: "String", commitUrl: "URI" },
  UniformResourceLocatable: { url: "URI", resourcePath: "URI" },
  Closable: { closed: "Boolean", closedAt: "DateTime" },
  SearchResultItem: {},
  ReferencedSubject: {},
  IssueOrPullRequest: {},
  RequestedReviewer: {},
  IssueTimelineItems: {},
  PullRequestTimelineItems: {},
};

for (const node of ["PullRequest", "Issue", "Label", "User", "IssueComment", "PullRequestReview", "PullRequestReviewComment", "PullRequestChangedFile", "PullRequestCommit", "Commit", "Ref", "ReviewRequest", "SearchResultItem", "IssueTimelineItems", "PullRequestTimelineItems"]) {
  types[`${node}Connection`] = connectionType(node);
  types[`${node}Edge`] = edgeType(node);
}

function implementsType(concrete: string, abstract: string): boolean {
  return concrete === abstract || (types[concrete]?.implements.includes(abstract) ?? false);
}

function fieldType(type: string, name: string): string | undefined {
  return types[type]?.fields[name]?.type ?? abstracts[type]?.[name];
}

function isComposite(type: string): boolean {
  return type in types || type in abstracts;
}

function refObj(repo: Repository, name: string): Obj | null {
  const sha = repo.branches.get(name);
  return sha === undefined ? null : new Obj("Ref", { repo, name, sha });
}

function numbered(repo: Repository, args: Args, kind: Item["kind"] | undefined): Obj | null {
  const item = repo.items.get(Number(args.number));
  if (item === undefined || (kind !== undefined && item.kind !== kind)) {
    throw new FieldFailure(`Could not resolve to ${kind === "pull" ? "a PullRequest" : kind === "issue" ? "an Issue" : "an issue or pull request"} with the number of ${String(args.number)}.`, "NOT_FOUND");
  }
  return itemObj(item);
}

function ownerByLogin(ctx: GraphQLContext, login: unknown, kind: Account["kind"] | undefined): Obj {
  const account = ctx.world.findAccount(String(login));
  if (account === undefined || (kind !== undefined && account.kind !== kind)) throw new FieldFailure(`Could not resolve to a ${kind ?? "RepositoryOwner"} with the login of '${String(login)}'.`, "NOT_FOUND");
  return new Obj(account.kind, account);
}

function nodeById(ctx: GraphQLContext, id: unknown): Obj {
  const found = ctx.world.node(String(id));
  const missing = new FieldFailure(`Could not resolve to a node with the global id of '${String(id)}'`, "NOT_FOUND");
  if (found === undefined) throw missing;
  const { type, value } = found;
  if (type === "Repository") {
    if (!ctx.visible(value as Repository)) throw missing;
    return new Obj(type, value);
  }
  if (type === "Issue" || type === "PullRequest") {
    if (!ctx.visible((value as Item).repository)) throw missing;
    return new Obj(type, value);
  }
  if (type === "Commit") {
    const repo = ctx.world.repositories().find((candidate) => candidate.commits.get((value as Commit).sha) === value && ctx.visible(candidate));
    if (repo === undefined) throw missing;
    return new Obj(type, { commit: value, repo });
  }
  if (type === "User" || type === "Organization" || type === "Bot") return new Obj(type, value);
  throw new FieldFailure(`The GitHub fake resolves node(id) for repositories, issues, pull requests, commits and accounts, not ${type}.`, "UNSUPPORTED");
}

class Execution {
  readonly errors: GraphQLError[] = [];
  readonly variables: Readonly<Record<string, unknown>>;
  readonly document: Document;
  readonly ctx: GraphQLContext;

  constructor(document: Document, ctx: GraphQLContext, variables: Readonly<Record<string, unknown>>, operation: Operation) {
    this.document = document;
    this.ctx = ctx;
    const values: Record<string, unknown> = {};
    for (const declared of operation.variables) values[declared.name] = declared.name in variables ? variables[declared.name] : declared.fallback === undefined ? null : this.#evaluate(declared.fallback, {});
    this.variables = values;
  }

  #evaluate(value: Value, variables: Readonly<Record<string, unknown>> = this.variables): unknown {
    switch (value.kind) {
      case "variable": return variables[value.name] ?? null;
      case "literal": return value.value;
      case "list": return value.values.map((entry) => this.#evaluate(entry, variables));
      case "object": return Object.fromEntries(value.fields.map(([name, entry]) => [name, this.#evaluate(entry, variables)]));
      default: {
        const _exhaustive: never = value;
        return _exhaustive;
      }
    }
  }

  #included(directives: ReadonlyArray<Directive>): boolean {
    return directives.every((directive) => {
      const condition = this.#evaluate(directive.args.find(([name]) => name === "if")?.[1] ?? { kind: "literal", value: true });
      return directive.name === "include" ? condition === true : directive.name === "skip" ? condition !== true : true;
    });
  }

  validate(selections: ReadonlyArray<Selection>, type: string, path: ReadonlyArray<string>, seen: ReadonlySet<string> = new Set()): void {
    for (const selection of selections) {
      if (selection.kind === "field") {
        if (selection.name === "__typename") continue;
        const declared = fieldType(type, selection.name);
        if (declared === undefined) {
          this.errors.push({ message: `Field '${selection.name}' doesn't exist on type '${type}'`, locations: [selection.at], path: [...path, selection.name], extensions: { code: "undefinedField", typeName: type, fieldName: selection.name } });
          continue;
        }
        if (isComposite(declared) && selection.selections === undefined) this.errors.push({ message: `Field must have selections (field '${selection.name}' returns ${declared} but has no selections.)`, locations: [selection.at], path: [...path, selection.name] });
        else if (!isComposite(declared) && selection.selections !== undefined) this.errors.push({ message: `Selections can't be made on scalars (field '${selection.name}' returns ${declared} but has selections [...])`, locations: [selection.at], path: [...path, selection.name] });
        else if (selection.selections !== undefined) this.validate(selection.selections, declared, [...path, selection.alias ?? selection.name], seen);
        continue;
      }
      const fragment = selection.kind === "spread" ? this.document.fragments.get(selection.name) : { on: selection.on ?? type, selections: selection.selections };
      if (fragment === undefined) {
        this.errors.push({ message: `Fragment ${selection.kind === "spread" ? selection.name : ""} was used, but not defined`, locations: [selection.at], path: [...path] });
        continue;
      }
      if (!isComposite(fragment.on)) {
        this.errors.push({ message: `No such type ${fragment.on}, so it can't be a fragment condition`, locations: [selection.at], path: [...path] });
        continue;
      }
      const key = selection.kind === "spread" ? `${selection.name}@${type}` : "";
      if (key !== "" && seen.has(key)) continue;
      this.validate(fragment.selections, fragment.on, path, key === "" ? seen : new Set([...seen, key]));
    }
  }

  #collect(selections: ReadonlyArray<Selection>, type: string, into: Map<string, Array<Extract<Selection, { kind: "field" }>>>): void {
    for (const selection of selections) {
      if (!this.#included(selection.directives)) continue;
      if (selection.kind === "field") {
        const key = selection.alias ?? selection.name;
        into.set(key, [...into.get(key) ?? [], selection]);
        continue;
      }
      const fragment = selection.kind === "spread" ? this.document.fragments.get(selection.name) : { on: selection.on ?? type, selections: selection.selections };
      if (fragment !== undefined && implementsType(type, fragment.on)) this.#collect(fragment.selections, type, into);
    }
  }

  select(obj: Obj, selections: ReadonlyArray<Selection>, path: ReadonlyArray<string | number>): Record<string, unknown> {
    const fields = new Map<string, Array<Extract<Selection, { kind: "field" }>>>();
    this.#collect(selections, obj.type, fields);
    const result: Record<string, unknown> = {};
    for (const [key, group] of fields) {
      const [field] = group;
      if (field === undefined) continue;
      if (field.name === "__typename") {
        result[key] = obj.type;
        continue;
      }
      const spec = types[obj.type]?.fields[field.name];
      if (spec === undefined) {
        result[key] = null;
        this.errors.push({ message: `Field '${field.name}' doesn't exist on type '${obj.type}'`, path: [...path, key], extensions: { code: "undefinedField", typeName: obj.type, fieldName: field.name } });
        continue;
      }
      const merged = group.flatMap((entry) => entry.selections ?? []);
      try {
        const args = Object.fromEntries(field.args.map(([name, value]) => [name, this.#evaluate(value)]));
        result[key] = this.#complete(spec.resolve(obj.value, args, this.ctx), merged, [...path, key]);
      } catch (error) {
        if (!(error instanceof FieldFailure)) throw error;
        result[key] = null;
        this.errors.push({ message: error.message, type: error.type, path: [...path, key], locations: [field.at] });
      }
    }
    return result;
  }

  #complete(value: unknown, selections: ReadonlyArray<Selection>, path: ReadonlyArray<string | number>): unknown {
    if (value instanceof FieldFailure) {
      this.errors.push({ message: value.message, type: value.type, path: [...path] });
      return null;
    }
    if (Array.isArray(value)) return value.map((entry: unknown, index) => this.#complete(entry, selections, [...path, index]));
    if (value instanceof Obj) return this.select(value, selections, path);
    return value ?? null;
  }
}

/** @throws {never} */
export function graphql(request: unknown, ctx: GraphQLContext): { readonly data?: unknown; readonly errors?: ReadonlyArray<GraphQLError> } {
  const body = typeof request === "object" && request !== null ? request as Record<string, unknown> : {};
  if (typeof body.query !== "string") return { errors: [{ message: "A query attribute must be specified and must be a string." }] };
  let document: Document;
  try {
    document = new Parser(tokenize(body.query)).document();
  } catch (error) {
    if (error instanceof Syntax) return { errors: [{ message: error.message }] };
    throw error;
  }
  const name = typeof body.operationName === "string" ? body.operationName : undefined;
  const operation = name === undefined ? document.operations[0] : document.operations.find((candidate) => candidate.name === name);
  if (operation === undefined || (name === undefined && document.operations.length > 1)) return { errors: [{ message: "An operation name is required" }] };
  if (operation.type !== "query") return { errors: [{ message: `The GitHub fake answers queries only, not ${operation.type}.`, extensions: { code: "unsupportedOperation" } }] };
  const variables = typeof body.variables === "object" && body.variables !== null ? body.variables as Record<string, unknown> : {};
  const execution = new Execution(document, ctx, variables, operation);
  execution.validate(operation.selections, "Query", ["query"]);
  if (execution.errors.length > 0) return { errors: execution.errors };
  const data = execution.select(new Obj("Query", undefined), operation.selections, []);
  return execution.errors.length === 0 ? { data } : { data, errors: execution.errors };
}
