// spec/slopbot/closure.md, "A decision is recorded once and keeps its scope, verdicts and outcome"
import { Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/slopbot__closure.conformance.ts";
import type { Event, ReviewIdentity } from "../../gen/slopbot__closure.ts";
import { type ClosureRecord, closureState, openClosure, receiveClosure, sendClosure } from "../../src/closure/store.vibe";
import { settled } from "../support/settled.ts";

const runtime = ManagedRuntime.make(Layer.empty);
const reviewed: ReviewIdentity = { project: 1, repository: 7, kind: "PullRequest", itemNode: "pr", revision: "head", contentDigest: "review", author: 5 };

let record: ClosureRecord = await runtime.runPromise(openClosure(reviewed));

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    record = await runtime.runPromise(openClosure(reviewed));
  },
  dispatch: (_key, event: Event) => settled(sendClosure(record, event), runtime),
  receive: (_key, raw) => settled(receiveClosure(record, raw), runtime),
  observe: () => runtime.runPromise(closureState(record)),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["closure"], walks: 10, steps: 20 };
