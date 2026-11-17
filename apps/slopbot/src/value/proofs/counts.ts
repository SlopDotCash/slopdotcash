//@ backend dafny
// spec/slopbot/valueEvidence.md, "Line counts come from the exact patch or from hash-verified file text, and must sum to the commit's totals"
import { comparedLineLimit, comparisonStepLimit } from "../../../gen/slopbot__valueEvidence.ts";

export interface LineCounts {
  complete: boolean;
  additions: number;
  deletions: number;
}

export const unresolved: LineCounts = { complete: false, additions: 0, deletions: 0 };

/** @throws {never} */
export function linesWithTerminators(text: string): string[] {
  //@ ensures \result.length <= text.length
  const lines: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= start && start <= i && i <= text.length
    //@ invariant lines.length <= start
    //@ decreases text.length - i
    if (text.charCodeAt(i) === 10) {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
    i = i + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** @throws {never} */
export function filled(size: number, value: number): number[] {
  //@ requires size >= 0
  //@ ensures \result.length === size
  const cells: number[] = [];
  while (cells.length < size) {
    //@ invariant cells.length <= size
    //@ decreases size - cells.length
    cells.push(value);
  }
  return cells;
}

/** @throws {never} */
export function myersCounts(beforeText: string, afterText: string): LineCounts {
  //@ ensures \result.complete ==> \result.additions >= 0 && \result.deletions >= 0
  const beforeLines = linesWithTerminators(beforeText);
  const afterLines = linesWithTerminators(afterText);
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
    //@ invariant 0 <= start && start <= beforeLines.length && start <= afterLines.length
    //@ decreases beforeLines.length - start
    start = start + 1;
  }
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (beforeEnd > start && afterEnd > start && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]) {
    //@ invariant start <= beforeEnd && beforeEnd <= beforeLines.length
    //@ invariant start <= afterEnd && afterEnd <= afterLines.length
    //@ decreases beforeEnd
    beforeEnd = beforeEnd - 1;
    afterEnd = afterEnd - 1;
  }
  const before = beforeLines.slice(start, beforeEnd);
  const after = afterLines.slice(start, afterEnd);
  const n = before.length;
  const m = after.length;
  if (n + m > comparedLineLimit) return unresolved;
  const maximum = n + m;
  const offset = maximum + 1;
  const furthest = filled(2 * maximum + 3, -1);
  furthest[offset + 1] = 0;
  let comparisons = 0;
  let distance = 0;
  while (distance <= maximum) {
    //@ invariant 0 <= distance && distance <= maximum + 1
    //@ invariant furthest.length === 2 * maximum + 3
    //@ decreases maximum + 1 - distance
    let diagonal = -distance;
    while (diagonal <= distance) {
      //@ invariant -distance <= diagonal && diagonal <= distance + 2
      //@ invariant furthest.length === 2 * maximum + 3
      //@ decreases distance + 2 - diagonal
      comparisons = comparisons + 1;
      if (comparisons > comparisonStepLimit) return unresolved;
      const slot = offset + diagonal;
      let x = diagonal === -distance || (diagonal !== distance && furthest[slot - 1] < furthest[slot + 1])
        ? furthest[slot + 1]
        : furthest[slot - 1] + 1;
      let y = x - diagonal;
      if (x < 0 || y < 0) return unresolved;
      while (x < n && y < m && before[x] === after[y]) {
        //@ invariant 0 <= x && 0 <= y && y === x - diagonal
        //@ decreases n - x
        x = x + 1;
        y = y + 1;
      }
      furthest[slot] = x;
      if (x >= n && y >= m) {
        const deletions = (distance + n - m) / 2;
        const additions = distance - deletions;
        if (deletions < 0 || additions < 0) return unresolved;
        return { complete: true, additions: additions, deletions: deletions };
      }
      diagonal = diagonal + 2;
    }
    distance = distance + 1;
  }
  return unresolved;
}
