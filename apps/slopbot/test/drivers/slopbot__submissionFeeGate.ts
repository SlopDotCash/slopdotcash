// spec/slopbot/submissionFeeGate.md, "Story: Ask an outside contributor's deposit before the review, and never close for it"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import type { D1Database } from "@repo/platform/bindings";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { github } from "@repo/platform/github";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { type GitHubFake, githubFake } from "@repo/platform/testing/github";
import { migrationsDir } from "@repo/platform/testing/paths";
import { type ProjectView, Registry, RegistryManifests, Restrictions, SubmissionFeeRates, SubmissionFeeSetting } from "@repo/ports/backend";
import { Enforcement } from "@repo/ports/security";
import type { StoredFeeSetting } from "../../gen/backend__submissionFeeSettings.ts";
import type { Driver, Options } from "../../gen/slopbot__submissionFeeGate.conformance.ts";
import type { Event, FeeFacts, FeeGate, GateState, PullFacts, Settlement } from "../../gen/slopbot__submissionFeeGate.ts";
import { dispatchFeeChecks } from "../../src/fee/dispatch.vibe";
import { gateSubmissionFee } from "../../src/fee/gate.vibe";
import { refreshSubmissionFee } from "../../src/fee/refresh.vibe";
import { SubmissionFeeMode, handBackLease } from "../../src/fee/store.vibe";
import { webhookSettings } from "../../src/ingress/webhook.vibe";
import { type Job, JobQueue } from "../../src/jobs/job.vibe";

type Observed = Pick<FeeGate, "gate" | "labelNeeded" | "labelPaid"> & { readonly present: boolean; readonly paid: boolean; readonly settlement: Settlement };

interface Held {
  readonly fake: GitHubFake;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly clock: ReturnType<typeof settableClock>;
  readonly db: D1Database;
  readonly number: number;
  now: number;
  mode: FeeFacts["mode"];
  manifest: string;
  since: string | null;
  contributor: boolean;
  hidden: boolean;
  failLabels: boolean;
  report: Record<string, unknown>;
}

const start = 1793491200;
const keys = ["a", "b"];
const repo = "ada/widgets";
const repositoryId = 8301;
const installationId = 9501;
const projectId = "fee-project";
const states: Readonly<Record<string, GateState>> = { recorded: "Recorded", asking: "Asking", asked: "Asked", paid: "Paid", released: "Released" };
const settlements: Readonly<Record<string, Settlement>> = { refund_due: "RefundDue", kept_due: "KeptDue", refunded: "Refunded", kept: "Kept" };
const finals: Readonly<Record<Settlement, string | null>> = { NoSettlement: null, RefundDue: null, KeptDue: null, Refunded: "refunded", Kept: "kept" };

const mf = startWorker({ d1: { FEE_A: "fee-gate-conformance-a", FEE_B: "fee-gate-conformance-b" } });
const databases = new Map<string, D1Database>();
for (const [key, binding] of [["a", "FEE_A"], ["b", "FEE_B"]] as const) {
  const failed = (await migrate(mf, binding, migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  databases.set(key, await database(mf, binding));
}

const held = new Map<string, Held>();

function iso(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

function viewOf(state: Held): ProjectView {
  const status = state.contributor ? "Active" : "Paused";
  return {
    projectId, revision: 1, manifestSha256: "0".repeat(64), rowStatus: status, manifestStatus: status, listingTier: "Community",
    retirement: "NotRetired", stewardGithubId: "100", stewardAccount: "UserSteward", listing: { fromApplication: false },
    repositories: [{ id: String(repositoryId), nodeId: `R_${repositoryId}`, fullName: repo, integrationBranch: "main", aliases: [] }], closureConsent: false,
  };
}

function settingValue(setting: StoredFeeSetting): Record<string, unknown> | undefined {
  if (!setting.present) return undefined;
  const amount = !setting.amountGiven ? {} : { amountMinor: setting.amountWellFormed ? String(setting.amountMinor) : "not-a-number" };
  return { enabled: setting.enabled, ...amount, ...(setting.exactShape ? {} : { extra: true }) };
}

function handlerOf(state: () => Held, fake: GitHubFake) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const current = state();
    const path = new URL(request.url).pathname;
    if (current.failLabels && request.method === "POST" && path.endsWith("/labels")) return new Response("{\"message\":\"unavailable\"}", { status: 500 });
    if (request.method !== "GET" || !path.endsWith(`/pulls/${current.number}`)) return fake.handler(request);
    if (current.hidden) return new Response("{\"message\":\"Not Found\"}", { status: 404 });
    const answer = await fake.handler(request);
    if (answer.status !== 200) return answer;
    const pull = (await answer.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...pull, ...current.report }), { status: 200, headers: answer.headers });
  };
}

