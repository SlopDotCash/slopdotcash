// spec/slopbot/valueRequests.md, "Story: Claim each due request alone for its pull request"; spec/slopbot/valueRequests.md, "Story: Decide one fixed outcome from current evidence"; spec/slopbot/valueRequests.md, "Story: Lease every source of a group or none"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { ProjectAudience } from "@repo/ports/backend";
import { Notices } from "@repo/ports/operations";
import type { RegistryObservation } from "../../gen/slopbot__repositoryScope.ts";
import type { Driver, Options } from "../../gen/slopbot__valueRequests.conformance.ts";
import type { Event, ValueRequests } from "../../gen/slopbot__valueRequests.ts";
import { valueRequestInsert } from "../../src/ingress/valueRequest.vibe";
import { type Numbered, deliver, installationState } from "../../src/installation/store.vibe";
import { leaseSources } from "../../src/value/requests/leases.vibe";
import { type Claim, type Run, type Source, checkParked, claimRequest, idle, recordOutcome, startRun, valueRequestsOf } from "../../src/value/requests/store.vibe";

const start = 1_793_491_300;
const clock = settableClock(start * 1000);
const mf = startWorker({ d1: { SLOPBOT_DB: "value-requests-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);

const noNotices = Layer.mergeAll(
  Layer.succeed(ProjectAudience, { listedBy: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`), owners: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`) }),
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]), payoutRecipient: (project) => Effect.succeed(project.stewardGithubId) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOPBOT_DB")), webCrypto, noNotices, clock.layer));
const account = { id: 1, login: "value-requests-owner", type: "User" };

type Observed = Omit<ValueRequests, "install"> & { readonly install: Pick<ValueRequests["install"], "known" | "suspended" | "removed" | "sourceTime"> };

let generation = 0;
let run: Run = idle;
let lastToken = 0;
const deliveries = new Map<number, string>();
const tokens = new Map<number, Claim>();
const installs: number[] = [];

const base = () => 1_000_000 * (generation + 1);
const installationId = () => 600_000 + generation;
const deliveryText = (id: number) => `value-requests-${generation}-${id}`;
const repositoryOf = (repository: number) => (repository > 0 ? base() + repository : repository);
const sourceOf = (source: number): Source => ({ repositoryDatabaseId: base() + 500_000 + source, pullRequestNumber: 1 });
const sourceKey = (source: number) => `${base() + 500_000 + source}:1`;

function installDeliveries(): [Numbered, ...Numbered[]] {
  return [{ deliveryId: `value-requests-${generation}-install-none`, number: 0 }, ...installs.map((number) => ({ deliveryId: `value-requests-${generation}-install-${number}`, number }))];
}

function registryOf(registry: RegistryObservation): RegistryObservation {
  return { ...registry, registeredId: repositoryOf(registry.registeredId), observedId: repositoryOf(registry.observedId) };
}

function claimOf(token: number): Claim {
  return tokens.get(token) ?? { deliveryId: `value-requests-${generation}-missing`, token: `value-requests-${generation}-missing-${token}` };
}

function isRefusal(error: unknown) {
  return typeof error === "object" && error !== null && "_tag" in error && (error._tag === "Rejected" || error._tag === "InvalidSources");
}

function accepted<A>(sent: Effect.Effect<A, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>, isAccepted: (value: A) => boolean) {
  return runtime.runPromise(sent.pipe(
    Effect.map((value) => (isAccepted(value) ? "accepted" as const : "refused" as const)),
    Effect.catch((error) => (isRefusal(error) ? Effect.succeed("refused" as const) : Effect.fail(error))),
  ));
}

const record = (deliveryId: number, key: Extract<Event, { type: "record" }>["key"]) => Effect.gen(function* () {
  const valid = key.installation > 0 && key.repository > 0 && key.pull > 0 && key.owner !== "" && key.repo !== "";
  if (deliveryId <= 0 || deliveries.has(deliveryId) || !valid) return false;
  const at = new Date(clock.now()).toISOString();
  const text = deliveryText(deliveryId);
  const value = { installation: installationId(), repository: repositoryOf(key.repository), owner: key.owner, repo: key.repo, pull: key.pull };
  const [, inserted] = yield* (yield* D1).batch([
    sql`INSERT INTO slopbot_deliveries (delivery_id, event, received_at) VALUES (${text}, 'pull_request', ${at})`,
    valueRequestInsert(text, value, at),
  ]);
  if (inserted?.changes !== 1) return false;
  deliveries.set(deliveryId, text);
  return true;
});

function names() {
  return {
    deliveries: new Map([...deliveries].map(([id, text]) => [text, id])),
    tokens: new Map([...tokens].map(([token, claim]) => [claim.token, token])),
    sources: new Map([1, 2, 3, 4].map((source) => [sourceKey(source), source])),
    lastToken,
  };
}

function live(state: ValueRequests, token: number) {
  return token > 0 && state.deliveries.some((delivery) => delivery.token === token && delivery.state === "Running" && delivery.leaseUntil > state.now);
}

function view(state: ValueRequests): Observed {
  const { known, suspended, removed, sourceTime } = state.install;
  const groups = state.groups.filter((group) => live(state, group.token)).sort((left, right) => left.token - right.token);
  return { ...state, groups, install: { known, suspended, removed, sourceTime } };
}

function restored(state: ValueRequests): Observed {
  const back = (repository: number) => (repository > base() ? repository - base() : repository);
  return view({
    ...state,
    deliveries: state.deliveries.map((delivery) => ({ ...delivery, key: { ...delivery.key, installation: 1, repository: back(delivery.key.repository) } })),
    parkedChecks: state.parkedChecks.map((check) => ({ ...check, target: { ...check.target, repository: back(check.target.repository) } })),
  });
}

function dispatch(event: Event): Promise<"accepted" | "refused"> {
  switch (event.type) {
    case "elapse": {
      if (event.seconds <= 0) return Promise.resolve("refused");
      clock.advance(event.seconds * 1000);
      return Promise.resolve("accepted");
    }
    case "applyInstallation": {
      if (!installs.includes(event.e.delivery)) installs.push(event.e.delivery);
      return outcome(deliver({
        installationId: installationId(),
        account: event.e.hasAccount ? account : undefined,
        deliveryId: `value-requests-${generation}-install-${event.e.delivery}`,
        event: event.e,
        servedProjects: [],
      }, installDeliveries()), runtime);
    }
    case "startRun":
      return accepted(startRun(run).pipe(Effect.tap((next) => Effect.sync(() => { run = next; }))), () => true);
    case "record":
      return accepted(record(event.deliveryId, event.key), (done) => done);
    case "claim":
      return accepted(claimRequest(run, deliveries.get(event.deliveryId) ?? deliveryText(event.deliveryId)).pipe(Effect.tap((claimed) => Effect.sync(() => {
        if (claimed === undefined) return;
        run = claimed.run;
        lastToken += 1;
        tokens.set(lastToken, claimed.claim);
      }))), (claimed) => claimed !== undefined);
    case "finish": {
      const { sources, ...gathered } = event.observation;
      const claim = { deliveryId: deliveries.get(event.deliveryId) ?? deliveryText(event.deliveryId), token: claimOf(event.token).token };
      return accepted(recordOutcome(claim, { ...gathered, registry: registryOf(gathered.registry) }, sources.map(sourceOf)), () => true);
    }
    case "checkParked":
      return accepted(checkParked({ repositoryId: repositoryOf(event.target.repository), owner: event.target.owner, repo: event.target.repo }, registryOf(event.registry)), (resumed) => resumed !== undefined);
    case "claimGroup":
      return accepted(leaseSources(claimOf(event.token), event.sources.map(sourceOf)), (leased) => leased);
  }
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    run = idle;
    lastToken = 0;
    deliveries.clear();
    tokens.clear();
    installs.length = 0;
    clock.set(start * 1000);
  },
  dispatch: (_key, event: Event) => dispatch(event),
  observe: async () => {
    const state = await runtime.runPromise(valueRequestsOf([...deliveries.values()], installationId(), run, names()));
    const install = await runtime.runPromise(installationState(installationId(), installDeliveries()));
    return restored({ ...state, install });
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["requests"], walks: 3, steps: 14, view };
