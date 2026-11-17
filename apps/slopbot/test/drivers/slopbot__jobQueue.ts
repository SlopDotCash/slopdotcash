// spec/slopbot/jobQueue.md, "Story: Deliver a job at least once and stop after the retry limit"
import { Effect, Layer, ManagedRuntime } from "effect";
import type { QueueMessage } from "@repo/platform/bindings";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/slopbot__jobQueue.conformance.ts";
import type { Copy, Durable, Event, JobKind, JobQueue as Queue } from "../../gen/slopbot__jobQueue.ts";
import { type DueTable, dueJobs, markDispatched } from "../../src/jobs/due.vibe";
import { type Job, JobQueue, send } from "../../src/jobs/job.vibe";
import { type Handled, ReviewBusy, maxRetries, settle } from "../../src/jobs/retry.vibe";

const base = Date.parse("2026-11-01T00:00:00.000Z");
const clock = settableClock(base);
const mf = startWorker({ d1: { SLOPBOT_DB: "job-queue-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");

type Observed = { readonly settled: ReadonlyArray<string>; readonly durable: Durable };
interface Message { readonly job: Job; status: "pending" | "inFlight" | "acked" | "deadLettered"; deliveries: number; availableAt: number; settled: string }
interface Held { now: number; kind: JobKind; messages: Message[] }

const keys = ["a", "b"];
const noDurable: Durable = { exists: false, resolved: false, dueAt: 0, queuedAt: 0 };
let generation = 0;
const held = new Map<string, Held>();

function heldOf(key: string): Held {
  const found = held.get(key);
  if (found !== undefined) return found;
  const made: Held = { now: 1, kind: "NoKind", messages: [] };
  held.set(key, made);
  return made;
}

function enqueued(job: Job) {
  const key = keys.find((candidate) => job.deliveryId === deliveryOf(candidate));
  if (key === undefined) throw new Error(`job for an unknown delivery ${job.deliveryId}`);
  const state = heldOf(key);
  state.messages.push({ job, status: "pending", deliveries: 0, availableAt: state.now, settled: "none" });
}

const queue = Layer.succeed(JobQueue, { send: (job: Job) => Effect.sync(() => enqueued(job)) });
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, queue, clock.layer));

const iso = (seconds: number) => new Date(base + seconds * 1000).toISOString();
const seconds = (text: string) => (Date.parse(text) - base) / 1000;
const keyOf = (key: string) => `jq-${generation}-${key}`;
const deliveryOf = (key: string) => `delivery-${keyOf(key)}`;
const tableOf = (kind: JobKind): DueTable => kind === "AppealDueJob" ? "slopbot_appeals" : "slopbot_maintainer_holds";
const rowKeyOf = (key: string, kind: JobKind) => kind === "AppealDueJob" ? `appeal:${keyOf(key)}` : keyOf(key);

function jobOf(key: string, kind: JobKind): Job {
  const item = { deliveryId: deliveryOf(key), installationId: 1, repositoryId: 1, owner: "ada", repo: "widgets", itemKind: "pull_request" as const, number: 1 };
  switch (kind) {
    case "MaintainerHoldJob": return { kind: "maintainer_hold", reviewKey: keyOf(key), ...item };
    case "AppealDueJob": return { kind: "appeal_due", appealKey: rowKeyOf(key, kind), ...item };
    case "AppealCommandJob": return { kind: "appeal_command", command: "accept", ...item, senderId: 2 };
    case "HumanSignalJob": return { kind: "human_reopen", ...item, senderId: 2 };
    default: return { kind: "review", ...item };
  }
}

async function at(now: number) {
  clock.set(base + now * 1000);
}

async function stored(key: string, kind: JobKind, dueAt: number) {
  const job = JSON.stringify(jobOf(key, kind));
  if (kind === "AppealDueJob") {
    await db.prepare("INSERT INTO slopbot_appeals (appeal_key, repository_id, item_node_id, appellant_github_id, job_json, opened_at, due_at) VALUES (?, 1, 'PR_1', '2', ?, ?, ?)").bind(rowKeyOf(key, kind), job, iso(dueAt - 1), iso(dueAt)).run();
    return;
  }
  await db.prepare("INSERT INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number, item_node_id, author_id, revision, content_digest, policy_digest, status, created_at) VALUES (?, 1, 1, 'pull_request', 1, 'PR_1', 2, 'head', 'content', 'policy', 'completed', ?)").bind(keyOf(key), iso(dueAt - 1)).run();
  await db.prepare("INSERT INTO slopbot_maintainer_holds (review_key, job_json, item_node_id, revision, category, held_at, due_at) VALUES (?, ?, 'PR_1', 'head', 'uncertain', ?, ?)").bind(keyOf(key), job, iso(dueAt - 1), iso(dueAt)).run();
}

