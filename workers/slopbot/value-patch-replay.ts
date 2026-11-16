import { valueFileReader } from "./value-blob";
import type {
  AcceptedPatchReplay,
  EvidenceClient,
  FileChange,
} from "./value-evidence-types";
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

/** Match old hunks in the original parent, never progressively edited output.
 * Repeated context is usable only when every occurrence is explicitly edited
 * by the same before/after hunk and the accepted offsets bind them all. */
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
    const matches: { at: number; line: number }[] = [];
    let from = 0;
    while (from <= parent.length) {
      const at = parent.indexOf(hunk.before, from);
      if (at < 0) break;
      const end = at + hunk.before.length;
      if (
        (at === 0 || parent[at - 1] === "\n") &&
        (hunk.before.endsWith("\n") || end === parent.length)
      ) {
        matches.push({ at, line: parent.slice(0, at).split("\n").length });
      }
      from = at + 1;
    }
    const expected = original.flatMap((candidate, index) =>
      candidate.before === hunk.before && candidate.after === hunk.after
        ? [accepted[index].oldStart]
        : [],
    );
    if (
      matches.length !== expected.length ||
      new Set(expected).size !== expected.length ||
      matches.some((match) => !expected.includes(match.line))
    )
      return null;
    const found =
      matches.find((match) => match.line === accepted[i].oldStart)?.at ?? -1;
    if (found < cursor || found < 0) return null;
    output += parent.slice(cursor, found) + hunk.after;
    cursor = found + hunk.before.length;
    if (hunk.after && !hunk.after.endsWith("\n") && cursor !== parent.length)
      return null;
  }
  return output + parent.slice(cursor);
}

/** A shifted squash needs full accepted-parent replay, not merely equality
 * after deleting hunk coordinates. Existing stacked-range proofs stay distinct. */
async function collectAcceptedPatchReplayBatch(
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
  const paths = submitted.map((file) => file.filename);
  const head = await readValuePaths(client, repository, headSha, paths);
  const parent = await readValuePaths(
    client,
    repository,
    merge.parents[0].sha,
    paths,
  );
  const final = await readValuePaths(client, repository, merge.sha, paths);
  if (!head || !parent || !final) return null;
  const read = valueFileReader(client, repository);
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

/** Replay every submitted file, in bounded path batches. A later failure
 * discards the complete candidate proof; an earlier batch is never published.
 * Cache only immutable object/path reads within this one proof collection.
 */
export async function collectAcceptedPatchReplay(
  client: EvidenceClient,
  repository: string,
  headSha: string,
  files: FileChange[],
  merge: { sha: string; parents: { sha: string }[]; files: FileChange[] },
): Promise<AcceptedPatchReplay | null> {
  if (
    !files.length ||
    files.length !== merge.files.length ||
    new Set(files.map((file) => file.filename)).size !== files.length ||
    new Set(merge.files.map((file) => file.filename)).size !==
      merge.files.length
  )
    return null;
  const submitted = [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );
  const accepted = new Map(merge.files.map((file) => [file.filename, file]));
  if (submitted.some((file) => !accepted.has(file.filename))) return null;
  const requests = new Map<string, Promise<unknown>>();
  const immutable: EvidenceClient = {
    async get<T>(path: string): Promise<T | null> {
      // Keep each file's blob body within its reader lifetime. Only the
      // shared immutable ancestor metadata needs cross-batch caching.
      if (!path.startsWith(`/repos/${repository}/git/`))
        return client.get<T>(path);
      let request = requests.get(path);
      if (!request) {
        request = client.get<unknown>(path);
        requests.set(path, request);
      }
      return (await request) as T | null;
    },
  };
  let complete: AcceptedPatchReplay | null = null;
  // Each file gets the existing bounded reader's complete byte budget.
  // Shared immutable requests avoid re-fetching common ancestor trees.
  for (let offset = 0; offset < submitted.length; offset++) {
    const batch = submitted.slice(offset, offset + 1);
    const proof = await collectAcceptedPatchReplayBatch(
      immutable,
      repository,
      headSha,
      batch,
      { ...merge, files: batch.map((file) => accepted.get(file.filename)!) },
    );
    if (!proof) return null;
    if (complete === null) complete = proof;
    else complete.files.push(...proof.files);
  }
  return complete;
}
