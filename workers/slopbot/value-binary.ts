import { valueFileReader } from "./value-blob";
import type {
  EvidenceClient,
  FileChange,
  ValueEvidence,
} from "./value-evidence";
import { readValueTreeProof } from "./value-tree";

/** Private source bytes, not a textual patch or proof of what a recording shows. */
export interface AddedBinaryProof {
  schemaVersion: 1;
  path: string;
  baseSha: string;
  headSha: string;
  baseTreeSha: string;
  headTreeSha: string;
  mode: "100644";
  blobSha: string;
  size: number;
  sha256: string;
  contentBase64: string;
  contentReview: "unviewed";
}

const oid = /^[a-f0-9]{40}$/u;
const digest = /^[a-f0-9]{64}$/u;
const validPath = (path: string) =>
  path.length > 0 &&
  path.length <= 1024 &&
  !path.includes("\\") &&
  ![...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
  !path.split("/").some((part) => !part || part === "." || part === "..");
const keys =
  "baseSha,baseTreeSha,blobSha,contentBase64,contentReview,headSha,headTreeSha,mode,path,schemaVersion,sha256,size";
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

function encode(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function binary(bytes: Uint8Array): boolean {
  // A Git LFS pointer describes other bytes and is never the media itself.
  if (
    new TextDecoder()
      .decode(bytes.subarray(0, 80))
      .startsWith("version https://git-lfs.github.com/spec/")
  )
    return false;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(bytes)
      .includes("\0");
  } catch {
    return true;
  }
}

export function needsAddedBinaryProof(file: FileChange): boolean {
  return (
    file.status === "added" &&
    file.previous_filename === undefined &&
    file.additions === 0 &&
    file.deletions === 0 &&
    file.patch === undefined &&
    file.fullComparison === undefined &&
    file.removedComparison === undefined &&
    file.unchangedRename === undefined
  );
}

async function identities(bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const object = new Uint8Array(prefix.length + bytes.length);
  object.set(prefix);
  object.set(bytes, prefix.length);
  return {
    blobSha: hex(await crypto.subtle.digest("SHA-1", object)),
    sha256: hex(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
  };
}

/** One bounded recovery session across submitted, accepted and author scopes. */
export function addedBinaryRecovery(
  client: EvidenceClient,
  repository: string,
) {
  const read = valueFileReader(client, repository);
  const trees = new Map<
    string,
    Awaited<ReturnType<typeof readValueTreeProof>>
  >();
  let treeEntries = 0;
  let attempts = 0;
  async function tree(ref: string) {
    if (!trees.has(ref)) {
      if (treeEntries >= 20_000) return null;
      const result = await readValueTreeProof(client, repository, ref);
      treeEntries += result?.entries.size ?? 0;
      trees.set(ref, treeEntries <= 20_000 ? result : null);
    }
    return treeEntries <= 20_000 ? trees.get(ref) : null;
  }
  return async (files: FileChange[], baseSha: string, headSha: string) => {
    if (!oid.test(baseSha) || !oid.test(headSha) || baseSha === headSha) return;
    for (const file of files) {
      if (!needsAddedBinaryProof(file) || file.addedBinary !== undefined)
        continue;
      if (++attempts > 48) return;
      const before = await tree(baseSha);
      const after = await tree(headSha);
      const entry = after?.entries.get(file.filename);
      if (
        !before ||
        !after ||
        before.entries.has(file.filename) ||
        entry?.type !== "blob" ||
        entry.mode !== "100644"
      )
        continue;
      const blob = await read(file.filename, headSha);
      if (!blob || blob.sha !== entry.sha || !binary(blob.bytes)) continue;
      file.addedBinary = {
        schemaVersion: 1,
        path: file.filename,
        baseSha,
        headSha,
        baseTreeSha: before.treeSha,
        headTreeSha: after.treeSha,
        mode: "100644",
        size: blob.bytes.length,
        ...(await identities(blob.bytes)),
        contentBase64: encode(blob.bytes),
        contentReview: "unviewed",
      };
    }
  };
}

/** Validate retained bodies before a private assessment can use them. Import
 * also regenerates the tree/byte proof through the authenticated collector. */
export async function validAddedBinaryProof(
  file: FileChange,
): Promise<boolean> {
  const proof = file.addedBinary;
  if (
    !proof ||
    !needsAddedBinaryProof(file) ||
    Object.keys(proof).sort().join() !== keys ||
    proof.schemaVersion !== 1 ||
    typeof proof.path !== "string" ||
    proof.path !== file.filename ||
    !validPath(proof.path) ||
    ![
      proof.baseSha,
      proof.headSha,
      proof.baseTreeSha,
      proof.headTreeSha,
      proof.blobSha,
    ].every((value) => typeof value === "string" && oid.test(value)) ||
    proof.baseSha === proof.headSha ||
    proof.baseTreeSha === proof.headTreeSha ||
    proof.mode !== "100644" ||
    proof.contentReview !== "unviewed" ||
    !Number.isSafeInteger(proof.size) ||
    proof.size <= 0 ||
    proof.size > 512 * 1024 ||
    typeof proof.sha256 !== "string" ||
    !digest.test(proof.sha256) ||
    typeof proof.contentBase64 !== "string" ||
    proof.contentBase64.length > 4 * Math.ceil((512 * 1024) / 3)
  )
    return false;
  try {
    const bytes = Uint8Array.from(atob(proof.contentBase64), (value) =>
      value.charCodeAt(0),
    );
    if (
      bytes.length !== proof.size ||
      encode(bytes) !== proof.contentBase64 ||
      !binary(bytes)
    )
      return false;
    const hashes = await identities(bytes);
    return hashes.blobSha === proof.blobSha && hashes.sha256 === proof.sha256;
  } catch {
    return false;
  }
}

export function sameAddedBinary(left: FileChange, right: FileChange): boolean {
  const a = left.addedBinary;
  const b = right.addedBinary;
  return (
    a !== undefined &&
    b !== undefined &&
    a.path === b.path &&
    a.mode === b.mode &&
    a.blobSha === b.blobSha &&
    a.size === b.size &&
    a.sha256 === b.sha256 &&
    a.contentBase64 === b.contentBase64
  );
}

/** Binary admission stays narrow: exact accepted bytes, and unchanged content
 * in each ordinary implementation commit. No indirect/copy/rewrite inference. */
export async function binarySourceLimitations(
  evidence: ValueEvidence,
): Promise<string[]> {
  const groups = [
    evidence.files,
    evidence.mergeCommitEvidence?.files ?? [],
    ...evidence.commitAttribution.map((entry) => entry.files ?? []),
  ];
  if (
    !groups.some((files) =>
      files.some((file) => file.addedBinary !== undefined),
    )
  )
    return [];
  const proofs = groups.flatMap((files) =>
    files.flatMap((file) => (file.addedBinary ? [file.addedBinary] : [])),
  );
  if (
    proofs.length > 48 ||
    proofs.reduce(
      (sum, proof) =>
        sum +
        (Number.isSafeInteger(proof.size) && proof.size > 0 ? proof.size : 0),
      0,
    ) >
      2 * 1024 * 1024
  )
    return ["Added binary evidence exceeds the recovery budget"];
  const limitations: string[] = [];
  const submitted = evidence.files.filter(
    (file) => file.addedBinary !== undefined,
  );
  if (
    !submitted.length ||
    evidence.indirectAcceptance ||
    evidence.acceptedRange ||
    !evidence.pull.merged_at ||
    !evidence.mergeCommitEvidence ||
    evidence.mergeCommitEvidence.sha !== evidence.pull.merge_commit_sha ||
    !(
      evidence.mergeCommitEvidence.parents.length === 1 ||
      (evidence.mergeCommitEvidence.parents.length === 2 &&
        evidence.mergeCommitEvidence.parents.some(
          (parent) => parent.sha === evidence.pull.head.sha,
        ))
    )
  ) {
    limitations.push(
      "Added binary evidence requires direct, unchanged acceptance",
    );
  }
  for (const files of groups) {
    for (const file of files) {
      if (
        file.addedBinary !== undefined &&
        !(await validAddedBinaryProof(file))
      )
        limitations.push(`Invalid added binary proof: ${file.filename}`);
    }
  }
  for (const file of evidence.mergeCommitEvidence?.files ?? []) {
    if (
      file.addedBinary &&
      !submitted.some((source) => source.filename === file.filename)
    )
      limitations.push(
        `Accepted binary has no submitted proof: ${file.filename}`,
      );
  }
  for (const file of submitted) {
    const accepted = evidence.mergeCommitEvidence?.files.find(
      (item) => item.filename === file.filename,
    );
    if (
      file.addedBinary?.headSha !== evidence.pull.head.sha ||
      !accepted ||
      accepted.addedBinary?.headSha !== evidence.mergeCommitEvidence?.sha ||
      accepted.addedBinary?.baseSha !==
        evidence.mergeCommitEvidence?.parents[0]?.sha ||
      !sameAddedBinary(file, accepted)
    )
      limitations.push(
        `Added binary accepted identity is unavailable: ${file.filename}`,
      );
    const scopes = evidence.commitAttribution.filter((entry) =>
      entry.changedPaths?.includes(file.filename),
    );
    if (scopes.length !== 1)
      limitations.push(
        `Added binary needs one unchanged implementation scope: ${file.filename}`,
      );
    for (const scope of scopes) {
      const commit = evidence.commits.find((item) => item.sha === scope.sha);
      const change = scope.files?.find(
        (item) => item.filename === file.filename,
      );
      if (
        commit?.parents.length !== 1 ||
        !change ||
        change.addedBinary?.headSha !== commit.sha ||
        change.addedBinary?.baseSha !== commit.parents[0].sha ||
        !sameAddedBinary(file, change)
      )
        limitations.push(
          `Added binary implementation identity is unavailable: ${file.filename}`,
        );
    }
  }
  return limitations;
}
