import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { readBoundedBytes } from "../../src/lib/browser-json";
import { decodeBase64 } from "../../src/lib/byte-encoding";
import { gitObjectSha1 } from "./git-object";
import type {
  EvidenceClient,
  FileChange,
  ValueEvidence,
} from "./value-evidence-types";
import { needsFullValueComparison } from "./value-file-comparisons";
import { hasCompleteValuePatch } from "./value-patch";

export const VALUE_FILE_EXPANSION_LIMIT = 256 * 1024 * 1024;
export interface ValueFileRequest {
  repository: string;
  repositoryNodeId: string;
  ref: string;
  path: string;
}
export interface ValueFileRecovery {
  inputSha256: string;
  entries: (ValueFileRequest & {
    treeSha: string;
    mode: "100644" | "100755" | null;
    blobSha: string | null;
  })[];
  blobs: { sha: string; sha256: string; size: number; gzipBase64: string }[];
}
const oid = /^[a-f0-9]{40}$/u;
export function validValueFileRequest(value: ValueFileRequest): boolean {
  return (
    typeof value.repository === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository) &&
    typeof value.repositoryNodeId === "string" &&
    value.repositoryNodeId.length > 0 &&
    oid.test(value.ref) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    value.path.length <= 1024 &&
    !value.path.includes("\\") &&
    ![...value.path].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ) &&
    !value.path
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  );
}

/** Capture the complete immutable commit file inventories already requested by
 * the normal collector, including commits whose omitted counts held attribution. */
export function valueFileRecoveryCapture<T extends EvidenceClient>(client: T) {
  const metadata = new Map<string, string>();
  const comparisonBases = new Map<string, string>();
  const files = new Map<
    string,
    {
      repository: string;
      ref: string;
      parents: string[];
      changes: FileChange[];
    }
  >();
  const wrapped = Object.create(client) as T;
  wrapped.get = async <R>(path: string): Promise<R | null> => {
    const result = await client.get<R>(path);
    // Bind the raw response before file recovery adds derived evidence.
    if (
      /^\/repos\/[^/]+\/[^/]+\/(?:pulls\/\d+(?:\/(?:files|commits))?|commits\/[a-f0-9]{40})(?:\?|$)/u.test(
        path,
      )
    ) {
      const signature = await sha256Hex(JSON.stringify(result));
      if (metadata.has(path) && metadata.get(path) !== signature)
        throw new Error("Source metadata changed during collection");
      metadata.set(path, signature);
    }
    const comparison =
      /^\/repos\/([^/]+\/[^/]+)\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/u.exec(
        path,
      );
    if (comparison && result && typeof result === "object") {
      const base = (result as { merge_base_commit?: { sha?: string } })
        .merge_base_commit?.sha;
      if (base && oid.test(base))
        comparisonBases.set(`${comparison[1]}:${comparison[3]}`, base);
    }
    const match =
      /^\/repos\/([^/]+\/[^/]+)\/commits\/([a-f0-9]{40})\?per_page=100&page=\d+$/u.exec(
        path,
      );
    if (match && result && typeof result === "object") {
      const row = result as unknown as {
        sha: string;
        parents: { sha: string }[];
        files: FileChange[];
      };
      if (
        row.sha !== match[2] ||
        !Array.isArray(row.parents) ||
        !Array.isArray(row.files)
      )
        throw new Error("Recovery commit inventory is incomplete");
      const key = `${match[1]}:${row.sha}`;
      const prior = files.get(key);
      const parents = row.parents.map(({ sha }) => sha);
      if (prior && JSON.stringify(prior.parents) !== JSON.stringify(parents))
        throw new Error("Recovery commit parents changed");
      files.set(key, {
        repository: match[1],
        ref: row.sha,
        parents,
        changes: [
          ...new Map(
            [...(prior?.changes ?? []), ...row.files].map((file) => [
              file.filename,
              file,
            ]),
          ).values(),
        ],
      });
    }
    return result;
  };
  return {
    client: wrapped,
    metadata,
    requests(sources: readonly ValueEvidence[]): ValueFileRequest[] {
      const requests = new Map<string, ValueFileRequest>();
      const add = (source: ValueEvidence, ref: string, paths: string[]) => {
        for (const path of paths) {
          const value = {
            repository: source.repository,
            repositoryNodeId: source.repositoryNodeId,
            ref,
            path,
          };
          if (!validValueFileRequest(value))
            throw new Error("Invalid source file recovery selection");
          requests.set(JSON.stringify(value), value);
        }
      };
      const select = (
        source: ValueEvidence,
        changes: FileChange[],
        head: string,
        base?: string,
      ) => {
        for (const file of changes) {
          if (hasCompleteValuePatch(file) && !needsFullValueComparison(file))
            continue;
          if (file.status !== "removed") add(source, head, [file.filename]);
          if (base && file.status !== "added")
            add(source, base, [file.previous_filename ?? file.filename]);
        }
      };
      for (const source of sources) {
        select(
          source,
          source.files,
          source.pull.head.sha,
          comparisonBases.get(`${source.repository}:${source.pull.head.sha}`),
        );
      }
      for (const inventory of files.values()) {
        const source = sources.find(
          (source) =>
            inventory.repository.toLowerCase() ===
            source.repository.toLowerCase(),
        );
        if (source)
          select(
            source,
            inventory.changes,
            inventory.ref,
            inventory.parents[0],
          );
      }
      return [...requests.values()].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      );
    },
  };
}

