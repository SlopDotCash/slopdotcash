/**
 * Short-lived edge caching for public project reads. Page views read D1 at
 * most once per key and colo per TTL; admin writes delete the keys in the
 * writing colo, and other colos expire within the TTL. Project reads also
 * key on the enforcement generation, so a Quarantine or a Ban replaces every
 * cached list and skill in every colo on the next request (PRD ADM-06).
 */

/** The subset of the Workers Cache API the project routes use. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

/** The Workers default cache, absent outside the Workers runtime. */
export function edgeCache(): EdgeCache | undefined {
  const caches = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return caches?.default;
}

/** Seconds a public project response may be served from the edge. */
export const PUBLIC_PROJECT_TTL_SECONDS = 30;
/** Browsers revalidate every load; only the edge holds a copy for the TTL. */
export const PUBLIC_PROJECT_CACHE_CONTROL = `public, max-age=0, s-maxage=${PUBLIC_PROJECT_TTL_SECONDS}`;

const KEY_PREFIX = "/__slop-cache/projects-v1";

function cacheKey(origin: string, path: string, generation?: number): Request {
  const scope = generation === undefined ? "" : `/g${generation}`;
  return new Request(`${origin}${KEY_PREFIX}${scope}${path}`, {
    method: "GET",
  });
}

/**
 * Serves a cached public response, or builds, stores, and returns it. Only
 * 200 responses are stored; errors always reach D1 again.
 */
export async function cachedPublicResponse(
  cache: EdgeCache | undefined,
  request: Request,
  build: () => Promise<Response>,
  waitUntil?: (promise: Promise<unknown>) => void,
  generation?: number,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    cache === undefined ||
    (request.method !== "GET" && request.method !== "HEAD")
  )
    return build();
  const key = cacheKey(url.origin, `${url.pathname}${url.search}`, generation);
  let cached: Response | undefined;
  try {
    cached = await cache.match(key);
  } catch {
    // error-policy:J3 an unavailable edge cache only means a D1 read.
    cached = undefined;
  }
  if (cached !== undefined) {
    const headers = new Headers(cached.headers);
    headers.set("x-slop-cache", "hit");
    return new Response(request.method === "HEAD" ? null : cached.body, {
      status: cached.status,
      headers,
    });
  }
  const response = await build();
  if (response.status !== 200) return response;
  const headers = new Headers(response.headers);
  headers.set("x-slop-cache", "miss");
  const body = await response.arrayBuffer();
  const store = cache
    .put(key, new Response(body, { status: 200, headers }))
    .catch(() => {
      // error-policy:J3 a failed cache write leaves the next read on D1.
    });
  if (waitUntil) waitUntil(store);
  else await store;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers,
  });
}

/**
 * The public project lists stored under the enforcement generation. Project
 * detail, terms, skills and archives are served with no-store and never stored.
 */
const PROJECT_LIST_PATHS = ["/api/v1/projects", "/api/v1/project-revisions"];

/** Deletes the public project lists in this colo after a project write. */
export async function purgeProjectCache(
  cache: EdgeCache | undefined,
  origin: string,
  generation?: number,
): Promise<void> {
  if (cache === undefined) return;
  await Promise.all(
    PROJECT_LIST_PATHS.map((path) =>
      cache.delete(cacheKey(origin, path, generation)).catch(() => false),
    ),
  );
}
