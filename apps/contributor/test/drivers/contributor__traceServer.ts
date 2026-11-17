// spec/contributor/traceServer.md, "The run, its intents, reservation, objects and events are separate records"; spec/contributor/traceServer.md, "The clock, private-intake observation and ban state come from their owning services"
import { createHash } from "node:crypto";
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker, storage } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { Restrictions } from "@repo/ports/backend";
import { IntakeHealthLive } from "@repo/operations/live";
import type { Driver, Options } from "../../gen/contributor__traceServer.conformance.ts";
import type { ContentType, CreateRequest, Event, Put, Reply, TraceObject, TraceServer } from "../../gen/contributor__traceServer.ts";
import { type RunRow, contentTypes, eventKinds, eventSources } from "../../src/traces/codec.vibe";
import { type StoredTrace, TraceObjects, objectKey, traceObjects } from "../../src/traces/objects.vibe";
import { type RunLocator, type Settled, appendEvent, attachPut, beginPut, createIntent, createRun, finalize, inspect, writeBytes } from "../../src/traces/store.vibe";

const runtimeSender = -1;
const latestTime = 9007199254740000;

const mf = startWorker({ d1: { SLOP_DB: "trace-conformance" }, r2: ["PRIVATE_TRACES"] });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const r2 = await storage(mf, "PRIVATE_TRACES");
const clock = settableClock(0);
const bans = new Set<string>();
let storageRefuses = false;

const objects = Layer.effect(TraceObjects, Effect.gen(function* () {
  const stored = yield* TraceObjects;
  return { store: (trace: StoredTrace, bytes: Uint8Array) => storageRefuses ? Effect.succeed(false) : stored.store(trace, bytes) };
})).pipe(Layer.provide(traceObjects(r2).pipe(Layer.provide(webCrypto))));
const restrictions = Layer.succeed(Restrictions, {
  account: (githubId) => Effect.succeed({ banned: bans.has(githubId) }),
  project: () => Effect.succeed({ restricted: false }),
  fence: ({ githubId }) => Effect.succeed(bans.has(githubId) ? sql`SELECT json('account banned') AS unbanned` : sql`SELECT 1 AS unbanned`),
  unbanned: (githubId) => Effect.succeed(bans.has(githubId) ? sql`0` : sql`1`),
});
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, objects, restrictions, Layer.provide(IntakeHealthLive, d1(db))));

const hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const noRequest: CreateRequest = { clientRun: "", project: 0, repository: "", policyRevision: "", provider: "", model: "", client: "", clientVersion: "" };

interface Digest {
  readonly hex: string;
  readonly bytes: Uint8Array;
}

interface World {
  readonly actors: Map<number, number>;
  readonly digests: Map<string, Digest>;
  readonly names: Map<string, string>;
  runId: string | undefined;
  otherRun: string | undefined;
  epoch: number;
  puts: ReadonlyArray<Put>;
  reply: Reply;
}

let generation = 0;
let nextActor = 7_000_000;
let nextContent = 1;
const fresh = (): World => ({ actors: new Map(), digests: new Map(), names: new Map(), runId: undefined, otherRun: undefined, epoch: 0, puts: [], reply: "ReplyNone" });
let world = fresh();

const actorOf = (model: number) => {
  if (model === runtimeSender) return runtimeSender;
  const known = world.actors.get(model);
  if (known !== undefined) return known;
  const made = nextActor++;
  world.actors.set(model, made);
  return made;
};
const owner = () => String(actorOf(1));

const contentOf = (size: number) => {
  const length = size >= 2 && size <= 64 ? size : 2;
  const counter = nextContent++;
  if (counter >= 256 ** Math.min(length, 6)) throw new Error("the driver ran out of distinct trace contents");
  const bytes = new Uint8Array(length);
  for (let index = length - 1, rest = counter; index >= 0 && rest > 0; index--, rest = Math.floor(rest / 256)) bytes[index] = rest % 256;
  return bytes;
};
const digestOf = (name: string, size: number): Digest => {
  if (name === "") return { hex: "", bytes: new Uint8Array() };
  const known = world.digests.get(name);
  if (known !== undefined) return known;
  const bytes = contentOf(size);
  const made = { hex: hex(bytes), bytes };
  world.digests.set(name, made);
  world.names.set(made.hex, name);
  return made;
};
const nameOf = (digest: string) => world.names.get(digest) ?? digest;
const named = (blob: TraceObject): TraceObject => ({ ...blob, digest: nameOf(blob.digest) });

