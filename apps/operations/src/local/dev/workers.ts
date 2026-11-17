// spec/backend/local.md, "A handoff binds one actor, exact loopback origin and environment"
import { Schema } from "effect";
import { Miniflare, Response as WorkerResponse } from "miniflare";
import { unstable_readConfig } from "wrangler";
import type { D1Database } from "@repo/platform/bindings";
import { type Bindings, type ExtraWorker, type Handler, type MailSink, type WorkerOptions, workerOptions } from "@repo/platform/testing";

export interface Deployable {
  readonly name: string;
  readonly config: string;
  readonly script: string;
  readonly assets?: string;
}

export interface AssertionStore {
  readonly deployable: string;
  readonly binding: string;
}

export interface LocalStart {
  readonly deployables: readonly [Deployable, ...Deployable[]];
  readonly vars: Readonly<Record<string, string>>;
  readonly persistence: string;
  readonly sink: MailSink;
  readonly assertions: AssertionStore;
}

export interface LocalWorkers {
  readonly mf: Miniflare;
  readonly database: D1Database;
}

const Named = Schema.Struct({ binding: Schema.String });

const WranglerConfig = Schema.Struct({
  name: Schema.optional(Schema.String),
  compatibility_date: Schema.optional(Schema.String),
  vars: Schema.Record(Schema.String, Schema.Unknown),
  d1_databases: Schema.Array(Schema.Struct({ binding: Schema.String, database_name: Schema.optional(Schema.String), database_id: Schema.optional(Schema.String) })),
  r2_buckets: Schema.Array(Named),
  services: Schema.optional(Schema.Array(Schema.Struct({ binding: Schema.String, service: Schema.String }))),
  queues: Schema.Struct({
    producers: Schema.optional(Schema.Array(Schema.Struct({ binding: Schema.String, queue: Schema.optional(Schema.String) }))),
    consumers: Schema.optional(Schema.Array(Schema.Struct({ queue: Schema.String, max_retries: Schema.optional(Schema.Number), dead_letter_queue: Schema.optional(Schema.String) }))),
  }),
  ratelimits: Schema.Array(Schema.Struct({ name: Schema.String, simple: Schema.Struct({ limit: Schema.Number, period: Schema.Literals([10, 60]) }) })),
  send_email: Schema.Array(Schema.Struct({ name: Schema.String, destination_address: Schema.optional(Schema.String), allowed_destination_addresses: Schema.optional(Schema.Array(Schema.String)) })),
  durable_objects: Schema.Struct({ bindings: Schema.Array(Schema.Struct({ name: Schema.String, class_name: Schema.String })) }),
});

type Config = typeof WranglerConfig.Type;
type DatabaseBinding = Config["d1_databases"][number];

const unavailable: Handler = () => new WorkerResponse(JSON.stringify({ error: "local_service_unavailable" }), { status: 503, headers: { "content-type": "application/json" } });

function textOf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function databaseName(database: DatabaseBinding): string {
  return database.database_name ?? database.database_id ?? database.binding;
}

function assertionDatabase(configs: ReadonlyArray<{ readonly deployable: Deployable; readonly config: Config }>, assertions: AssertionStore) {
  const owner = configs.find(({ deployable }) => deployable.name === assertions.deployable);
  const bound = owner?.config.d1_databases.find((database) => database.binding === assertions.binding);
  if (owner === undefined || bound === undefined) throw new Error(`The ${assertions.deployable} deployable binds no ${assertions.binding} database`);
  const name = databaseName(bound);
  const strays = configs.flatMap(({ deployable, config }) => config.d1_databases.filter((database) => databaseName(database) !== name).map((database) => `${deployable.name}.${database.binding}`));
  if (strays.length > 0) throw new Error(`Every local deployable must bind the ${name} database that ${assertions.deployable}.${assertions.binding} names; these do not: ${strays.join(", ")}`);
  return { owner: owner.deployable.name, binding: bound.binding };
}

