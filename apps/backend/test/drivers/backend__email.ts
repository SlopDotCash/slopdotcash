import { Clock, Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import type { Driver, Options } from "../../gen/backend__email.conformance.ts";
import type { Enrollment, Event } from "../../gen/backend__email.ts";
import { receive, send, stored, tokenDigest } from "../../src/email/store.vibe";
import { migrations } from "../migrations.ts";

const keys = ["first", "second"];
const mf = startWorker({ d1: { SLOP_DB: "email-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrations)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

let now = 0;
const nanos = () => BigInt(now) * 1_000_000n;
const live = Clock.Clock.defaultValue();
const clock: Clock.Clock = {
  currentTimeMillisUnsafe: () => now,
  currentTimeMillis: Effect.sync(() => now),
  currentTimeNanosUnsafe: nanos,
  currentTimeNanos: Effect.sync(nanos),
  monotonicTimeNanosUnsafe: nanos,
  monotonicTimeNanos: Effect.sync(nanos),
  sleep: (duration) => live.sleep(duration),
};
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, Layer.succeed(Clock.Clock, clock)));

let generation = 0;
const tokens = new Set<string>();
const times = new Map<string, number>();
const at = (key: string) => { now = times.get(key) ?? 0; };
const actorOf = (key: string) => String(1000 + generation * keys.length + keys.indexOf(key));
const sender = (key: string, by: unknown) => by === 1 ? Number(actorOf(key)) : -Math.abs(Number(by)) - 1;

const outcome = (key: string, sent: Effect.Effect<Enrollment, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.map((next) => { times.set(key, next.now); return "accepted" as const; }),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

const remember = (input: unknown) => {
  const token = (input as { digest?: unknown } | null)?.digest;
  if (typeof token === "string") tokens.add(token);
};

const observed = (key: string) => Effect.gen(function* () {
  const { enrollment, verification } = yield* stored(actorOf(key));
  let digest = enrollment.tokenDigest;
  for (const token of tokens) if (digest !== "" && (yield* tokenDigest(verification ?? "", token)) === enrollment.tokenDigest) digest = token;
  return { ...enrollment, actor: 1, tokenDigest: digest } satisfies Enrollment;
});

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    times.clear();
  },
  dispatch: (key, event: Event, by) => {
    at(key);
    remember(event);
    return outcome(key, send(actorOf(key), event, sender(key, by)));
  },
  receive: (key, raw, by) => {
    at(key);
    remember(raw);
    return outcome(key, receive(actorOf(key), raw, sender(key, by)));
  },
  observe: (key) => {
    at(key);
    return runtime.runPromise(observed(key));
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys, walks: 5, steps: 12 };
