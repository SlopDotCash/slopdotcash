//@ backend dafny
// spec/slopbot/valueEvidence.md, "Absence is proved only by a hash-verified tree, never by a 404"; spec/slopbot/valueEvidence.md, "A blob, tree or binary claim counts only when its git object hash matches the bytes read"

export const pathLengthLimit = 1024;

/** @throws {never} */
//@ pure
export function isLowerHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102);
}

/** @throws {never} */
export function isLowerHexOfLength(text: string, length: number): boolean {
  //@ requires length >= 0
  //@ ensures \result ==> text.length === length
  if (text.length !== length) return false;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ decreases text.length - i
    if (!isLowerHex(text.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function isObjectId(text: string): boolean {
  //@ ensures \result ==> text.length === 40
  return isLowerHexOfLength(text, 40);
}

/** @throws {never} */
export function isSha256(text: string): boolean {
  //@ ensures \result ==> text.length === 64
  return isLowerHexOfLength(text, 64);
}

/** @throws {never} */
//@ pure
export function isControl(code: number): boolean {
  return code < 32 || code === 127;
}

/** @throws {never} */
export function hasUnsafeCharacter(text: string, slashAllowed: boolean): boolean {
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ decreases text.length - i
    const code = text.charCodeAt(i);
    if (isControl(code) || code === 92 || (!slashAllowed && code === 47)) return true;
    i = i + 1;
  }
  return false;
}

/** @throws {never} */
//@ pure
export function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

/** @throws {never} */
export function isSafeSegment(segment: string): boolean {
  //@ ensures \result ==> 0 < segment.length && segment.length <= pathLengthLimit
  return segment.length > 0 && segment.length <= pathLengthLimit && !hasUnsafeCharacter(segment, false) && !isDotSegment(segment);
}

/** @throws {never} */
export function isSafePath(path: string): boolean {
  //@ ensures \result ==> 0 < path.length && path.length <= pathLengthLimit
  if (path.length === 0 || path.length > pathLengthLimit || hasUnsafeCharacter(path, true)) return false;
  let start = 0;
  let i = 0;
  while (i <= path.length) {
    //@ invariant 0 <= start && start <= i && i <= path.length + 1
    //@ decreases path.length + 1 - i
    if (i === path.length || path.charCodeAt(i) === 47) {
      const segment = path.slice(start, i);
      if (segment.length === 0 || isDotSegment(segment)) return false;
      start = i + 1;
    }
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
//@ pure
export function entryTypeOfMode(mode: string): string {
  return mode === "040000"
    ? "tree"
    : mode === "100644" || mode === "100755" || mode === "120000"
      ? "blob"
      : mode === "160000"
        ? "commit"
        : "";
}

/** @throws {never} */
//@ pure
export function isRegularFileMode(mode: string): boolean {
  return mode === "100644" || mode === "100755";
}

/** @throws {never} */
export function parentPath(path: string): string {
  //@ ensures \result.length <= path.length
  let i = path.length;
  while (i > 0) {
    //@ invariant 0 <= i && i <= path.length
    //@ decreases i
    if (path.charCodeAt(i - 1) === 47) return path.slice(0, i - 1);
    i = i - 1;
  }
  return "";
}

/** @throws {never} */
export function baseName(path: string): string {
  //@ ensures \result.length <= path.length
  let i = path.length;
  while (i > 0) {
    //@ invariant 0 <= i && i <= path.length
    //@ decreases i
    if (path.charCodeAt(i - 1) === 47) return path.slice(i);
    i = i - 1;
  }
  return path;
}
