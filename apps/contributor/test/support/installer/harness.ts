// spec/contributor/installation.md, "Installation tracks verification, activation, and readback separately"
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "@repo/platform/testing/paths";
import { type InstallerAuthority, createInstallCommand, productionAuthority } from "../../../src/render/installerProgram.ts";
import { type SkillFile, renderProjectSkill } from "../../../src/render/render.ts";
import { type Authority, type AuthorityFixtureOptions, type RegistryBinding, aheadComparison, createInstallAuthorityFixture, registryOrigin, sha256 } from "./authority.ts";

export const revisionA = "a".repeat(40);
export const revisionB = "b".repeat(40);
export const revisionC = "c".repeat(40);
export const revisionD = "d".repeat(40);
export const staticSkill = "contribute-to-eliza";
export const skillsRoot = "${CODEX_HOME:-${HOME}/.codex}/skills";

const normalizeArchive = join(import.meta.dirname, "normalize-skill-archive.py");
const roots: string[] = [];

export interface ArtifactOptions {
  readonly archiveFiles?: Readonly<Record<string, Buffer>>;
  readonly name?: string;
  readonly sourcePath?: string;
  readonly registry?: RegistryBinding;
  readonly provenanceRevision?: string | null;
  readonly revisionStatus?: "committed" | "working-tree";
}

export interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** @throws {Error} */
export function freshRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `slop-installer-${label}-`));
  roots.push(root);
  return root;
}

/** @throws {never} */
export function removeRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
}

/** @throws {Error} */
export function baseFiles(marker: string): Record<string, Buffer> {
  return {
    "SKILL.md": readFileSync(join(repoRoot, "skills", "slop", "SKILL.md")),
    "references/revision.txt": Buffer.from(`${marker}\n`),
  };
}

/** @throws {Error} */
export function testPython(): string {
  const configured = process.env.SLOP_TEST_PYTHON ?? process.env.SLOP_PYTHON;
  for (const candidate of configured === undefined ? ["python3", "python"] : [configured]) {
    const result = spawnSync(candidate, ["-c", "import os, ssl, sys; ok = sys.version_info.major == 3 and bool(ssl.create_default_context().get_ca_certs()); print(os.path.realpath(sys.executable)) if ok else None; sys.exit(0 if ok else 1)"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim() !== "") return result.stdout.trim();
  }
  throw new Error("installer journeys require Python 3 with a usable CA store");
}

const archiveWriter = `
import os
import stat
import sys
import zipfile

source, archive_path = sys.argv[1:]
with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for directory, _, names in os.walk(source):
        for name in sorted(names):
            path = os.path.join(directory, name)
            relative = os.path.relpath(path, os.path.dirname(source)).replace(os.sep, "/")
            entry = zipfile.ZipInfo(relative, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            with open(path, "rb") as contents:
                archive.writestr(entry, contents.read())
`;

/** @throws {Error} */
export function writeArtifact(root: string, revision: string, canonicalFiles: Readonly<Record<string, Buffer>>, options: ArtifactOptions = {}): string {
  const name = options.name ?? staticSkill;
  const label = `${revision.slice(0, 4)}${options.registry === undefined ? "" : `-r${options.registry.revision}`}${options.name === undefined ? "" : `-${options.name}`}`;
  const publicRoot = join(root, `artifact-${label}`);
  const archivePath = join(publicRoot, "downloads", `${name}.skill`);
  const stagedSkill = join(root, `stage-${label}`, name);
  const archiveFiles = options.archiveFiles ?? canonicalFiles;
  for (const [path, contents] of Object.entries(archiveFiles)) {
    const destination = join(stagedSkill, ...path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }
  const skill = archiveFiles["SKILL.md"];
  if (skill === undefined) throw new TypeError("artifact fixture omitted SKILL.md");
  const files = Object.entries(archiveFiles)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, contents]) => ({ path, sha256: sha256(contents) }));
  writeFileSync(join(stagedSkill, "PROVENANCE.json"), `${JSON.stringify({
    schemaVersion: "1",
    name,
    repository: "SlopDotCash/slopdotcash",
    revision: options.provenanceRevision === undefined ? revision : options.provenanceRevision,
    revisionStatus: options.revisionStatus ?? "committed",
    source: { path: `${options.sourcePath ?? `skills/${staticSkill}`}/SKILL.md`, sha256: sha256(skill) },
    files,
    ...options.registry === undefined ? {} : { registry: options.registry },
  }, null, 2)}\n`);
  mkdirSync(dirname(archivePath), { recursive: true });
  const python = testPython();
  execFileSync(python, ["-c", archiveWriter, stagedSkill, archivePath], { cwd: repoRoot });
  execFileSync(python, [normalizeArchive, archivePath], { cwd: repoRoot });
  writeFileSync(`${archivePath}.sha256`, `${sha256(readFileSync(archivePath))}  ${name}.skill\n`);
  return publicRoot;
}

