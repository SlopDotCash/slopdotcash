// spec/slopbot/readyLabel.md, "Story: Label a pull request ready only while every condition holds at its head"
import { Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import type { D1Database } from "@repo/platform/bindings";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { github } from "@repo/platform/github";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { type GitHubFake, githubFake } from "@repo/platform/testing/github";
import { migrationsDir } from "@repo/platform/testing/paths";
import { type ProjectView, Registry, RegistryManifests, Restrictions } from "@repo/ports/backend";
import { Enforcement } from "@repo/ports/security";
import type { Driver, Options } from "../../gen/slopbot__readyLabel.conformance.ts";
import type { Event, MergeState, ReadyLine, ReadyObservation, ReadyPull, RowState } from "../../gen/slopbot__readyLabel.ts";
import { webhookSettings } from "../../src/ingress/webhook.vibe";
import { type Job, JobQueue } from "../../src/jobs/job.vibe";
import { refreshReadyLabel } from "../../src/ready/refresh.vibe";
import { dispatchReadyChecks } from "../../src/ready/store.vibe";

const ReadyRow = Schema.Struct({ state: Schema.String, next_check_at: Schema.NullOr(Schema.String) });

type Observed = Pick<ReadyPull, "pr" | "row" | "labelled" | "line" | "nextCheckAt">;

interface Held {
  readonly fake: GitHubFake;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly clock: ReturnType<typeof settableClock>;
  readonly db: D1Database;
  readonly number: number;
  readonly commentId: number;
  now: number;
  heads: number;
  manifest: string;
  contributor: boolean;
  hidden: boolean;
  hiddenComment: boolean;
  report: Record<string, unknown>;
  atWrite: ReadyObservation["headAtWrite"];
  reads: number;
}

const base = Date.parse("2026-11-01T00:00:00.000Z");
const keys = ["a", "b"];
const repo = "ada/widgets";
const repositoryId = 8201;
const installationId = 9401;
const marker = "<!-- slopbot:review -->";
const readyMarker = "<!-- slopbot:ready -->";
const states: Readonly<Record<string, RowState>> = { ready: "ReadyRow", "not-ready": "NotReadyRow", off: "OffRow" };
const mergeStates: Readonly<Record<MergeState, string | null>> = {
  MergeClean: "clean", MergeHasHooks: "has_hooks", MergeUnknown: "unknown", MergeUnstable: "unstable", MergeBlocked: "blocked",
  MergeBehind: "behind", MergeDirty: "dirty", MergeDraft: "draft", MergeNotReported: null,
};
const statuses = { FileAdded: "added", FileModified: "modified", FileRemoved: "removed", FileRenamed: "renamed", FileOther: "modified" } as const;

const mf = startWorker({ d1: { READY_A: "ready-label-conformance-a", READY_B: "ready-label-conformance-b" } });
const databases = new Map<string, D1Database>();
for (const [key, binding] of [["a", "READY_A"], ["b", "READY_B"]] as const) {
  const failed = (await migrate(mf, binding, migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  databases.set(key, await database(mf, binding));
}

const held = new Map<string, Held>();

function headOf(state: Held, count = state.heads) {
  return count.toString(16).padStart(40, "0");
}

function viewOf(state: Held): ProjectView {
  const status = state.contributor ? "Active" : "Paused";
  return {
    projectId: "ready-project", revision: 1, manifestSha256: "0".repeat(64), rowStatus: status, manifestStatus: status, listingTier: "Community",
    retirement: "NotRetired", stewardGithubId: "100", stewardAccount: "UserSteward", listing: { fromApplication: false },
    repositories: [{ id: String(repositoryId), nodeId: `R_${repositoryId}`, fullName: repo, integrationBranch: "main", aliases: [] }], closureConsent: false,
  };
}

function handlerOf(state: () => Held, fake: GitHubFake) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const current = state();
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path.endsWith(`/issues/comments/${current.commentId}`) && current.hiddenComment) return new Response("{\"message\":\"Not Found\"}", { status: 404 });
    if (request.method !== "GET" || !path.endsWith(`/pulls/${current.number}`)) return fake.fetch(request);
    if (current.hidden) return new Response("{\"message\":\"Not Found\"}", { status: 404 });
    current.reads++;
    if (current.reads === 2 && current.atWrite === "UnreadableHead") return new Response("{\"message\":\"Not Found\"}", { status: 404 });
    if (current.reads === 2 && current.atWrite === "MovedHead") {
      current.heads++;
      Object.assign(fake.world.pull(repo, current.number), { headSha: headOf(current) });
    }
    const answer = await fake.fetch(request);
    if (answer.status !== 200) return answer;
    const pull = (await answer.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...pull, ...current.report }), { status: 200, headers: answer.headers });
  };
}

