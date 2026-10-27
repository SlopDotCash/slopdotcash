import { WorkerEntrypoint } from "cloudflare:workers";
import type { Environment } from "./index";
import { SIGNER_STACKS, signerStack } from "./signer-stacks.mjs";

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

/** Authenticated Pages owner actions only; no default signer or payment access. */
export class MonthlyReserveRelease extends WorkerEntrypoint<Environment> {
  async fetch(request: Request): Promise<Response> {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/v1/monthly-reserve-release" ||
      this.env.SIGNER_ROLE !== "attester" ||
      this.env.PAYMENT_SCOPE === "security-bounty"
    )
      return new Response("Not found", { status: 404 });
    return this.env.JOURNAL.get(
      this.env.JOURNAL.idFromName(
        SIGNER_STACKS[signerStack(this.env.SIGNER_STACK)].journal,
      ),
    ).fetch(request);
  }
}

/** Pages may prepare/complete a Solana wallet binding, never dispatch a payment. */
export class SolanaBinding extends WorkerEntrypoint<Environment> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (
      request.method !== "POST" ||
      ![
        "/v1/pay",
        "/v1/complete-bind",
        "/v1/security/pay",
        "/v1/security/complete-bind",
      ].includes(path) ||
      this.env.SIGNER_STACK !== "production" ||
      this.env.SIGNER_ROLE !== "attester" ||
      this.env.CHAIN_FAMILY !== "solana"
    )
      return new Response("Not found", { status: 404 });
    return this.env.JOURNAL.get(
      this.env.JOURNAL.idFromName(SIGNER_STACKS.production.journal),
    ).fetch(request);
  }
}
