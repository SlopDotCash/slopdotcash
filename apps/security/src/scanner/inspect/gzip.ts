// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"
import { gunzipSync, inflateRawSync } from "node:zlib";
import { hexOf, sha256Of } from "@repo/platform/git/bytes";
import type { ScanInputFile, VettingArtifact } from "./model.ts";

interface Inflated {
  readonly buffer: Uint8Array;
  readonly engine: { readonly bytesWritten: number };
}

/** @throws {never} */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** @throws {Error} */
function gzipHeader(bytes: Uint8Array, archiveSha256: string, sourcePath: string, member: number, offset: number): { text: string; length: number } {
  const flags = bytes[3] ?? 0;
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8 || (flags & 0xe0) !== 0) throw new Error("Invalid gzip header");
  let at = 10;
  const fields: Record<string, unknown> = {
    schema: "slop-gzip-header-v1",
    archiveSha256,
    sourcePath,
    member,
    offset,
    fixedHex: hexOf(bytes.subarray(0, at)),
  };
  const field = (name: string, end: number) => {
    if (end > bytes.length - 8) throw new Error("Truncated gzip header");
    const value = bytes.subarray(at, end);
    fields[name] = { hex: hexOf(value), latin1: latin1(value) };
    at = end;
  };
  if (flags & 4) {
    if (at + 2 > bytes.length - 8) throw new Error("Truncated gzip extra length");
    const length = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
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
    fields.headerCrcHex = hexOf(bytes.subarray(at, at + 2));
    at += 2;
  }
  fields.headerBytes = at;
  fields.completeHeaderHex = hexOf(bytes.subarray(0, at));
  return { text: JSON.stringify(fields), length: at };
}

/** @throws {Error} */
function members(bytes: Uint8Array, digest: string, path: string): { payload: Uint8Array; headers: string[] } {
  const decoded = gunzipSync(bytes, { info: true }) as unknown as Inflated;
  if (decoded.engine.bytesWritten !== bytes.byteLength) throw new Error("Unconsumed compressed-object bytes");
  const headers: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const header = gzipHeader(bytes.subarray(offset), digest, path, headers.length + 1, offset);
    const member = inflateRawSync(bytes.subarray(offset + header.length), { info: true }) as unknown as Inflated;
    offset += header.length + member.engine.bytesWritten + 8;
    if (offset > bytes.length) throw new Error("Truncated gzip member");
    headers.push(header.text);
  }
  return { payload: new Uint8Array(decoded.buffer), headers };
}

/** @throws {never} */
function readMembers(bytes: Uint8Array, digest: string, path: string, ancestors: ReadonlySet<string>): { payload: Uint8Array; headers: string[] } | null {
  if (ancestors.has(digest)) return null;
  try {
    return members(bytes, digest, path);
  } catch {
    return null;
  }
}

export interface ExpandedInputs {
  readonly files: ScanInputFile[];
  readonly derivedFiles: ScanInputFile[];
  readonly archives: VettingArtifact[];
  readonly gaps: string[];
}

/** @throws {never} */
export function expandGzipInputs(input: ReadonlyArray<ScanInputFile>, knownPath: (path: string) => boolean): ExpandedInputs {
  const files: ScanInputFile[] = [];
  const derivedFiles: ScanInputFile[] = [];
  const archives: VettingArtifact[] = [];
  const gaps: string[] = [];
  const pending = input.map((file) => ({ file, ancestors: new Set<string>() as ReadonlySet<string> }));
  for (let index = 0; index < pending.length; index++) {
    const next = pending[index];
    if (next === undefined) continue;
    const { file, ancestors } = next;
    if (file.bytes[0] !== 0x1f || file.bytes[1] !== 0x8b) {
      files.push(file);
      continue;
    }
    const digest = sha256Of(file.bytes);
    const read = readMembers(file.bytes, digest, file.path, ancestors);
    if (read === null) {
      files.push(file);
      gaps.push(`Gzip payload could not be read completely: ${file.path}`);
      continue;
    }
    read.headers.forEach((header, member) => {
      files.push({
        path: `/slop-scan/gzip-header/${digest}/${sha256Of(file.path)}/member-${member + 1}/AGENTS.md`,
        logicalPath: "AGENTS.md",
        bytes: new TextEncoder().encode(header),
        parentArtifactSha256: digest,
      });
    });
    const logicalPath = (file.logicalPath ?? file.path).replace(/\.gz$/iu, "");
    const name = knownPath(logicalPath) ? logicalPath : `${logicalPath}.bin`;
    const child: ScanInputFile = { path: `/slop-scan/gzip/${digest}/${name}`, logicalPath: name, bytes: read.payload, parentArtifactSha256: digest };
    archives.push({
      sha256: digest,
      parentSha256: file.parentArtifactSha256 ?? null,
      origin: file.parentArtifactSha256 ? "archive" : "repository",
      path: file.path.slice(0, 500),
      type: "archive",
      state: "released",
      analysis: "static-clean",
      requestedExecution: false,
    });
    derivedFiles.push(child);
    pending.push({ file: child, ancestors: new Set([...ancestors, digest]) });
  }
  return { files, derivedFiles, archives, gaps };
}