/** Only the private verifier constructs this proof. Validate every binding and
 * compressed byte before exposing immutable files to the ordinary collector. */
export async function verifiedValueFileClient<T extends EvidenceClient>(
  client: T,
  requests: readonly ValueFileRequest[],
  recovery: ValueFileRecovery,
  internText?: (text: string) => string,
): Promise<T & EvidenceClient> {
  if (
    recovery.inputSha256 !== (await sha256Hex(JSON.stringify(requests))) ||
    !Array.isArray(recovery.entries) ||
    recovery.entries.length !== requests.length ||
    !Array.isArray(recovery.blobs)
  )
    throw new Error("File recovery identity mismatch");
  const entries = new Map<string, ValueFileRecovery["entries"][number]>();
  const expected = new Set(requests.map((request) => JSON.stringify(request)));
  for (const entry of recovery.entries) {
    const request = {
      repository: entry.repository,
      repositoryNodeId: entry.repositoryNodeId,
      ref: entry.ref,
      path: entry.path,
    };
    const key = JSON.stringify(request);
    if (
      !validValueFileRequest(request) ||
      !expected.delete(key) ||
      !oid.test(entry.treeSha) ||
      (entry.blobSha === null
        ? entry.mode !== null
        : !oid.test(entry.blobSha) ||
          !["100644", "100755"].includes(entry.mode ?? ""))
    )
      throw new Error("Invalid recovered file binding");
    entries.set(
      JSON.stringify([entry.repository.toLowerCase(), entry.ref, entry.path]),
      entry,
    );
  }
  if (expected.size) throw new Error("Incomplete file recovery");
  const required = new Set(
    recovery.entries.flatMap((entry) => (entry.blobSha ? [entry.blobSha] : [])),
  );
  const blobs = new Map<string, { sha: string; text: string }>();
  const textPool = new Map<string, string>();
  const wrapped = Object.create(client) as T & EvidenceClient;
  wrapped.internText =
    internText ??
    client.internText ??
    ((text) => {
      if (text.length < 1024) return text;
      const existing = textPool.get(text);
      if (existing !== undefined) return existing;
      textPool.set(text, text);
      return text;
    });
  let expanded = 0;
  for (const blob of recovery.blobs) {
    if (
      !required.delete(blob.sha) ||
      !oid.test(blob.sha) ||
      !/^[a-f0-9]{64}$/u.test(blob.sha256) ||
      !Number.isSafeInteger(blob.size) ||
      blob.size < 0 ||
      blob.size > VALUE_FILE_EXPANSION_LIMIT - expanded
    )
      throw new Error("Invalid recovered blob inventory");
    const compressed = decodeBase64(blob.gzipBase64);
    const bytes = await readBoundedBytes(
      new Response(
        new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream("gzip")),
      ),
      blob.size,
      "recovered Git blob",
    );
    if (
      bytes.length !== blob.size ||
      (await sha256Hex(bytes)) !== blob.sha256 ||
      (await gitObjectSha1("blob", bytes)) !== blob.sha
    )
      throw new Error("Recovered Git blob bytes changed");
    // Only exact UTF-8 regular text files participate in this recovery route.
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (text.includes("\0")) throw new Error("Recovered Git blob is not text");
    expanded += bytes.length;
    blobs.set(blob.sha, {
      sha: blob.sha,
      text: wrapped.internText(text),
    });
  }
  if (required.size) throw new Error("Missing recovered Git blob");
  wrapped.verifiedFile = async (repository, ref, path) => {
    const entry = entries.get(
      JSON.stringify([repository.toLowerCase(), ref, path]),
    );
    const blob = entry?.blobSha ? blobs.get(entry.blobSha) : null;
    return blob
      ? { sha: blob.sha, bytes: new TextEncoder().encode(blob.text) }
      : null;
  };
  return wrapped;
}
