import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type ReportingRefreshEnv,
  refreshRegisteredReporting,
} from "./reporting-readiness";

/** Private named binding from the existing identity schedule; no public route. */
export class ReportingReadinessRefresher extends WorkerEntrypoint<ReportingRefreshEnv> {
  refreshReportingReadiness() {
    return refreshRegisteredReporting(this.env);
  }
}
