/** Staging installation lookup; historical intake has a separate named binding. */
import { routeRepositoryAccess } from "./repository-access";

export { ReportingReadinessRefresher } from "./reporting-readiness-service";
export { HistoricalValuePublisher } from "./value-import-service";

type Env = { SLOPBOT_APP_ID: string; SLOPBOT_APP_PRIVATE_KEY: string };

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return (
      routeRepositoryAccess(request, env) ??
      new Response("not found", { status: 404 })
    );
  },
};
