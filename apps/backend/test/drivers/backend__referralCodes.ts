import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import type { Driver, Options } from "../../gen/backend__referralCodes.conformance.ts";
import type { CodeRecord, Event, LinkRegistry } from "../../gen/backend__referralCodes.ts";
import { names, receive, send } from "../../src/referrals/store.vibe";
import { migrationsDir } from "@repo/platform/testing/paths";

const mf = startWorker({ d1: { SLOP_DB: "referral-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOP_DB")), webCrypto));

let generation = 0;
let nextId = 1000;
const ids = new Map<string, string>();
const actorOf = (actor: string) => {
  if (actor === "") return "";
  const known = ids.get(actor);
  if (known !== undefined) return known;
  const made = String(nextId++);
  ids.set(actor, made);
  return made;
};
const suffix = () => `-g${generation}`;
const fresh = (name: string) => name === "" ? "" : `${name}${suffix()}`;
const original = (name: string) => name.endsWith(suffix()) ? name.slice(0, -suffix().length) : name;

const translated = (raw: unknown): unknown => {
  const event = raw as { name?: { text?: unknown; key?: unknown } } | null;
  const name = event?.name;
  if (name === null || typeof name !== "object" || typeof name.text !== "string" || typeof name.key !== "string") return raw;
  return { ...event, name: { ...name, text: fresh(name.text), key: fresh(name.key) } };
};

const outcome = (sent: Effect.Effect<LinkRegistry, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

const observed = async (): Promise<LinkRegistry> => {
  const registry = await runtime.runPromise(names());
  const actors = new Map([...ids].map(([model, id]) => [id, model]));
  const ours = registry.keys.filter((key) => key.endsWith(suffix()));
  const record = (key: string) => registry.reservations[`$${key}`]!;
  return {
    reservations: Object.fromEntries(ours.map((key) => [`$${original(key)}`, { actor: actors.get(record(key).actor)!, text: original(record(key).text) } satisfies CodeRecord])),
    active: Object.fromEntries(registry.actors.filter((id) => actors.has(id)).map((id) => [`$${actors.get(id)}`, original(registry.active[`$${id}`]!)])),
    held: Object.fromEntries(registry.actors.filter((id) => actors.has(id)).map((id) => [`$${actors.get(id)}`, registry.held[`$${id}`]!.map(original)])),
    keys: ours.map(original),
    actors: registry.actors.filter((id) => actors.has(id)).map((id) => actors.get(id)!),
  };
};

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    ids.clear();
  },
  dispatch: (_key, event: Event, by) => outcome(send(translated(event) as Event, actorOf(String(by)))),
  receive: (_key, raw, by) => outcome(receive(translated(raw), actorOf(String(by)))),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["registry"], walks: 10, steps: 12 };