async function started(key: string): Promise<Held> {
  const db = databases.get(key);
  if (db === undefined) throw new Error(`no database for ${key}`);
  for (const table of ["slopbot_fee_gates", "submission_fee_items", "slopbot_installations"]) await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("INSERT INTO slopbot_installations (installation_id, account_id, account_login, account_type, created_at, source_updated_at) VALUES (?, 100, 'ada', 'User', ?, 1)").bind(installationId, iso(start)).run();
  const fake = githubFake();
  const world = fake.world;
  world.addUser({ id: 100, login: "ada" });
  world.addUser({ id: 301, login: "carol" });
  world.addRepo({ id: repositoryId, owner: "ada", name: "widgets" });
  world.addInstallation({ id: installationId, account: "ada", repositories: "all", permissions: { metadata: "read", issues: "write", pull_requests: "write" } });
  const number = world.addPull({ repo, author: "carol", title: "Fee check", headSha: "1".padStart(40, "0") });
  let state: Held | undefined;
  function current(): Held {
    if (state === undefined) throw new Error("the driver state is not ready");
    return state;
  }
  const clock = settableClock(start * 1000);
  const ports = Layer.mergeAll(
    Layer.succeed(Registry, {
      project: () => Effect.sync(() => viewOf(current())),
      byRepository: () => Effect.sync(() => viewOf(current())),
      byPath: (fullName: string) => Effect.sync(() => (fullName.toLowerCase() === repo ? { match: "CurrentPath" as const, registeredRepositoryId: String(repositoryId), project: viewOf(current()) } : undefined)),
      active: () => Effect.sync(() => [viewOf(current())]),
      pausedProjects: () => Effect.succeed([]),
      appendVaultRegistration: () => Effect.die(new Error("the fee driver registers no vault")),
      fence: () => Effect.die(new Error("the fee driver writes no registry fence")),
    }),
    Layer.succeed(RegistryManifests, {
      current: () => Effect.sync(() => [manifestRow()]),
      project: () => Effect.sync(() => manifestRow()),
    }),
    Layer.succeed(Restrictions, {
      account: () => Effect.succeed({ banned: false }),
      project: () => Effect.succeed({ restricted: false }),
      fence: () => Effect.die(new Error("the fee driver writes no restriction fence")),
      unbanned: () => Effect.die(new Error("the fee driver writes no restriction fence")),
    }),
    Layer.succeed(Enforcement, {
      project: () => Effect.succeed({ restriction: "Clear" as const, enforcementGeneration: 0, clearanceGeneration: "0" }),
      fence: () => Effect.die(new Error("the fee driver writes no enforcement fence")),
    }),
    Layer.succeed(SubmissionFeeRates, {
      all: () => Effect.succeed([]),
      newest: () => Effect.succeed(null),
      append: () => Effect.die(new Error("the fee driver appends no rate")),
    }),
    Layer.succeed(SubmissionFeeSetting, { since: () => Effect.sync(() => current().since) }),
    Layer.succeed(SubmissionFeeMode, { get mode() { return current().mode; } }),
    Layer.succeed(JobQueue, { send: (_job: Job) => Effect.void }),
  );
  function manifestRow() {
    return { projectId, active: true, revision: 1, manifest: current().manifest, manifestSha256: "0".repeat(64), updatedAt: iso(start) };
  }
  const http = Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, handlerOf(current, fake) as typeof globalThis.fetch));
  const githubLayer = Layer.provide(github({ authority: fake.authority, token: Redacted.make(fake.tokens.installation(installationId)), userAgent: "slopbot-fee-conformance" }), http);
  const settings = webhookSettings({ SLOPBOT_WEBHOOK_SECRET: "fee-conformance-secret", SLOPBOT_APP_USER_ID: String(fake.app.bot.id) });
  const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, ports, githubLayer, settings)) as unknown as ManagedRuntime.ManagedRuntime<never, never>;
  state = { fake, runtime, clock, db, number, now: start, mode: "FeeLive", manifest: JSON.stringify({ id: projectId }), since: null, contributor: true, hidden: false, failLabels: false, report: {} };
  return state;
}

