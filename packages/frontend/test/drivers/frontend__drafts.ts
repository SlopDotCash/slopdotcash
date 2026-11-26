// spec/frontend/drafts.md, "A draft belongs to one account and project"; spec/frontend/drafts.md, "The first send fixes a key and retries keep that key and content"; spec/frontend/drafts.md, "A definite refusal returns the report to review with a fresh key"
import { ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__drafts.conformance.ts";
import type { Event } from "../../gen/frontend__drafts.ts";
import { draftMachine, draftState, receiveDraft, sendDraft } from "../../src/flows/security/composeDraft.vibe";

let runtime = ManagedRuntime.make(draftMachine);

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    await runtime.dispose();
    runtime = ManagedRuntime.make(draftMachine);
  },
  dispatch: (_key, event: Event) => outcome(sendDraft(event), runtime),
  receive: (_key, raw) => outcome(receiveDraft(raw), runtime),
  observe: () => runtime.runPromise(draftState()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["draft"] };
