// spec/contributor/skillAuthority.md, "Only the exact GitHub API authority receives the optional credential"; spec/backend/revisionReceipts.md, "A revision receipt serves manifest text whose SHA-256 equals the approved revision digest"
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ProjectDetail, RevisionReceipt } from "@repo/backend/client";
import { Schema } from "effect";

const repository = "SlopDotCash/slopdotcash";
const defaultSkillPath = "skills/contribute-to-eliza";

export interface AuthorityRevision {
  readonly files: Readonly<Record<string, Buffer | string>>;
  readonly pulls?: ReadonlyArray<unknown>;
  readonly released?: boolean;
}

export interface AuthorityFixtureOptions {
  readonly skillPath?: string;
  readonly comparisons?: Readonly<Record<string, unknown>>;
  readonly developHead: string;
  readonly revisions: Readonly<Record<string, AuthorityRevision>>;
  readonly responseOverrides?: Readonly<Record<string, unknown>>;
  readonly timelines?: Readonly<Record<number, ReadonlyArray<unknown>>>;
}

export interface Authority {
  readonly apiOrigin: string;
  readonly rawOrigin: string;
}

interface ContentsEntry {
  readonly name: string;
  readonly path: string;
  readonly sha?: string;
  readonly size: number;
  readonly submodule_git_url?: null;
  readonly type: "dir" | "file";
}

export interface RegistryBinding {
  readonly projectId: string;
  readonly revision: number;
  readonly manifestSha256: string;
}

const encodeReceipt = Schema.encodeSync(RevisionReceipt);
const encodeDetail = Schema.encodeSync(ProjectDetail);

/** @throws {never} */
export function sha256(contents: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function gitBlobSha(contents: Buffer): string {
  return createHash("sha1").update(`blob ${contents.length}\0`).update(contents).digest("hex");
}

function normalizedFiles(files: Readonly<Record<string, Buffer | string>>): Record<string, Buffer> {
  return Object.fromEntries(Object.entries(files).map(([path, contents]) => [path, Buffer.isBuffer(contents) ? contents : Buffer.from(contents)]));
}

function contentsResponses(revision: string, files: Readonly<Record<string, Buffer>>, skillPath: string): Record<string, unknown> {
  const directories = new Map<string, Map<string, ContentsEntry>>([["", new Map()]]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const parts = relativePath.split("/");
    for (let index = 0; index < parts.length - 1; index += 1) {
      const parent = parts.slice(0, index).join("/");
      const child = parts.slice(0, index + 1).join("/");
      const entries = directories.get(parent);
      if (entries === undefined) throw new TypeError(`fixture omitted directory ${parent}`);
      entries.set(parts[index] ?? "", { name: parts[index] ?? "", path: `${skillPath}/${child}`, size: 0, type: "dir" });
      if (!directories.has(child)) directories.set(child, new Map());
    }
    const name = parts.at(-1);
    const entries = directories.get(parts.slice(0, -1).join("/"));
    if (name === undefined || entries === undefined) throw new TypeError(`fixture path ${relativePath} has no parent`);
    entries.set(name, { name, path: `${skillPath}/${relativePath}`, sha: gitBlobSha(contents), size: contents.length, submodule_git_url: null, type: "file" });
  }
  return Object.fromEntries([...directories].map(([relative, entries]) => [
    `/repos/${repository}/contents/${relative === "" ? skillPath : `${skillPath}/${relative}`}?ref=${revision}`,
    [...entries.values()].sort((left, right) => left.name.localeCompare(right.name)),
  ]));
}

/** @throws {Error} */
export function createInstallAuthorityFixture(root: string, options: AuthorityFixtureOptions): Authority {
  const skillPath = options.skillPath ?? defaultSkillPath;
  const apiRoot = join(root, "api");
  const rawRoot = join(root, "raw");
  mkdirSync(apiRoot, { recursive: true });
  mkdirSync(rawRoot, { recursive: true });
  const responses: Record<string, unknown> = {
    [`/repos/${repository}/git/ref/heads/main`]: { object: { sha: options.developHead, type: "commit" }, ref: "refs/heads/main" },
  };
  for (const [revision, configuration] of Object.entries(options.revisions)) {
    responses[`/repos/${repository}/git/commits/${revision}`] = { sha: revision };
    responses[`/repos/${repository}/actions/workflows/deploy.yml/runs?head_sha=${revision}&status=success&per_page=100`] = {
      workflow_runs: configuration.released === true
        ? [{ head_sha: revision, head_branch: "main", event: "push", conclusion: "success", head_repository: { full_name: repository } }]
        : [],
    };
    responses[`/repos/${repository}/contents/protocol/skill-revocations.json?ref=${revision}`] = { encoding: "base64", content: Buffer.from("[]").toString("base64") };
    const files = normalizedFiles(configuration.files);
    Object.assign(responses, contentsResponses(revision, files, skillPath));
    responses[`/repos/${repository}/commits/${revision}/pulls?page=1&per_page=100`] = configuration.pulls ?? [];
    for (const [relativePath, contents] of Object.entries(files)) {
      const destination = join(rawRoot, ...repository.split("/"), revision, ...skillPath.split("/"), ...relativePath.split("/"));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, contents);
    }
  }
  for (const [comparison, response] of Object.entries(options.comparisons ?? {})) {
    responses[`/repos/${repository}/compare/${comparison}?per_page=1&page=2`] = response;
  }
  for (const [number, timeline] of Object.entries(options.timelines ?? {})) {
    responses[`/repos/${repository}/issues/${number}/timeline?page=1&per_page=100`] = timeline;
  }
  Object.assign(responses, options.responseOverrides);
  writeFileSync(join(apiRoot, "responses.json"), `${JSON.stringify(responses, null, 2)}\n`);
  return {
    apiOrigin: pathToFileURL(apiRoot).href.replace(/\/$/u, ""),
    rawOrigin: pathToFileURL(rawRoot).href.replace(/\/$/u, ""),
  };
}

