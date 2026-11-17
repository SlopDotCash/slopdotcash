import { WorkerEntrypoint } from "cloudflare:workers";
import type { ReviewEnv } from "./review";
import { importSubscriptionAssessment } from "./value-import";
import { withHistoricalIntakeDiagnostics } from "./value-import-diagnostics";
import type { ValueSettingsEnv } from "./value-settings";

/** Named RPC entrypoint. It has no public fetch route. */
export class HistoricalValuePublisher extends WorkerEntrypoint<
  ReviewEnv & ValueSettingsEnv & { SLOPBOT_PRODUCER_REVISION?: string }
> {
  publishSubscription(input: unknown, bundle?: ReadableStream<Uint8Array>) {
    return withHistoricalIntakeDiagnostics((observe) =>
      importSubscriptionAssessment(this.env, input, bundle, observe),
    );
  }
}
