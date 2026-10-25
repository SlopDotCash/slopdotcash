/** Staging installation lookup; historical intake has a separate named binding. */
import {
  handleRepositoryAccess,
  REPOSITORY_ACCESS_URL,
} from "./repository-access";

export { ReportingReadinessRefresher } from "./reporting-readiness-service";
export { HistoricalValuePublisher } from "./value-import-service";

type Env = { SLOPBOT_APP_ID: string; SLOPBOT_APP_PRIVATE_KEY: string };

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const url = new URL(request.url);
    const target = new URL(REPOSITORY_ACCESS_URL);
    if (
      request.method !== "GET" ||
      url.origin !== target.origin ||
      url.pathname !== target.pathname
    )
      return new Response("not found", { status: 404 });
    return handleRepositoryAccess(request, env);
  },
};