async function started(key: string): Promise<Held> {
  const db = databases.get(key);
  if (db === undefined) throw new Error(`no database for ${key}`);
  for (const table of ["slopbot_ready_labels", "slopbot_reviews", "slopbot_item_comments", "slopbot_installations"]) await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("INSERT INTO slopbot_installations (installation_id, account_id, account_login, account_type, created_at, source_updated_at) VALUES (?, 100, 'ada', 'User', ?, 1)").bind(installationId, new Date(base).toISOString()).run();
  const fake = githubFake();
  const world = fake.world;
  world.addUser({ id: 100, login: "ada" });
  world.addUser({ id: 301, login: "carol" });
  world.addUser({ id: 302, login: "maya" });
  world.addRepo({ id: repositoryId, owner: "ada", name: "widgets" });
  world.setPermission(repo, "maya", "write");
  world.addInstallation({ id: installationId, account: "ada", repositories: "all", permissions: { metadata: "read", issues: "write", pull_requests: "write" } });
  const number = world.addPull({ repo, author: "carol", title: "Ready check", headSha: "1".padStart(40, "0") });
  const commentId = world.addComment(repo, number, { author: fake.app.bot.login, body: `${marker}\n### Slopbot review\n\nNo finding.` });
  await db.prepare("INSERT INTO slopbot_item_comments (item_node_id, repository_id, comment_id) VALUES (?, ?, ?)").bind(world.pull(repo, number).nodeId, repositoryId, commentId).run();
  let state: Held | undefined;
  const clock = settableClock(base + 1000);
  const queue = Layer.succeed(JobQueue, { send: (_job: Job) => Effect.void });
  const ports = Layer.mergeAll(
    Layer.succeed(Registry, {
      project: () => Effect.sync(() => viewOf(current())),
      byRepository: () => Effect.sync(() => viewOf(current())),
      byPath: (fullName: string) => Effect.sync(() => (fullName.toLowerCase() === repo ? { match: "CurrentPath" as const, registeredRepositoryId: String(repositoryId), project: viewOf(current()) } : undefined)),
      active: () => Effect.sync(() => [viewOf(current())]),
      pausedProjects: () => Effect.succeed([]),
      appendVaultRegistration: () => Effect.die(new Error("the ready-label driver registers no vault")),
      fence: () => Effect.die(new Error("the ready-label driver writes no registry fence")),
    }),
    Layer.succeed(RegistryManifests, {
      current: () => Effect.sync(() => [manifestRow()]),
      project: () => Effect.sync(() => manifestRow()),
    }),
    Layer.succeed(Restrictions, {
      account: () => Effect.succeed({ banned: false }),
      project: () => Effect.succeed({ restricted: false }),
      fence: () => Effect.die(new Error("the ready-label driver writes no restriction fence")),
      unbanned: () => Effect.die(new Error("the ready-label driver writes no restriction fence")),
    }),
    Layer.succeed(Enforcement, {
      project: () => Effect.succeed({ restriction: "Clear" as const, enforcementGeneration: 0, clearanceGeneration: "0" }),
      fence: () => Effect.die(new Error("the ready-label driver writes no enforcement fence")),
    }),
  );
  function current(): Held {
    if (state === undefined) throw new Error("the driver state is not ready");
    return state;
  }
  function manifestRow() {
    return { projectId: "ready-project", active: true, revision: 1, manifest: current().manifest, manifestSha256: "0".repeat(64), updatedAt: new Date(base).toISOString() };
  }
  const http = Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, handlerOf(current, fake) as typeof globalThis.fetch));
  const githubLayer = Layer.provide(github({ authority: fake.authority, token: Redacted.make(fake.tokens.installation(installationId)), userAgent: "slopbot-ready-conformance" }), http);
  const settings = webhookSettings({ SLOPBOT_WEBHOOK_SECRET: "ready-conformance-secret", SLOPBOT_APP_USER_ID: String(fake.app.bot.id) });
  const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, queue, ports, githubLayer, settings)) as unknown as ManagedRuntime.ManagedRuntime<never, never>;
  state = { fake, runtime, clock, db, number, commentId, now: 1, heads: 1, manifest: JSON.stringify({ id: "ready-project" }), contributor: true, hidden: false, hiddenComment: false, report: {}, atWrite: "SameHead", reads: 0 };
  return state;
}

