//@ backend dafny
// spec/slopbot/review.md, "Each item carries one Slopbot review comment, found again only through the App's own actor, and echoed text is neutralized"

export const echoLimit = 1500;
export const zeroWidthSpace = "​";

/** @throws {never} */
//@ pure
export function unsafeAt(text: string, i: number): boolean {
  //@ requires 0 <= i && i < text.length
  return text.charCodeAt(i) === 60 ||
    (text.charCodeAt(i) === 93 && i + 1 < text.length && (text.charCodeAt(i + 1) === 40 || text.charCodeAt(i + 1) === 58)) ||
    (text.charCodeAt(i) === 58 && i + 2 < text.length && text.charCodeAt(i + 1) === 47 && text.charCodeAt(i + 2) === 47) ||
    (text.charCodeAt(i) === 64 && i + 1 < text.length && text.charCodeAt(i + 1) !== 8203);
}

/** @throws {never} */
//@ pure
export function neutralFrom(text: string, i: number): boolean {
  //@ requires 0 <= i && i <= text.length
  //@ decreases text.length - i
  return i === text.length || (!unsafeAt(text, i) && neutralFrom(text, i + 1));
}

/** @throws {never} */
//@ pure
export function isNeutral(text: string): boolean {
  return neutralFrom(text, 0);
}

/** @throws {never} */
//@ pure
export function piece(text: string, i: number): string {
  //@ requires 0 <= i && i < text.length
  return text.charCodeAt(i) === 64 ? "@" + zeroWidthSpace
    : text.charCodeAt(i) === 60 ? "&lt;"
    : text.charCodeAt(i) === 93 && i + 1 < text.length && (text.charCodeAt(i + 1) === 40 || text.charCodeAt(i + 1) === 58) ? "] "
    : text.charCodeAt(i) === 58 && i + 2 < text.length && text.charCodeAt(i + 1) === 47 && text.charCodeAt(i + 2) === 47 ? ":" + zeroWidthSpace
    : text.slice(i, i + 1);
}

/** @throws {never} */
//@ pure
export function neutralizedFrom(text: string, i: number): string {
  //@ requires 0 <= i && i <= text.length
  //@ decreases text.length - i
  return i === text.length ? "" : piece(text, i) + neutralizedFrom(text, i + 1);
}

/** @throws {never} */
//@ pure
export function boundedSource(text: string): string {
  return text.length > echoLimit + 2 ? text.slice(0, echoLimit + 2) : text;
}

/** @throws {never} */
//@ pure
export function cut(text: string): string {
  return text.length > echoLimit ? text.slice(0, echoLimit) : text;
}

/** @throws {never} */
//@ pure
export function neutralize(text: string): string {
  //@ ensures \result.length <= echoLimit
  //@ ensures isNeutral(\result)
  return cut(neutralizedFrom(boundedSource(text), 0));
}