/** @throws {never} */
export function aheadComparison(oldRevision: string, newRevision: string) {
  return {
    ahead_by: 1,
    base_commit: { sha: oldRevision },
    behind_by: 0,
    merge_base_commit: { sha: oldRevision },
    status: "ahead",
    total_commits: 1,
    commits: [{ sha: newRevision }],
  };
}

/** @throws {never} */
export function behindComparison(newer: string, older: string) {
  return { ahead_by: 0, base_commit: { sha: newer }, behind_by: 1, merge_base_commit: { sha: older }, status: "behind" };
}

function registryPath(root: string, ...parts: ReadonlyArray<string>): string {
  return join(root, "registry", "api", "v1", ...parts);
}

/** @throws {Error} */
export function registryOrigin(root: string): string {
  return pathToFileURL(join(root, "registry")).href;
}

/** @throws {Error} */
export function publishStatus(root: string, projectId: string, body: unknown): void {
  const path = registryPath(root, "projects", projectId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
}

/** @throws {Error} */
export function publishRevision(root: string, manifest: { readonly id: string }, revision: number, manifestText = JSON.stringify(manifest)): RegistryBinding {
  const manifestSha256 = sha256(JSON.stringify(manifest));
  const path = registryPath(root, "project-revisions", manifest.id, String(revision));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(encodeReceipt({ schemaVersion: "1", projectId: manifest.id, revision, manifestSha256, manifestText })));
  publishStatus(root, manifest.id, encodeDetail({
    schemaVersion: "1",
    project: { ...manifest, status: "active" },
    revision,
    manifestSha256,
    updatedAt: "2026-11-01T00:00:00.000Z",
    skillsPublished: true,
    vetting: { state: "cleared" },
  }));
  return { projectId: manifest.id, revision, manifestSha256 };
}