async function stateOf(key: string): Promise<Held> {
  const found = held.get(key);
  if (found !== undefined) return found;
  const made = await started(key);
  held.set(key, made);
  return made;
}

function pullOf(state: Held) {
  return state.fake.world.pull(repo, state.number);
}

function openOf(state: Held) {
  const pull = pullOf(state);
  return pull.state === "open" && pull.mergedAt === null;
}

async function realize(state: Held, observed: ReadyObservation) {
  const { facts, settings } = observed;
  const world = state.fake.world;
  const pull = pullOf(state);
  const head = headOf(state);
  state.manifest = JSON.stringify(observed.saved
    ? { id: "ready-project", slopbot: { readyLabel: { enabled: settings.enabled, approvals: settings.approvals, maxChangedLines: settings.maxChangedLines, maxChangedFiles: settings.maxChangedFiles, protectedPaths: settings.protectedPaths.map((path) => path.pattern) } } }
    : { id: "ready-project" });
  state.contributor = observed.contributorWork;
  state.hidden = !observed.pullReadable;
  state.hiddenComment = !observed.commentFound;
  state.atWrite = observed.headAtWrite;
  state.reads = 0;
  state.report = { mergeable: facts.mergeable, mergeable_state: mergeStates[facts.mergeState], additions: facts.additions, deletions: facts.deletions, changed_files: facts.changedFiles };
  await state.db.prepare("UPDATE slopbot_installations SET removed_at = ? WHERE installation_id = ?").bind(observed.installationActive ? null : new Date(base).toISOString(), installationId).run();
  const files = facts.files.map((file, index) => ({
    path: file.defaultProtected ? `package${index}/package.json` : `src/file${index}.ts`,
    additions: file.lines,
    deletions: 0,
    status: statuses[file.change],
    ...(file.patched ? { patch: "@@ -1 +1 @@" } : {}),
  }));
  Object.assign(pull, { draft: facts.draft, files });
  pull.reviews.splice(0, pull.reviews.length);
  for (let index = 0; index < facts.approvals; index++) world.addReview(repo, state.number, { author: "maya", state: "APPROVED", commitId: head });
  if (facts.changesRequested) world.addReview(repo, state.number, { author: "maya", state: "CHANGES_REQUESTED", commitId: head });
  await state.db.prepare("DELETE FROM slopbot_reviews WHERE revision = ?").bind(head).run();
  const row = facts.verdict === "VerdictMissing" ? undefined
    : facts.verdict === "VerdictRunning" ? { status: "running", verdict: null }
    : { status: "completed", verdict: JSON.stringify({ category: facts.verdict === "VerdictFinding" ? "spam" : "none", limitations: facts.verdict === "VerdictLimited" ? ["unread"] : [] }) };
  if (row !== undefined)
    await state.db.prepare("INSERT INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number, item_node_id, author_id, revision, content_digest, policy_digest, status, verdict, action, created_at) VALUES (?, ?, ?, 'pull_request', ?, ?, 301, ?, 'content', 'policy', ?, ?, 'comment', ?)")
      .bind(`ready-${head}`, installationId, repositoryId, state.number, pull.nodeId, head, row.status, row.verdict, new Date(base).toISOString()).run();
}

