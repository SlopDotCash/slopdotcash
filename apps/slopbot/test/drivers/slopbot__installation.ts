// spec/slopbot/installation.md, "Story: Apply installation changes in GitHub's order"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { migrationsDir } from "@repo/platform/testing/paths";
import { ProjectAudience } from "@repo/ports/backend";
import { Notices } from "@repo/ports/operations";
import type { Driver, Options } from "../../gen/slopbot__installation.conformance.ts";
import type { Event, Installation } from "../../gen/slopbot__installation.ts";
import { type Numbered, deliver, installationState } from "../../src/installation/store.vibe";

const mf = startWorker({ d1: { SLOPBOT_DB: "installation-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);

const noNotices = Layer.mergeAll(
  Layer.succeed(ProjectAudience, { listedBy: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`), owners: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`) }),
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOPBOT_DB")), webCrypto, noNotices));

type Observed = Pick<Installation, "known" | "suspended" | "removed" | "sourceTime" | "processed">;
const account = { id: 1, login: "installation-owner", type: "User" };
const keys = ["a", "b"];
let generation = 0;
const sent = new Map<string, number[]>();

function installationOf(key: string) {
  return 900_000 + generation * 10 + keys.indexOf(key);
}

function deliveriesOf(key: string): [Numbered, ...Numbered[]] {
  const numbers = sent.get(key) ?? [];
  return [{ deliveryId: `installation-${generation}-${key}-none`, number: 0 }, ...numbers.map((number) => ({ deliveryId: `installation-${generation}-${key}-${number}`, number }))];
}

function view(state: Installation): Observed {
  return { known: state.known, suspended: state.suspended, removed: state.removed, sourceTime: state.sourceTime, processed: state.processed };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    sent.clear();
  },
  dispatch: (key, event: Event) => {
    const numbers = sent.get(key) ?? [];
    if (!numbers.includes(event.e.delivery)) sent.set(key, [...numbers, event.e.delivery]);
    return outcome(deliver({
      installationId: installationOf(key),
      account: event.e.hasAccount ? account : undefined,
      deliveryId: `installation-${generation}-${key}-${event.e.delivery}`,
      event: event.e,
      servedProjects: [],
    }, deliveriesOf(key)), runtime);
  },
  observe: async (key) => view(await runtime.runPromise(installationState(installationOf(key), deliveriesOf(key)))),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys, view, walks: 4, steps: 12 };
