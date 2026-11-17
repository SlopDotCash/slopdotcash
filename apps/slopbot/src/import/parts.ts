// spec/slopbot/historicalImport.md, "The import needs an administrator, a deployed producer and registered accepted work before the API start"

export interface HistoricalParts {
  readonly envelope: string;
  readonly bundle: Uint8Array;
}

/** @throws {never} */
export async function historicalParts(bytes: Uint8Array, contentType: string): Promise<HistoricalParts | undefined> {
  const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData().catch(() => undefined);
  if (form === undefined || [...form.keys()].sort().join() !== "bundle,envelope") return undefined;
  const envelope = form.get("envelope");
  const bundle = form.get("bundle");
  if (!(envelope instanceof File) || envelope.type !== "application/json" || !(bundle instanceof File) || bundle.size === 0) return undefined;
  return { envelope: await envelope.text(), bundle: new Uint8Array(await bundle.arrayBuffer()) };
}

/** @throws {never} */
export function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
