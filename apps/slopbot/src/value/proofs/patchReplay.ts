//@ backend dafny
// spec/slopbot/valueEvidence.md, "An accepted-patch replay counts only when every submitted file replays onto the accepted parent to the exact accepted bytes"

export interface Hunk {
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
  body: string[];
  before: string;
  after: string;
  label: string;
}

export interface ParsedHunks {
  ok: boolean;
  hunks: Hunk[];
}

export interface HunkHeader {
  ok: boolean;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  label: string;
}

export interface DigitRun {
  ok: boolean;
  value: number;
  next: number;
}

export interface Replayed {
  ok: boolean;
  text: string;
}

export const hunkLimit = 128;
export const safeIntegerLimit = 9007199254740991;
export const noNewlineMarker = "\\ No newline at end of file";

const refusedHeader: HunkHeader = { ok: false, oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, label: "" };
const refusedHunks: ParsedHunks = { ok: false, hunks: [] };
const refusedReplay: Replayed = { ok: false, text: "" };

/** @throws {never} */
export function splitOnNewline(text: string): string[] {
  //@ ensures \result.length >= 1
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= start && start <= i && i <= text.length
    //@ decreases text.length - i
    if (text.charCodeAt(i) === 10) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i = i + 1;
  }
  parts.push(text.slice(start));
  return parts;
}

/** @throws {never} */
export function digitsAt(text: string, at: number): DigitRun {
  //@ requires 0 <= at && at <= text.length
  //@ ensures \result.ok ==> at < \result.next && \result.next <= text.length && 0 <= \result.value && \result.value <= safeIntegerLimit
  let value = 0;
  let i = at;
  while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
    //@ invariant at <= i && i <= text.length
    //@ invariant 0 <= value && value <= safeIntegerLimit
    //@ decreases text.length - i
    const digit = text.charCodeAt(i) - 48;
    if (value > 900719925474099 || (value === 900719925474099 && digit > 1)) return { ok: false, value: 0, next: at };
    value = value * 10 + digit;
    i = i + 1;
  }
  return i === at ? { ok: false, value: 0, next: at } : { ok: true, value: value, next: i };
}

/** @throws {never} */
export function hasLineTerminator(line: string): boolean {
  let i = 0;
  while (i < line.length) {
    //@ invariant 0 <= i && i <= line.length
    //@ decreases line.length - i
    const code = line.charCodeAt(i);
    if (code === 10 || code === 13 || code === 8232 || code === 8233) return true;
    i = i + 1;
  }
  return false;
}

/** @throws {never} */
export function hunkHeader(line: string): HunkHeader {
  if (!line.startsWith("@@ -")) return refusedHeader;
  const oldStart = digitsAt(line, 4);
  if (!oldStart.ok) return refusedHeader;
  let at = oldStart.next;
  let oldCount = 1;
  if (line.startsWith(",", at)) {
    const count = digitsAt(line, at + 1);
    if (!count.ok) return refusedHeader;
    oldCount = count.value;
    at = count.next;
  }
  if (!line.startsWith(" +", at)) return refusedHeader;
  const newStart = digitsAt(line, at + 2);
  if (!newStart.ok) return refusedHeader;
  at = newStart.next;
  let newCount = 1;
  if (line.startsWith(",", at)) {
    const count = digitsAt(line, at + 1);
    if (!count.ok) return refusedHeader;
    newCount = count.value;
    at = count.next;
  }
  if (!line.startsWith(" @@", at) || hasLineTerminator(line)) return refusedHeader;
  return { ok: true, oldStart: oldStart.value, oldCount: oldCount, newStart: newStart.value, newCount: newCount, label: line.slice(at + 3) };
}

/** @throws {never} */
export function endsWithNewline(text: string): boolean {
  return text.length > 0 && text.charCodeAt(text.length - 1) === 10;
}

/** @throws {never} */
export function withoutLastCharacter(text: string): string {
  return text.length === 0 ? text : text.slice(0, text.length - 1);
}

/** @throws {never} */
export function concatenated(parts: string[]): string {
  let out = "";
  let i = 0;
  while (i < parts.length) {
    //@ invariant 0 <= i && i <= parts.length
    //@ decreases parts.length - i
    out = out + parts[i];
    i = i + 1;
  }
  return out;
}

/** @throws {never} */
export function startsAHunk(line: string): boolean {
  return line.startsWith("@@");
}

