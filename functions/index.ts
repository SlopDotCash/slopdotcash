const CASH_DOMAIN = "slop.cash";
const TECH_DOMAIN = "slop.tech";
export const MAX_TRANSFORMED_HTML_BYTES = 1024 * 1024;

type PublicDomain = typeof CASH_DOMAIN | typeof TECH_DOMAIN;

type SocialMetadata = {
  domain: PublicDomain;
  origin: `https://${PublicDomain}`;
  imageUrl:
    | "https://slop.cash/og-shipping-slop.png"
    | "https://slop.tech/og-shipping-slop-tech.png";
};

type PagesContext = {
  request: Request;
  next(): Promise<Response>;
};

export function publicSocialMetadata(hostname: string): SocialMetadata {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  const domain: PublicDomain =
    normalized === TECH_DOMAIN || normalized === `www.${TECH_DOMAIN}`
      ? TECH_DOMAIN
      : CASH_DOMAIN;

  return {
    domain,
    origin: `https://${domain}`,
    imageUrl:
      domain === TECH_DOMAIN
        ? "https://slop.tech/og-shipping-slop-tech.png"
        : "https://slop.cash/og-shipping-slop.png",
  };
}

function replaceExactCount(
  contents: string,
  source: string,
  replacement: string,
  expectedCount: number,
): string {
  const actualCount = contents.split(source).length - 1;
  if (actualCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} social metadata occurrences of ${JSON.stringify(source)}, found ${actualCount}`,
    );
  }
  return contents.replaceAll(source, replacement);
}

export function renderSocialMetadata(
  contents: string,
  hostname: string,
): string {
  const metadata = publicSocialMetadata(hostname);
  if (metadata.domain === CASH_DOMAIN) return contents;

  const replacements: ReadonlyArray<readonly [string, string, number]> = [
    ['href="https://slop.cash/"', `href="${metadata.origin}/"`, 1],
    ['content="slop.cash"', `content="${metadata.domain}"`, 1],
    ['content="https://slop.cash/"', `content="${metadata.origin}/"`, 1],
    [
      'content="https://slop.cash/og-shipping-slop.png"',
      `content="${metadata.imageUrl}"`,
      2,
    ],
  ];

  return replacements.reduce(
    (html, [source, replacement, expectedCount]) =>
      replaceExactCount(html, source, replacement, expectedCount),
    contents,
  );
}

async function boundedHtml(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_TRANSFORMED_HTML_BYTES)
  ) {
    throw new RangeError("HTML response exceeded the transform limit");
  }
  if (!response.body) throw new TypeError("HTML response has no readable body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_TRANSFORMED_HTML_BYTES) {
        await reader.cancel();
        throw new RangeError("HTML response exceeded the transform limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "GET") return context.next();

  const hostname = new URL(context.request.url).hostname;
  const response = await context.next();
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !response.headers.get("content-type")?.includes("text/html")
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const cacheControl = headers.get("cache-control");
  if (
    !cacheControl
      ?.toLowerCase()
      .split(/\s*,\s*/u)
      .includes("no-transform")
  ) {
    headers.set(
      "cache-control",
      cacheControl === null ? "no-transform" : `${cacheControl}, no-transform`,
    );
  }

  if (publicSocialMetadata(hostname).domain === CASH_DOMAIN) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const vary = headers.get("vary");
  if (vary === null) headers.set("vary", "Host");
  else if (
    !vary
      .toLowerCase()
      .split(/\s*,\s*/u)
      .includes("host")
  ) {
    headers.set("vary", `${vary}, Host`);
  }

  return new Response(
    renderSocialMetadata(await boundedHtml(response), hostname),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}
