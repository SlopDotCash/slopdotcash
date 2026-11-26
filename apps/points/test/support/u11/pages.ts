// spec/points/recovery.md, "Recovery requires both verified public copies from the requested environment"
import { Effect } from "effect";
import { Response as WorkerResponse } from "miniflare";
import type { Handler } from "@repo/platform/testing";
import type { AreaShape } from "@repo/platform/testing/area";

export interface ApiAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface SiteOptions {
  readonly api: (pathAndQuery: string) => Promise<ApiAnswer>;
  readonly apiUnavailable?: number;
  readonly apiAbsent?: boolean;
  readonly files: Readonly<Record<string, string>>;
}

export interface Site {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: string[];
}

/** @throws {never} */
export function areaApi(area: AreaShape): (pathAndQuery: string) => Promise<ApiAnswer> {
  return (pathAndQuery) => Effect.runPromise(area.request(pathAndQuery)).then((answer) => ({ status: answer.status, body: answer.body }));
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** @throws {never} */
export function site(options: SiteOptions): Site {
  let unavailable = options.apiUnavailable ?? 0;
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(`${url.origin}${url.pathname}`);
    if (url.pathname === "/api/v1/points/journal") {
      if (options.apiAbsent === true) return answer(503, { error: "points_not_published" });
      if (unavailable > 0) {
        unavailable -= 1;
        return answer(503, { error: "points_unavailable" });
      }
      const served = await options.api(`${url.pathname}${url.search}`);
      return answer(served.status, served.body);
    }
    const file = options.files[url.pathname];
    return file === undefined ? new Response("", { status: 404 }) : new Response(file, { status: 200 });
  };
  return { fetch, requests };
}

/** @throws {never} */
export function absentService(): Handler {
  return () => Promise.resolve(new WorkerResponse(null, { status: 404 }));
}
