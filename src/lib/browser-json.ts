/** Bounded public JSON transport shared by app views. */
export async function readBoundedJson(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^[0-9]+$/u.test(declaredLength)) {
      throw new Error(`${label} returned an invalid content length`);
    }
    if (BigInt(declaredLength) > BigInt(maxBytes)) {
      throw new Error(`${label} exceeded the ${maxBytes}-byte limit`);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`${label} returned no readable body`);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let source = "";
  let complete = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        throw new Error(`${label} exceeded the ${maxBytes}-byte limit`);
      }
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode();
    complete = true;
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // The original read/decoding failure is the actionable error.
      }
    }
    reader.releaseLock();
  }

  try {
    return JSON.parse(source) as unknown;
  } catch (error: unknown) {
    // error-policy:J1 Invalid public JSON becomes an explicit unavailable state.
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}