async function stateOf(key: string): Promise<Held> {
  const found = held.get(key);
  if (found !== undefined) return found;
  const made = await started(key);
  held.set(key, made);
  return made;
}

function realizeFacts(state: Held, facts: FeeFacts) {
  state.mode = facts.contractPublished ? facts.mode : "FeeOff";
  const submissionFee = settingValue(facts.feeSetting);
  state.manifest = JSON.stringify({ id: projectId, slopbot: submissionFee === undefined ? {} : { submissionFee } });
  state.since = facts.settingSince > 0 ? iso(facts.settingSince) : null;
  state.report = { ...state.report, created_at: iso(Math.max(1, facts.openedAt)) };
}

async function realizePull(state: Held, pull: PullFacts) {
  state.contributor = pull.contributorScope;
  state.hidden = !pull.readable;
  state.report = { ...state.report, state: pull.open && !pull.merged ? "open" : "closed", merged: pull.merged, draft: pull.draft, closed_at: pull.closedAt > 0 ? iso(pull.closedAt) : null };
  await state.db.prepare("UPDATE slopbot_installations SET removed_at = ? WHERE installation_id = ?").bind(pull.installationActive ? null : iso(start), installationId).run();
}

function jobOf(state: Held) {
  return { kind: "submission_fee" as const, deliveryId: `fee-${state.now}`, installationId, repositoryId, owner: "ada", repo: "widgets", itemKind: "pull_request" as const, number: state.number };
}

function pullOf(state: Held) {
  return { installationId, repositoryId, owner: "ada", repo: "widgets", number: state.number };
}

async function run<A>(state: Held, program: Effect.Effect<A, unknown, unknown>) {
  state.clock.set(state.now * 1000);
  return state.runtime.runPromiseExit(program as Effect.Effect<A, unknown, never>);
}

async function gateRow(state: Held) {
  return state.db.prepare("SELECT state, updated_at, next_check_at FROM slopbot_fee_gates WHERE repository_id = ? AND pull_number = ?").bind(repositoryId, state.number).first<{ state: string; updated_at: string; next_check_at: string | null }>();
}

async function gated(state: Held, facts: FeeFacts) {
  realizeFacts(state, facts);
  return run(state, gateSubmissionFee({ target: { pull: pullOf(state), projectId, itemNodeId: "", appUser: state.fake.app.bot.id }, exemption: facts.exemption, mayAsk: facts.mayAsk }));
}

async function refreshed(state: Held, facts: FeeFacts, pull: PullFacts) {
  realizeFacts(state, facts);
  await realizePull(state, pull);
  const exit = await run(state, refreshSubmissionFee(jobOf(state)));
  return exit._tag === "Success" ? exit.value.outcome : "failed";
}

async function worker(state: Held, statement: string, ...values: unknown[]) {
  const result = await state.db.prepare(statement).bind(...values).run();
  return (result.meta.changes ?? 0) === 1 ? "accepted" : "refused";
}

function verdict(accepted: boolean): "accepted" | "refused" {
  return accepted ? "accepted" : "refused";
}

