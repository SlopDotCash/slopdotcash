/** Keep a request deadline when its caller also cancels on navigation or retry. */
export function fetchWithDeadline(url: string, init: RequestInit = {}) {
  const deadline = AbortSignal.timeout(15_000);
  return fetch(url, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  });
}

/** Headers and a stream are shared by HTTP requests and responses. */
type HttpBody = Pick<Response, "headers" | "body">;

/**
 * Bounded byte transport shared by app views and API request readers. Only a
 * size over the limit throws a RangeError, so callers can tell it apart.
 */
export async function readBoundedBytes(
  response: HttpBody,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^[0-9]+$/u.test(declaredLength)) {
      throw new Error(`${label} returned an invalid content length`);
    }
    if (BigInt(declaredLength) > BigInt(maxBytes)) {
      throw new RangeError(`${label} exceeded the ${maxBytes}-byte limit`);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`${label} returned no readable body`);
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let complete = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        throw new RangeError(`${label} exceeded the ${maxBytes}-byte limit`);
      }
      chunks.push(chunk.value);
    }
    complete = true;
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // The original read failure is the actionable error.
      }
    }
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Bounded UTF-8 transport shared by app views and API request readers. */
export async function readBoundedText(
  response: HttpBody,
  maxBytes: number,
  label: string,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await readBoundedBytes(response, maxBytes, label),
  );
}

export async function readBoundedJson(
  response: HttpBody,
  maxBytes: number,
  label: string,
): Promise<unknown> {
  const source = await readBoundedText(response, maxBytes, label);
  try {
    return JSON.parse(source) as unknown;
  } catch (error: unknown) {
    // error-policy:J1 Invalid public JSON becomes an explicit unavailable state.
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}