/** @throws {Error} */
export function configureAuthority(root: string, options: AuthorityFixtureOptions): Authority {
  return createInstallAuthorityFixture(join(root, "authority"), options);
}

/** @throws {Error} */
export function installerText(artifactOrigin: string, skillName: string, skillRepositoryPath: string, authority: InstallerAuthority): string {
  const generated = createInstallCommand({ artifactOrigin, skillsRoot, skillName, skillRepositoryPath, authority });
  if (generated.kind === "refused") throw new Error(`the installer generator refused: ${generated.message}`);
  return generated.text;
}

/** @throws {Error} */
export function fileOrigin(directory: string): string {
  return pathToFileURL(directory).href.replace(/\/$/u, "");
}

/** @throws {Error} */
export function command(artifactRoot: string, authority: Authority & { readonly registryOrigin?: string; readonly requestTimeoutSeconds?: number }, skillName = staticSkill, skillRepositoryPath = `skills/${staticSkill}`): string {
  return installerText(fileOrigin(artifactRoot), skillName, skillRepositoryPath, { kind: "test", ...authority });
}

/** @throws {Error} */
export function productionCommand(): string {
  return installerText("https://slop.cash/projects/eliza", staticSkill, `skills/${staticSkill}`, productionAuthority);
}

/** @throws {Error} */
export function loopbackCommand(artifactRoot: string, apiPort: number, rawOrigin: string): string {
  return command(artifactRoot, { apiOrigin: `http://127.0.0.1:${apiPort}`, rawOrigin, requestTimeoutSeconds: 0.5 });
}

/** @throws {never} */
export function shellPath(value: string): string {
  const windows = /^([A-Za-z]):[\\/](.*)$/u.exec(value);
  return windows === null ? value : `/${windows[1]?.toLowerCase()}/${windows[2]?.replaceAll("\\", "/")}`;
}

/** @throws {never} */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** @throws {Error} */
export function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

/** @throws {Error} */
export function run(script: string, installationRoot: string, environment: Readonly<Record<string, string>> = {}): Ran {
  const windows = process.platform === "win32";
  return spawnSync(process.env.SLOP_TEST_BASH ?? "bash", windows ? [] : ["-c", script], {
    encoding: "utf8",
    input: windows ? script : undefined,
    env: { ...process.env, CODEX_HOME: join(installationRoot, "codex"), HOME: join(installationRoot, "home"), ...environment },
  });
}

/** @throws {never} */
export function skillsDirectory(root: string): string {
  return join(root, "codex", "skills");
}

/** @throws {Error} */
export function currentLink(root: string, name = staticSkill): string {
  return readlinkSync(join(skillsDirectory(root), name)).replaceAll("\\", "/");
}

/** @throws {never} */
export function versionPath(root: string, revision: string, name = staticSkill): string {
  return join(skillsDirectory(root), `.${name}-versions`, revision);
}

/** @throws {never} */
export function versionLink(revision: string, name = staticSkill): string {
  return `.${name}-versions/${revision}`;
}

/** @throws {Error} */
export function stagedLeftovers(root: string): string[] {
  return readdirSync(skillsDirectory(root)).filter((name) => name.startsWith(`.${staticSkill}-stage-`));
}

/** @throws {Error} */
export function rewriteInstalledRepositoryIdentity(root: string, revision: string, repository: string, files: ReadonlyArray<"PROVENANCE.json" | ".slop-authorization.json"> = ["PROVENANCE.json", ".slop-authorization.json"]): void {
  for (const file of files) {
    const path = join(versionPath(root, revision), file);
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    record.repository = repository;
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  }
}

