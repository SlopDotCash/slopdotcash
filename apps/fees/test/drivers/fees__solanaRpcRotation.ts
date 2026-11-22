// spec/fees/solanaRpcRotation.md, "Each phase is in the receipt before the next starts, and phases only move forward"; spec/fees/solanaRpcRotation.md, "An uncertain activation keeps its lease until it expires, and every other end releases only its own lease"
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/fees__solanaRpcRotation.conformance.ts";
import type { Event, Rotation } from "../../gen/fees__solanaRpcRotation.ts";
import { type RotationRun, startRun } from "../../src/programs/solanaRpcRotation.vibe";

const root = mkdtempSync(join(tmpdir(), "fee-solana-rotation-driver-"));
const runs = new Map<string, RotationRun>();
let generation = 0;

async function runFor(key: string): Promise<RotationRun> {
  const found = runs.get(key);
  if (found !== undefined) return found;
  generation += 1;
  const directory = mkdtempSync(join(root, `${generation}-`));
  const made = await Effect.runPromise(Effect.provide(startRun(directory, { schemaVersion: 1, checkout: "a".repeat(40), previousVersion: "11111111-2222-3333-4444-555555555555", deployedSource: "b".repeat(40), phase: "qualification", sourceFiles: 1 }), NodeServices.layer));
  runs.set(key, made);
  return made;
}

async function sent(key: string, event: Event): Promise<"accepted" | "refused"> {
  const run = await runFor(key);
  return Effect.runPromise(Effect.provide(run.send(event), NodeServices.layer).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("RotationStopped", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<Rotation> & AsyncDisposable = {
  reset: () => { runs.clear(); },
  dispatch: (key, event) => sent(key, event),
  observe: async (key) => Effect.runPromise((await runFor(key)).state()),
  [Symbol.asyncDispose]: async () => { rmSync(root, { recursive: true, force: true }); },
};

export const options: Options<Rotation> = { keys: ["rotation"], walks: 5, steps: 12 };
