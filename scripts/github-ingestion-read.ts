import {
  type DiscussionCacheOptions,
  githubDiscussionCache,
} from "./github-discussion-cache";

const REQUEST_TIMEOUT_MS = 60_000;
const IMMUTABLE_CACHE_BYTES = 16 * 1024 * 1024;

type ImmutableResponse = {
  bytes: Uint8Array;
  headers: [string, string][];
  statusText: string;
};

function immutableRead(url: URL): string | null {
  if (url.username || url.password || url.hash) return null;
  const root = /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\//u;
  if (!root.test(url.pathname)) return null;
  const path = url.pathname.replace(root, "");
  const object = /^git\/(commits|trees|blobs)\/([a-f0-9]{40})$/u.exec(path);
  if (object)
    return url.search === "" ||
      (object[1] === "trees" && url.search === "?recursive=1")
      ? object[2]
      : null;
  if (
    path.startsWith("contents/") &&
    path.length > "contents/".length &&
    /^\?ref=[a-f0-9]{40}$/u.test(url.search)
  )
    return "contents";
  return null;
}

/** GitHub names a secondary limit in the 403 body; without Retry-After it
 * directs clients to wait at least one minute, as the GraphQL client does. */
function secondaryRateLimit(bytes: Uint8Array): boolean {
  try {
    const { message } = JSON.parse(new TextDecoder().decode(bytes)) as {
      message?: unknown;
    };
    return (
      typeof message === "string" &&
      /secondary rate limit|abuse detection/iu.test(message)
    );
  } catch {
    return false;
  }
}

function replay(value: ImmutableResponse): Response {
  return new Response(value.bytes.slice(), {
    status: 200,
    statusText: value.statusText,
    headers: value.headers,
  });
}

async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

