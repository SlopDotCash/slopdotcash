// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import type { GitHubFake } from "@repo/platform/testing/github";
import { repository } from "./github.ts";

export interface ArchivedFile {
  readonly name: string;
  readonly content: Uint8Array;
  readonly deflated: boolean;
}

export interface Checkpoint {
  readonly zip: Uint8Array;
  readonly digest: string;
}

export const resumedRun = 777;
export const runAttempt = 2;
export const artifactId = 9001;
export const artifactHost = "https://pipelines.actions.githubusercontent.com";
const artifactPath = "/checkpoints/leaderboard-discussions.zip";

function bytesOf(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function littleEndian(...fields: ReadonlyArray<readonly [number, 2 | 4]>): Uint8Array {
  const out = new Uint8Array(fields.reduce((total, [, width]) => total + width, 0));
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const [value, width] of fields) {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    offset += width;
  }
  return out;
}

/** @throws {never} */
export function zipOf(files: ReadonlyArray<ArchivedFile>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const stored = file.deflated ? new Uint8Array(deflateRawSync(file.content)) : file.content;
    const method = file.deflated ? 8 : 0;
    const checksum = crc32(file.content);
    const local = bytesOf(littleEndian([0x04034b50, 4], [20, 2], [0, 2], [method, 2], [0, 2], [0, 2], [checksum, 4], [stored.length, 4], [file.content.length, 4], [name.length, 2], [0, 2]), name, stored);
    centrals.push(bytesOf(littleEndian([0x02014b50, 4], [0x031e, 2], [20, 2], [0, 2], [method, 2], [0, 2], [0, 2], [checksum, 4], [stored.length, 4], [file.content.length, 4], [name.length, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0o100644 * 0x10000, 4], [offset, 4]), name));
    locals.push(local);
    offset += local.length;
  }
  const directory = bytesOf(...centrals);
  const end = littleEndian([0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [directory.length, 4], [offset, 4], [0, 2]);
  return bytesOf(...locals, directory, end);
}

/** @throws {never} */
export function checkpointOf(files: ReadonlyArray<ArchivedFile>): Checkpoint {
  const zip = zipOf(files);
  return { zip, digest: `sha256:${createHash("sha256").update(zip).digest("hex")}` };
}

/** @throws {Error} */
export function checkedOutCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

/** @throws {never} */
export function servedCheckpoint(fake: GitHubFake, options: { readonly headSha: string; readonly createdAt: number; readonly checkpoint: Checkpoint; readonly digest?: string }): void {
  const run = `/repos/${repository}/actions/runs/${resumedRun}`;
  fake.alterNext(new RegExp(`^GET ${run}$`, "u"), () => json({
    id: resumedRun,
    head_sha: options.headSha,
    head_branch: "main",
    event: "push",
    path: ".github/workflows/deploy.yml",
    status: "completed",
    run_attempt: runAttempt,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
  }));
  fake.alterNext(new RegExp(`^GET ${run}/artifacts\\?per_page=100$`, "u"), () => json({
    total_count: 1,
    artifacts: [{
      id: artifactId,
      name: `leaderboard-discussions-${runAttempt}`,
      digest: options.digest ?? options.checkpoint.digest,
      size_in_bytes: options.checkpoint.zip.length,
      expired: false,
      created_at: new Date(options.createdAt).toISOString(),
      workflow_run: { id: resumedRun, head_sha: options.headSha },
    }],
  }));
  fake.alterNext(new RegExp(`^GET /repos/${repository}/actions/artifacts/${artifactId}/zip$`, "u"), () => new Response(null, { status: 302, headers: { location: `${artifactHost}${artifactPath}` } }));
  fake.alterNext(new RegExp(`^GET ${artifactPath}$`, "u"), () => new Response(options.checkpoint.zip.slice(), { status: 200, headers: { "content-type": "application/zip" } }));
}
