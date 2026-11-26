// spec/contributor/publication.md, "The template index binds templateSha256 to the template, renderer and accepted-revision digests"; spec/contributor/publication.md, "The server renders only template files whose bytes match the index digest"; spec/security/admission.md, "An assessment is bound to its queued revision, commit and template"
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Option, Schema } from "effect";
import { type Role, templatePaths } from "./fields.ts";
import { type SkillFile, comparePaths } from "./render.ts";

export const sourceRepository = "SlopDotCash/slopdotcash";

export const guideRendererPaths = [
  "scripts/render-install-guide.mjs",
  "src/lib/install-command.ts",
  "skills/project-contributor-template/scripts/skill-authority.mjs",
] as const;

export const rendererSourcePaths = [
  ...guideRendererPaths,
  "src/lib/project-skill-publication.mjs",
  "src/lib/project-skill.mjs",
  "src/lib/project-schema.mjs",
] as const;

export const acceptedRevisions = [
  "any committed template revision in the canonical GitHub repository, without main ancestry or release-status requirements",
] as const;

export const maxTemplateFiles = 32;
export const maxTemplateFileBytes = 1_048_576;

const reservedTemplatePaths: ReadonlyArray<string> = ["PROVENANCE.json", "project.json"];

const Sha256Hex = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/u)));
const CommitSha = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/u)));
const RevisionStatus = Schema.Literals(["committed", "working-tree"]);
const FileDigestSchema = Schema.Struct({ path: Schema.String, sha256: Sha256Hex });
const TemplateGroupSchema = Schema.Struct({ sourcePath: Schema.String, files: Schema.Array(FileDigestSchema) });

export const TemplateIndex = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  repository: Schema.Literal(sourceRepository),
  commit: CommitSha,
  templateSha256: Sha256Hex,
  revisionStatus: RevisionStatus,
  contributor: TemplateGroupSchema,
  reviewer: TemplateGroupSchema,
  renderer: Schema.Struct({
    paths: Schema.Array(Schema.String),
    sources: Schema.Array(FileDigestSchema),
    revisionStatus: RevisionStatus,
  }),
  acceptedRevisions: Schema.Array(Schema.String),
});

export type TemplateIndex = typeof TemplateIndex.Type;
export type TemplateGroup = typeof TemplateGroupSchema.Type;
export type FileDigest = typeof FileDigestSchema.Type;

export interface TemplateInputs {
  readonly contributor: TemplateGroup;
  readonly reviewer: TemplateGroup;
  readonly rendererSources: ReadonlyArray<FileDigest>;
  readonly acceptedRevisions: ReadonlyArray<string>;
}

export type TemplateGroupResult = { readonly kind: "group"; readonly group: TemplateGroup } | { readonly kind: "unboundedTree" };

export type DecodedIndex =
  | { readonly kind: "decoded"; readonly index: TemplateIndex }
  | { readonly kind: "notJson" }
  | { readonly kind: "invalidShape" }
  | { readonly kind: "wrongTemplatePath"; readonly role: Role }
  | { readonly kind: "unboundedTree"; readonly role: Role }
  | { readonly kind: "wrongRendererSources" }
  | { readonly kind: "templateSha256Mismatch" };

export type VerifiedFiles =
  | { readonly kind: "verified"; readonly files: ReadonlyArray<SkillFile> }
  | { readonly kind: "missing" | "tooLarge" | "digestMismatch"; readonly path: string };

const encoder = new TextEncoder();
const roles: ReadonlyArray<Role> = ["contributor", "reviewer"];
const nodeCrypto = typeof process !== "undefined" && typeof process.getBuiltinModule === "function"
  ? process.getBuiltinModule("node:crypto")
  : undefined;

/** @throws {never} */
export function sha256Hex(bytes: Uint8Array): string {
  return nodeCrypto !== undefined ? nodeCrypto.createHash("sha256").update(bytes).digest("hex") : bytesToHex(sha256(bytes));
}

const digests = (files: ReadonlyArray<FileDigest>) => files.map(({ path, sha256 }) => ({ path, sha256 }));

/** @throws {never} */
export function templateSha256(inputs: TemplateInputs): string {
  const group = ({ sourcePath, files }: TemplateGroup) => ({ sourcePath, files: digests(files) });
  return sha256Hex(
    encoder.encode(
      JSON.stringify({
        contributor: group(inputs.contributor),
        reviewer: group(inputs.reviewer),
        rendererSources: digests(inputs.rendererSources),
        acceptedRevisions: [...inputs.acceptedRevisions],
      }),
    ),
  );
}

function boundedTree(paths: ReadonlyArray<string>): boolean {
  return (
    paths.length > 0 &&
    paths.length <= maxTemplateFiles &&
    paths.every((path, index) => index === 0 || comparePaths(paths[index - 1] ?? "", path) < 0) &&
    !paths.some((path) => reservedTemplatePaths.includes(path))
  );
}

/** @throws {never} */
export function templateGroup(role: Role, files: ReadonlyArray<SkillFile>): TemplateGroupResult {
  const sorted = [...files].sort((left, right) => comparePaths(left.path, right.path));
  if (!boundedTree(sorted.map((file) => file.path))) return { kind: "unboundedTree" };
  return {
    kind: "group",
    group: { sourcePath: templatePaths[role], files: sorted.map(({ path, bytes }) => ({ path, sha256: sha256Hex(bytes) })) },
  };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function decodeTemplateIndex(text: string): DecodedIndex {
  const json = parsed(text);
  if (json === undefined) return { kind: "notJson" };
  const decoded = Schema.decodeUnknownOption(TemplateIndex)(json);
  if (Option.isNone(decoded)) return { kind: "invalidShape" };
  const index = decoded.value;
  for (const role of roles) {
    if (index[role].sourcePath !== templatePaths[role]) return { kind: "wrongTemplatePath", role };
    if (!boundedTree(index[role].files.map((file) => file.path))) return { kind: "unboundedTree", role };
  }
  const sourcePaths = index.renderer.sources.map((source) => source.path);
  if (sourcePaths.length !== rendererSourcePaths.length || sourcePaths.some((path, n) => path !== rendererSourcePaths[n]))
    return { kind: "wrongRendererSources" };
  const recomputed = templateSha256({
    contributor: index.contributor,
    reviewer: index.reviewer,
    rendererSources: index.renderer.sources,
    acceptedRevisions: index.acceptedRevisions,
  });
  return recomputed === index.templateSha256 ? { kind: "decoded", index } : { kind: "templateSha256Mismatch" };
}

/** @throws {never} */
export function templateFilePath(group: TemplateGroup, file: FileDigest): string {
  return `${group.sourcePath}/${file.path.replaceAll("\\", "/")}`;
}

/** @throws {never} */
export function verifyTemplateFiles(group: TemplateGroup, fetched: ReadonlyMap<string, Uint8Array>): VerifiedFiles {
  const files: SkillFile[] = [];
  for (const file of group.files) {
    const path = templateFilePath(group, file);
    const bytes = fetched.get(path);
    if (bytes === undefined) return { kind: "missing", path };
    if (bytes.length > maxTemplateFileBytes) return { kind: "tooLarge", path };
    if (sha256Hex(bytes) !== file.sha256) return { kind: "digestMismatch", path };
    files.push({ path: file.path.replaceAll("\\", "/"), bytes });
  }
  return { kind: "verified", files };
}
