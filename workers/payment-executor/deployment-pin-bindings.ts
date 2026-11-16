import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Cloudflare Workers limits each environment variable to 5 KB.
const MAX_BINDING_BYTES = 5_000;
const PIN_BINDINGS = [
  "PAYMENT_DEPLOYMENTS",
  "SECURITY_PAYMENT_DEPLOYMENTS",
] as const;
type PinBinding = (typeof PIN_BINDINGS)[number];

const utf8 = new TextEncoder();
const byteLength = (value: string) => utf8.encode(value).byteLength;
const pinDigest = (value: string) => bytesToHex(sha256(utf8.encode(value)));

/** Frame only the public registry values that exceed the provider's limit. */
export function frameDeploymentPinBindings(vars: Record<string, string>) {
  const framed = { ...vars };
  for (const binding of PIN_BINDINGS) {
    const value = vars[binding];
    if (value === undefined) continue;
    const bytes = byteLength(value);
    if (bytes <= MAX_BINDING_BYTES) continue;

    const parts: string[] = [];
    let part = "";
    let partBytes = 0;
    // Iterate Unicode code points so a character never crosses a part boundary.
    for (const character of value) {
      const characterBytes = byteLength(character);
      if (partBytes + characterBytes > MAX_BINDING_BYTES) {
        parts.push(part);
        part = "";
        partBytes = 0;
      }
      part += character;
      partBytes += characterBytes;
    }
    parts.push(part);
    const prefix = `${binding}_PART_`;
    for (const [index, chunk] of parts.entries()) {
      framed[prefix + (index + 1)] = chunk;
    }
    framed[binding] = `pins:v1:${parts.length}:${bytes}:${pinDigest(value)}`;
  }
  return framed;
}

/** Reconstruct the exact bytes of one binding without reading unrelated values. */
export function readDeploymentPinBinding(env: object, binding: PinBinding) {
  const vars = env as Record<string, unknown>;
  const value = vars[binding];
  const prefix = `${binding}_PART_`;
  const partNames = Object.keys(env).filter((name) => name.startsWith(prefix));
  const invalid = () =>
    new Error(`Invalid deployment pin frame for ${binding}`);
  if (value !== undefined && typeof value !== "string") throw invalid();
  if (!value?.startsWith("pins:") && !partNames.length) return value;

  const frame = /^pins:v1:([1-9][0-9]*):([1-9][0-9]*):([a-f0-9]{64})$/u.exec(
    value ?? "",
  );
  if (!frame || partNames.length < 2 || Number(frame[1]) !== partNames.length)
    throw invalid();

  const parts = [];
  for (let index = 1; index <= partNames.length; index++) {
    const name = prefix + index;
    const part = vars[name];
    if (
      !Object.hasOwn(vars, name) ||
      typeof part !== "string" ||
      !part.length ||
      byteLength(part) > MAX_BINDING_BYTES
    )
      throw invalid();
    parts.push(part);
  }

  const reconstructed = parts.join("");
  const bytes = byteLength(reconstructed);
  if (
    bytes <= MAX_BINDING_BYTES ||
    bytes !== Number(frame[2]) ||
    pinDigest(reconstructed) !== frame[3]
  )
    throw invalid();
  return reconstructed;
}