function bindingsOf(deployable: Deployable, config: Config, start: LocalStart, services: Readonly<Record<string, Handler>>): Bindings {
  return {
    d1: Object.fromEntries(config.d1_databases.map((database) => [database.binding, databaseName(database)])),
    r2: config.r2_buckets.map((bucket) => bucket.binding),
    vars: { ...Object.fromEntries(Object.entries(config.vars).map(([name, value]) => [name, textOf(value)])), ...start.vars },
    services,
    queues: {
      producers: Object.fromEntries((config.queues.producers ?? []).map((producer) => [producer.binding, producer.queue ?? producer.binding])),
      consumers: Object.fromEntries((config.queues.consumers ?? []).map((consumer) => [consumer.queue, {
        maxRetries: consumer.max_retries ?? 3,
        ...consumer.dead_letter_queue === undefined ? {} : { deadLetterQueue: consumer.dead_letter_queue },
      }])),
    },
    ratelimits: Object.fromEntries(config.ratelimits.map((limit) => [limit.name, limit.simple])),
    email: Object.fromEntries(config.send_email.map((mail) => [mail.name, {
      sink: start.sink,
      ...mail.destination_address === undefined ? {} : { destinationAddress: mail.destination_address },
      ...mail.allowed_destination_addresses === undefined ? {} : { allowedDestinationAddresses: mail.allowed_destination_addresses },
    }])),
    durableObjects: Object.fromEntries(config.durable_objects.bindings.map((binding) => [binding.name, binding.class_name])),
    ...deployable.assets === undefined ? {} : { assets: deployable.assets },
  };
}

/** @throws {never} */
export async function startLocal(start: LocalStart): Promise<LocalWorkers> {
  const configs = start.deployables.map((deployable) => ({ deployable, config: Schema.decodeUnknownSync(WranglerConfig)(unstable_readConfig({ config: deployable.config }, { hideWarnings: true })) }));
  const assertions = assertionDatabase(configs, start.assertions);
  const byService = new Map(configs.map(({ deployable, config }) => [config.name ?? deployable.name, deployable.name]));
  const holder: { mf?: Miniflare } = {};
  const forwardTo = (worker: string): Handler => async (request) => {
    if (holder.mf === undefined) return unavailable(request);
    const target = (await holder.mf.getWorker(worker)) as unknown as { fetch(input: string, init: RequestInit): Promise<WorkerResponse> };
    const body = request.method === "GET" || request.method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());
    return target.fetch(request.url, { method: request.method, headers: [...request.headers], body, redirect: "manual" });
  };
  const servicesOf = (config: Config) => Object.fromEntries((config.services ?? []).map((service) => {
    const local = byService.get(service.service);
    return [service.binding, local === undefined ? unavailable : forwardTo(local)];
  }));
  const [main, ...extras] = configs;
  if (main === undefined) throw new Error("local serve needs the site deployable");
  const workers = Object.fromEntries(extras.map(({ deployable, config }) => [`LOCAL_${deployable.name.toUpperCase()}`, {
    name: deployable.name,
    script: deployable.script,
    ...bindingsOf(deployable, config, start, servicesOf(config)),
  } satisfies ExtraWorker]));
  const options: WorkerOptions = {
    script: main.deployable.script,
    compatibilityDate: main.config.compatibility_date,
    workers,
    ...bindingsOf(main.deployable, main.config, start, servicesOf(main.config)),
  };
  const mf = new Miniflare({ ...workerOptions(options, []), resourcePersistencePath: start.persistence });
  holder.mf = mf;
  await mf.ready;
  const database = (await mf.getD1Database(assertions.binding, assertions.owner === main.deployable.name ? "worker" : assertions.owner)) as unknown as D1Database;
  return { mf, database };
}

/** @throws {never} */
export async function forward(mf: Miniflare, request: Request): Promise<Response> {
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
  const answer = await mf.dispatchFetch(request.url, { method: request.method, headers: [...request.headers], body, redirect: "manual" });
  return new Response(answer.status === 204 || answer.status === 304 ? null : await answer.arrayBuffer(), { status: answer.status, statusText: answer.statusText, headers: [...answer.headers] });
}

/** @throws {never} */
export async function stopLocal(mf: Miniflare): Promise<void> {
  await mf.dispose();
}
