import type { PagesMiddlewareContext } from "../backend/pages";
import { readBoundedText } from "../src/lib/browser-json";
import {
  isWebAnalyticsHost,
  renderWebAnalytics,
} from "../src/lib/web-analytics.mjs";

const CASH_DOMAIN = "slop.cash";
const TECH_DOMAIN = "slop.tech";
const MAX_TRANSFORMED_HTML_BYTES = 1024 * 1024;
type PublicDomain = typeof CASH_DOMAIN | typeof TECH_DOMAIN;

type SocialMetadata = {
  domain: PublicDomain;
  origin: `https://${PublicDomain}`;
  imageUrl:
    | "https://slop.cash/og-slop-cash.png"
    | "https://slop.tech/og-slop-tech.png";
};

function publicSocialMetadata(hostname: string): SocialMetadata {
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
        ? "https://slop.tech/og-slop-tech.png"
        : "https://slop.cash/og-slop-cash.png",
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

function renderSocialMetadata(contents: string, hostname: string): string {
  const metadata = publicSocialMetadata(hostname);
  if (metadata.domain === CASH_DOMAIN) return contents;

  const replacements: ReadonlyArray<readonly [string, string, number]> = [
    ['href="https://slop.cash/"', `href="${metadata.origin}/"`, 1],
    ['content="slop.cash"', `content="${metadata.domain}"`, 1],
    ['content="https://slop.cash/"', `content="${metadata.origin}/"`, 1],
    [
      'content="https://slop.cash/og-slop-cash.png"',
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

/**
 * Head tags for a page that a sponsor is sent to. The app shell carries the
 * home page's contributor headline, so a shared link to one of these paths
 * would otherwise preview as "make money shipping open source".
 */
type RouteMetadata = {
  canonicalPath: string;
  title: string;
  headline: string;
  description: string;
  imageUrl: string;
};

const SHELL_TITLE = "<title>Slop: make money shipping open source</title>";
const SHELL_HEADLINE = 'content="MAKE MONEY SHIPPING OPEN SOURCE."';
const SHELL_DESCRIPTION =
  'content="Pick important public work, run your best coding agent, and ship an accepted result on GitHub."';

const SPONSOR_METADATA: RouteMetadata = {
  canonicalPath: "/sponsors",
  title: "Fund a project · Slop",
  headline: "Fund a project. Pay for accepted work.",
  description:
    "Fund a monthly pool for an open-source project. It pays contributors for the work the project's maintainers accept.",
  imageUrl: "https://slop.cash/og-slop-cash-sponsors.png",
};

function routeMetadata(pathname: string): RouteMetadata | null {
  return pathname === "/sponsors" || pathname === "/sponsors/"
    ? SPONSOR_METADATA
    : null;
}

/**
 * Rewrites the shell's head for one route. Every source string must occur the
 * expected number of times; a shell that no longer matches is served as it is
 * instead of failing the page.
 */
export function renderRouteMetadata(
  contents: string,
  metadata: RouteMetadata,
): string {
  const replacements: ReadonlyArray<readonly [string, string, number]> = [
    [SHELL_TITLE, `<title>${metadata.title}</title>`, 1],
    [SHELL_HEADLINE, `content="${metadata.headline}"`, 4],
    [SHELL_DESCRIPTION, `content="${metadata.description}"`, 3],
    [
      'href="https://slop.cash/"',
      `href="https://slop.cash${metadata.canonicalPath}"`,
      1,
    ],
    [
      'content="https://slop.cash/"',
      `content="https://slop.cash${metadata.canonicalPath}"`,
      1,
    ],
    [
      'content="https://slop.cash/og-slop-cash.png"',
      `content="${metadata.imageUrl}"`,
      2,
    ],
  ];
  if (
    replacements.some(
      ([source, , expectedCount]) =>
        contents.split(source).length - 1 !== expectedCount,
    )
  ) {
    return contents;
  }
  return replacements.reduce(
    (html, [source, replacement]) => html.replaceAll(source, replacement),
    contents,
  );
}

export async function onRequest(
  context: Pick<PagesMiddlewareContext<unknown>, "request" | "next">,
): Promise<Response> {
  if (context.request.method !== "GET") return context.next();

  const { hostname, pathname } = new URL(context.request.url);
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

  // Route head tags are written for slop.cash and its test hosts only;
  // slop.tech keeps the shell's own tags.
  const metadata =
    publicSocialMetadata(hostname).domain === CASH_DOMAIN
      ? routeMetadata(pathname)
      : null;
  const forRoute = (contents: string) =>
    metadata === null ? contents : renderRouteMetadata(contents, metadata);

  if (isWebAnalyticsHost(hostname)) {
    return new Response(
      renderWebAnalytics(
        forRoute(
          await readBoundedText(
            response,
            MAX_TRANSFORMED_HTML_BYTES,
            "HTML response",
          ),
        ),
        hostname,
      ),
      {
        status: response.status,
        statusText: response.statusText,
        headers,
      },
    );
  }

  if (metadata !== null) {
    return new Response(
      forRoute(
        await readBoundedText(
          response,
          MAX_TRANSFORMED_HTML_BYTES,
          "HTML response",
        ),
      ),
      {
        status: response.status,
        statusText: response.statusText,
        headers,
      },
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
    renderSocialMetadata(
      await readBoundedText(
        response,
        MAX_TRANSFORMED_HTML_BYTES,
        "HTML response",
      ),
      hostname,
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}
