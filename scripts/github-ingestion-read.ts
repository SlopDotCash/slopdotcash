/** Rate-limit recovery for read-only source collection, never Worker writes. */
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
): typeof fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input));
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const retryable =
        url.origin === "https://api.github.com" && method === "GET";
      for (let attempt = 1; ; attempt++) {
        const response = await transport(input, init);
        if (
          !retryable ||
          attempt === 5 ||
          (response.status !== 403 && response.status !== 429)
        )
          return response;
        let delay: number | null = null;
        const reset = response.headers.get("x-ratelimit-reset");
        if (
          response.headers.get("x-ratelimit-remaining") === "0" &&
          reset &&
          /^\d+$/u.test(reset)
        ) {
          const milliseconds = Number(reset) * 1_000 - now() + 1_000;
          if (Number.isSafeInteger(milliseconds) && milliseconds > 0)
            delay = milliseconds;
        }
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter && /^\d+$/u.test(retryAfter)) {
          const milliseconds = Number(retryAfter) * 1_000;
          if (Number.isSafeInteger(milliseconds))
            delay = Math.max(delay ?? 0, milliseconds);
        }
        if (delay === null && response.status === 429) delay = 60_000;
        if (delay === null) return response;
        await response.body?.cancel();
        await wait(delay);
      }
    },
    { preconnect: transport.preconnect },
  );
}