/** @throws {never} */
export function candidatePull(revision: string, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    base: { ref: "main", repo: { full_name: "SlopDotCash/slopdotcash" } },
    draft: false,
    head: { repo: { full_name: "SlopDotCash/slopdotcash" }, sha: revision },
    labels: [{ name: "slop-release-candidate" }],
    number: 17424,
    state: "open",
    ...overrides,
  };
}

/** @throws {never} */
export function freshCandidateTimeline(revision: string): unknown[] {
  return [{ event: "committed", sha: revision }, { event: "labeled", label: { name: "slop-release-candidate" } }];
}

const completionInjection = `import os, shutil
original_symlink = os.symlink
original_readlink = os.readlink
original_rmtree = shutil.rmtree
link_prepared = False
def symlink(source, destination, *args, **kwargs):
    global link_prepared
    managed = os.path.basename(os.fsdecode(destination)).startswith('.contribute-to-eliza-link-')
    if managed and os.environ.get('SLOP_TEST_ACTIVATION_FAILURE') == '1':
        raise OSError('synthetic activation failure')
    result = original_symlink(source, destination, *args, **kwargs)
    if managed: link_prepared = True
    return result
def readlink(path, *args, **kwargs):
    if link_prepared and os.path.basename(os.fsdecode(path)) == 'contribute-to-eliza' and os.environ.get('SLOP_TEST_READBACK_FAILURE') == '1':
        raise OSError('synthetic post-activation readback failure')
    return original_readlink(path, *args, **kwargs)
def rmtree(path, *args, **kwargs):
    if os.path.basename(os.fsdecode(path)).startswith('.contribute-to-eliza-stage-') and os.environ.get('SLOP_TEST_CLEANUP_FAILURE') == '1':
        raise OSError('synthetic staging cleanup failure')
    return original_rmtree(path, *args, **kwargs)
os.symlink = symlink
os.readlink = readlink
shutil.rmtree = rmtree
`;

/** @throws {Error} */
export function completionFaults(root: string, faults: { readonly readback?: boolean; readonly cleanup?: boolean; readonly activation?: boolean }): Record<string, string> {
  const injection = join(root, "completion-injection");
  mkdirSync(injection, { recursive: true });
  writeFileSync(join(injection, "sitecustomize.py"), completionInjection);
  return {
    PYTHONPATH: injection,
    SLOP_TEST_READBACK_FAILURE: faults.readback === true ? "1" : "0",
    SLOP_TEST_CLEANUP_FAILURE: faults.cleanup === true ? "1" : "0",
    SLOP_TEST_ACTIVATION_FAILURE: faults.activation === true ? "1" : "0",
  };
}

/** @throws {Error} */
export function injection(root: string, name: string, sitecustomize: string): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "sitecustomize.py"), sitecustomize);
  return directory;
}

/** @throws {Error} */
export function singleRevision(label: string, marker = "revision-a") {
  const root = freshRoot(label);
  const files = baseFiles(marker);
  const artifact = writeArtifact(root, revisionA, files);
  const authority = configureAuthority(root, { developHead: revisionA, revisions: { [revisionA]: { files } } });
  return { root, files, artifact, authority, installRoot: join(root, "install") };
}

/** @throws {Error} */
export function twoRevisions(label: string, markers: readonly [string, string] = ["revision-a", "revision-b"]) {
  const root = freshRoot(label);
  const filesA = baseFiles(markers[0]);
  const filesB = baseFiles(markers[1]);
  const artifactA = writeArtifact(root, revisionA, filesA);
  const artifactB = writeArtifact(root, revisionB, filesB);
  const initialAuthority = configureAuthority(root, { developHead: revisionA, revisions: { [revisionA]: { files: filesA } } });
  const advance = (overrides: Readonly<Record<string, unknown>> = {}) => configureAuthority(root, {
    comparisons: { [`${revisionA}...${revisionB}`]: aheadComparison(revisionA, revisionB) },
    developHead: revisionB,
    responseOverrides: overrides,
    revisions: { [revisionA]: { files: filesA }, [revisionB]: { files: filesB } },
  });
  return { root, filesA, filesB, artifactA, artifactB, initialAuthority, advance, installRoot: join(root, "install") };
}

