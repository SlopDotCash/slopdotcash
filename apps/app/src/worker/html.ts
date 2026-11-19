// spec/frontend/presentation.md, "The wordmark and footer domain follow the serving host"

function listed(value: string | null, token: string): boolean {
  return value !== null && value.toLowerCase().split(/\s*,\s*/u).includes(token);
}

/** @throws {never} */
export function documentHeaders(response: Response, perHost: boolean): Headers {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const cacheControl = headers.get("cache-control");
  if (!listed(cacheControl, "no-transform")) headers.set("cache-control", cacheControl === null ? "no-transform" : `${cacheControl}, no-transform`);
  const vary = headers.get("vary");
  if (perHost && !listed(vary, "host")) headers.set("vary", vary === null ? "Host" : `${vary}, Host`);
  return headers;
}

/** @throws {never} */
export function document(response: Response, headers: Headers, html?: string): Response {
  return new Response(html ?? response.body, { status: response.status, statusText: response.statusText, headers });
}
