export type SqlValue = string | number | null;

export interface D1Meta {
  readonly changes: number;
  readonly last_row_id: number;
}

export interface D1Result {
  readonly results: ReadonlyArray<Record<string, unknown>>;
  readonly meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: ReadonlyArray<SqlValue>): D1PreparedStatement;
  all(): Promise<D1Result>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: ReadonlyArray<D1PreparedStatement>): Promise<ReadonlyArray<D1Result>>;
  exec(query: string): Promise<unknown>;
}

export interface R2Checksums {
  readonly sha256?: ArrayBuffer;
}

export interface R2Object {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly uploaded: Date;
  readonly checksums: R2Checksums;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface R2ObjectBody extends R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2PutOptions {
  readonly sha256?: string;
  readonly onlyIf?: { readonly etagDoesNotMatch?: string };
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface R2Bucket {
  put(key: string, value: Uint8Array, options?: R2PutOptions): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

export interface QueueMessage {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  /** @throws {never} */
  ack(): void;
  /** @throws {never} */
  retry(): void;
}

export interface MessageBatch {
  readonly queue: string;
  readonly messages: ReadonlyArray<QueueMessage>;
}
