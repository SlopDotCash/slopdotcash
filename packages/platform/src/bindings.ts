// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"
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

export type Assets = Fetcher;

export interface ExecutionContext {
  /** @throws {never} */
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

export interface QueueSendOptions {
  readonly delaySeconds?: number;
}

export interface Queue<Body = unknown> {
  send(body: Body, options?: QueueSendOptions): Promise<void>;
  sendBatch(messages: ReadonlyArray<{ readonly body: Body } & QueueSendOptions>): Promise<void>;
}

export interface RateLimit {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

export interface EmailMessage {
  readonly from: string;
  readonly to: string;
}

export interface SendEmail {
  send(message: EmailMessage): Promise<void>;
}

export interface Cache {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

export interface CacheStorage {
  readonly default: Cache;
  open(name: string): Promise<Cache>;
}

export interface SqlCursor<Row = Record<string, SqlValue>> {
  toArray(): Row[];
  one(): Row;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface SqlStorage {
  exec<Row = Record<string, SqlValue>>(query: string, ...bindings: ReadonlyArray<SqlValue>): SqlCursor<Row>;
}

export interface StorageListOptions {
  readonly prefix?: string;
  readonly start?: string;
  readonly startAfter?: string;
  readonly end?: string;
  readonly limit?: number;
  readonly reverse?: boolean;
}

export interface DurableObjectTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: StorageListOptions): Promise<Map<string, T>>;
  rollback(): void;
}

export interface DurableObjectStorage {
  readonly sql: SqlStorage;
  transactionSync<T>(closure: () => T): T;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: StorageListOptions): Promise<Map<string, T>>;
  transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T>;
}

export interface DurableObjectId {
  toString(): string;
  readonly name?: string;
}

export interface DurableObjectState {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  /** @throws {never} */
  waitUntil(promise: Promise<unknown>): void;
}

export type DurableObjectStub<Stub = Fetcher> = Stub & { readonly id: DurableObjectId };

export interface DurableObjectNamespace<Stub = Fetcher> {
  /** @throws {never} */
  idFromName(name: string): DurableObjectId;
  /** @throws {TypeError} */
  idFromString(id: string): DurableObjectId;
  /** @throws {never} */
  get(id: DurableObjectId): DurableObjectStub<Stub>;
}