export interface Server {
  readonly port: number;
  kill(): void;
}

const stallServerScript = `
  const http = require("node:http");
  const fs = require("node:fs");
  const [responsesPath, pattern, stallMsRaw, stallCountRaw, logPath, failureMode] = process.argv.slice(1);
  const responses = JSON.parse(fs.readFileSync(responsesPath, "utf8"));
  const stallMs = Number(stallMsRaw);
  const stallCount = Number(stallCountRaw);
  let stalled = 0;
  const server = http.createServer((request, response) => {
    fs.appendFileSync(logPath, request.url + "\\n");
    const respond = () => {
      try {
        if (!(request.url in responses)) {
          response.statusCode = 404;
          response.end("{}");
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(responses[request.url]));
      } catch {}
    };
    if (request.url.includes(pattern) && stalled < stallCount) {
      stalled += 1;
      if (failureMode === "disconnect") {
        request.socket.destroy();
        return;
      }
      setTimeout(respond, stallMs);
    } else {
      respond();
    }
  });
  server.listen(0, "127.0.0.1", () => {
    console.log("PORT " + server.address().port);
  });
`;

const headerLoggingServerScript = `
  const http = require("node:http");
  const fs = require("node:fs");
  const path = require("node:path");
  const [kind, source, logPath, forbidPattern, redirectTarget] = process.argv.slice(1);
  const responses = kind === "json" ? JSON.parse(fs.readFileSync(source, "utf8")) : null;
  const server = http.createServer((request, response) => {
    fs.appendFileSync(logPath, request.url + "\\t" + (request.headers.authorization || "-") + "\\n");
    if (redirectTarget && request.url.includes("/contents/")) {
      response.statusCode = 302;
      response.setHeader("location", redirectTarget + request.url);
      response.end();
      return;
    }
    if (forbidPattern && request.url.includes(forbidPattern)) {
      response.statusCode = 403;
      response.setHeader("x-ratelimit-limit", "60");
      response.setHeader("x-ratelimit-remaining", "0");
      response.setHeader("x-ratelimit-reset", "1800000000");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ message: "API rate limit exceeded" }));
      return;
    }
    if (responses) {
      if (!(request.url in responses)) {
        response.statusCode = 404;
        response.end("{}");
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(responses[request.url]));
      return;
    }
    const file = path.join(source, decodeURIComponent(request.url));
    if (!file.startsWith(source) || !fs.existsSync(file)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.end(fs.readFileSync(file));
  });
  server.listen(0, "127.0.0.1", () => {
    console.log("PORT " + server.address().port);
  });
`;

function listening(child: ChildProcess, what: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const match = /PORT (\d+)/u.exec(buffered);
      if (match !== null) resolve({ port: Number(match[1]), kill: () => child.kill("SIGKILL") });
    });
    child.once("exit", () => reject(new Error(`${what} exited before listening`)));
  });
}

/** @throws {Error} */
export function startStallServer(options: { readonly responsesPath: string; readonly requestLog: string; readonly stallPattern: string; readonly stallMs: number; readonly stallCount: number; readonly failureMode?: "stall" | "disconnect" }): Promise<Server> {
  writeFileSync(options.requestLog, "");
  const child = spawn(process.execPath, ["-e", stallServerScript, options.responsesPath, options.stallPattern, String(options.stallMs), String(options.stallCount), options.requestLog, options.failureMode ?? "stall"], { stdio: ["ignore", "pipe", "inherit"] });
  return listening(child, "stall server");
}

/** @throws {Error} */
export function startHeaderLoggingServer(options: { readonly kind: "json" | "static"; readonly source: string; readonly requestLog: string; readonly forbidPattern?: string; readonly redirectTarget?: string }): Promise<Server> {
  writeFileSync(options.requestLog, "");
  const child = spawn(process.execPath, ["-e", headerLoggingServerScript, options.kind, options.source, options.requestLog, options.forbidPattern ?? "", options.redirectTarget ?? ""], { stdio: ["ignore", "pipe", "inherit"] });
  return listening(child, "header-logging server");
}

