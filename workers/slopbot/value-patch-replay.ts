import { valueFileReader } from "./value-blob";
import type { EvidenceClient, FileChange } from "./value-evidence";
import {
  hasCompleteValuePatch,
  valueAdditionCount,
  valuePatch,
} from "./value-patch";
import { readValuePaths } from "./value-tree";

interface Hunk {
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
  body: string[];
  before: string;
  after: string;
  label: string;
}

export interface AcceptedPatchReplay {
  schemaVersion: 1;
  headSha: string;
  mergeSha: string;
  parentSha: string;
  files: {
    path: string;
    mode: string;
    submittedBlobSha: string;
    parentBlobSha: string | null;
    acceptedBlobSha: string;
  }[];
}

/** Parse complete unified hunks without normalizing any content bytes. */
function hunks(file: FileChange): Hunk[] | null {
  const patch = valuePatch(file);
  if (!hasCompleteValuePatch(file) || typeof patch !== "string") return null;
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const result: Hunk[] = [];
  let delta = 0;
  let end = 0;
  for (let index = 0; index < lines.length; ) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u.exec(
      lines[index++],
    );
    if (!header || result.length >= 128) return null;
    const [oldStart, oldCount, newStart, newCount] = [
      header[1],
      header[2] ?? "1",
      header[3],
      header[4] ?? "1",
    ].map(Number);
    if (
      ![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger) ||
      !Number.isSafeInteger(oldStart + oldCount) ||
      !Number.isSafeInteger(newStart + newCount) ||
      oldStart < end ||
      (!oldCount && file.status !== "added") ||
      (oldCount > 0 && oldStart < 1) ||
      (newCount > 0 && newStart < 1) ||
      (file.status === "added"
        ? oldStart !== 0 ||
          oldCount !== 0 ||
          newStart !== 1 ||
          result.length !== 0
        : newStart !== oldStart + delta)
    )
      return null;
    const before: string[] = [];
    const after: string[] = [];
    const body: string[] = [];
    let previous = "";
    let marker = false;
    while (index < lines.length && !lines[index].startsWith("@@")) {
      const line = lines[index++];
      body.push(line);
      if (line === "\\ No newline at end of file") {
        if (marker || !previous) return null;
        if (previous !== "+")
          before[before.length - 1] = before.at(-1)!.slice(0, -1);
        if (previous !== "-")
          after[after.length - 1] = after.at(-1)!.slice(0, -1);
        marker = true;
        previous = "";
        continue;
      }
      const tag = line[0];
      if (![" ", "+", "-"].includes(tag) || (marker && tag === " "))
        return null;
      // Once one side has reached EOF, it cannot receive another line.
      if (
        (tag !== "+" && before.length && !before.at(-1)!.endsWith("\n")) ||
        (tag !== "-" && after.length && !after.at(-1)!.endsWith("\n"))
      )
        return null;
      if (tag !== "+") before.push(`${line.slice(1)}\n`);
      if (tag !== "-") after.push(`${line.slice(1)}\n`);
      previous = tag;
      marker = false;
    }
    if (
      before.length !== oldCount ||
      after.length !== newCount ||
      !body.some((line) => /^[+-]/u.test(line))
    )
      return null;
    result.push({
      oldStart,
      newStart,
      oldCount,
      newCount,
      body,
      before: before.join(""),
      after: after.join(""),
      label: header[5],
    });
    end = oldStart + oldCount;
    delta += newCount - oldCount;
  }
  return result.length ? result : null;
}

