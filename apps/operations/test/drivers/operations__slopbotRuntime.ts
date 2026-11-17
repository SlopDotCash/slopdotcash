// spec/operations/slopbotRuntime.md, "Story: Observe the Slopbot runtime only from three agreeing reads of the expected source"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/operations__slopbotRuntime.conformance.ts";
import type { Event, RuntimeReadback } from "../../gen/operations__slopbotRuntime.ts";
import { type Readback, startReadback } from "../../src/diagnostics/slopbotRuntime.vibe";

const readbacks = new Map<string, Readback>();

async function readbackFor(key: string): Promise<Readback> {
  const found = readbacks.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(startReadback());
  readbacks.set(key, made);
  return made;
}

async function sent(key: string, event: Event): Promise<"accepted" | "refused"> {
  const readback = await readbackFor(key);
  return Effect.runPromise(readback.send(event).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("ReadbackRefused", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<RuntimeReadback> = {
  reset: () => { readbacks.clear(); },
  dispatch: (key, event) => sent(key, event),
  observe: async (key) => Effect.runPromise((await readbackFor(key)).state()),
};

export const options: Options<RuntimeReadback> = { keys: ["readback"], walks: 5, steps: 12 };
