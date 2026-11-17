/// <reference path="../../../../packages/platform/src/cloudflare.d.ts" />
// spec/settlement/keeperLifecycle.md, "Public and wrong internal routes cannot start work"; spec/settlement/keeperLifecycle.md, "Core completion and per-request result delivery have independent lifetimes"; spec/settlement/keeperDiagnostics.md, "An invocation exception reports only a fixed failure response"
import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import type { DurableObjectState, ScheduledController } from "@repo/platform/bindings";
import type { KeeperRun } from "../keeper/run.vibe";
import { type Answer, type KeeperEnv, type KeeperObject, type TickAnswer, admitRequest, answer, failedAnswer, objectServices, openObject, runObject, scheduledTick } from "../keeper/object.vibe";

function runtimeOf(state: DurableObjectState, env: KeeperEnv) {
  return ManagedRuntime.make(objectServices(state, env));
}

interface Slot {
  readonly promise: Promise<KeeperRun | undefined>;
  readonly settle: (run: KeeperRun | undefined) => void;
}

const RETAINED_RUNS = 100;

function slot(): Slot {
  let settle: (run: KeeperRun | undefined) => void = () => undefined;
  const promise = new Promise<KeeperRun | undefined>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function respond(answered: Answer): Response {
  return Response.json(answered.body, { status: answered.status });
}

export class OperatorKeeper extends DurableObject<KeeperEnv> {
  readonly #runtime: ReturnType<typeof runtimeOf>;
  readonly #ready: Promise<KeeperObject>;
  #requests = 0;
  readonly #runs = new Map<number, Slot>();

  constructor(state: DurableObjectState, env: KeeperEnv) {
    super(state, env);
    this.#runtime = runtimeOf(state, env);
    this.#ready = state.blockConcurrencyWhile(() => this.#runtime.runPromise(openObject(env)));
  }

  #slot(runId: number): Slot {
    const found = this.#runs.get(runId);
    if (found !== undefined) return found;
    const made = slot();
    this.#runs.set(runId, made);
    for (const kept of this.#runs.keys()) if (kept <= runId - RETAINED_RUNS) this.#runs.delete(kept);
    return made;
  }

  async fetch(request: Request): Promise<Response> {
    const wrong = request.method !== "POST" || new URL(request.url).pathname !== "/tick";
    this.#requests += 1;
    const id = this.#requests;
    try {
      const object = await this.#ready;
      const admitted = this.#runtime.runPromise(admitRequest(object, id, wrong ? "WrongInternalRoute" : "InternalTick"));
      if (wrong) {
        await admitted;
        return new Response("Not found", { status: 404 });
      }
      const started = await admitted;
      const bound = this.#slot(started.runId);
      if (started.fresh && started.working) {
        void this.#runtime.runPromise(runObject(object, started.runId)).then(bound.settle, () => bound.settle(undefined));
      } else if (started.fresh) bound.settle(undefined);
      const run = await bound.promise;
      return respond(await this.#runtime.runPromise(answer(object, id, run)));
    } catch {
      return wrong ? new Response("Not found", { status: 404 }) : respond(failedAnswer);
    }
  }
}

async function tickObject(env: KeeperEnv, name: string): Promise<TickAnswer> {
  const response = await env.KEEPER.get(env.KEEPER.idFromName(name)).fetch(new Request("https://keeper.internal/tick", { method: "POST" }));
  const body: unknown = await response.json().catch(() => undefined);
  return { ok: response.ok, body };
}

export const keeperEntry = {
  fetch: async (): Promise<Response> => new Response("Not found", { status: 404 }),
  scheduled: (_controller: ScheduledController, env: KeeperEnv): Promise<void> => Effect.runPromise(scheduledTick(env, tickObject)),
};