/** @throws {never} */
export function parseHunks(patch: string, added: boolean): ParsedHunks {
  //@ ensures \result.ok ==> \result.hunks.length > 0 && \result.hunks.length <= hunkLimit
  const lines = splitOnNewline(patch);
  const total = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  const result: Hunk[] = [];
  let delta = 0;
  let end = 0;
  let index = 0;
  while (index < total) {
    //@ invariant 0 <= index && index <= total && total <= lines.length
    //@ invariant result.length <= hunkLimit
    //@ decreases total - index
    const header = hunkHeader(lines[index]);
    index = index + 1;
    if (!header.ok || result.length >= hunkLimit) return refusedHunks;
    const oldStart = header.oldStart;
    const oldCount = header.oldCount;
    const newStart = header.newStart;
    const newCount = header.newCount;
    if (
      oldStart + oldCount > safeIntegerLimit ||
      newStart + newCount > safeIntegerLimit ||
      oldStart < end ||
      (oldCount === 0 && !added) ||
      (oldCount > 0 && oldStart < 1) ||
      (newCount > 0 && newStart < 1) ||
      (added ? oldStart !== 0 || oldCount !== 0 || newStart !== 1 || result.length !== 0 : newStart !== oldStart + delta)
    )
      return refusedHunks;
    const before: string[] = [];
    const after: string[] = [];
    const body: string[] = [];
    let previous = "";
    let marker = false;
    let changed = false;
    while (index < total && !startsAHunk(lines[index])) {
      //@ invariant 0 <= index && index <= total && total <= lines.length
      //@ decreases total - index
      const line = lines[index];
      index = index + 1;
      body.push(line);
      if (line === noNewlineMarker) {
        if (marker || previous === "") return refusedHunks;
        if (previous !== "+") {
          if (before.length === 0) return refusedHunks;
          before[before.length - 1] = withoutLastCharacter(before[before.length - 1]);
        }
        if (previous !== "-") {
          if (after.length === 0) return refusedHunks;
          after[after.length - 1] = withoutLastCharacter(after[after.length - 1]);
        }
        marker = true;
        previous = "";
      } else {
        if (line.length === 0) return refusedHunks;
        const tag = line.slice(0, 1);
        if ((tag !== " " && tag !== "+" && tag !== "-") || (marker && tag === " ")) return refusedHunks;
        if (
          (tag !== "+" && before.length > 0 && !endsWithNewline(before[before.length - 1])) ||
          (tag !== "-" && after.length > 0 && !endsWithNewline(after[after.length - 1]))
        )
          return refusedHunks;
        if (tag !== "+") before.push(line.slice(1) + "\n");
        if (tag !== "-") after.push(line.slice(1) + "\n");
        if (tag !== " ") changed = true;
        previous = tag;
        marker = false;
      }
    }
    if (before.length !== oldCount || after.length !== newCount || !changed) return refusedHunks;
    result.push({
      oldStart: oldStart,
      newStart: newStart,
      oldCount: oldCount,
      newCount: newCount,
      body: body,
      before: concatenated(before),
      after: concatenated(after),
      label: header.label,
    });
    end = oldStart + oldCount;
    delta = delta + newCount - oldCount;
  }
  return result.length > 0 ? { ok: true, hunks: result } : refusedHunks;
}