/** @throws {Error} */
export function loggedRequests(logPath: string): Array<readonly [string, string]> {
  return readFileSync(logPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => {
    const [url, authorization] = line.split("\t");
    return [url ?? "", authorization ?? ""] as const;
  });
}

/** @throws {Error} */
export function requestLines(logPath: string, fragment: string): string[] {
  return readFileSync(logPath, "utf8").split("\n").filter((line) => line.includes(fragment));
}

/** @throws {Error} */
export function listFilesRecursively(directory: string): string[] {
  const found: string[] = [];
  const pending = [directory];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(path);
      else found.push(path);
    }
  }
  return found;
}

const lockHolderScript = process.platform === "win32"
  ? `
import msvcrt
import os
import sys
import time

lock_file = open(sys.argv[1], "a+b")
if os.fstat(lock_file.fileno()).st_size == 0:
    lock_file.write(bytes([0]))
    lock_file.flush()
lock_file.seek(0)
msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
print("locked", flush=True)
time.sleep(60)
`
  : `
import fcntl
import sys
import time

lock_file = open(sys.argv[1], "a+b")
fcntl.flock(lock_file, fcntl.LOCK_EX)
print("locked", flush=True)
time.sleep(60)
`;

export interface Holder {
  release(): Promise<void>;
}

/** @throws {Error} */
export function holdLock(lock: string): Promise<Holder> {
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, "");
  const holder = spawn(testPython(), ["-c", lockHolderScript, lock], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    holder.once("error", reject);
    holder.stdout.once("data", (value: Buffer) => {
      if (!String(value).includes("locked")) return reject(new Error(`unexpected lock holder output: ${value.toString("utf8")}`));
      resolve({
        release: () => holder.exitCode !== null ? Promise.resolve() : new Promise<void>((done) => {
          holder.once("close", () => done());
          holder.kill("SIGKILL");
        }),
      });
    });
  });
}

/** @throws {Error} */
export function runAsync(script: string, installationRoot: string): Promise<Ran> {
  const windows = process.platform === "win32";
  const child = spawn(process.env.SLOP_TEST_BASH ?? "bash", windows ? [] : ["-c", script], {
    env: { ...process.env, CODEX_HOME: join(installationRoot, "codex"), HOME: join(installationRoot, "home") },
    stdio: [windows ? "pipe" : "ignore", "pipe", "pipe"],
  });
  if (windows) child.stdin?.end(script);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return new Promise((resolve) => child.once("close", (status) => resolve({ status, stdout, stderr })));
}

export const generatedSkill = "contribute-to-thenetwork";
export const reviewSkill = "review-thenetwork-contributions";
export const contributorTemplate = "skills/project-contributor-template";
export const reviewerTemplate = "skills/project-reviewer-template";

/** @throws {Error} */
export function templateFiles(template = contributorTemplate): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(directory, entry.name), path);
      else files[path] = readFileSync(join(directory, entry.name));
    }
  };
  walk(join(repoRoot, template), "");
  return files;
}

export interface Manifest {
  readonly id: string;
  readonly repositories: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly [field: string]: unknown;
}

/** @throws {never} */
export function manifestFor(notes: string, integrationBranch = "main"): Manifest {
  return {
    schemaVersion: "1",
    id: "thenetwork",
    slug: "thenetwork",
    name: "The Network",
    eyebrow: "Open-source project",
    headline: "Match people to the work they can finish.",
    description: "Improve the matching simulator and its integration suite.",
    listingTier: "community",
    status: "active",
    repositories: [{ id: "thenetwork-org/thenetwork", displayName: "thenetwork-org/thenetwork", githubUrl: "https://github.com/thenetwork-org/thenetwork", description: "Matching.", integrationBranch }],
    skill: { id: generatedSkill, publishAtRoot: false, sourcePath: contributorTemplate, publicPath: "/projects/thenetwork/skill.md" },
    reviewSkill: { id: reviewSkill, sourcePath: reviewerTemplate },
    contribution: {
      approvedScope: 'Fix reproduced matching bugs — "naïve" scoring.',
      contributionGuide: "Run `bun run sim` first.\n\tThen the e2e suite.",
      supportedTasks: "bug fixes, simulations ✓",
      requiredTests: "bun run test:integration",
      reviewExpectations: "Before and after numbers.",
      securityContact: "security@example.org",
      closurePolicy: "",
      maintainerNotes: notes,
    },
  };
}

