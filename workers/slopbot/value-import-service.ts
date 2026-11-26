import { WorkerEntrypoint } from "cloudflare:workers";
import type { HistoricalValueDiagnosticReply } from "../../backend/slopbot/value-import";
import { isIntakeCorrelation } from "../../backend/slopbot/value-import-observation";
import type { ReviewEnv } from "./review";
import { importSubscriptionAssessment } from "./value-import";
import {
  type HistoricalIntakeTerminalFailure,
  terminalIntakeFailure,
  withHistoricalIntakeDiagnostics,
} from "./value-import-diagnostics";
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

  async publishSubscriptionDiagnosed(
    input: unknown,
    correlation: string,
    bundle?: ReadableStream<Uint8Array>,
  ): Promise<HistoricalValueDiagnosticReply> {
    if (!isIntakeCorrelation(correlation))
      throw new Error("Invalid historical intake correlation");
    let diagnostic: HistoricalIntakeTerminalFailure | null = null;
    try {
      const receipt = await withHistoricalIntakeDiagnostics(
        (observe) =>
          importSubscriptionAssessment(this.env, input, bundle, observe),
        undefined,
        (failure) => {
          diagnostic = terminalIntakeFailure(failure);
        },
      );
      return { status: 200, receipt };
    } catch {
      return { status: 409, correlation, diagnostic };
    }
  }
}
