// spec/slopbot/assessmentInbox.md, "Story: Show one unresolved assessment and its retry status"; spec/slopbot/assessmentInbox.md, "Story: Keep a private assessment read bound to the current authority"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, type Statement, d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/slopbot__assessmentInbox.conformance.ts";
import type { AccessCheck, Event, QueueRead, RegistryBinding } from "../../gen/slopbot__assessmentInbox.ts";
import type { Delivery } from "../../gen/slopbot__valueRequests.ts";
import { outcomeNames, stateNames } from "../../src/value/requests/rows.vibe";
import { completeItem, idleQueue, pullDeliveries, readItem } from "../../src/value/inbox/store.vibe";

const mf = startWorker({ d1: { SLOPBOT_DB: "assessment-inbox-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOPBOT_DB")), webCrypto));

let generation = 0;
let spaces = 0;
const queues = new Map<string, QueueRead>();
const spaceOf = new Map<string, number>();

const baseOf = (space: number) => 1_000_000 * (generation * 1000 + space + 1);
const iso = (millis: number) => new Date(millis).toISOString();
const instant = (millis: number) => (millis === 0 ? null : iso(millis));
const forward = (space: number) => (repository: number) => (repository > 0 ? baseOf(space) + repository : repository);
const backward = (space: number) => (repository: number) => (repository > baseOf(space) ? repository - baseOf(space) : repository);
const deliveryText = (space: number, id: number) => `assessment-inbox-${generation}-${space}-${id}`;

function rowsWritten(space: number, rows: ReadonlyArray<Delivery>): ReadonlyArray<Statement> {
  const ids = JSON.stringify(rows.map((row) => deliveryText(space, row.id)));
  return [
    ...rows.flatMap((row) => {
      const id = deliveryText(space, row.id);
      const received = iso(row.receivedAt);
      return [
        sql`INSERT INTO slopbot_deliveries (delivery_id, event, received_at) SELECT ${id}, 'pull_request', ${received} WHERE NOT EXISTS (SELECT 1 FROM slopbot_deliveries WHERE delivery_id = ${id})`,
        sql`INSERT INTO slopbot_value_requests (delivery_id, installation_id, repository_id, owner, repo, pull_request_number, received_at)
          SELECT ${id}, ${row.key.installation}, ${forward(space)(row.key.repository)}, ${row.key.owner}, ${row.key.repo}, ${row.key.pull}, ${received}
          WHERE NOT EXISTS (SELECT 1 FROM slopbot_value_requests WHERE delivery_id = ${id})`,
        row.state === "Unread"
          ? sql`DELETE FROM slopbot_value_processing WHERE delivery_id = ${id}`
          : sql`INSERT INTO slopbot_value_processing (delivery_id, claim_token, lease_until, state, outcome, retry_at, updated_at, attempts, incomplete_since)
              VALUES (${id}, ${row.token > 0 ? `token-${row.token}` : ""}, ${row.state === "Running" ? iso(row.leaseUntil) : ""}, ${stateNames[row.state]},
                ${row.code === "NoOutcome" ? null : outcomeNames[row.code]}, ${instant(row.retryAt)}, ${iso(row.updatedAt)}, ${row.attempts}, ${instant(row.incompleteSince)})
              ON CONFLICT(delivery_id) DO UPDATE SET claim_token = excluded.claim_token, lease_until = excluded.lease_until, state = excluded.state, outcome = excluded.outcome,
                retry_at = excluded.retry_at, updated_at = excluded.updated_at, attempts = excluded.attempts, incomplete_since = excluded.incomplete_since`,
      ];
    }),
    sql`DELETE FROM slopbot_value_processing WHERE delivery_id LIKE ${`assessment-inbox-${generation}-${space}-%`} AND delivery_id NOT IN (SELECT value FROM json_each(${ids}))`,
  ];
}

function bindingIn(space: number, binding: RegistryBinding): RegistryBinding {
  return { ...binding, repository: forward(space)(binding.repository) };
}

function accessIn(space: number, access: AccessCheck): AccessCheck {
  return { ...access, repository: forward(space)(access.repository) };
}

function restored(space: number | undefined, queue: QueueRead): QueueRead {
  if (space === undefined) return queue;
  const back = backward(space);
  const { request, item } = queue;
  return {
    ...queue,
    request: { ...request, binding: { ...request.binding, repository: back(request.binding.repository) }, key: { ...request.key, repository: back(request.key.repository) } },
    item: item.tag === "Unresolved" ? { ...item, key: { ...item.key, repository: back(item.key.repository) } } : item,
  };
}

function settled(sent: Effect.Effect<QueueRead, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>, key: string, space: number) {
  return runtime.runPromise(sent.pipe(
    Effect.map((next) => {
      queues.set(key, next);
      spaceOf.set(key, space);
      return "accepted" as const;
    }),
    Effect.catch((error) => (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected" ? Effect.succeed("refused" as const) : Effect.fail(error))),
  ));
}

function dispatch(key: string, event: Event, by: number) {
  const current = queues.get(key) ?? idleQueue;
  if (event.type === "read") {
    spaces += 1;
    const space = spaces;
    const request = { ...event.request, binding: bindingIn(space, event.request.binding), key: { ...event.request.key, repository: forward(space)(event.request.key.repository) } };
    return settled(Effect.gen(function* () {
      yield* (yield* D1).batch(rowsWritten(space, event.rows));
      const deliveries = yield* pullDeliveries(request.key);
      return yield* readItem(current, request, by, deliveries);
    }), key, space);
  }
  const space = spaceOf.get(key) ?? spaces + 1;
  return settled(Effect.gen(function* () {
    yield* (yield* D1).batch(rowsWritten(space, event.rows));
    const deliveries = yield* pullDeliveries(current.request.key);
    return yield* completeItem(current, event.requestId, bindingIn(space, event.currentBinding), accessIn(space, event.access), deliveries);
  }), key, space);
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    spaces = 0;
    queues.clear();
    spaceOf.clear();
  },
  dispatch: (key, event: Event, by) => dispatch(key, event, typeof by === "number" ? by : 0),
  observe: (key) => restored(spaceOf.get(key), queues.get(key) ?? idleQueue),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["a", "b"], walks: 4, steps: 10 };
