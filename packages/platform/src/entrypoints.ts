/// <reference path="./cloudflare.d.ts" />
// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Cause, type Effect, Exit, type Layer, ManagedRuntime } from "effect";
import type { DurableObjectState, ExecutionContext } from "./bindings.ts";

type Method<S> = (...args: never[]) => Effect.Effect<unknown, unknown, S>;

export type Methods<S> = Readonly<Record<string, Method<S>>>;

export type Remote<M> = {
  readonly [K in keyof M]: M[K] extends (...args: infer A) => Effect.Effect<infer V, infer _E, infer _R> ? (...args: A) => Promise<V> : never;
};

export interface ObjectHandler<S, M extends Methods<S>> {
  readonly start?: Effect.Effect<void, unknown, S>;
  readonly methods: M;
}

type Runtime<S, LE> = ManagedRuntime.ManagedRuntime<S, LE>;

async function outcome<A, E, S, LE>(runtime: Runtime<S, LE>, program: Effect.Effect<A, E, S>): Promise<A> {
  const exit = await runtime.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

function remote<S, LE, M extends Methods<S>>(prototype: object, methods: M, instances: WeakMap<object, Runtime<S, LE>>): void {
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(prototype, name, {
      async value(this: object, ...args: never[]) {
        const runtime = instances.get(this);
        if (runtime === undefined) throw new TypeError(`${name} was called on an object this class did not construct`);
        return outcome(runtime, method(...args));
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}

export function entrypoint<Env extends object, S, LE, M extends Methods<S>>(services: (env: Env) => Layer.Layer<S, LE>, methods: M) {
  const isolates = new WeakMap<Env, Runtime<S, LE>>();
  const instances = new WeakMap<object, Runtime<S, LE>>();
  const runtimeFor = (env: Env) => {
    const found = isolates.get(env);
    if (found !== undefined) return found;
    const made = ManagedRuntime.make(services(env));
    isolates.set(env, made);
    return made;
  };
  class Entrypoint extends WorkerEntrypoint<Env> {
    constructor(ctx: ExecutionContext, env: Env) {
      super(ctx, env);
      instances.set(this, runtimeFor(env));
    }
  }
  remote(Entrypoint.prototype, methods, instances);
  return Entrypoint as unknown as new (ctx: ExecutionContext, env: Env) => WorkerEntrypoint<Env> & Remote<M>;
}

export function durableObject<Env extends object, S, LE, M extends Methods<S>>(services: (state: DurableObjectState, env: Env) => Layer.Layer<S, LE>, handler: ObjectHandler<S, M>) {
  const instances = new WeakMap<object, Runtime<S, LE>>();
  class Durable extends DurableObject<Env> {
    constructor(state: DurableObjectState, env: Env) {
      super(state, env);
      const runtime = ManagedRuntime.make(services(state, env));
      instances.set(this, runtime);
      const { start } = handler;
      if (start !== undefined) void state.blockConcurrencyWhile(() => outcome(runtime, start));
    }
  }
  remote(Durable.prototype, handler.methods, instances);
  return Durable as unknown as new (state: DurableObjectState, env: Env) => DurableObject<Env> & Remote<M>;
}
