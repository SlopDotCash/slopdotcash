import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "../../src/lib/byte-encoding";

/** The exact JSON.stringify byte stream, emitted in bounded chunks. Evidence is
 * JSON data. No source body or escaping-sized copy is retained for hashing. */
export function valueJsonDigest(value: unknown): string {
  const hash = sha256.create();
  const encoder = new TextEncoder();
  const ancestors = new Set<object>();
  const emit = (text: string) => hash.update(encoder.encode(text));
  const string = (text: string) => {
    emit('"');
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + 16_384, text.length);
      const last = text.charCodeAt(end - 1),
        next = text.charCodeAt(end);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
        end--;
      emit(JSON.stringify(text.slice(start, end)).slice(1, -1));
      start = end;
    }
    emit('"');
  };
  const write = (item: unknown): void => {
    if (typeof item === "string") {
      string(item);
      return;
    }
    if (item === null || typeof item !== "object") {
      const encoded = JSON.stringify(item);
      if (encoded === undefined)
        throw new TypeError("Evidence contains non-JSON data");
      emit(encoded);
      return;
    }
    if (ancestors.has(item)) throw new TypeError("Cyclic evidence");
    ancestors.add(item);
    if (Array.isArray(item)) {
      emit("[");
      for (let i = 0; i < item.length; i++) {
        if (i) emit(",");
        const child = item[i];
        write(
          child === undefined ||
            typeof child === "function" ||
            typeof child === "symbol"
            ? null
            : child,
        );
      }
      emit("]");
    } else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        throw new TypeError("Evidence must contain plain JSON objects");
      emit("{");
      let first = true;
      for (const key of Object.keys(item)) {
        const child = (item as Record<string, unknown>)[key];
        if (
          child === undefined ||
          typeof child === "function" ||
          typeof child === "symbol"
        )
          continue;
        if (!first) emit(",");
        first = false;
        string(key);
        emit(":");
        write(child);
      }
      emit("}");
    }
    ancestors.delete(item);
  };
  write(value);
  return bytesToHex(hash.digest());
}
