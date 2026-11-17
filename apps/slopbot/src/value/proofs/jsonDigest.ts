// spec/slopbot/valueEvidence.md, "A blob, tree or binary claim counts only when its git object hash matches the bytes read"
import { runningSha256 } from "@repo/platform/digest";
import { hexOf, textBytes } from "@repo/platform/git/bytes";

const chunkLength = 16_384;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function omitted(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/** @throws {TypeError} */
export function jsonDigest(value: unknown): string {
  const hash = runningSha256();
  const ancestors = new Set<object>();
  const emit = (text: string) => hash.update(textBytes(text));
  const string = (text: string) => {
    emit('"');
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + chunkLength, text.length);
      if (isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) end--;
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
      const encoded = JSON.stringify(item) as string | undefined;
      if (encoded === undefined) throw new TypeError("Evidence contains non-JSON data");
      emit(encoded);
      return;
    }
    if (ancestors.has(item)) throw new TypeError("Cyclic evidence");
    ancestors.add(item);
    if (Array.isArray(item)) {
      emit("[");
      for (let index = 0; index < item.length; index++) {
        if (index) emit(",");
        const child: unknown = item[index];
        write(omitted(child) ? null : child);
      }
      emit("]");
    } else {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Evidence must contain plain JSON objects");
      emit("{");
      let first = true;
      for (const [key, child] of Object.entries(item)) {
        if (omitted(child)) continue;
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
  return hexOf(hash.finish());
}