async function dispatched(key: string, event: Event): Promise<"accepted" | "refused"> {
  const state = await stateOf(key);
  const before = await gateRow(state);
  switch (event.type) {
    case "elapse":
      if (event.seconds <= 0) return "refused";
      state.now += event.seconds;
      return "accepted";
    case "record":
      await gated(state, event.facts);
      return verdict(before === null && (await gateRow(state))?.state === "recorded");
    case "claimAsk": {
      state.failLabels = true;
      await gated(state, event.facts);
      state.failLabels = false;
      const after = await gateRow(state);
      const claimed = after?.state === "asking" && after.updated_at !== before?.updated_at;
      if (claimed) await state.db.prepare("UPDATE slopbot_fee_gates SET updated_at = ? WHERE repository_id = ? AND pull_number = ?").bind(iso(state.now), repositoryId, state.number).run();
      return verdict(claimed);
    }
    case "failAsk": {
      if (before?.state !== "asking" || Date.parse(before.updated_at) <= (state.now - 600) * 1000) return "refused";
      const exit = await run(state, handBackLease(pullOf(state), before.updated_at, iso(Math.floor(Date.parse(before.updated_at) / 1000) - 600)));
      return verdict(exit._tag === "Success");
    }
    case "confirmAsk": {
      if (event.commentId <= 0 || before?.state !== "asking") return "refused";
      await state.db.prepare("UPDATE slopbot_fee_gates SET updated_at = ? WHERE repository_id = ? AND pull_number = ?").bind(iso(state.now - 601), repositoryId, state.number).run();
      const exit = await run(state, gateSubmissionFee({ target: { pull: pullOf(state), projectId, itemNodeId: "", appUser: state.fake.app.bot.id }, exemption: "NotExempt", mayAsk: true }));
      return verdict(exit._tag === "Success" && (await gateRow(state))?.state === "asked");
    }
    case "release":
      if (event.commentId <= 0) return "refused";
      await gated(state, event.facts);
      return verdict(before?.state !== "released" && (await gateRow(state))?.state === "released");
    case "releaseChecked":
      if (event.commentId <= 0) return "refused";
      return verdict((await refreshed(state, event.facts, event.pull)) === "submission fee released: setting off");
    case "deferCheck":
      return verdict((await refreshed(state, event.facts, event.pull)) === "submission fee ask in progress");
    case "refreshPaid": {
      if (event.commentId <= 0) return "refused";
      const outcome = await refreshed(state, event.facts, event.pull);
      return verdict(outcome === "submission fee paid" || outcome.startsWith("submission fee: "));
    }
    case "askAgain":
      if (event.commentId <= 0) return "refused";
      return verdict((await refreshed(state, event.facts, event.pull)) === "submission fee payment withdrawn; asked again");
    case "clearCheck":
      return verdict((await refreshed(state, event.facts, event.pull)) === "submission fee not paid");
    case "observePaid":
      if (event.paidAt <= 0) return "refused";
      return worker(state, "UPDATE submission_fee_items SET paid_at = ?, paid_network = 'base-mainnet', paid_deposit_id = 1 WHERE repository_id = ? AND pull_number = ? AND paid_at IS NULL", iso(event.paidAt), repositoryId, state.number);
    case "observeWithdrawn":
      return worker(state, "UPDATE submission_fee_items SET paid_at = NULL, paid_network = NULL, paid_deposit_id = NULL WHERE repository_id = ? AND pull_number = ? AND paid_at IS NOT NULL AND outcome IS NULL", repositoryId, state.number);
    case "observeSettled": {
      const final = finals[event.settledAs];
      if (final === null) return "refused";
      return worker(state, "UPDATE submission_fee_items SET outcome = ?, outcome_at = ? WHERE repository_id = ? AND pull_number = ? AND paid_at IS NOT NULL AND outcome = ?", final, iso(state.now), repositoryId, state.number, final === "refunded" ? "refund_due" : "kept_due");
    }
    case "dispatch": {
      realizeFacts(state, event.facts);
      const exit = await run(state, dispatchFeeChecks());
      return verdict(exit._tag === "Success" && exit.value === 1);
    }
  }
}

async function observed(key: string): Promise<Observed> {
  const state = await stateOf(key);
  const gate = await gateRow(state);
  const item = await state.db.prepare("SELECT paid_at, outcome FROM submission_fee_items WHERE repository_id = ? AND pull_number = ?").bind(repositoryId, state.number).first<{ paid_at: string | null; outcome: string | null }>();
  const labels = state.fake.world.pull(repo, state.number).labels;
  return {
    gate: gate === null ? "NoGate" : states[gate.state] ?? "NoGate",
    present: item !== null,
    paid: item?.paid_at !== null && item !== null,
    settlement: item?.outcome === null || item === null ? "NoSettlement" : settlements[item.outcome] ?? "NoSettlement",
    labelNeeded: labels.some((label) => label.name === "slopbot:fee-needed"),
    labelPaid: labels.some((label) => label.name === "slopbot:fee-paid"),
  };
}

function view(state: FeeGate): Observed {
  return { gate: state.gate, present: state.feeItem.present, paid: state.feeItem.paid, settlement: state.feeItem.settlement, labelNeeded: state.labelNeeded, labelPaid: state.labelPaid };
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
