// spec/operations/release.md, "Story: Admit only a trusted run of the exact environment branch"; spec/operations/release.md, "Story: Publish under the shared environment lock only while the tested source may still be deployed"; spec/operations/release.md, "Production publishes only the current main head; staging publishes a checked ancestor and never rolls back"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/operations__release.conformance.ts";
import type { Actor, Event, Release } from "../../gen/operations__release.ts";
import { type Run, startRun } from "../../src/release/run/run.vibe";

const runs = new Map<string, Run>();

async function runFor(key: string): Promise<Run> {
  const found = runs.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(startRun("Production", "TrustedWorkflow"));
  runs.set(key, made);
  return made;
}

async function sent(key: string, event: Event, by: unknown): Promise<"accepted" | "refused"> {
  const run = await runFor(key);
  return Effect.runPromise(run.sendAs(event, by as Actor).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("ReleaseRefused", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<Release> = {
  reset: () => { runs.clear(); },
  dispatch: (key, event, by) => sent(key, event, by),
  observe: async (key) => Effect.runPromise((await runFor(key)).state()),
};

export const options: Options<Release> = { keys: ["run"], walks: 5, steps: 12 };
