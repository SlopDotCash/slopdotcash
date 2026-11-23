// spec/settlement/asiNovemberCloseout.md, "Story: Close ASI's November pool early from one reviewed import"; spec/settlement/unsafeDestinations.md, "Story: Keep accepted cycle files and unsafe-destination evidence on a trusted base"
import type { GitHubFake } from "@repo/platform/testing/github";

export interface Reachable {
  readonly hub: GitHubFake;
  readonly requests: string[];
  readonly published: Uint8Array<ArrayBuffer>;
}

/** @throws {never} */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** @throws {never} */
export function closeoutFetch(world: Reachable): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    world.requests.push(`${url.host}${url.pathname}`);
    if (url.host === "slop.cash" && url.pathname === "/data/leaderboard.json") return new Response(world.published, { status: 200, headers: { "content-type": "application/json" } });
    if (url.host === "api.github.com") return world.hub.fetch(request);
    return new Response("not found", { status: 404 });
  };
}
