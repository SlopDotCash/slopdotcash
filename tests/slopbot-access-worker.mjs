/**
 * The registry browser lane's Slopbot service binding. It serves the real
 * repository-access route from workers/slopbot/repository-access.ts and
 * sends its GitHub App calls to the loopback GitHub fixture instead of
 * api.github.com. The App key is a throwaway made for each run.
 */
import {
  handleRepositoryAccess,
  REPOSITORY_ACCESS_URL,
} from "../workers/slopbot/repository-access";

const route = new URL(REPOSITORY_ACCESS_URL);

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (
      request.method !== "GET" ||
      url.origin !== route.origin ||
      url.pathname !== route.pathname
    )
      return new Response("not found", { status: 404 });
    return handleRepositoryAccess(request, env, (input, init) => {
      const target = new URL(String(input));
      if (target.origin !== "https://api.github.com")
        throw new Error("Slopbot fixture reached an unexpected origin");
      return fetch(
        `${env.GITHUB_FIXTURE_ORIGIN}/__slopbot${target.pathname}${target.search}`,
        init,
      );
    });
  },
};
