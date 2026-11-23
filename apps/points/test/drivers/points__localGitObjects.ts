// spec/points/localGitObjects.md, "Story: Read immutable Git objects without spending the GitHub allowance"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/points__localGitObjects.conformance.ts";
import type { Machine } from "../../gen/points__localGitObjects.effect.vibe";
import type { Event, LocalReads } from "../../gen/points__localGitObjects.ts";
import { localReads } from "../../src/ingestion/localGit.vibe";

let readers = new Map<string, Machine.Shape>();

function readerOf(key: string): Machine.Shape {
  const found = readers.get(key);
  if (found !== undefined) return found;
  const made = Effect.runSync(localReads());
  readers.set(key, made);
  return made;
}

function outcome(sent: Effect.Effect<LocalReads, { readonly _tag: string }>) {
  const decided = Effect.catch(Effect.as(sent, "accepted" as const), (error) =>
    error._tag === "Rejected" || error._tag === "NotAnEvent" ? Effect.succeed("refused" as const) : Effect.die(error));
  return Effect.runSync(decided);
}

export const driver: Driver = {
  reset: () => {
    readers = new Map();
  },
  dispatch: (key, event: Event) => outcome(readerOf(key).send(event)),
  receive: (key, raw) => outcome(readerOf(key).receive(raw)),
  observe: (key) => Effect.runSync(readerOf(key).get()),
};

export const options: Options = { keys: ["objects", "sizes"], walks: 25, steps: 12 };
