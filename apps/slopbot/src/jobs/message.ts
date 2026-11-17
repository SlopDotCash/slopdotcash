// spec/slopbot/jobQueue.md, "A failed or contended handler retries with a bounded delay"

export interface RetryOptions {
  readonly delaySeconds?: number;
}

export interface JobMessage {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  /** @throws {never} */
  ack(): void;
  /** @throws {never} */
  retry(options?: RetryOptions): void;
}

export interface JobBatch {
  readonly queue: string;
  readonly messages: ReadonlyArray<JobMessage>;
}
