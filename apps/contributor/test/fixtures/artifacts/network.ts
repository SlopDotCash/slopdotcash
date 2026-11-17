import type { Fetcher } from "@repo/platform/bindings";

export interface Seen {
  readonly host: string;
  readonly path: string;
  readonly authorized: boolean;
}

export type Serve = (request: Request, visit: number) => Response;

export interface ArtifactNetwork {
  readonly fetcher: Fetcher;
  readonly seen: ReadonlyArray<Seen>;
  /** @throws {never} */
  route(url: string, serve: Serve): string;
  /** @throws {never} */
  upload(id: number, serve: Serve): string;
  /** @throws {never} */
  callsTo(prefix: string): ReadonlyArray<Seen>;
}

export class NetworkDown extends TypeError {}

/** @throws {never} */
export function uploadUrl(id: number): string {
  return `https://github.com/user-attachments/assets/00000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`;
}

/** @throws {never} */
export function cdnUrl(id: number): string {
  return `https://objects.githubusercontent.com/github-production-user-asset-6210df/${id}`;
}

/** @throws {never} */
export function redirecting(location: string): Serve {
  return () => new Response(null, { status: 302, headers: { location } });
}

/** @throws {never} */
export function ranged(bytes: Uint8Array, contentType: string | undefined, request: Request): Response {
  const range = /^bytes=0-([0-9]+)$/.exec(request.headers.get("range") ?? "");
  const last = range === null ? bytes.length - 1 : Number(range[1]);
  const headers: Record<string, string> = contentType === undefined ? {} : { "content-type": contentType };
  if (last + 1 >= bytes.length) {
    return new Response(Uint8Array.from(bytes), { status: 200, headers: { ...headers, "content-length": String(bytes.length) } });
  }
  return new Response(bytes.slice(0, last + 1), {
    status: 206,
    headers: { ...headers, "content-length": String(last + 1), "content-range": `bytes 0-${last}/${bytes.length}` },
  });
}

/** @throws {never} */
export function serving(bytes: Uint8Array, contentType?: string): Serve {
  return (request) => ranged(bytes, contentType, request);
}

/** @throws {never} */
export function unavailableFirst(status: number, then: Serve): Serve {
  return (request, visit) => (visit === 1 ? new Response("upstream unavailable", { status }) : then(request, visit));
}

/** @throws {never} */
export function dropped(): Serve {
  return () => {
    throw new NetworkDown("connection reset by the artifact host");
  };
}

/** @throws {never} */
export function answering(status: number): Serve {
  return () => new Response(`HTTP ${status}`, { status });
}

/** @throws {never} */
export function artifactNetwork(): ArtifactNetwork {
  const routes = new Map<string, Serve>();
  const visits = new Map<string, number>();
  const seen: Seen[] = [];
  const route = (url: string, serve: Serve) => {
    routes.set(url, serve);
    return url;
  };
  return {
    seen,
    route,
    upload: (id, serve) => {
      route(uploadUrl(id), redirecting(`${cdnUrl(id)}?X-Amz-Signature=${id}`));
      route(cdnUrl(id), serve);
      return uploadUrl(id);
    },
    callsTo: (prefix) => seen.filter((call) => `https://${call.host}${call.path}`.startsWith(prefix)),
    fetcher: {
      fetch: async (request) => {
        const url = new URL(request.url);
        const key = `${url.origin}${url.pathname}`;
        seen.push({ host: url.host, path: url.pathname, authorized: request.headers.has("authorization") });
        const visit = (visits.get(key) ?? 0) + 1;
        visits.set(key, visit);
        const serve = routes.get(key);
        if (serve === undefined) return new Response("no such artifact", { status: 404 });
        return serve(request, visit);
      },
    },
  };
}
