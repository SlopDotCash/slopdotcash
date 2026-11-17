// spec/settlement/keeperLifecycle.md, "Native fee liability and nonce become durable with the exact signed bytes"; spec/settlement/keeperLifecycle.md, "Restart abandons only ephemeral work and unresolved callers from that instance"
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { fileJournal } from "@repo/platform/journal";
import type { Driver, Options } from "../../gen/settlement__keeperLifecycle.conformance.ts";
import type { Event, Lifecycle } from "../../gen/settlement__keeperLifecycle.ts";
import { type KeeperCore, keeperCore, observeGroup, receiveInGroup, sendInGroup } from "../../src/keeper/lifecycle.vibe";
import { openKeeperStore } from "../../src/keeper/store.vibe";

const directory = mkdtempSync(join(tmpdir(), "keeper-lifecycle-conformance-"));
const runtime = ManagedRuntime.make(fileJournal(join(directory, "keeper.sqlite")));
await runtime.runPromise(openKeeperStore());

let generation = 0;
const cores = new Map<string, KeeperCore>();
const group = (key: string) => `conformance-${generation}-${key}`;

const coreOf = async (key: string) => {
  const known = cores.get(key);
  if (known !== undefined) return known;
  const made = await runtime.runPromise(keeperCore());
  cores.set(key, made);
  return made;
};

const outcome = (sent: Effect.Effect<Lifecycle, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    cores.clear();
  },
  dispatch: async (key, event: Event) => outcome(sendInGroup(await coreOf(key), group(key), event)),
  receive: async (key, raw) => outcome(receiveInGroup(await coreOf(key), group(key), raw)),
  observe: async (key) => runtime.runPromise(observeGroup(await coreOf(key), group(key))),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  },
};

export const options: Options = { keys: ["first", "second"], walks: 10, steps: 16 };
