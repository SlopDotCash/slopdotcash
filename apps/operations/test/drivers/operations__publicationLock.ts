// spec/operations/publicationLock.md, "At most one run of an environment holds the lock, and health jobs never take it"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/operations__publicationLock.conformance.ts";
import type { Actor, Event, Locks } from "../../gen/operations__publicationLock.ts";
import { type LockRecord, lockRecord } from "../../src/publicationLock/lock.vibe";

const records = new Map<string, LockRecord>();

async function recordFor(key: string): Promise<LockRecord> {
  const found = records.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(lockRecord());
  records.set(key, made);
  return made;
}

async function sent(key: string, event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const record = await recordFor(key);
  return Effect.runPromise(record.send(event, by as Actor).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("LockRefused", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<Locks> = {
  reset: () => { records.clear(); },
  dispatch: (key, event, by) => sent(key, event, by),
  observe: async (key) => Effect.runPromise((await recordFor(key)).state()),
};

export const options: Options<Locks> = { keys: ["production", "staging"], walks: 5, steps: 12 };
