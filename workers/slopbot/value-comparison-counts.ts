import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "../../src/lib/byte-encoding";
import type { FileChange } from "./value-evidence-types";

const counts = new WeakMap<
  object,
  {
    before: string;
    after: string;
    beforeSha: string;
    afterSha: string;
    result: { additions: number; deletions: number };
  }
>();

function verifiedText(text: string, blobSha: string): boolean {
  if (text.includes("\0") || !/^[a-f0-9]{40}$/u.test(blobSha)) return false;
  const bytes = new TextEncoder().encode(text);
  const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const object = new Uint8Array(prefix.length + bytes.length);
  object.set(prefix);
  object.set(bytes, prefix.length);
  return bytesToHex(sha1(object)) === blobSha;
}

export function hasVerifiedFullComparison(file: FileChange): boolean {
  const comparison = file.fullComparison;
  return (
    comparison !== undefined &&
    /^[a-f0-9]{40}$/u.test(comparison.baseSha) &&
    /^[a-f0-9]{40}$/u.test(comparison.headSha) &&
    verifiedText(comparison.before.text, comparison.before.blobSha) &&
    verifiedText(comparison.after.text, comparison.after.blobSha)
  );
}

/** Recover omitted zero counts from complete, verified text. Myers' shortest
 * edit distance counts changed lines without manufacturing a source patch. */
export function fullComparisonCounts(
  file: FileChange,
): { additions: number; deletions: number } | null {
  const comparison = file.fullComparison;
  if (
    file.status !== "modified" ||
    file.previous_filename !== undefined ||
    file.additions !== 0 ||
    file.deletions !== 0 ||
    !comparison ||
    !/^[a-f0-9]{40}$/u.test(comparison.baseSha) ||
    !/^[a-f0-9]{40}$/u.test(comparison.headSha)
  )
    return null;
  const cached = counts.get(comparison);
  if (
    cached &&
    cached.before === comparison.before.text &&
    cached.after === comparison.after.text &&
    cached.beforeSha === comparison.before.blobSha &&
    cached.afterSha === comparison.after.blobSha
  )
    return cached.result;
  if (
    !verifiedText(comparison.before.text, comparison.before.blobSha) ||
    !verifiedText(comparison.after.text, comparison.after.blobSha)
  )
    return null;
  // Keep line terminators to count a final-newline change as a changed line.
  const beforeLines = comparison.before.text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const afterLines = comparison.after.text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  )
    start++;
  let beforeEnd = beforeLines.length,
    afterEnd = afterLines.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd--;
    afterEnd--;
  }
  const before = beforeLines.slice(start, beforeEnd);
  const after = afterLines.slice(start, afterEnd);
  // An incomplete calculation keeps the reported counts, so existing commit
  // sum validation retains its gap instead of treating unknown work as zero.
  if (before.length + after.length > 200_000) return null;
  const maximum = before.length + after.length;
  const offset = maximum + 1;
  const furthest = new Int32Array(2 * maximum + 3);
  furthest.fill(-1);
  furthest[offset + 1] = 0;
  let comparisons = 0;
  for (let distance = 0; distance <= maximum; distance++) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (++comparisons > 2_000_000) return null;
      const slot = offset + diagonal;
      let x =
        diagonal === -distance ||
        (diagonal !== distance && furthest[slot - 1] < furthest[slot + 1])
          ? furthest[slot + 1]
          : furthest[slot - 1] + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x++;
        y++;
      }
      furthest[slot] = x;
      if (x >= before.length && y >= after.length) {
        const deletions = (distance + before.length - after.length) / 2;
        const result = { additions: distance - deletions, deletions };
        counts.set(comparison, {
          before: comparison.before.text,
          after: comparison.after.text,
          beforeSha: comparison.before.blobSha,
          afterSha: comparison.after.blobSha,
          result,
        });
        return result;
      }
    }
  }
  return null;
}
