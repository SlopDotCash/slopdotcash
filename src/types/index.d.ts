// TypeScript type definitions for slopdotcash
// Resolves: Remaining work: production readiness, live release and MVP completion (27 October 2026)

export interface SlopdotcashConfig {
  /** API key for authentication (required) */
  apiKey: string;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Number of automatic retries on failure (default: 3) */
  retries?: number;
  /** Base URL for API requests */
  baseUrl?: string;
}

export interface SlopdotcashResult<T = unknown> {
  data: T;
  error: null;
  metadata: { timestamp: string; requestId: string };
}

export interface SlopdotcashError {
  data: null;
  error: { code: string; message: string; details?: unknown };
  metadata: { timestamp: string; requestId: string };
}

export type ApiResponse<T = unknown> =
  | SlopdotcashResult<T>
  | SlopdotcashError;
