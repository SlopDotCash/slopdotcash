// The approved production-apex tag is also the release verifier's exact HTML
// transform (PRD sections 9 and 11). This public token is not a credential.
const WEB_ANALYTICS_TAG =
  '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ' +
  'data-cf-beacon=\'{"token":"230b277fc6fe4a279c8b06cf7e569719","spa":true}\'></script>';

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
