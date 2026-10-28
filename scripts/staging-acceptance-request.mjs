/**
 * Transport for the release's harmless staging acceptance probes only.
 * These requests read state, create short-lived synthetic OAuth flows, or
 * assert that anonymous/cross-origin writes are refused. Do not use for
 * authenticated application writes. Semantic assertions remain with callers.
 */
export async function stagingAcceptanceRequest(url, init = {}, options = {}) {
  const {
    timeoutMs = 30000,
    attemptTimeoutMs = 10000,
    retryDelayMs = 250,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let lastFailure;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(remaining, attemptTimeoutMs)),
        ),
      });
      if (![429, 500, 502, 503, 504].includes(response.status)) return response;
      await response.body?.cancel();
      lastFailure = new Error(`Staging acceptance HTTP ${response.status}`);
    } catch (error) {
      const code = error?.cause?.code ?? error?.code;
      if (
        error?.name !== "TimeoutError" &&
        ![
          "ECONNRESET",
          "ECONNREFUSED",
          "ETIMEDOUT",
          "EAI_AGAIN",
          "UND_ERR_SOCKET",
          "UND_ERR_CONNECT_TIMEOUT",
        ].includes(code)
      )
        throw error;
      lastFailure = new Error(
        `Staging acceptance transport failed (${code ?? "timeout"})`,
      );
    }
    const delay = retryDelayMs * (attempt + 1);
    if (attempt < 2 && deadline - Date.now() > delay)
      await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Staging acceptance request exhausted its retry bound", {
    cause: lastFailure,
  });
}
