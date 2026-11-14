// The approved production-apex tag is also the release verifier's exact HTML
// transform (PRD sections 9 and 11). This public token is not a credential.
//
// `send.to` keeps the report on the site's own origin, where the tag Cloudflare
// adds automatically to statically served pages also reports. Without it the
// beacon treats this tag as a manual embed and posts to
// https://cloudflareinsights.com/cdn-cgi/rum, which connect-src does not allow
// and which Cloudflare answers with 404 for a site on automatic setup, so no
// Function-served page was counted. Cloudflare documents only `token` and
// `spa`; `send.to` is read from the published beacon.min.js. If a later beacon
// drops it, reports fall back to that blocked host: nothing breaks for
// visitors, and Function-served pages stop being counted again.
const WEB_ANALYTICS_TAG =
  '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ' +
  'data-cf-beacon=\'{"token":"230b277fc6fe4a279c8b06cf7e569719","spa":true,"send":{"to":"/cdn-cgi/rum"}}\'></script>';

export function isWebAnalyticsHost(hostname) {
  return hostname.toLowerCase().replace(/\.$/u, "") === "slop.cash";
}

export function renderWebAnalytics(contents, hostname) {
  if (
    !isWebAnalyticsHost(hostname) ||
    contents.includes("static.cloudflareinsights.com")
  )
    return contents;
  const count = contents.split("</body>").length - 1;
  if (count !== 1) {
    throw new Error(
      `Expected 1 social metadata occurrences of ${JSON.stringify("</body>")}, found ${count}`,
    );
  }
  return contents.replaceAll("</body>", `${WEB_ANALYTICS_TAG}</body>`);
}
