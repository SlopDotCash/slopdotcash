// spec/operations/slopbotQuotaWitness.md, "Story: Witness the installation quota with a temporary metadata-only grant"
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/operations__slopbotQuotaWitness.conformance.ts";
import type { Event, QuotaWitness } from "../../gen/operations__slopbotQuotaWitness.ts";
import { type Witness, startWitness } from "../../src/diagnostics/quotaWitness.vibe";

const witnesses = new Map<string, Witness>();

async function witnessFor(key: string): Promise<Witness> {
  const found = witnesses.get(key);
  if (found !== undefined) return found;
  const made = await Effect.runPromise(startWitness());
  witnesses.set(key, made);
  return made;
}

async function sent(key: string, event: Event): Promise<"accepted" | "refused"> {
  const witness = await witnessFor(key);
  return Effect.runPromise(witness.send(event).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("QuotaWitnessRefused", () => Effect.succeed("refused" as const)),
  ));
}

export const driver: Driver<QuotaWitness> = {
  reset: () => { witnesses.clear(); },
  dispatch: (key, event) => sent(key, event),
  observe: async (key) => Effect.runPromise((await witnessFor(key)).state()),
};

export const options: Options<QuotaWitness> = { keys: ["witness"], walks: 5, steps: 12 };
