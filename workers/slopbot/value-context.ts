import { valueFileReader } from "./value-blob";
import type { EvidenceClient, ValueEvidence } from "./value-evidence-types";

export type ValueContextSelection = string | { path: string; ref: string };

export function validValueContextSelections(
  value: unknown,
): value is ValueContextSelection[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every(
      (entry) =>
        typeof entry === "string" ||
        (entry !== null &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          Object.keys(entry).sort().join(",") === "path,ref" &&
          typeof entry.path === "string" &&
          typeof entry.ref === "string" &&
          /^[a-f0-9]{40}$/u.test(entry.ref)),
    ) &&
    new Set(
      value.map((entry) =>
        typeof entry === "string"
          ? entry
          : JSON.stringify([entry.ref, entry.path]),
      ),
    ).size === value.length
  );
}

export function valueContextSelections(
  evidence: ValueEvidence,
): ValueContextSelection[] {
  return (evidence.contextFiles ?? []).map(({ path, ref }) =>
    ref === evidence.pull.head.sha ? path : { path, ref },
  );
}

/** Selected unchanged files let reviewers check claims outside the PR diff.
 * Bind complete bytes to the head, base or an observed review revision.
 */
export async function collectValueContext(
  client: EvidenceClient,
  evidence: ValueEvidence,
  paths: readonly ValueContextSelection[],
): Promise<ValueEvidence> {
  if (!paths.every((selection) => validValueContextSelections([selection])))
    throw new Error("Invalid immutable context selection");
  const allowedRefs = new Set([
    evidence.pull.head.sha,
    evidence.pull.base.sha,
    ...evidence.reviews.map((review) => review.commit_id),
  ]);
  const selected = [
    ...new Map(
      paths.map((entry) => {
        const selection =
          typeof entry === "string"
            ? { path: entry, ref: evidence.pull.head.sha }
            : entry;
        return [`${selection.ref}/${selection.path}`, selection] as const;
      }),
    ).values(),
  ].sort((a, b) => {
    const left = `${a.ref}/${a.path}`;
    const right = `${b.ref}/${b.path}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (
    selected.length > 16 ||
    selected.some(
      ({ path, ref }) =>
        !allowedRefs.has(ref) ||
        !path ||
        path.length > 1024 ||
        path.includes("\\") ||
        [...path].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        path.split("/").some((part) => !part || part === "." || part === ".."),
    ) ||
    !/^[a-f0-9]{40}$/u.test(evidence.pull.head.sha)
  )
    throw new Error("Invalid immutable context selection");
  if (!selected.length) return evidence;
  const contextFiles = [];
  const read = valueFileReader(client, evidence.repository);
  for (const { path, ref } of selected) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const file = await read(path, ref);
    if (!file) throw new Error(`Complete context file unavailable: ${path}`);
    contextFiles.push({
      path,
      ref,
      blobSha: file.sha,
      text: new TextDecoder("utf-8", { fatal: true }).decode(file.bytes),
      url: `https://github.com/${evidence.repository}/blob/${ref}/${encoded}`,
    });
  }
  return {
    ...evidence,
    contextFiles,
    evidenceUrls: [
      ...new Set([
        ...evidence.evidenceUrls,
        ...contextFiles.map((file) => file.url),
      ]),
    ],
  };
}
