// spec/slopbot/maintainerHold.md, "Story: Give the maintainer seven days to decide an uncertain finding"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/slopbot__maintainerHold.conformance.ts";
import type { Event, Hold } from "../../gen/slopbot__maintainerHold.ts";
import { type HoldScope, commitHold, holdJobOf, loadHold, startingScope } from "../../src/holds/store.vibe";

const mf = startWorker({ d1: { SLOPBOT_DB: "hold-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const clock = settableClock(0);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));

type Observed = Pick<Hold, "now" | "heldAt" | "queuedAt" | "hold" | "maintainerReopened" | "appealUpheld"> & { readonly gateSeq: number };

let generation = 0;
let reviewed = false;
let reopens = 0;
let scope: HoldScope = scoped();

function node() {
  return `pr-hold-g${generation}`;
}

function iso(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

function translated<T>(value: T): T {
  if (Array.isArray(value)) return (value as ReadonlyArray<unknown>).map((each) => translated(each)) as T;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, key === "itemNode" && field === "pr" ? node() : translated(field)])) as T;
}

function scoped(): HoldScope {
  const reviewKey = `hold-g${generation}`;
  const job = holdJobOf(reviewKey, { installationId: 1, repositoryId: 7_100_000 + generation, owner: "o", repo: "r", itemKind: "pull_request", number: 1 });
  return translated(startingScope(reviewKey, job));
}

async function seedReview() {
  if (reviewed) return;
  const { identity } = scope.finding;
  await db.prepare(`INSERT INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number, item_node_id, author_id, revision, content_digest, policy_digest, status, created_at)
    VALUES (?, 1, ?, 'pull_request', 1, ?, ?, ?, ?, 'policy', 'completed', ?)`).bind(scope.reviewKey, scope.job.repositoryId, identity.itemNode, identity.author, identity.revision, identity.contentDigest, iso(0)).run();
  reviewed = true;
}

function committed(event: Event) {
  return runtime.runPromise(commitHold(scope, () => [event]).pipe(Effect.catchTag("Rejected", () => Effect.succeed(undefined))));
}

async function dispatch(event: Event): Promise<"accepted" | "refused"> {
  await seedReview();
  const sent = translated(event);
  const hold = await committed(sent);
  if (hold === undefined) return "refused";
  if (sent.type === "observe") scope = { ...scope, gate: hold.gate };
  if (sent.type === "observeTime") clock.set(sent.observedAt * 1000);
  if (sent.type === "observeReopen") {
    reopens++;
    const source = JSON.stringify({ installationId: 1, repositoryId: scope.job.repositoryId, itemKind: "pull_request", number: 1, senderId: sent.reopen.actor, itemNodeId: sent.reopen.itemNode, revision: sent.reopen.revision, occurredAt: iso(sent.reopen.at) });
    await db.prepare("INSERT INTO slopbot_deliveries (delivery_id, event, received_at, reopen_source, reopen_confirmed_at) VALUES (?, 'pull_request', ?, ?, ?)")
      .bind(`hold-reopen-g${generation}-${reopens}`, iso(hold.now), source, iso(hold.now)).run();
  }
  if (sent.type === "observeAppealOutcome") {
    await db.prepare(`INSERT INTO slopbot_appeals (appeal_key, repository_id, item_node_id, appellant_github_id, job_json, opened_at, due_at, resolved_at, resolution, resolved_by)
      VALUES (?, ?, ?, '5', '{}', ?, ?, ?, 'upheld', 'maintainer')`)
      .bind(`appeal:${sent.appealOutcome.itemNode}:${sent.appealOutcome.revision}`, scope.job.repositoryId, sent.appealOutcome.itemNode, iso(hold.now), iso(hold.now + 1), iso(hold.now)).run();
  }
  return "accepted";
}

function view(state: Hold): Observed {
  return { now: state.now, heldAt: state.heldAt, queuedAt: state.queuedAt, hold: state.hold, maintainerReopened: state.maintainerReopened, appealUpheld: state.appealUpheld, gateSeq: state.gate.seq };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    reviewed = false;
    reopens = 0;
    clock.set(0);
    scope = scoped();
  },
  dispatch: (_key, event: Event) => dispatch(event),
  observe: async () => view((await runtime.runPromise(loadHold(scope))).hold),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["hold"], view, walks: 4, steps: 14 };
