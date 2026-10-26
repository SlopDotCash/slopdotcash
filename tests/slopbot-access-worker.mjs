/**
 * The registry browser lane's Slopbot service binding. It serves the real
 * repository-access route from workers/slopbot/repository-access.ts and
 * sends its GitHub App calls to the loopback GitHub fixture instead of
 * api.github.com. The App key is a throwaway made for each run.
 */

import { githubAppReportingReader } from "../backend/security/github-advisories";
import { refreshRegisteredReporting } from "../workers/slopbot/reporting-readiness";
import { routeRepositoryAccess } from "../workers/slopbot/repository-access";

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    // Loopback fixture control only; production exports named RPC without fetch.
    if (
      request.method === "POST" &&
      url.hostname === "127.0.0.1" &&
      url.pathname === "/__fixture/reporting-refresh"
    ) {
      return refreshRegisteredReporting(
        env,
        githubAppReportingReader({
          appId: env.SLOPBOT_APP_ID,
          privateKey: env.SLOPBOT_APP_PRIVATE_KEY,
          apiOrigin: env.GITHUB_FIXTURE_ORIGIN,
          fetch: (url, init) => fetch(url, init),
          now: () => new Date(),
        }),
      ).then((result) => Response.json(result));
    }
    return (
      routeRepositoryAccess(request, env, (input, init) => {
        const target = new URL(String(input));
        if (target.origin !== "https://api.github.com")
          throw new Error("Slopbot fixture reached an unexpected origin");
        return fetch(
          `${env.GITHUB_FIXTURE_ORIGIN}/__slopbot${target.pathname}${target.search}`,
          init,
        );
      }) ?? new Response("not found", { status: 404 })
    );
  },
};