function text(bytes: Uint8Array): string | null {
  try {
    const decoded = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}

function hasSubmittedPostimages(source: string, hunks: Hunk[]): boolean {
  const starts = [0];
  for (
    let at = source.indexOf("\n");
    at !== -1;
    at = source.indexOf("\n", at + 1)
  )
    starts.push(at + 1);
  return hunks.every((hunk) => {
    const start = starts[hunk.newStart - 1];
    return (
      hunk.after.length > 0 &&
      start !== undefined &&
      source.slice(start, start + hunk.after.length) === hunk.after &&
      (hunk.after.endsWith("\n") || start + hunk.after.length === source.length)
    );
  });
}

/** Match each complete old hunk uniquely in the original parent, never in
 * progressively edited output. Ambiguous placement supplies no proof. */
function replay(
  parent: string,
  original: Hunk[],
  accepted: Hunk[],
): string | null {
  let cursor = 0;
  let output = "";
  for (let i = 0; i < original.length; i++) {
    const hunk = original[i];
    if (!hunk.before) return null;
    let found = -1;
    let from = 0;
    while (from <= parent.length) {
      const at = parent.indexOf(hunk.before, from);
      if (at < 0) break;
      const end = at + hunk.before.length;
      if (
        (at === 0 || parent[at - 1] === "\n") &&
        (hunk.before.endsWith("\n") || end === parent.length)
      ) {
        if (found !== -1) return null;
        found = at;
      }
      from = at + 1;
    }
    if (
      found < cursor ||
      found < 0 ||
      parent.slice(0, found).split("\n").length !== accepted[i].oldStart
    )
      return null;
    output += parent.slice(cursor, found) + hunk.after;
    cursor = found + hunk.before.length;
    if (hunk.after && !hunk.after.endsWith("\n") && cursor !== parent.length)
      return null;
  }
  return output + parent.slice(cursor);
}

/** A shifted squash needs full accepted-parent replay, not merely equality
 * after deleting hunk coordinates. Existing stacked-range proofs stay distinct. */
export async function collectAcceptedPatchReplay(
  client: EvidenceClient,
  repository: string,
  headSha: string,
  files: FileChange[],
  merge: { sha: string; parents: { sha: string }[]; files: FileChange[] },
): Promise<AcceptedPatchReplay | null> {
  if (
    merge.parents.length !== 1 ||
    ![headSha, merge.sha, merge.parents[0].sha].every((sha) =>
      /^[a-f0-9]{40}$/u.test(sha),
    ) ||
    !files.length ||
    files.length > 16 ||
    files.length !== merge.files.length
  )
    return null;
  const submitted = [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );
  const accepted = [...merge.files].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );
  if (new Set(submitted.map((file) => file.filename)).size !== files.length)
    return null;
  const parsed: { original: Hunk[]; accepted: Hunk[] }[] = [];
  for (let i = 0; i < submitted.length; i++) {
    const a = submitted[i],
      b = accepted[i];
    if (
      a.filename !== b.filename ||
      !["added", "modified"].includes(a.status) ||
      a.status !== b.status ||
      a.previous_filename !== undefined ||
      b.previous_filename !== undefined ||
      a.fullComparison ||
      b.fullComparison ||
      valueAdditionCount(a) !== valueAdditionCount(b) ||
      a.deletions !== b.deletions
    )
      return null;
    const left = hunks(a),
      right = hunks(b);
    if (
      !left ||
      !right ||
      left.length !== right.length ||
      left.some(
        (h, j) =>
          h.oldCount !== right[j].oldCount ||
          h.newCount !== right[j].newCount ||
          h.label !== right[j].label ||
          JSON.stringify(h.body) !== JSON.stringify(right[j].body),
      )
    )
      return null;
    parsed.push({ original: left, accepted: right });
  }
  let reads = 0;
  const bounded: EvidenceClient = {
    async get<T>(path: string) {
      if (++reads > 48) return null;
      return client.get<T>(path);
    },
  };
  const paths = submitted.map((file) => file.filename);
  const head = await readValuePaths(bounded, repository, headSha, paths);
  const parent = await readValuePaths(
    bounded,
    repository,
    merge.parents[0].sha,
    paths,
  );
  const final = await readValuePaths(bounded, repository, merge.sha, paths);
  if (!head || !parent || !final) return null;
  const read = valueFileReader(bounded, repository);
  const proof: AcceptedPatchReplay = {
    schemaVersion: 1,
    headSha,
    mergeSha: merge.sha,
    parentSha: merge.parents[0].sha,
    files: [],
  };
  for (let i = 0; i < submitted.length; i++) {
    const file = submitted[i],
      path = file.filename;
    const before = parent.get(path),
      after = final.get(path),
      source = head.get(path);
    if (
      !source ||
      !after ||
      !["100644", "100755"].includes(source.mode) ||
      source.mode !== after.mode ||
      (file.status === "added"
        ? before !== undefined || source.sha !== after.sha
        : !before || before.mode !== after.mode)
    )
      return null;
    const target = await read(path, merge.sha);
    if (!target || target.sha !== after.sha) return null;
    const expected = text(target.bytes);
    if (expected === null) return null;
    if (file.status === "added") {
      if (parsed[i].original[0].after !== expected) return null;
    } else {
      const submittedFile = await read(path, headSha);
      if (!submittedFile || submittedFile.sha !== source.sha) return null;
      const submittedText = text(submittedFile.bytes);
      if (
        submittedText === null ||
        !hasSubmittedPostimages(submittedText, parsed[i].original)
      )
        return null;
      const base = await read(path, merge.parents[0].sha);
      if (!base || base.sha !== before!.sha) return null;
      const content = text(base.bytes);
      if (
        content === null ||
        replay(content, parsed[i].original, parsed[i].accepted) !== expected
      )
        return null;
    }
    proof.files.push({
      path,
      mode: after.mode,
      submittedBlobSha: source.sha,
      parentBlobSha: before?.sha ?? null,
      acceptedBlobSha: after.sha,
    });
  }
  return proof;
}
