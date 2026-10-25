import { WorkerEntrypoint } from "cloudflare:workers";
import type { ReviewEnv } from "./review";
import { importSubscriptionAssessment } from "./value-import";

/** Named RPC entrypoint. It has no public fetch route. */
export class HistoricalValuePublisher extends WorkerEntrypoint<
  ReviewEnv & { SLOPBOT_PRODUCER_REVISION?: string }
> {
  publishSubscription(input: unknown, bundle?: ReadableStream<Uint8Array>) {
    return importSubscriptionAssessment(this.env, input, bundle);
  }
}
