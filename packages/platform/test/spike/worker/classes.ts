import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Cause, Exit, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "../../../src/crypto.vibe";
import type { DurableObjectState } from "../bindings.ts";
import { Refusal, entries, migrateJournal, objectStorage, record } from "./journal.vibe";
import { type ServiceEnv, serviceLayer, stamp } from "./stamps.vibe";

export class Journal extends DurableObject<ServiceEnv> {
  readonly #runtime;

  constructor(ctx: DurableObjectState, env: ServiceEnv) {
    super(ctx, env);
    this.#runtime = ManagedRuntime.make(Layer.mergeAll(objectStorage(ctx.storage), webCrypto));
    void ctx.blockConcurrencyWhile(() => this.#runtime.runPromise(migrateJournal()));
  }

  async record(key: string, texts: ReadonlyArray<string>, refuseAfterWriting: boolean) {
    const exit = await this.#runtime.runPromiseExit(record(key, texts, refuseAfterWriting));
    if (Exit.isSuccess(exit)) return { committed: exit.value };
    const error = Cause.squash(exit.cause);
    return { refused: error instanceof Refusal ? error.reason : String(error) };
  }

  entries(key: string) {
    return this.#runtime.runPromise(entries(key));
  }
}

const runtimes = new WeakMap<ServiceEnv, ManagedRuntime.ManagedRuntime<Layer.Success<ReturnType<typeof serviceLayer>>, never>>();

function runtimeFor(env: ServiceEnv) {
  const found = runtimes.get(env);
  if (found !== undefined) return found;
  const made = ManagedRuntime.make(serviceLayer(env));
  runtimes.set(env, made);
  return made;
}

export class Verifier extends WorkerEntrypoint<ServiceEnv> {
  stamp(text: string): Promise<string> {
    return runtimeFor(this.env).runPromise(stamp(text));
  }
}