async function run<A>(state: Held, program: Effect.Effect<A, unknown, unknown>) {
  state.clock.set(base + state.now * 1000);
  return state.runtime.runPromiseExit(program as Effect.Effect<A, unknown, never>);
}

async function dispatched(key: string, event: Event): Promise<"accepted" | "refused"> {
  const state = await stateOf(key);
  const pull = pullOf(state);
  switch (event.type) {
    case "refresh": {
      if (event.observed.facts.open !== openOf(state)) return "refused";
      await realize(state, event.observed);
      const exit = await run(state, refreshReadyLabel({ kind: "ready_label", deliveryId: `ready-${key}-${state.now}`, installationId, repositoryId, owner: "ada", repo: "widgets", itemKind: "pull_request", number: state.number }));
      return exit._tag === "Success" ? "accepted" : "refused";
    }
    case "pushCommit":
      if (!openOf(state)) return "refused";
      state.heads++;
      Object.assign(pull, { headSha: headOf(state) });
      return "accepted";
    case "closePull":
      if (!openOf(state)) return "refused";
      Object.assign(pull, { state: "closed", closedAt: new Date(base + state.now * 1000).toISOString() });
      return "accepted";
    case "reopenPull":
      if (openOf(state) || pull.mergedAt !== null) return "refused";
      Object.assign(pull, { state: "open", closedAt: null });
      return "accepted";
    case "humanMerge":
      if (!openOf(state)) return "refused";
      Object.assign(pull, { state: "closed", mergedAt: new Date(base + state.now * 1000).toISOString() });
      return "accepted";
    case "elapse":
      if (event.seconds <= 0) return "refused";
      state.now += event.seconds;
      return "accepted";
    case "claimDue": {
      const exit = await run(state, dispatchReadyChecks());
      return exit._tag === "Success" && exit.value === 1 ? "accepted" : "refused";
    }
  }
}

function seconds(iso: unknown) {
  return typeof iso === "string" ? (Date.parse(iso) - base) / 1000 : 0;
}

function lineOf(body: string): ReadyLine {
  const line = body.split("\n").find((entry) => entry.startsWith(readyMarker));
  return line === undefined ? "NoReadyLine" : line.startsWith(`${readyMarker} **Labelled`) ? "LabelledLine" : "NotLabelledLine";
}

async function observed(key: string): Promise<Observed> {
  const state = await stateOf(key);
  const pull = pullOf(state);
  const [found] = (await state.db.prepare("SELECT state, next_check_at FROM slopbot_ready_labels WHERE repository_id = ? AND pull_number = ?").bind(repositoryId, state.number).all()).results;
  const row = found === undefined ? null : Schema.decodeUnknownSync(ReadyRow)(found);
  const comment = pull.comments.find((entry) => entry.id === state.commentId);
  return {
    pr: pull.mergedAt !== null ? "PullMerged" : pull.state === "open" ? "PullOpen" : "PullClosed",
    row: row === null ? "NoReadyRow" : states[row.state] ?? "NoReadyRow",
    labelled: pull.labels.some((label) => label.name === "slopbot:ready"),
    line: lineOf(comment?.body ?? ""),
    nextCheckAt: seconds(row?.next_check_at ?? null),
  };
}

function view(state: ReadyPull): Observed {
  return { pr: state.pr, row: state.row, labelled: state.labelled, line: state.line, nextCheckAt: state.nextCheckAt };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: async () => {
    for (const state of held.values()) await state.runtime.dispose();
    held.clear();
  },
  dispatch: (key, event: Event) => dispatched(key, event),
  observe: (key) => observed(key),
  [Symbol.asyncDispose]: async () => {
    for (const state of held.values()) await state.runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys, view, walks: 4, steps: 12 };
