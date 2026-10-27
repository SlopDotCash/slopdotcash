import { deploymentOrigins, deploymentTier } from "./deployment";
export const browserDeployment = deploymentOrigins(
  deploymentTier(import.meta.env.VITE_SLOP_ENVIRONMENT),
);

/** Sign-in works only on a product origin, so other origins link there. */
export const loginHref = (next: string) =>
  `${browserDeployment.browserOrigins.has(window.location.origin) ? "" : browserDeployment.site}${
    next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`
  }`;