const locator = (createKey = ""): RunLocator => world.runId === undefined ? { owner: owner(), createKey } : { runId: world.runId };

type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

const rejected = (error: unknown) => typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected";

const settled = async <E>(sent: Effect.Effect<Settled, E, Services>, movesPuts = false) => {
  const exit = await runtime.runPromiseExit(sent);
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    if (rejected(error)) return "refused" as const;
    throw error;
  }
  const outcome = exit.value;
  if (movesPuts) world.puts = outcome.state.puts;
  world.reply = outcome.state.reply;
  if (outcome.run !== undefined) world.runId = outcome.run.id;
  return "accepted" as const;
};

const requestOf = (run: RunRow | undefined): CreateRequest => run === undefined ? noRequest : {
  clientRun: run.client_run_id,
  project: Number(run.project_id.slice(1)),
  repository: run.repository,
  policyRevision: run.project_policy_revision,
  provider: run.provider,
  model: run.model,
  client: run.client,
  clientVersion: run.client_version,
};

const observed = async (): Promise<TraceServer> => {
  const loaded = await runtime.runPromise(inspect({ run: locator(), owner: owner(), digests: [...world.names.keys()], puts: world.puts }));
  const model = loaded.model;
  return {
    ...model,
    owner: 1,
    standingEpoch: world.epoch,
    request: requestOf(loaded.rows.run),
    intents: model.intents.map((intent) => ({ ...intent, digest: nameOf(intent.digest) })),
    reservation: model.reservation.map(named),
    objects: model.objects.map(named),
    attached: nameOf(model.attached),
    puts: model.puts.map((put) => ({ ...put, blob: named(put.blob) })),
    reply: world.reply,
  };
};

const environment = (allowed: boolean, enact: () => Promise<void> | void) => async () => {
  if (!allowed) return "refused" as const;
  await enact();
  world.reply = "ReplyNone";
  return "accepted" as const;
};

const otherRun = async () => {
  if (world.otherRun !== undefined) return world.otherRun;
  const id = `other-run-${generation}`;
  const now = iso(clock.now() / 1000);
  await db.prepare(`INSERT INTO trace_runs (id, client_run_id, github_user_id, github_login, project_id, repository, project_policy_revision, provider, model, client, client_version, state, trace_sha256, created_at, finalized_at, create_idempotency_key)
    VALUES (?, 'other', ?, 'other', 'other', 'o/other', 'other', 'other', 'other', 'other', '1', 'awaiting_trace', NULL, ?, NULL, ?)`).bind(id, owner(), now, id).run();
  world.otherRun = id;
  return id;
};

