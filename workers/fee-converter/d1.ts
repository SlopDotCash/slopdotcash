/** The minimal D1 surface the fee converter store and gas journal use. */

export type D1Value = string | number | null;

export interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface FeeD1Database {
  prepare(query: string): D1Statement;
}
