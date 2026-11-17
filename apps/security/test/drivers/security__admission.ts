// spec/security/admission.md, "Story: Review every acquired item before granting admission"; spec/security/admission.md, "Each attempt starts from nothing and a service failure leaves the assessment pending"; spec/security/admission.md, "Publication records its intent, sends once, keeps uncertainty and records the result exactly once"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/security__admission.conformance.ts";
import type { Event, Scan } from "../../gen/security__admission.ts";
import { attemptMachine } from "../../src/scanner/run/attempt.vibe";

type Attempt = Effect.Success<ReturnType<typeof attemptMachine>>;

const attempts = new Map<string, Attempt>();

async function attemptOf(key: string): Promise<Attempt> {
  const found = attempts.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(attemptMachine());
  attempts.set(key, made);
  return made;
}

async function outcome(sent: Effect.Effect<Scan, unknown>): Promise<"accepted" | "refused"> {
  return Effect.runPromise(
    sent.pipe(
      Effect.as("accepted" as const),
      Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
    ),
  );
}

export const driver: Driver = {
  reset: () => {
    attempts.clear();
  },
  dispatch: async (key, event: Event) => outcome((await attemptOf(key)).send(event)),
  receive: async (key, raw) => outcome((await attemptOf(key)).receive(raw)),
  observe: async (key) => Effect.runPromise((await attemptOf(key)).get()),
};

export const options: Options = { keys: ["assessment"], walks: 20, steps: 40 };
