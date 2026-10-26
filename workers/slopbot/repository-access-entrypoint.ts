/** Staging installation lookup; historical intake has a separate named binding. */
import {
  handleRepositoryAccess,
  handleRepositoryRead,
  REPOSITORY_ACCESS_URL,
  REPOSITORY_READ_URL,
} from "./repository-access";

export { ReportingReadinessRefresher } from "./reporting-readiness-service";
export { HistoricalValuePublisher } from "./value-import-service";

type Env = { SLOPBOT_APP_ID: string; SLOPBOT_APP_PRIVATE_KEY: string };

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const url = new URL(request.url);
    if (request.method !== "GET")
      return new Response("not found", { status: 404 });
    const route = `${url.origin}${url.pathname}`;
    if (route === REPOSITORY_ACCESS_URL)
      return handleRepositoryAccess(request, env);
    if (route === REPOSITORY_READ_URL)
      return handleRepositoryRead(request, env);
    return new Response("not found", { status: 404 });
  },
};
