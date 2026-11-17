// spec/operations/release.md, "Every required check binds the same source and built artifact"
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { frozenManifest, repoRoot } from "./paths.ts";

const Manifest = Schema.Struct({
  source: Schema.String,
  ignore: Schema.Array(Schema.String),
  files: Schema.Record(Schema.String, Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u))),
});

export type FrozenManifest = typeof Manifest.Type;

export interface FrozenMismatch {
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
}

/** @throws {Error} */
export function readManifest(manifest: string = frozenManifest): FrozenManifest {
  return Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(manifest, "utf8")));
}

/** @throws {Error} */
export function verifyFrozen(root: string = repoRoot, manifest: string = frozenManifest): ReadonlyArray<FrozenMismatch> {
  return Object.entries(readManifest(manifest).files)
    .map(([path, expected]) => {
      const file = join(root, path);
      const actual = existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "missing";
      return { path, expected, actual };
    })
    .filter(({ expected, actual }) => expected !== actual)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export interface FrozenCopy {
  readonly root: string;
  readonly manifest: string;
  dispose(): void;
}

/** @throws {Error} */
export function frozenCopy(paths: ReadonlyArray<string>): FrozenCopy {
  const source = readManifest();
  const root = mkdtempSync(join(tmpdir(), "slop-frozen-"));
  const files: Record<string, string> = {};
  for (const path of paths) {
    const digest = source.files[path];
    if (digest === undefined) throw new Error(`${path} is not a frozen file`);
    files[path] = digest;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repoRoot, path), join(root, path));
  }
  const manifest = join(root, "frozen.json");
  writeFileSync(manifest, `${JSON.stringify({ ...source, files }, null, 2)}\n`);
  return { root, manifest, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

/** @throws {Error} */
export function flipByte(file: string, offset: number): void {
  const bytes = readFileSync(file);
  const at = offset % bytes.length;
  bytes[at] = (bytes[at] ?? 0) ^ 1;
  writeFileSync(file, bytes);
}
