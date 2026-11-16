// Binding shapes the spike adds beside src/bindings.ts (candidates for it): Durable Objects, SQLite storage,
// rate limits, send_email, queue producers, the Cache API and the ExecutionContext.
import type { SqlValue } from "../../src/bindings.ts";

export interface ExecutionContext {
  /** @throws {never} */
  waitUntil(promise: Promise<unknown>): void;
}

export interface SqlCursor<Row> {
  toArray(): Row[];
  readonly rowsWritten: number;
}

export interface SqlStorage {
  exec<Row = Record<string, unknown>>(query: string, ...bindings: ReadonlyArray<SqlValue>): SqlCursor<Row>;
}

export interface DurableObjectStorage {
  readonly sql: SqlStorage;
  transactionSync<T>(closure: () => T): T;
}

export interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectNamespace<Stub> {
  /** @throws {never} */
  idFromName(name: string): DurableObjectId;
  /** @throws {never} */
  get(id: DurableObjectId): Stub;
}

export interface RateLimit {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

export interface SendEmail {
  send(message: { readonly from: string; readonly to: string }): Promise<unknown>;
}

export interface Queue<Body> {
  send(body: Body): Promise<void>;
}

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}
