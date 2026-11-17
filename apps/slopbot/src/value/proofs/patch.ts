//@ backend dafny
// spec/slopbot/valueEvidence.md, "Line counts come from the exact patch or from hash-verified file text, and must sum to the commit's totals"

export interface SignCounts {
  additions: number;
  deletions: number;
}

export const noNewlineMarker = "\\ No newline at end of file";

/** @throws {never} */
export function patchCounts(patch: string): SignCounts {
  //@ ensures \result.additions >= 0 && \result.deletions >= 0
  let additions = 0;
  let deletions = 0;
  let i = 0;
  while (i < patch.length) {
    //@ invariant 0 <= i && i <= patch.length
    //@ invariant additions >= 0 && deletions >= 0
    //@ decreases patch.length - i
    if (i === 0 || patch.charCodeAt(i - 1) === 10) {
      const code = patch.charCodeAt(i);
      if (code === 43) additions = additions + 1;
      if (code === 45) deletions = deletions + 1;
    }
    i = i + 1;
  }
  return { additions: additions, deletions: deletions };
}

/** @throws {never} */
export function textLineCount(text: string): number {
  //@ ensures \result >= 0
  //@ ensures text.length === 0 ==> \result === 0
  let count = 0;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant count >= 0
    //@ decreases text.length - i
    if (text.charCodeAt(i) === 10) count = count + 1;
    i = i + 1;
  }
  if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) count = count + 1;
  return count;
}

/** @throws {never} */
export function decimal(value: number): string {
  //@ requires value >= 0
  const digits = "0123456789";
  if (value === 0) return "0";
  let rest = value;
  let text = "";
  while (rest > 0) {
    //@ invariant rest >= 0
    //@ decreases rest
    const digit = rest % 10;
    text = digits.slice(digit, digit + 1) + text;
    rest = (rest - digit) / 10;
  }
  return text;
}

/** @throws {never} */
export function rangeOf(count: number): string {
  //@ requires count >= 0
  return count === 1 ? "1" : "1," + decimal(count);
}

/** @throws {never} */
export function prefixedLines(text: string, sign: string): string {
  let out = sign;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ decreases text.length - i
    const character = text.slice(i, i + 1);
    if (character === "\n") {
      if (i < text.length - 1) out = out + "\n" + sign;
    } else {
      out = out + character;
    }
    i = i + 1;
  }
  return out;
}

/** @throws {never} */
export function endsWithNewline(text: string): boolean {
  return text.length > 0 && text.charCodeAt(text.length - 1) === 10;
}

/** @throws {never} */
export function addedPatch(text: string): string {
  //@ ensures text.length === 0 ==> \result === ""
  const count = textLineCount(text);
  if (count === 0) return "";
  return "@@ -0,0 +" + rangeOf(count) + " @@\n" + prefixedLines(text, "+") + (endsWithNewline(text) ? "" : "\n" + noNewlineMarker);
}

/** @throws {never} */
export function removedPatch(text: string): string {
  //@ ensures text.length === 0 ==> \result === ""
  const count = textLineCount(text);
  if (count === 0) return "";
  return "@@ -" + rangeOf(count) + " +0,0 @@\n" + prefixedLines(text, "-") + (endsWithNewline(text) ? "" : "\n" + noNewlineMarker);
}
