// spec/slopbot/valueEvidence.md, "Line counts come from the exact patch or from hash-verified file text, and must sum to the commit's totals"
import { hunkHeader, noNewlineMarker } from "./patchReplay.ts";

export interface DiffSection {
  readonly patch: string;
  readonly beforePrefix: string;
  readonly afterPrefix: string;
  readonly mode: string;
}

/** @throws {never} */
function completeHunks(lines: ReadonlyArray<string>): boolean {
  let before = 0;
  let after = 0;
  let endBefore = 0;
  let endAfter = 0;
  let beforeEnded = false;
  let afterEnded = false;
  let active = false;
  let previous = "";
  let changed = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const header = hunkHeader(line);
      if (!header.ok || before !== 0 || after !== 0 || (active && !changed) ||
        (header.oldCount > 0 && (header.oldStart === 0 || beforeEnded)) ||
        (header.newCount > 0 && (header.newStart === 0 || afterEnded))) return false;
      const startBefore = header.oldStart - Number(header.oldCount > 0);
      const startAfter = header.newStart - Number(header.newCount > 0);
      const gap = startBefore - endBefore;
      if (gap < 0 || startAfter - endAfter !== gap) return false;
      before = header.oldCount;
      after = header.newCount;
      endBefore = startBefore + before;
      endAfter = startAfter + after;
      if (before + after === 0 || !Number.isSafeInteger(endBefore) || !Number.isSafeInteger(endAfter)) return false;
      active = true;
      previous = "";
      changed = false;
      continue;
    }
    if (!active) return false;
    if (line === noNewlineMarker && previous !== "") {
      beforeEnded ||= previous !== "+";
      afterEnded ||= previous !== "-";
      previous = "";
      continue;
    }
    const sign = line[0];
    if (sign !== " " && sign !== "-" && sign !== "+") return false;
    if ((sign !== "+" && beforeEnded) || (sign !== "-" && afterEnded)) return false;
    if (sign !== "+") before -= 1;
    if (sign !== "-") after -= 1;
    if (before < 0 || after < 0) return false;
    previous = sign;
    changed ||= sign !== " ";
  }
  return active && changed && before === 0 && after === 0;
}

/** @throws {never} */
export function modifiedDiffSection(diff: string, path: string): DiffSection | undefined {
  if (!/^[\w./-]+$/u.test(path) || !diff.endsWith("\n") || diff.includes("\0")) return undefined;
  const lines = diff.slice(0, -1).split("\n");
  if (lines.some((line) => line.startsWith("diff --git ") && line.includes('"'))) return undefined;
  const expected = `diff --git a/${path} b/${path}`;
  const start = lines.indexOf(expected);
  if (start < 0 || lines.lastIndexOf(expected) !== start) return undefined;
  const index = /^index ([a-f0-9]{7,40})\.\.([a-f0-9]{7,40}) (100644|100755)$/u.exec(lines[start + 1] ?? "");
  if (index === null || lines[start + 2] !== `--- a/${path}` || lines[start + 3] !== `+++ b/${path}`) return undefined;
  const next = lines.findIndex((line, position) => position > start && line.startsWith("diff --git "));
  const hunks = lines.slice(start + 4, next < 0 ? lines.length : next);
  return completeHunks(hunks) ? { patch: hunks.join("\n"), beforePrefix: index[1] ?? "", afterPrefix: index[2] ?? "", mode: index[3] ?? "" } : undefined;
}
