// spec/slopbot/closeAttempt.md, "Story: Recheck every gate before the slot is reserved and the request is sent"; spec/slopbot/closeAttempt.md, "Story: Confirm or release an attempt only on GitHub's evidence"; spec/slopbot/closeAttempt.md, "Story: A maintainer reopen or an upheld appeal undoes Slopbot's own close"
import { Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/slopbot__closeAttempt.conformance.ts";
import type { Event } from "../../gen/slopbot__closeAttempt.ts";
import { type AttemptRecord, attemptState, openAttempt, receiveAttempt, sendAttempt } from "../../src/closeAttempt/store.vibe";
import { settled } from "../support/settled.ts";

const runtime = ManagedRuntime.make(Layer.empty);

let record: AttemptRecord = await runtime.runPromise(openAttempt());

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    record = await runtime.runPromise(openAttempt());
  },
  dispatch: (_key, event: Event) => settled(sendAttempt(record, event), runtime),
  receive: (_key, raw) => settled(receiveAttempt(record, raw), runtime),
  observe: () => runtime.runPromise(attemptState(record)),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["attempt"], walks: 10, steps: 20 };