/** @throws {Error} */
export function rendered(manifest: Manifest, binding: RegistryBinding, role: "contributor" | "reviewer" = "contributor"): Record<string, Buffer> {
  const files: SkillFile[] = Object.entries(templateFiles(role === "contributor" ? contributorTemplate : reviewerTemplate)).map(([path, bytes]) => ({ path, bytes: new Uint8Array(bytes) }));
  const result = renderProjectSkill({ role, templateFiles: files, manifest, registry: { revision: binding.revision, manifestSha256: binding.manifestSha256 } });
  if (result.kind !== "rendered") throw new Error(`the server renderer refused the fixture: ${result.kind}`);
  return Object.fromEntries(result.files.map((file) => [file.path, Buffer.from(file.bytes)]));
}

/** @throws {Error} */
export function generatedArtifact(root: string, manifest: Manifest, binding: RegistryBinding, tamper?: (files: Record<string, Buffer>) => void, role: "contributor" | "reviewer" = "contributor") {
  const files = rendered(manifest, binding, role);
  tamper?.(files);
  const name = role === "contributor" ? generatedSkill : reviewSkill;
  return { rendered: files, artifact: writeArtifact(root, revisionA, files, { name, sourcePath: role === "contributor" ? contributorTemplate : reviewerTemplate, registry: binding }) };
}

/** @throws {Error} */
export function generatedAuthority(root: string, template = contributorTemplate): Authority {
  return createInstallAuthorityFixture(join(root, template === contributorTemplate ? "authority" : "reviewer-authority"), { developHead: revisionA, revisions: { [revisionA]: { files: templateFiles(template) } }, skillPath: template });
}

/** @throws {Error} */
export function generatedCommand(artifactOrigin: string, authority: Authority, root: string, role: "contributor" | "reviewer" = "contributor"): string {
  return role === "contributor"
    ? installerText(artifactOrigin, generatedSkill, contributorTemplate, { kind: "test", ...authority, registryOrigin: registryOrigin(root) })
    : installerText(artifactOrigin, reviewSkill, reviewerTemplate, { kind: "test", ...authority, registryOrigin: registryOrigin(root) });
}

/** @throws {Error} */
export function targetRepository(root: string, name: string, repositoryId: string): string {
  const target = join(root, name);
  execFileSync("git", ["init", "--quiet", target]);
  execFileSync("git", ["-C", target, "remote", "add", "origin", `https://github.com/${repositoryId}.git`]);
  return target;
}

/** @throws {Error} */
export function runReceipt(script: string, args: ReadonlyArray<string>, environment: Readonly<Record<string, string | undefined>>): Ran {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...environment } });
}

const clockedReceipt = `
  import { pathToFileURL } from 'node:url';
  const [script, timestamp, args] = process.argv.slice(1);
  const now = Number(timestamp);
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...values) { super(...(values.length ? values : [now])); }
    static now() { return now; }
  };
  process.argv = [process.execPath];
  const { main } = await import(pathToFileURL(script).href);
  try { await main(JSON.parse(args)); }
  catch (error) {
    process.stderr.write(String(error.message) + '\\n');
    process.exitCode = 1;
  }
`;

/** @throws {Error} */
export function runReceiptAt(script: string, timestamp: number, args: ReadonlyArray<string>, configuration: string): Ran {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", clockedReceipt, script, String(timestamp), JSON.stringify(args)], { encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: configuration } });
}

/** @throws {never} */
export function declaredRun(lane: string, repoRootPath: string, model = "fixture-model"): string[] {
  return ["--client", "codex", "--provider", "fixture", "--model", model, "--lane", lane, "--repo-root", repoRootPath, "--usage-unavailable", "--json"];
}

/** @throws {Error} */
export function writeTree(root: string, files: Readonly<Record<string, Buffer>>): void {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
}
