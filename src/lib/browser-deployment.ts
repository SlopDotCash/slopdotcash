import {
  deploymentOrigins,
  deploymentTier,
  isLocalDevelopmentOrigin,
} from "./deployment";
export const browserDeployment = deploymentOrigins(
  deploymentTier(import.meta.env.VITE_SLOP_ENVIRONMENT),
);

/**
 * The dev server's own origin while `bun run dev:local` proxies sign-in and
 * the API to a local backend. `import.meta.env.DEV` is false in every build,
 * so no deployed bundle ever sets it.
 */
export const localBackendOrigin: string | null =
  import.meta.env.DEV &&
  import.meta.env.VITE_SLOP_LOCAL_BACKEND === "1" &&
  typeof window !== "undefined" &&
  isLocalDevelopmentOrigin(window.location.origin)
    ? window.location.origin
    : null;
if (localBackendOrigin)
  browserDeployment.browserOrigins.add(localBackendOrigin);

/** Sign-in works only on a product origin, so other origins link there. */
export const loginHref = (next: string) =>
  `${browserDeployment.browserOrigins.has(window.location.origin) ? "" : browserDeployment.site}${
    next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`
  }`;
