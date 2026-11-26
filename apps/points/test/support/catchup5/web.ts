// spec/points/protectedMonths.md, "The generator reads the protected months only from this site's own route, once, with a bounded answer"; spec/points/projectionTransport.md, "A reset read of the published index or a shard is repeated at most three times"; spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
export type WebHandler = (request: Request) => Promise<Response>;
export type Answer = (url: URL) => Response;

export interface Sent {
  readonly url: string;
  readonly authorization: string | null;
  readonly accept: string | null;
}

export interface RouteAnswer {
  readonly status: number;
  readonly cache: string | null;
  readonly body: unknown;
}

/** @throws {never} */
export function etagged(status: 200 | 304, body: unknown, etag: string): Response {
  return status === 304
    ? new Response(null, { status: 304, headers: { etag } })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", etag } });
}

/** @throws {never} */
export function site(answer: Answer): { readonly fetch: typeof globalThis.fetch; readonly sent: ReadonlyArray<Sent> } {
  const sent: Sent[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push({ url: request.url, authorization: request.headers.get("authorization"), accept: request.headers.get("accept") });
    return Promise.resolve(answer(new URL(request.url)));
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

/** @throws {never} */
export function listing(body: unknown, status = 200): () => Response {
  return () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** @throws {never} */
export function routedFetch(handler: WebHandler): typeof globalThis.fetch {
  return ((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init))) as typeof globalThis.fetch;
}

export async function routeRequest(handler: WebHandler, url: string, init: RequestInit): Promise<RouteAnswer> {
  const response = await handler(new Request(url, init));
  const text = await response.text();
  const body: unknown = text === "" ? null : JSON.parse(text);
  return { status: response.status, cache: response.headers.get("cache-control"), body };
}

export interface ResetSite {
  readonly fetch: typeof globalThis.fetch;
  /** @throws {never} */
  attempts(): number;
  /** @throws {never} */
  indexReads(): number;
}

/** @throws {never} */
export function resetSite(options: { readonly scenario: string; readonly target: string; readonly checkpoint: unknown; readonly files: ReadonlyMap<string, string> }): ResetSite {
  const { scenario, target, checkpoint, files } = options;
  let attempts = 0;
  let indexReads = 0;
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    if (url.pathname === "/api/v1/points/journal") return Promise.resolve(Response.json(checkpoint));
    if (url.pathname === target) {
      attempts += 1;
      if (scenario === "persistent-reset" || scenario === "other-error" || attempts <= (scenario === "shard-reset" ? 2 : 1)) {
        const error = Object.assign(new Error("socket connection closed"), { code: scenario === "other-error" ? "OTHER_ERROR" : "ECONNRESET" });
        if (scenario !== "body-reset") return Promise.reject(error);
        let partial = false;
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (partial) controller.error(error);
            else {
              partial = true;
              controller.enqueue(new TextEncoder().encode("["));
            }
          },
        })));
      }
    }
    if (url.pathname === "/data/points.json") indexReads += 1;
    const file = files.get(url.pathname);
    if (file === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(scenario === "reset-then-corrupt" && url.pathname === "/data/points/1.json" ? `${file} ` : file));
  };
  return { fetch: fetch as typeof globalThis.fetch, attempts: () => attempts, indexReads: () => indexReads };
}
