// spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"

export interface BuildFlags {
  readonly tier: string | undefined;
  readonly development: boolean;
  readonly localBackend: boolean;
}

/** @throws {never} */
export function buildFlags(): BuildFlags {
  const env: ImportMetaEnv = import.meta.env;
  const tier: unknown = env.VITE_SLOP_ENVIRONMENT;
  return {
    tier: typeof tier === "string" ? tier : undefined,
    development: env.DEV,
    localBackend: env.VITE_SLOP_LOCAL_BACKEND === "1",
  };
}

/** @throws {never} */
export function pageOrigin(): string {
  return typeof location === "undefined" ? "" : location.origin;
}

/** @throws {URIError} */
export function loginPath(next: string): string {
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
