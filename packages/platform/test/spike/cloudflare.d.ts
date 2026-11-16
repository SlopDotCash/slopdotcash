// The two workerd built-in modules the spike imports. @cloudflare/workers-types is not installed (IDIOMS failed
// assumption 7), so these are the minimal shapes the spike uses; the build keeps both modules external.
declare module "cloudflare:workers" {
  import type { DurableObjectState, ExecutionContext } from "./bindings.ts";

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }

  export abstract class WorkerEntrypoint<Env = unknown> {
    protected readonly ctx: ExecutionContext;
    protected readonly env: Env;
    constructor(ctx: ExecutionContext, env: Env);
  }
}

declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
  }
}
