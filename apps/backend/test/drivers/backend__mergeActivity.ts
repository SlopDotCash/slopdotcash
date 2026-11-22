import { Cause, Effect, Exit, ManagedRuntime } from "effect";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/backend__mergeActivity.conformance.ts";
import type { Event, Merges, Row } from "../../gen/backend__mergeActivity.ts";
import { hourMillis } from "../../src/projects/mergeActivity/github.vibe";
import { type Evidence, type Facts, type Key, noEvidence, receive, send, storedRow } from "../../src/projects/mergeActivity/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "merge-activity-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(d1(await database(mf, "SLOP_DB")));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

const initialFacts: Facts = { at: hourMillis, measured: false, listed: true, running: false, reads: 0, intake: false, label: "", labelPending: false };

interface Instance {
  facts: Facts;
  pruned: Row | undefined;
}

let generation = 0;
let instances = new Map<string, Instance>();

const keyOf = (key: string): Key => ({ projectId: `merge-g${generation}-${key}`, repository: `conformance/${key}` });

function instanceOf(key: string): Instance {
  const found = instances.get(key);
  if (found !== undefined) return found;
  const made: Instance = { facts: initialFacts, pruned: undefined };
  instances.set(key, made);
  return made;
}

function evidenceOf(key: Key, raw: unknown): Evidence {
  if (typeof raw !== "object" || raw === null || !("wanted" in raw) || !Array.isArray(raw.wanted)) return noEvidence;
  const wanted = raw.wanted.flatMap((issue: unknown) => {
    if (typeof issue !== "object" || issue === null || !("number" in issue) || typeof issue.number !== "number") return [];
    const own = "ownRepository" in issue && issue.ownRepository === true;
    const open = "openPulls" in issue && typeof issue.openPulls === "number" ? issue.openPulls : 0;
    const url = own ? `https://github.com/${key.repository}/issues/${issue.number}` : `https://github.com/elsewhere/${key.repository}/issues/${issue.number}`;
    return [{ number: issue.number, title: `Wanted issue ${issue.number}`, url, openPullRequests: open }];
  });
  return { ...noEvidence, wanted };
}

async function settled(key: string, sent: Effect.Effect<Merges, unknown, Services>, pruning: boolean) {
  const exit = await runtime.runPromiseExit(sent);
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    const tag = typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined;
    if (tag === "Rejected" || tag === "NotAnEvent") return "refused" as const;
    throw error;
  }
  const next = exit.value;
  const instance = instanceOf(key);
  instance.facts = { at: next.now * hourMillis, measured: next.measured, listed: next.listed, running: next.running, reads: next.reads, intake: next.intake, label: next.label, labelPending: next.labelPending };
  if (pruning) instance.pruned = next.row;
  return "accepted" as const;
}

async function observe(key: string): Promise<Merges> {
  const instance = instanceOf(key);
  const stored = await runtime.runPromise(storedRow(keyOf(key)));
  const row = stored.stored || instance.pruned === undefined ? stored : instance.pruned;
  const { at, measured, listed, running, reads, intake, label, labelPending } = instance.facts;
  return { repository: 1, now: Math.floor(at / hourMillis), measured, listed, row, running, reads, intake, label, labelPending };
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation += 1;
    instances = new Map();
  },
  dispatch: (key, event: Event, by) => settled(key, send(keyOf(key), instanceOf(key).facts, event, String(by), evidenceOf(keyOf(key), event)), event.type === "prune"),
  receive: (key, raw, by) => settled(key, receive(keyOf(key), instanceOf(key).facts, raw, String(by), evidenceOf(keyOf(key), raw)), typeof raw === "object" && raw !== null && "type" in raw && raw.type === "prune"),
  observe,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["one", "two"], walks: 8, steps: 14 };