async function durableOf(key: string, kind: JobKind): Promise<Durable> {
  if (kind !== "MaintainerHoldJob" && kind !== "AppealDueJob") return noDurable;
  const row = kind === "AppealDueJob"
    ? await db.prepare("SELECT due_at, queued_at, escalated_at AS resolved_at FROM slopbot_appeals WHERE appeal_key = ?").bind(rowKeyOf(key, kind)).all()
    : await db.prepare("SELECT due_at, queued_at, resolved_at FROM slopbot_maintainer_holds WHERE review_key = ?").bind(keyOf(key)).all();
  const found = row.results[0] as { due_at: string; queued_at: string | null; resolved_at: string | null } | undefined;
  return found === undefined ? noDurable : { exists: true, resolved: found.resolved_at !== null, dueAt: seconds(found.due_at), queuedAt: found.queued_at === null ? 0 : seconds(found.queued_at) };
}

async function resolve(key: string, kind: JobKind, now: number) {
  if (kind === "AppealDueJob") await db.prepare("UPDATE slopbot_appeals SET escalated_at = ?, escalation = 'deadline' WHERE appeal_key = ? AND escalated_at IS NULL").bind(iso(now), rowKeyOf(key, kind)).run();
  else await db.prepare("UPDATE slopbot_maintainer_holds SET resolved_at = ?, outcome = 'labeled' WHERE review_key = ? AND resolved_at IS NULL").bind(iso(now), keyOf(key)).run();
}

async function due(key: string, state: Held) {
  await at(state.now);
  const { jobs } = await runtime.runPromise(dueJobs(tableOf(state.kind)));
  return jobs.find((found) => found.key === rowKeyOf(key, state.kind));
}

async function handled(key: string, state: Held, copy: Message, result: string, remaining: number) {
  const durable = await durableOf(key, state.kind);
  if (result === "Resolved" && !(durable.exists && state.now >= durable.dueAt)) return "refused" as const;
  const message: QueueMessage = { id: `message-${state.messages.indexOf(copy) + 1}`, body: copy.job, attempts: copy.deliveries, ack: () => undefined, retry: () => undefined };
  const handler = (): Effect.Effect<Handled, ReviewBusy | Error> => result === "Busy" ? Effect.fail(new ReviewBusy({ remainingSeconds: remaining }))
    : result === "Failed" ? Effect.fail(new Error("handler failed"))
    : result === "Resolved" ? Effect.promise(() => resolve(key, state.kind, state.now)).pipe(Effect.as("Resolved" as const))
    : Effect.succeed(result === "SourceChanged" ? "SourceChanged" as const : "Done" as const);
  await at(state.now);
  const redelivery = await runtime.runPromise(settle(message, handler));
  if (redelivery === undefined) Object.assign(copy, { status: "acked", settled: "ack" });
  else if (copy.deliveries > maxRetries) Object.assign(copy, { status: "deadLettered", settled: "retry" });
  else {
    const availableAt = state.now + redelivery.delaySeconds;
    Object.assign(copy, { status: "pending", availableAt, settled: `retry at ${availableAt}` });
  }
  return "accepted" as const;
}

async function dispatched(key: string, event: Event): Promise<"accepted" | "refused"> {
  const state = heldOf(key);
  switch (event.type) {
    case "elapse":
      if (event.seconds <= 0) return "refused";
      state.now += event.seconds;
      return "accepted";
    case "submit":
      if (state.kind !== "NoKind" || event.kind === "NoKind" || event.dueAt < 0) return "refused";
      state.kind = event.kind;
      if (event.kind === "MaintainerHoldJob" || event.kind === "AppealDueJob") await stored(key, event.kind, event.dueAt);
      else await runtime.runPromise(send(jobOf(key, event.kind)));
      return "accepted";
    case "duplicate": {
      const last = state.messages.at(-1);
      if (last === undefined) return "refused";
      enqueued(last.job);
      return "accepted";
    }
    case "deliver": {
      const copy = state.messages[event.copyId - 1];
      if (copy?.status !== "pending") return "refused";
      state.now = Math.max(state.now, copy.availableAt);
      Object.assign(copy, { status: "inFlight", deliveries: copy.deliveries + 1, settled: "none" });
      return "accepted";
    }
    case "handle": {
      const copy = state.messages[event.copyId - 1];
      if (copy?.status !== "inFlight") return "refused";
      return handled(key, state, copy, event.result, event.remaining);
    }
    case "redispatch": {
      const found = await due(key, state);
      if (found === undefined) return "refused";
      await runtime.runPromise(send(found.job));
      return "accepted";
    }
    case "recordDispatch": {
      const found = await due(key, state);
      if (found === undefined || state.messages.length === 0) return "refused";
      await runtime.runPromise(markDispatched(tableOf(state.kind), found.key, iso(state.now)));
      return "accepted";
    }
  }
}

function settlement(copy: Copy) {
  switch (copy.state) {
    case "Acked": return "ack";
    case "Waiting": return `retry at ${copy.availableAt}`;
    case "DeadLettered": return "retry";
    case "Queued":
    case "Delivered": return "none";
  }
}

function view(state: Queue): Observed {
  return { settled: state.copies.map(settlement), durable: state.durable };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    held.clear();
  },
  dispatch: (key, event: Event) => dispatched(key, event),
  observe: async (key) => {
    const state = heldOf(key);
    return { settled: state.messages.map((message) => message.settled), durable: await durableOf(key, state.kind) };
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys, view, walks: 4, steps: 16 };
