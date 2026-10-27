/** Public origins are selected from an explicit deployment tier, never user input. */
export type DeploymentTier = "production" | "staging";
export function deploymentOrigins(tier: DeploymentTier = "production") {
  const staging = tier === "staging";
  const site = staging ? "https://staging.slop.cash" : "https://slop.cash";
  const browserOrigins = new Set(
    staging ? [site] : [site, "https://slop.tech", "https://eliza.army"],
  );
  return {
    branch: staging ? "development" : "main",
    site,
    api: staging ? site : "https://api.slop.cash",
    identity: staging
      ? "https://identity-staging.slop.cash"
      : "https://identity.slop.cash",
    browserOrigins,
    traceBrowserOrigins: new Set(
      staging
        ? browserOrigins
        : [...browserOrigins, "https://www.slop.cash", "https://www.slop.tech"],
    ),
  };
}
export function deploymentTier(value: unknown): DeploymentTier {
  if (value === undefined || value === "production") return "production";
  if (value === "staging") return "staging";
  throw new Error("Invalid deployment tier");
}
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9][0-9]{3,4})$/u;
/**
 * The origin of a developer's own dev server. A request can reach it only from
 * that machine, so production traffic never carries it.
 */
export function isLocalDevelopmentOrigin(value: unknown): value is string {
  const port = typeof value === "string" ? LOCAL_ORIGIN.exec(value)?.[1] : null;
  return port != null && Number(port) <= 65_535;
}
