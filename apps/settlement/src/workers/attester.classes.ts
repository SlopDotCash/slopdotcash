// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"; spec/settlement/signer.md, "A signer stack signs only for its own networks, and production signs only enabled mainnets as the attester"; spec/settlement/signer.md, "Both possible winners stay retained"
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";
import type { DurableObjectNamespace, DurableObjectState, ExecutionContext, ScheduledController } from "@repo/platform/bindings";
import { durableJournal } from "@repo/platform/journal";
import { worker } from "@repo/platform/worker";
import { adoptKeyValue } from "../journal/journal.vibe";
import { NETWORKS, isNetworkKey } from "../kernels/networks.ts";
import { type AttesterObjectEnv, attesterRoutes, attesterScheduled, attesterServices } from "../signer/attesterRoutes.vibe";

interface JournalStub {
  fetch(request: Request): Promise<Response>;
  scheduledRun(controller: ScheduledController): Promise<void>;
}

export interface AttesterWorkerEnv extends AttesterObjectEnv {
  readonly JOURNAL: DurableObjectNamespace<JournalStub>;
}

const JOURNALS = { test: "dedicated-test-signer-v1", production: "production-signer-v1" } as const;

function journalOf(env: AttesterWorkerEnv): JournalStub | undefined {
  const name = env.SIGNER_STACK === undefined || env.SIGNER_STACK === "test" ? JOURNALS.test : env.SIGNER_STACK === "production" ? JOURNALS.production : undefined;
  return name === undefined ? undefined : env.JOURNAL.get(env.JOURNAL.idFromName(name));
}

const notFound = (): Response => new Response("Not found", { status: 404 });

function pinned(text: string | undefined): boolean {
  const trimmed = text?.trim();
  return trimmed !== undefined && trimmed !== "" && trimmed !== "[]";
}

function familyOf(env: AttesterWorkerEnv): "evm" | "solana" | undefined {
  const network = env.PAYMENT_NETWORK ?? "";
  return isNetworkKey(network) ? NETWORKS[network].family : undefined;
}

function contextOf(state: DurableObjectState): ExecutionContext {
  return { waitUntil: (promise) => state.waitUntil(promise) };
}

export class PaymentSignerJournal extends DurableObject<AttesterWorkerEnv> {
  readonly #state: DurableObjectState;
  readonly #app: ReturnType<typeof workerOf>;
  readonly #ready: Promise<void>;

  constructor(state: DurableObjectState, env: AttesterWorkerEnv) {
    super(state, env);
    this.#state = state;
    this.#app = workerOf(state, env);
    this.#ready = state.blockConcurrencyWhile(() => Effect.runPromise(Effect.provide(adoptKeyValue(state.storage), durableJournal(state))));
  }

  async fetch(request: Request): Promise<Response> {
    await this.#ready;
    return this.#app.fetch(request, this.env, contextOf(this.#state));
  }

  async scheduledRun(controller: ScheduledController): Promise<void> {
    await this.#ready;
    await this.#app.scheduled(controller, this.env, contextOf(this.#state));
  }
}

function workerOf(state: DurableObjectState, env: AttesterWorkerEnv) {
  return worker({ services: () => attesterServices(state, env), routes: attesterRoutes(env), scheduled: attesterScheduled(env) });
}

function forwarded(env: AttesterWorkerEnv, request: Request, admitted: boolean): Promise<Response> {
  const journal = journalOf(env);
  return admitted && journal !== undefined ? journal.fetch(request) : Promise.resolve(notFound());
}

export class BindingRecovery extends WorkerEntrypoint<AttesterWorkerEnv> {
  async reconcile(request: unknown): Promise<unknown> {
    const admitted = this.env.SIGNER_STACK === "production" && familyOf(this.env) === "evm";
    const answer = await forwarded(this.env, new Request("https://attester.internal/v1/reconcile-binding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }), admitted);
    if (!answer.ok) throw new Error("binding recovery refused");
    return answer.json();
  }

  async fetch(request: Request): Promise<Response> {
    const admitted = request.method === "POST" && new URL(request.url).pathname === "/v1/reconcile-binding" && this.env.SIGNER_STACK === "production" && familyOf(this.env) === "evm";
    return forwarded(this.env, request, admitted);
  }
}

export class MonthlyReserveRelease extends WorkerEntrypoint<AttesterWorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    const admitted = request.method === "POST" && new URL(request.url).pathname === "/v1/monthly-reserve-release" && pinned(this.env.PAYMENT_DEPLOYMENTS);
    return forwarded(this.env, request, admitted);
  }
}

const SOLANA_BINDING_PATHS: ReadonlySet<string> = new Set(["/v1/pay", "/v1/complete-bind", "/v1/security/pay", "/v1/security/complete-bind"]);

export class SolanaBinding extends WorkerEntrypoint<AttesterWorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    const admitted = request.method === "POST" && SOLANA_BINDING_PATHS.has(new URL(request.url).pathname) && this.env.SIGNER_STACK === "production" && familyOf(this.env) === "solana";
    return forwarded(this.env, request, admitted);
  }
}

export const attesterEntry = {
  fetch: (request: Request, env: AttesterWorkerEnv): Promise<Response> => forwarded(env, request, true),
  scheduled: async (controller: ScheduledController, env: AttesterWorkerEnv): Promise<void> => {
    if (!pinned(env.PAYMENT_DEPLOYMENTS) && !pinned(env.SECURITY_PAYMENT_DEPLOYMENTS) && !env.PAYMENT_DEPLOYMENTS?.startsWith("pins:")) return;
    const journal = journalOf(env);
    if (journal === undefined) throw new Error("Unknown SIGNER_STACK");
    await journal.scheduledRun({ cron: controller.cron, scheduledTime: controller.scheduledTime });
  },
};
