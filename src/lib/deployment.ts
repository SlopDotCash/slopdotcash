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
