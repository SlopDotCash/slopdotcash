/** Decode complete gzip streams inertly; their payload still receives a full scan. */
import { gunzipSync, inflateRawSync } from "node:zlib";
import type { VettingArtifact } from "../../backend/vetting/result";
import { sha256Hex as sha256 } from "../../src/lib/sha256";
import type { ScanInputFile } from "./bounded-scan";

/** Exact optional header bytes, including text that gzip itself does not execute. */
function gzipHeader(
  bytes: Uint8Array,
  archiveSha256: string,
  sourcePath: string,
  member: number,
  offset: number,
): { text: string; length: number } {
  if (
    bytes.length < 18 ||
    bytes[0] !== 0x1f ||
    bytes[1] !== 0x8b ||
    bytes[2] !== 8 ||
    (bytes[3] & 0xe0) !== 0
  )
    throw new Error("Invalid gzip header");
  const flags = bytes[3];
  let at = 10;
  const fields: Record<string, unknown> = {
    schema: "slop-gzip-header-v1",
    archiveSha256,
    sourcePath,
    member,
    offset,
    fixedHex: Buffer.from(bytes.subarray(0, at)).toString("hex"),
  };
  const field = (name: string, end: number) => {
    if (end > bytes.length - 8) throw new Error("Truncated gzip header");
    const value = Buffer.from(bytes.subarray(at, end));
    fields[name] = {
      hex: value.toString("hex"),
      latin1: value.toString("latin1"),
    };
    at = end;
  };
  if (flags & 4) {
    if (at + 2 > bytes.length - 8)
      throw new Error("Truncated gzip extra length");
    const length = bytes[at] | (bytes[at + 1] << 8);
    at += 2;
    field("extra", at + length);
  }
  for (const [flag, name] of [
    [8, "filename"],
    [16, "comment"],
  ] as const) {
    if (!(flags & flag)) continue;
    const end = bytes.indexOf(0, at);
    if (end < 0) throw new Error("Unterminated gzip header string");
    field(name, end);
    at += 1;
  }
  if (flags & 2) {
    if (at + 2 > bytes.length - 8) throw new Error("Truncated gzip header CRC");
    fields.headerCrcHex = Buffer.from(bytes.subarray(at, at + 2)).toString(
      "hex",
    );
    at += 2;
  }
  fields.headerBytes = at;
  fields.completeHeaderHex = Buffer.from(bytes.subarray(0, at)).toString("hex");
  return { text: JSON.stringify(fields), length: at };
}

export function expandGzipInputs(
  input: ScanInputFile[],
  knownPath: (path: string) => boolean,
): {
  files: ScanInputFile[];
  derivedFiles: ScanInputFile[];
  archives: VettingArtifact[];
  gaps: string[];
} {
  const files: ScanInputFile[] = [];
  const derivedFiles: ScanInputFile[] = [];
  const archives: VettingArtifact[] = [];
  const gaps: string[] = [];
  const pending = input.map((file) => ({ file, ancestors: new Set<string>() }));
  for (let index = 0; index < pending.length; index++) {
    const { file, ancestors } = pending[index];
    if (file.bytes[0] !== 0x1f || file.bytes[1] !== 0x8b) {
      files.push(file);
      continue;
    }
    const digest = sha256(file.bytes);
    let payload: Uint8Array;
    const headers: string[] = [];
    try {
      if (ancestors.has(digest)) throw new Error("Repeated compressed object");
      // zlib validates each stream's CRC and all concatenated members, but it
      // stops at zero padding and can ignore arbitrary bytes after that. Its
      // consumed-input count must therefore cover the exact retained object.
      // Do not impose a repository or decompressed-file size refusal.
      const decoded = gunzipSync(file.bytes, { info: true }) as unknown as {
        buffer: Uint8Array;
        engine: { bytesWritten: number };
      };
      if (decoded.engine.bytesWritten !== file.bytes.byteLength)
        throw new Error("Unconsumed compressed-object bytes");
      payload = new Uint8Array(decoded.buffer);
      // The complete gunzip above validates every member's CRC and trailer.
      // Raw DEFLATE's consumed count locates each next header without trying
      // to find magic bytes inside compressed data or omitting later metadata.
      let offset = 0;
      while (offset < file.bytes.length) {
        const header = gzipHeader(
          file.bytes.subarray(offset),
          digest,
          file.path,
          headers.length + 1,
          offset,
        );
        const member = inflateRawSync(
          file.bytes.subarray(offset + header.length),
          {
            info: true,
          },
        ) as unknown as { engine: { bytesWritten: number } };
        offset += header.length + member.engine.bytesWritten + 8;
        if (offset > file.bytes.length)
          throw new Error("Truncated gzip member");
        headers.push(header.text);
      }
    } catch {
      files.push(file);
      gaps.push(`Gzip payload could not be read completely: ${file.path}`);
      continue;
    }
    // Header comments/names/extra fields are untrusted text too. Decode all
    // their bytes losslessly and run instruction checks, while never using
    // an embedded filename as a path or granting it instruction authority.
    headers.forEach((header, index) => {
      files.push({
        path: `/slop-scan/gzip-header/${digest}/${sha256(file.path)}/member-${index + 1}/AGENTS.md`,
        logicalPath: "AGENTS.md",
        bytes: new TextEncoder().encode(header),
        parentArtifactSha256: digest,
      });
    });
    const logicalPath = (file.logicalPath ?? file.path).replace(/\.gz$/iu, "");
    // Unknown formats remain binary artifacts. A readable UTF-8 payload must
    // never disappear merely because its gzip name has no recognized suffix.
    const name = knownPath(logicalPath) ? logicalPath : `${logicalPath}.bin`;
    const child: ScanInputFile = {
      path: `/slop-scan/gzip/${digest}/${name}`,
      logicalPath: name,
      bytes: payload,
      parentArtifactSha256: digest,
    };
    archives.push({
      sha256: digest,
      parentSha256: file.parentArtifactSha256 ?? null,
      origin: file.parentArtifactSha256 ? "archive" : "repository",
      path: file.path.slice(0, 500),
      type: "archive",
      // Initial classification of a transparent compression wrapper, before
      // quarantine. Native, unknown and nested-archive payloads still receive
      // their own analysis. This never releases an existing quarantined item.
      state: "released",
      analysis: "static-clean",
      requestedExecution: false,
    });
    derivedFiles.push(child);
    pending.push({ file: child, ancestors: new Set([...ancestors, digest]) });
  }
  return { files, derivedFiles, archives, gaps };
}
