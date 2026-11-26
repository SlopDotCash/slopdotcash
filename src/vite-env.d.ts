/**
 * Supplies Vite's asset and stylesheet module declarations to TypeScript.
 */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the project registry source; only the browser-test fixture sets it. */
  readonly VITE_SLOP_PROJECT_REGISTRY_URL?: string;
  /** "1" only in the browser-test fixture build; lets a test supply pay page tables. */
  readonly VITE_SLOP_FEE_FIXTURE?: string;
}
