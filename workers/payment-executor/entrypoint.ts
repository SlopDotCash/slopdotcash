import { WorkerEntrypoint } from "cloudflare:workers";
import type { Environment } from "./index";
import { SIGNER_STACKS } from "./signer-stacks.mjs";

export { default, PaymentSignerJournal } from "./index";

/** Pages receives this entrypoint only, never the default signing service. */
export class BindingRecovery extends WorkerEntrypoint<Environment> {
  async fetch(request: Request): Promise<Response> {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/v1/reconcile-binding" ||
      this.env.SIGNER_STACK !== "production" ||
      this.env.SIGNER_ROLE !== "attester" ||
      this.env.CHAIN_FAMILY !== "evm"
    )
      return new Response("Not found", { status: 404 });
    return this.env.JOURNAL.get(
      this.env.JOURNAL.idFromName(SIGNER_STACKS.production.journal),
    ).fetch(request);
  }
}
