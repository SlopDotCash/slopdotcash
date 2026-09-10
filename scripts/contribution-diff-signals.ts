import { createHash } from "node:crypto";
export interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}
/** Conservative structural signals, never a monetary score or semantic verdict. */
export function contributionDiffSignals(
  files: DiffFile[],
  expectedFiles: number,
  expectedAdditions: number,
  expectedDeletions: number,
) {
  const incomplete = {
    complete: false,
    blankLinesOnly: false,
    testsOnly: false,
    patchSha256: null as string | null,
  };
  if (
    !Number.isSafeInteger(expectedFiles) ||
    expectedFiles < 0 ||
    files.length !== expectedFiles ||
    new Set(files.map((file) => file.filename)).size !== files.length
  )
    return incomplete;
  if (!files.length)
    return {
      complete: true,
      blankLinesOnly: false,
      testsOnly: false,
      patchSha256: null,
    };
  let additions = 0,
    deletions = 0;
  let blankLinesOnly = true;
  const normalized: [string, string, string][] = [];
  for (const file of files) {
    if (
      typeof file.patch !== "string" ||
      !Number.isSafeInteger(file.additions) ||
      !Number.isSafeInteger(file.deletions)
    )
      return incomplete;
    // GitHub omits/truncates binary and large patches. Count actual diff lines.
    const lines = file.patch.split("\n");
    const added = lines.filter((line) => line.startsWith("+"));
    const deleted = lines.filter((line) => line.startsWith("-"));
    if (added.length !== file.additions || deleted.length !== file.deletions)
      return incomplete;
    additions += added.length;
    deletions += deleted.length;
    blankLinesOnly &&=
      file.status === "modified" &&
      [...added, ...deleted].every((line) => line.slice(1).trim() === "");
    // Retain whitespace and context. Ignore only hunk coordinates; do not erase
    // indentation, strings or paths, and never equate this hash with acceptance.
    normalized.push([
      file.filename,
      file.status,
      lines
        .map((line) =>
          line.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, "@@"),
        )
        .join("\n"),
    ]);
  }
  if (additions !== expectedAdditions || deletions !== expectedDeletions)
    return incomplete;
  normalized.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    complete: true,
    blankLinesOnly: blankLinesOnly && additions + deletions > 0,
    testsOnly: files.every((file) =>
      /(?:^|\/)(?:tests?|__tests__)\/|(?:^|\/)test_[^/]+\.py$|\.(?:test|spec)\.[^.]+$/.test(
        file.filename,
      ),
    ),
    patchSha256: createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex"),
  };
}