/** @throws {never} */
export function sameLines(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  let i = 0;
  while (i < left.length) {
    //@ invariant 0 <= i && i <= left.length
    //@ decreases left.length - i
    if (left[i] !== right[i]) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function sameHunks(left: Hunk[], right: Hunk[]): boolean {
  if (left.length !== right.length) return false;
  let i = 0;
  while (i < left.length) {
    //@ invariant 0 <= i && i <= left.length
    //@ decreases left.length - i
    const a = left[i];
    const b = right[i];
    if (a.oldCount !== b.oldCount || a.newCount !== b.newCount || a.label !== b.label || !sameLines(a.body, b.body)) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function lineStarts(source: string): number[] {
  //@ ensures \result.length >= 1
  //@ ensures forall(k, 0 <= k && k < \result.length ==> 0 <= \result[k] && \result[k] <= source.length)
  const starts: number[] = [0];
  let i = 0;
  while (i < source.length) {
    //@ invariant 0 <= i && i <= source.length
    //@ invariant starts.length >= 1
    //@ invariant forall(k, 0 <= k && k < starts.length ==> 0 <= starts[k] && starts[k] <= source.length)
    //@ decreases source.length - i
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
    i = i + 1;
  }
  return starts;
}

/** @throws {never} */
export function hasSubmittedPostimages(source: string, hunks: Hunk[]): boolean {
  const starts = lineStarts(source);
  let i = 0;
  while (i < hunks.length) {
    //@ invariant 0 <= i && i <= hunks.length
    //@ decreases hunks.length - i
    const hunk = hunks[i];
    const line = hunk.newStart - 1;
    if (hunk.after.length === 0 || line < 0 || line >= starts.length) return false;
    const start = starts[line];
    if (start + hunk.after.length > source.length) return false;
    if (source.slice(start, start + hunk.after.length) !== hunk.after) return false;
    if (!endsWithNewline(hunk.after) && start + hunk.after.length !== source.length) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function lineNumberAt(text: string, at: number): number {
  //@ requires 0 <= at && at <= text.length
  //@ ensures \result >= 1
  let line = 1;
  let i = 0;
  while (i < at) {
    //@ invariant 0 <= i && i <= at
    //@ invariant line >= 1
    //@ decreases at - i
    if (text.charCodeAt(i) === 10) line = line + 1;
    i = i + 1;
  }
  return line;
}

/** @throws {never} */
export function findFrom(text: string, from: number, needle: string): number {
  //@ requires 0 <= from && needle.length > 0
  //@ ensures \result === -1 || (from <= \result && \result + needle.length <= text.length)
  let i = from;
  while (i + needle.length <= text.length) {
    //@ invariant from <= i
    //@ decreases text.length - i
    if (text.startsWith(needle, i)) return i;
    i = i + 1;
  }
  return -1;
}

/** @throws {never} */
export function contains(values: number[], value: number): boolean {
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ decreases values.length - i
    if (values[i] === value) return true;
    i = i + 1;
  }
  return false;
}

/** @throws {never} */
export function distinct(values: number[]): boolean {
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ decreases values.length - i
    let j = i + 1;
    while (j < values.length) {
      //@ invariant i < j && j <= values.length
      //@ decreases values.length - j
      if (values[i] === values[j]) return false;
      j = j + 1;
    }
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function replay(parent: string, original: Hunk[], accepted: Hunk[]): Replayed {
  //@ requires original.length === accepted.length
  let cursor = 0;
  let output = "";
  let i = 0;
  while (i < original.length) {
    //@ invariant 0 <= i && i <= original.length
    //@ invariant 0 <= cursor && cursor <= parent.length
    //@ decreases original.length - i
    const hunk = original[i];
    if (hunk.before.length === 0) return refusedReplay;
    const lines: number[] = [];
    const offsets: number[] = [];
    let from = 0;
    while (from <= parent.length) {
      //@ invariant 0 <= from && from <= parent.length + 1
      //@ invariant lines.length === offsets.length
      //@ decreases parent.length + 1 - from
      const at = findFrom(parent, from, hunk.before);
      if (at < 0) {
        from = parent.length + 1;
      } else {
        const end = at + hunk.before.length;
        if ((at === 0 || parent.charCodeAt(at - 1) === 10) && (endsWithNewline(hunk.before) || end === parent.length)) {
          lines.push(lineNumberAt(parent, at));
          offsets.push(at);
        }
        from = at + 1;
      }
    }
    const expected: number[] = [];
    let k = 0;
    while (k < original.length) {
      //@ invariant 0 <= k && k <= original.length
      //@ decreases original.length - k
      if (original[k].before === hunk.before && original[k].after === hunk.after) expected.push(accepted[k].oldStart);
      k = k + 1;
    }
    if (lines.length !== expected.length || !distinct(expected)) return refusedReplay;
    let found = -1;
    let m = 0;
    while (m < lines.length) {
      //@ invariant 0 <= m && m <= lines.length
      //@ invariant found === -1 || (0 <= found && found <= parent.length)
      //@ decreases lines.length - m
      if (!contains(expected, lines[m])) return refusedReplay;
      if (found === -1 && lines[m] === accepted[i].oldStart) {
        const offset = offsets[m];
        if (offset < 0 || offset > parent.length) return refusedReplay;
        found = offset;
      }
      m = m + 1;
    }
    if (found < 0 || found < cursor || found + hunk.before.length > parent.length) return refusedReplay;
    output = output + parent.slice(cursor, found) + hunk.after;
    cursor = found + hunk.before.length;
    if (hunk.after.length > 0 && !endsWithNewline(hunk.after) && cursor !== parent.length) return refusedReplay;
    i = i + 1;
  }
  return { ok: true, text: output + parent.slice(cursor) };
}
