// spec/backend/repoRequests.md, "A flag counts for 90 days, renews in place and is withdrawn without being deleted"; spec/backend/repoRequests.md, "Only a member with merged work flags a public, original, unarchived repository that is not theirs and not on Slop"
import { type Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/backend__repoRequests.conformance.ts";
import type { Event, RepoFlag, RepoRequests } from "../../gen/backend__repoRequests.ts";
import { accountFlags, receive, send } from "../../src/repoRequests/store.vibe";

const BASE = Date.parse("2026-01-01T00:00:00.000Z");

const mf = startWorker({ d1: { SLOP_DB: "repo-requests-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const clock = settableClock(BASE);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOP_DB")), webCrypto, clock.layer));

let nextAccount = 10_000_000;
let nextRepo = 1_000_000;
const accounts = new Map<string, string>();
const repos = new Map<string, string>();

const storable = (model: string, known: Map<string, string>, next: () => number) => {
  if (model === "") return "";
  const found = known.get(model);
  if (found !== undefined) return found;
  const made = String(next());
  known.set(model, made);
  return made;
};
const accountOf = (model: string) => storable(model, accounts, () => nextAccount++);
const repoOf = (model: string) => storable(model, repos, () => nextRepo++);
const modelOf = (known: Map<string, string>, real: string) => [...known].find(([, stored]) => stored === real)?.[0] ?? real;

const snapshot = (raw: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(raw)) as unknown;
  } catch {
    return raw;
  }
};

const translated = (copy: unknown): unknown => {
  if (typeof copy !== "object" || copy === null || Array.isArray(copy)) return copy;
  const event = copy as Record<string, unknown>;
  return {
    ...event,
    ...typeof event.repoId === "string" ? { repoId: repoOf(event.repoId) } : {},
    ...event.type === "observeClock" && Number.isSafeInteger(event.now) ? { now: BASE + (event.now as number) } : {},
  };
};

const clockAfter = (copy: unknown): number | undefined => {
  if (typeof copy !== "object" || copy === null) return undefined;
  const event = copy as Record<string, unknown>;
  return event.type === "observeClock" && Number.isSafeInteger(event.now) ? BASE + (event.now as number) : undefined;
};

const sent = async (copy: unknown, deliver: (event: unknown) => Effect.Effect<RepoRequests, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => {
  const result = await outcome(deliver(translated(copy)), runtime);
  const moved = clockAfter(copy);
  if (result === "accepted" && moved !== undefined) clock.set(moved);
  return result;
};

const ordered = (state: RepoRequests): RepoRequests => ({
  now: state.now,
  flags: [...state.flags].sort((a, b) => a.account.localeCompare(b.account) || a.repoId.localeCompare(b.repoId)),
});

const modelFlag = (flag: RepoFlag): RepoFlag => ({
  repoId: modelOf(repos, flag.repoId),
  account: modelOf(accounts, flag.account),
  fullName: flag.fullName,
  createdAt: flag.createdAt - BASE,
  flaggedAt: flag.flaggedAt - BASE,
  expiresAt: flag.expiresAt - BASE,
  withdrawn: flag.withdrawn,
});

const observed = async (): Promise<RepoRequests> => {
  const flags: RepoFlag[] = [];
  for (const real of accounts.values()) flags.push(...(await runtime.runPromise(accountFlags(real))).flags.map(modelFlag));
  return ordered({ now: clock.now() - BASE, flags });
};

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    accounts.clear();
    repos.clear();
    clock.set(BASE);
  },
  dispatch: (_key, event: Event, by) => sent(snapshot(event), (translatedEvent) => send(translatedEvent as Event, accountOf(String(by ?? "")))),
  receive: (_key, raw, by) => sent(snapshot(raw), (translatedEvent) => receive(translatedEvent, accountOf(String(by ?? "")))),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { view: ordered, keys: ["requests"], walks: 10, steps: 12 };
