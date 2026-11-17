import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { fileJournal } from "@repo/platform/journal";
import type { Driver, Options } from "../../gen/settlement__signer.conformance.ts";
import type { Binding, Event } from "../../gen/settlement__signer.ts";
import { observeBinding, receiveBinding, sendBinding } from "../../src/journal/bindings.vibe";
import { createJournal, journaled } from "../../src/journal/journal.vibe";

const directory = mkdtempSync(join(tmpdir(), "signer-conformance-"));
const runtime = ManagedRuntime.make(fileJournal(join(directory, "journal.sqlite")));
await runtime.runPromise(createJournal());

let generation = 0;
const stored = (key: string) => `bind:stored:conformance-${generation}-${key}`;
const sender = (by: unknown) => (typeof by === "string" ? by : "");

const outcome = (sent: Effect.Effect<Binding, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
  },
  dispatch: (key, event: Event, by) => outcome(journaled((entries) => sendBinding(entries, stored(key), event, sender(by)))),
  receive: (key, raw, by) => outcome(journaled((entries) => receiveBinding(entries, stored(key), raw, sender(by)))),
  observe: (key) => runtime.runPromise(journaled((entries) => observeBinding(entries, stored(key)))),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  },
};

export const options: Options = { keys: ["first", "second"], walks: 10, steps: 12 };
