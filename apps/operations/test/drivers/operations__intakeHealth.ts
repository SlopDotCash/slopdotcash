// spec/operations/intakeHealth.md, "A usable answer replaces the observation; anything else leaves it to expire"; spec/operations/intakeHealth.md, "The hourly watch only reads and alerts after three hours"
import { Effect, Layer, ManagedRuntime } from "effect";
import { D1, d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/operations__intakeHealth.conformance.ts";
import type { Machine, Rejected } from "../../gen/operations__intakeHealth.effect.vibe";
import type { Event, Health, Renewer } from "../../gen/operations__intakeHealth.ts";
import { advanceClock, failWrite, healthState, observedHealth, rejectToken, settleRenewal, startRead, watchHealth } from "../../src/intakeHealth/renewal.vibe";
import { storedObservation } from "../../src/intakeHealth/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "intake-health-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const storage = d1(await database(mf, "SLOP_DB"));

type Run = ManagedRuntime.ManagedRuntime<Machine | D1, never>;

let run: Run = ManagedRuntime.make(Layer.mergeAll(healthState(), storage));

const sent = (event: Event, by: Renewer): Effect.Effect<Health, Rejected, Machine | D1> => {
  switch (event.type) {
    case "advanceClock":
      return advanceClock(event.now, by);
    case "startRead":
      return startRead(event.withToken, by);
    case "rejectToken":
      return rejectToken(by);
    case "failWrite":
      return failWrite(by);
    case "renew":
      return settleRenewal(event.answer, event.readAt, by);
    case "watch":
      return watchHealth(by);
  }
};

const observed = Effect.gen(function* () {
  const health = yield* observedHealth();
  return { ...health, observation: yield* storedObservation() };
});

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    const previous = run;
    run = ManagedRuntime.make(Layer.mergeAll(healthState(), storage));
    await previous.dispose();
    await run.runPromise(Effect.gen(function* () {
      const db = yield* D1;
      yield* db.run(sql`DELETE FROM private_intake_status`);
    }));
  },
  dispatch: (_key, event: Event, by) => run.runPromise(sent(event, by as Renewer).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("Rejected", () => Effect.succeed("refused" as const)),
  )),
  observe: () => run.runPromise(observed),
  [Symbol.asyncDispose]: async () => {
    await run.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["intake"], walks: 20, steps: 20 };
