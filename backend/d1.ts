/** Shared D1 capabilities. Services request only the operations they use. */
export type D1Result<T = unknown> = {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
};

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

/** Cloudflare `all()` always returns its rows. */
export type D1Rows<T> = D1Result<T> & { results: T[] };

export interface D1QueryStatement extends D1Statement {
  bind(...values: unknown[]): D1QueryStatement;
  all<T>(): Promise<D1Rows<T>>;
}

export interface D1Database<S extends D1Statement = D1Statement> {
  prepare(query: string): S;
}

/** A SQLite constraint refused the write: an expected race, not an outage. */
export function isConstraintFailure(error: unknown): boolean {
  return error instanceof Error && /constraint failed/u.test(error.message);
}

export interface D1TransactionalDatabase<S extends D1Statement = D1Statement>
  extends D1Database<S> {
  batch(statements: S[]): Promise<D1Result[]>;
}
