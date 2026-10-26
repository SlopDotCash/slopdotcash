/** Strict record primitives shared by public record readers. */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function readRecord(value, field) {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}
export function exactKeys(value, keys, field) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}
/** The exact millisecond UTC form that Date.prototype.toISOString writes. */
export const EXACT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
export function isExactUtc(value) {
  return (
    typeof value === "string" &&
    EXACT_UTC.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function timestamp(value, field) {
  if (!isExactUtc(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}
/** A canonical unsigned decimal integer: digits only, no leading zero. */
export const CANONICAL_UINT = /^(?:0|[1-9]\d*)$/u;
export function isCanonicalUint(value) {
  return typeof value === "string" && CANONICAL_UINT.test(value);
}
/** A string of min to max characters that matches pattern when one is given. */
export function boundedText(value, field, { min = 1, max, pattern }) {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    (pattern && !pattern.test(value))
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

export function nonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return Number(value);
}