const observe = async (event: Event, by: number) => {
  const current = await observed();
  switch (event.type) {
    case "observeTime":
      return environment(by === runtimeSender && event.t >= current.now && event.t <= latestTime, () => clock.set(event.t * 1000))();
    case "renewIntake":
      return environment(by === runtimeSender && event.verifiedAt >= 0 && event.verifiedAt <= current.now + 300 && event.verifiedAt >= current.intake.verifiedAt, async () => {
        await db.prepare("INSERT INTO private_intake_status (singleton, enabled, verified_at) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET enabled = excluded.enabled, verified_at = excluded.verified_at")
          .bind(event.intakeEnabled ? 1 : 0, iso(event.verifiedAt)).run();
      })();
    case "observeStanding":
      return environment(by === runtimeSender && event.actor === 1 && event.epoch > world.epoch, () => {
        if (event.banned) bans.add(owner());
        else bans.delete(owner());
        world.epoch = event.epoch;
      })();
    case "observeForeignObject":
      return environment(by === runtimeSender && event.blob.digest !== "" && !current.objects.some((object) => object.digest === event.blob.digest), async () => {
        if (event.blob.size < 1 || event.blob.size > 8388608) throw new Error(`a stored trace object cannot have ${event.blob.size} bytes`);
        const digest = digestOf(event.blob.digest, event.blob.size).hex;
        await db.prepare("INSERT INTO trace_objects (sha256, r2_key, size_bytes, content_type, created_by_github_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(digest, objectKey(digest), event.blob.size, contentTypes[event.blob.contentType], String(nextActor++), iso(current.now)).run();
      })();
    case "observeOtherRunKey": {
      const own = event.keyKind === "IntentKey" ? current.intents.map((intent) => intent.key) : current.events.map((each) => each.key);
      const other = event.keyKind === "IntentKey" ? current.otherRunIntentKeys : current.otherRunEventKeys;
      return environment(by === runtimeSender && event.key !== "" && !own.includes(event.key) && !other.includes(event.key), async () => {
        const run = await otherRun();
        const now = iso(current.now);
        if (event.keyKind === "IntentKey") {
          await db.prepare("INSERT INTO trace_upload_intents (token_hash, run_id, github_user_id, trace_sha256, size_bytes, content_type, idempotency_key, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, 1, 'text/plain', ?, ?, ?, NULL)")
            .bind(hex(`other-intent:${generation}:${event.key}`), run, owner(), hex(`other-digest:${generation}`), event.key, now, now).run();
        } else {
          await db.prepare("INSERT INTO run_progress_events (id, run_id, github_user_id, kind, occurred_at, source, github_object_id, github_url, head_sha, created_at, idempotency_key) VALUES (?, ?, ?, 'checkpoint', ?, 'agent', NULL, NULL, NULL, ?, ?)")
            .bind(`other-event-${generation}-${hex(event.key)}`, run, owner(), now, now, event.key).run();
        }
      })();
    }
    default:
      throw new Error(`${event.type} is not an environment observation`);
  }
};

const contentType = (value: ContentType) => contentTypes[value];

const send = async (event: Event, by: number) => {
  const sender = actorOf(by);
  switch (event.type) {
    case "observeTime":
    case "renewIntake":
    case "observeStanding":
    case "observeForeignObject":
    case "observeOtherRunKey":
      return observe(event, by);
    case "createRun": {
      const request = event.request;
      return settled(createRun({
        run: locator(event.key),
        owner: String(sender),
        login: `contributor-${sender}`,
        key: event.key,
        request: {
          clientRunId: request.clientRun,
          projectId: request.project > 0 ? `p${request.project}` : "",
          repository: request.repository,
          policyRevision: request.policyRevision,
          provider: request.provider,
          model: request.model,
          client: request.client,
          clientVersion: request.clientVersion,
        },
      }));
    }
    case "createIntent": {
      const digest = digestOf(event.digest, event.byteCount).hex;
      return settled(createIntent({
        run: locator(),
        by: sender,
        key: event.key,
        digest,
        byteCount: event.byteCount,
        contentType: contentType(event.contentType),
        tokenHash: hex(`capability:${generation}:${owner()}:${event.key}:${digest}`),
      }));
    }
    case "beginPut":
      return settled(beginPut({
        run: locator(),
        key: event.key,
        digest: digestOf(event.digest, event.byteCount).hex,
        byteCount: event.byteCount,
        contentType: contentType(event.contentType),
        puts: world.puts,
      }), true);
    case "writeBytes": {
      const reserved = world.puts.find((put) => put.key === event.key && put.stage === "PutReserved");
      const bytes = reserved === undefined ? new Uint8Array() : world.digests.get(nameOf(reserved.blob.digest))?.bytes ?? new Uint8Array();
      storageRefuses = !event.succeeds;
      try {
        return await settled(writeBytes({ run: locator(), by: sender, key: event.key, bytes, puts: world.puts }), true);
      } finally {
        storageRefuses = false;
      }
    }
    case "attachPut":
      return settled(attachPut({ run: locator(), key: event.key, puts: world.puts }), true);
    case "finalize":
      return settled(finalize({ run: locator(), by: sender, key: event.key }));
    case "appendEvent":
      return settled(appendEvent({
        run: locator(),
        by: sender,
        key: event.key,
        kind: eventKinds[event.kind],
        source: eventSources[event.source],
        occurredAt: iso(event.occurredAt),
        githubObject: event.githubObject === "" ? undefined : event.githubObject,
        githubUrl: undefined,
        headSha: undefined,
      }));
  }
};

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    generation++;
    world = fresh();
    clock.set(0);
    bans.clear();
    storageRefuses = false;
    await db.prepare("DELETE FROM private_intake_status").run();
  },
  dispatch: (_key, event, by) => send(event, Number(by)),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["run"], walks: 4, steps: 14 };
