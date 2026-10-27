/**
 * Wait for a newly published staging root to serve HTTP 200 and security headers.
 * Cost: at most six reads, one second apart, within a 30-second total deadline.
 * Only transport/transient HTTP failures retry; a redirect, missing security
 * header or other permanent HTTP failure rejects the release immediately.
 * Tests pass a zero retry delay.
 */
export async function verifyStagingRoot(origin, retryDelayMs = 1000) {
  const deadline = Date.now() + 30000;
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let response;
    try {
      response = await fetch(origin, {
        redirect: "manual",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(5000, remaining))),
      });
    } catch (cause) {
      lastError = new Error(`Staging root transport failed at ${origin}`, {
        cause,
      });
    }
    if (response) {
      await response.body?.cancel();
      if (response.status === 200) {
        for (const header of [
          "content-security-policy",
          "strict-transport-security",
          "x-content-type-options",
        ]) {
          if (!response.headers.has(header)) {
            throw new Error(`Staging root ${origin} omitted ${header}`);
          }
        }
        return;
      }
      lastError = new Error(
        `Staging root ${origin} returned HTTP ${response.status}`,
      );
      if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    }
    if (attempt < 6 && deadline - Date.now() > retryDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(
    `Staging root ${origin} did not become available within its retry bound`,
    { cause: lastError },
  );
}