async function readAttempt(
  transport: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("GitHub read timed out", "TimeoutError"),
      ),
    timeoutMs,
  );
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  try {
    const response = await abortable(
      transport(input, { ...init, signal }),
      signal,
    );
    const bytes = new Uint8Array(
      await abortable(response.arrayBuffer(), signal),
    );
    signal.throwIfAborted();
    return {
      response: new Response(
        [204, 205, 304].includes(response.status) ? null : bytes,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      ),
      bytes,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function githubPrimaryRateLimitDelay(
  response: Response,
  now = Date.now(),
): number | null {
  const reset = response.headers.get("x-ratelimit-reset");
  if (
    (response.status !== 403 && response.status !== 429) ||
    response.headers.get("x-ratelimit-remaining") !== "0" ||
    !reset ||
    !/^\d+$/u.test(reset)
  )
    return null;
  const delay = Number(reset) * 1_000 - now + 1_000;
  return Number.isSafeInteger(delay) && delay > 0 ? delay : null;
}

export class GitHubIngestionCheckpointError extends Error {
  constructor() {
    super("GitHub source collection reached its checkpoint deadline");
    this.name = "GitHubIngestionCheckpointError";
  }
}

interface IngestionReadOptions {
  discussionCache?: DiscussionCacheOptions;
  quotaDeadlineMs?: number;
}

export type IngestionReadTransport = typeof fetch & {
  assertNoCheckpoint: () => void;
};

function opaqueTag(etag: string | null) {
  return etag?.replace(/^W\//u, "");
}

/** Quota recovery waits outside each request deadline. Mutable reads stay live. */
export function githubIngestionReadTransport(
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
  wait: (milliseconds: number) => Promise<void> = async (milliseconds) => {
    // Keep long quota resets representable by native timers.
    while (milliseconds > 0) {
      const chunk = Math.min(milliseconds, 60_000);
      await new Promise<void>((resolve) => setTimeout(resolve, chunk));
      milliseconds -= chunk;
    }
  },
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  options: IngestionReadOptions = {},
): IngestionReadTransport {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0)
    throw new Error("GitHub request timeout must be a positive integer");
  const deadline = options.quotaDeadlineMs;
  if (
    deadline !== undefined &&
    (!Number.isSafeInteger(deadline) || deadline <= 0)
  )
    throw new Error("GitHub quota deadline must be a positive epoch time");
  const discussionCache = options.discussionCache
    ? githubDiscussionCache(options.discussionCache, now)
    : null;
  let checkpoint: GitHubIngestionCheckpointError | undefined;
  const assertNoCheckpoint = () => {
    if (checkpoint) throw checkpoint;
  };
  const checkDeadline = (waitMs = 0) => {
    if (deadline !== undefined && now() + waitMs >= deadline)
      checkpoint ??= new GitHubIngestionCheckpointError();
    assertNoCheckpoint();
  };
  const cache = new Map<string, ImmutableResponse>();
  let cachedBytes = 0;
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input));
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const retryable =
        url.origin === "https://api.github.com" && method === "GET";
      if (!retryable) return transport(input, init);
      const repositoryPath =
        /^\/(?:repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|repositories\/[1-9]\d*)(\/.*)$/u.exec(
          url.pathname,
        )?.[1] ?? "";
      // GitHub answers a transient HTTP 500 on these per-item list pages; the
      // same page retried a second later normally succeeds (19 Nov: one 500 on
      // a pull request's reviews ended a five-hour collection).
      const pullFiles =
        /^\/(?:pulls\/[1-9]\d*\/(?:files|reviews|comments|commits)|issues\/[1-9]\d*\/(?:comments|events|timeline))$/u.test(
          repositoryPath,
        );
      const commitFilePage =
        /^\/commits\/[a-f0-9]{40}$/u.test(repositoryPath) &&
        /^\?per_page=100&page=[1-9]\d*$/u.test(url.search);
      const commitFileGatewayRetry =
        commitFilePage && !url.username && !url.password && !url.hash;
      const commitPulls =
        !url.username &&
        !url.password &&
        !url.hash &&
        /^\/commits\/[a-f0-9]{40}\/pulls$/u.test(repositoryPath) &&
        /^\?per_page=100(?:&page=[1-9]\d*)?$/u.test(url.search);
      const readRetry =
        pullFiles || commitPulls
          ? { status: 500, limit: 2 }
          : commitFilePage
            ? { status: 422, limit: 1 }
            : null;
      const callerSignal =
        init && "signal" in init ? init.signal : request?.signal;
      callerSignal?.throwIfAborted();
      checkDeadline();
      const headers = new Headers(init?.headers ?? request?.headers);
      const verifiesRepresentation =
        !(init?.integrity ?? request?.integrity) &&
        (init?.cache ?? request?.cache ?? "default") === "default";
      const discussion = verifiesRepresentation
        ? discussionCache?.(
            url,
            headers,
            init?.redirect ?? request?.redirect ?? "follow",
          )
        : null;
      let retainedDiscussion = await discussion?.read();
      const identity = immutableRead(url);
      const key =
        identity &&
        !headers.has("range") &&
        ![...headers.keys()].some((name) => name.startsWith("if-")) &&
        !headers.has("cache-control") &&
        !headers.has("pragma") &&
        verifiesRepresentation
          ? JSON.stringify([
              url.href,
              [...headers].sort(([a], [b]) => a.localeCompare(b)),
              init?.credentials ?? request?.credentials ?? "same-origin",
              init?.redirect ?? request?.redirect ?? "follow",
            ])
          : null;
      const cached = key ? cache.get(key) : undefined;
      if (key && cached) {
        cache.delete(key);
        cache.set(key, cached);
        return replay(cached);
      }
      let readRetries = 0;
      let gatewayRetries = 0;
      for (let attempt = 1; ; ) {
        callerSignal?.throwIfAborted();
        checkDeadline();
        let readInit = init;
        if (retainedDiscussion) {
          const conditionalHeaders = new Headers(headers);
          conditionalHeaders.set("if-none-match", retainedDiscussion.etag);
          readInit = { ...init, headers: conditionalHeaders };
        }
        const { response, bytes } = await readAttempt(
          transport,
          input,
          readInit,
          callerSignal,
          requestTimeoutMs,
        );
        if (retainedDiscussion && response.status === 304) {
          if (
            opaqueTag(response.headers.get("etag")) ===
            opaqueTag(retainedDiscussion.etag)
          ) {
            await discussion?.save(
              retainedDiscussion.etag,
              retainedDiscussion.bytes,
            );
            return new Response(retainedDiscussion.bytes, {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          // A missing or different validator does not vouch for these bytes.
          // Retry once without a validator and let the caller check the reply.
          retainedDiscussion = null;
          continue;
        }
        // GitHub can fail to serve a known evidence page temporarily. Retry that
        // exact page without resetting the quota budget or changing pagination.
        const retryGateway =
          commitFileGatewayRetry &&
          response.status === 502 &&
          gatewayRetries < 2;
        const retryRead =
          readRetry &&
          response.status === readRetry.status &&
          readRetries < readRetry.limit;
        if (retryGateway || retryRead) {
          const retry = retryGateway ? ++gatewayRetries : ++readRetries;
          const delay = retry * 1_000;
          await response.body?.cancel();
          checkDeadline(delay);
          await (callerSignal
            ? abortable(wait(delay), callerSignal)
            : wait(delay));
          continue;
        }
        if (
          attempt === 5 ||
          (response.status !== 403 && response.status !== 429)
        ) {
          const retained = {
            bytes,
            headers: [...response.headers],
            statusText: response.statusText,
          };
          if (
            key &&
            response.status === 200 &&
            bytes.length <= IMMUTABLE_CACHE_BYTES
          ) {
            let value: { sha?: unknown; type?: unknown } | null = null;
            try {
              value = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              );
            } catch {
              // Invalid bodies retain their original caller validation.
            }
            if (
              value &&
              typeof value.sha === "string" &&
              (identity === "contents"
                ? value.type === "file" && /^[a-f0-9]{40}$/u.test(value.sha)
                : value.sha === identity)
            ) {
              while (cachedBytes + bytes.length > IMMUTABLE_CACHE_BYTES) {
                const oldest = cache.entries().next().value;
                if (oldest === undefined) break;
                cachedBytes -= oldest[1].bytes.length;
                cache.delete(oldest[0]);
              }
              cachedBytes -= cache.get(key)?.bytes.length ?? 0;
              cachedBytes += bytes.length;
              cache.set(key, retained);
            }
          }
          const etag = response.headers.get("etag");
          if (
            discussion &&
            response.status === 200 &&
            /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/iu.test(
              response.headers.get("content-type") ?? "",
            )
          )
            await discussion.save(etag ?? "", bytes);
          return response;
        }
        let delay = githubPrimaryRateLimitDelay(response, now());
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter && /^\d+$/u.test(retryAfter)) {
          const milliseconds = Number(retryAfter) * 1_000;
          if (Number.isSafeInteger(milliseconds))
            delay = Math.max(delay ?? 0, milliseconds);
        }
        if (
          delay === null &&
          (response.status === 429 || secondaryRateLimit(bytes))
        )
          delay = 60_000;
        if (delay === null) return response;
        await response.body?.cancel();
        checkDeadline(delay);
        console.warn(
          JSON.stringify({
            event: "github_ingestion_quota_wait",
            attempt,
            maximumAttempts: 5,
            delayMs: delay,
            at: new Date(now()).toISOString(),
          }),
        );
        await (callerSignal
          ? abortable(wait(delay), callerSignal)
          : wait(delay));
        attempt += 1;
      }
    },
    { preconnect: transport.preconnect, assertNoCheckpoint },
  );
}
