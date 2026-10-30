/**
 * The bounded malicious-code scan (PRD section 8; audit finding 8). It reads
 * the acquired bytes of one exact revision without executing them, sorts
 * them into the defined surfaces, runs deterministic checks for the defined
 * threats and prepares one evidence bundle for the model review. It then
 * composes a `slop-vetting-result-v2` result whose disposition follows the
 * intake rules exactly.
 *
 * "Clean" means these defined checks passed on every defined surface. It is
 * not a guarantee that the code contains no malware. Unread, oversized or
 * undecodable content, an unretrieved install-time download and an
 * unanalyzed binary keep the result incomplete. Execution is never needed
 * for ordinary source; an operator runs an install hook or download in an
 * isolated runner only when its bytes cannot be judged statically, and that
 * runner never receives secrets.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VettingArtifact } from "../../backend/vetting/result";
import {
  SCAN_SURFACES,
  SCAN_THREATS,
  type ScanReview,
  type ScanSurface,
  type ScanThreat,
  scanProblems,
  specialistRequired,
  VETTING_SCAN_SCHEMA,
  type VettingScanResult,
} from "../../backend/vetting/scan-result";
import { sha256Hex as sha256 } from "../../src/lib/sha256";
import { resolveSymlinkTarget, type TreeEntry } from "./acquire";
import type { QueuedAssessment } from "./queue";
import {
  SCAN_PROMPT_REVISION,
  SCAN_REVIEW_AREAS,
  type ScannerEvidence,
} from "./scanners";

export const INVENTORY_SCHEMA = "slop-scan-inventory-v2";
/**
 * The envelope of one single-call review: an inventory within it is read by
 * one model call, exactly as before batching. A larger inventory is never
 * shortened; `review-plan.ts` splits it across token-budgeted batches.
 */
export const MAX_INVENTORY_BYTES = 1024 * 1024;
export const MAX_INVENTORY_ITEMS = 1024;
/** Text files larger than this are reviewed in consecutive parts of this size. */
export const MAX_TEXT_FILE_BYTES = 256 * 1024;

export type ScanInputFile = {
  path: string;
  bytes: Uint8Array;
  symlink?: {
    gitSha: string;
    sha256: string;
    target: string;
    resolvedPath: string;
    targetSha256: string;
  };
};

export type ScanFinding = VettingScanResult["findings"][number] & {
  path: string;
};

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "go.sum",
  "gemfile.lock",
  "composer.lock",
  "flake.lock",
  "deno.lock",
  "pdm.lock",
  "pubspec.lock",
  "mix.lock",
  "podfile.lock",
  "packages.lock.json",
  "gradle.lockfile",
  "conda-lock.yml",
]);
const MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "setup.cfg",
  "pipfile",
  "cargo.toml",
  "go.mod",
  "gemfile",
  "composer.json",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "deno.json",
  "deno.jsonc",
  "flake.nix",
  "mix.exs",
  "podfile",
  "conanfile.txt",
]);
const AGENT_INSTRUCTIONS = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  "contributing.md",
  "readme.md",
  "skill.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".goosehints",
  ".continuerules",
  ".rules",
  "copilot-instructions.md",
  "warp.md",
  "claude.local.md",
  "llms.txt",
]);
const INSTALL_FILES = new Set([
  "setup.py",
  "build.rs",
  "makefile",
  "justfile",
  "install.sh",
  "postinstall.js",
  "preinstall.js",
  ".envrc",
  "tasks.json",
  "devcontainer.json",
  "gnumakefile",
  "dockerfile",
  "containerfile",
  "jenkinsfile",
  "vagrantfile",
  "rakefile",
  "brewfile",
  "procfile",
  "cmakelists.txt",
  "meson.build",
  "earthfile",
  "sconstruct",
  "sconscript",
  "wscript",
  "wscript_build",
  "makefile.am",
  "makefile.in",
  "gnumakefile.in",
  "configure.ac",
  "build",
  "build.sbt",
  "build.boot",
  "build.bazel",
  "module.bazel",
  "workspace",
  "workspace.bazel",
  "docker-bake.hcl",
  "docker-bake.override.hcl",
  "makefile.inc",
  "configure.in",
  "build.xml",
  "build.ninja",
  "tupfile",
  "tuprules.tup",
]);
/**
 * Build recipes identified by a name suffix, such as `Dockerfile.prod` or
 * `app.dockerfile`, or by a build-system definition extension, such as
 * `Helper.cmake`, `plugins.sbt` or `defs.bzl`. They run commands at build
 * time, so they are install surfaces like a Makefile, never unreviewed
 * content.
 */
const BUILD_RECIPE =
  /(?:^|\/)(?:dockerfile|containerfile|jenkinsfile)(?:\.[^/]+)?$|\.(?:dockerfile|cmake|sbt|bzl|bazel|m4|hcl|ninja)$/u;
const SOURCE_EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|ps1|psm1|bat|cmd|lua|pl|r|scala|sol|move|vue|svelte|astro|toml|ya?ml|json|gradle|nix|mk)$/iu;
const EXECUTABLE_BINARIES =
  /\.(?:node|wasm|so|dylib|dll|exe|jar|pyc|class|bin|a|o)$/iu;
const ARCHIVES = /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar|whl|gem|crate)$/iu;

/**
 * A leading `#!` marks content as a potential interpreter script.
 */
function declaresInterpreter(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21;
}
/** Lifecycle hooks package managers run on install, without being asked. */
const INSTALL_HOOKS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
];

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

/** The surfaces one path belongs to; empty for non-executable content. */
export function surfacesOf(path: string): ScanSurface[] {
  const lower = path.toLowerCase();
  const name = basename(path);
  const surfaces = new Set<ScanSurface>();
  if (
    LOCKFILES.has(name) ||
    /^requirements[^/]*\.txt$/u.test(name) ||
    // A requirement file under a `requirements` directory, such as
    // `requirements/base.txt`, is dependency content at any depth.
    /(?:^|\/)requirements\/[^/]*\.txt$/u.test(lower)
  )
    surfaces.add("dependencies");
  if (MANIFESTS.has(name) || name.endsWith(".gemspec"))
    surfaces.add("manifests");
  if (
    AGENT_INSTRUCTIONS.has(name) ||
    lower.startsWith(".cursor/") ||
    lower.startsWith(".claude/") ||
    lower.startsWith(".github/instructions/") ||
    lower.startsWith(".github/chatmodes/") ||
    lower.startsWith(".junie/") ||
    lower.startsWith(".idx/") ||
    lower.startsWith(".windsurf/") ||
    lower.includes("/.cursor/rules/")
  )
    surfaces.add("agentInstructions");
  if (
    INSTALL_FILES.has(name) ||
    BUILD_RECIPE.test(lower) ||
    lower.startsWith(".husky/") ||
    lower.startsWith(".devcontainer/") ||
    lower.startsWith(".vscode/") ||
    /(?:^|\/)(?:install|setup|bootstrap)[^/]*\.(?:sh|ps1|bat|cmd|py|js|mjs)$/u.test(
      lower,
    )
  )
    surfaces.add("installScripts");
  if (SOURCE_EXTENSIONS.test(name) || surfaces.size > 0) surfaces.add("source");
  return [...surfaces];
}

type Rule = {
  threat: ScanThreat;
  severity: "medium" | "high";
  pattern: RegExp;
  summary: string;
  /** Applies only to these surfaces; every surface when absent. */
  surfaces?: ScanSurface[];
};

/**
 * Deterministic indicators. A match is a reason to look closer, never a
 * confirmation: it escalates the result to a specialist review.
 */
const RULES: Rule[] = [
  {
    threat: "wallet-drainer",
    severity: "high",
    pattern:
      /\.config\/solana\/id\.json|wallet\.dat|nkbihfbeogaeaoehlefnkodbefgpgknn|bfnaelmomeimhlpmgjnjophhpkkoljpa|Local Extension Settings|\.ethereum\/keystore/iu,
    summary: "Reads a wallet key file or browser wallet extension store",
  },
  {
    threat: "wallet-drainer",
    severity: "medium",
    pattern:
      /\b(?:mnemonic|seed[ _-]?phrase|private[ _-]?key)\b[^\n]{0,120}\b(?:fetch|axios|https?:\/\/|XMLHttpRequest|sendTransaction|transfer)\b/iu,
    summary: "Handles a seed phrase or private key next to a network send",
  },
  {
    threat: "credential-theft",
    severity: "high",
    pattern:
      /~\/\.ssh\/|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|\.git-credentials|\.netrc\b|\.config\/gh\/hosts\.yml|\bLogin Data\b|security find-(?:generic|internet)-password|\bgh auth token\b/iu,
    summary: "Reads a stored credential, key or password store",
  },
  {
    threat: "credential-theft",
    severity: "medium",
    pattern: /~\/\.npmrc|\.pypirc|\.docker\/config\.json|\.kube\/config/iu,
    summary: "Reads a package-registry or cluster credential file",
  },
  {
    threat: "secret-exfiltration",
    severity: "high",
    pattern:
      /discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|webhook\.site|requestbin|pipedream\.net|pastebin\.com\/api|transfer\.sh|ngrok(?:-free)?\.(?:io|app)|interact\.sh|oast\.(?:fun|live|site)/iu,
    summary:
      "Sends data to a webhook or paste endpoint commonly used for exfiltration",
  },
  {
    threat: "secret-exfiltration",
    severity: "high",
    pattern:
      /JSON\.stringify\(\s*process\.env\s*\)|json\.dumps\(\s*(?:dict\()?\s*os\.environ|\b(?:env|printenv)\s*\|\s*(?:curl|wget|nc)\b/iu,
    summary: "Serializes the whole environment, which holds secrets",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern:
      /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:\S*\/)?(?:env\s+)?(?:ba|da|k|a|z|fi)?sh\b|\b(?:ba|da|k|a|z|fi)?sh\s+-c\s+["']?\$\(\s*(?:curl|wget)\b|iex\s*\(\s*(?:New-Object\s+Net\.WebClient|iwr|Invoke-WebRequest)|powershell[^\n]*-(?:e|enc|encodedcommand)\s/iu,
    summary: "Pipes a remote download straight into a shell",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern:
      /\beval\s*\(\s*(?:atob|Buffer\.from|unescape|decodeURIComponent)\s*\(|\bexec\s*\(\s*(?:base64\.b64decode|zlib\.decompress|marshal\.loads)|new\s+Function\s*\(\s*(?:atob|Buffer\.from)\s*\(/iu,
    summary: "Executes decoded or obfuscated code",
  },
  {
    threat: "unsafe-execution",
    severity: "medium",
    pattern: /\b(?:child_process|subprocess|os\.system|spawnSync|execSync)\b/u,
    summary: "An install-time script starts processes",
    surfaces: ["installScripts"],
  },
  {
    threat: "prompt-injection",
    severity: "medium",
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions|prompts|rules)|\byou\s+are\s+now\s+(?:in\s+)?(?:developer|admin|god|jailbreak)|do\s+not\s+(?:tell|inform|show)\s+the\s+(?:user|operator|human)/iu,
    summary: "Text matches wording used to override agent instructions",
  },
  {
    threat: "prompt-injection",
    severity: "medium",
    pattern:
      /\b(?:send|post|upload|exfiltrate|paste)\b[^\n]{0,80}\b(?:api[ _-]?key|token|secret|credential|password|private key|\.env)\b/iu,
    summary: "Text matches wording about sending secrets",
    surfaces: ["agentInstructions"],
  },
  {
    threat: "prompt-injection",
    severity: "medium",
    // Zero-width and bidirectional control characters hide text from reviewers.
    pattern: /[​-‏‪-‮⁦-⁩]/u,
    summary: "Hidden or reordered text in instructions",
    surfaces: ["agentInstructions"],
  },
];

const DOWNLOAD =
  /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n]*?(https?:\/\/[^\s"'`)|]+)|\b(?:fetch|urlopen|requests\.get|https?\.get)\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/giu;

function decode(bytes: Uint8Array): string | null {
  // NUL bytes mean binary content, not text to read.
  if (bytes.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position += 1)
    if (text.charCodeAt(position) === 10) line += 1;
  return line;
}

function binaryMagic(bytes: Uint8Array): boolean {
  const head = [...bytes.subarray(0, 4)];
  const is = (...magic: number[]) =>
    magic.every((value, i) => head[i] === value);
  return (
    is(0x7f, 0x45, 0x4c, 0x46) || // ELF
    is(0x4d, 0x5a) || // PE
    is(0xcf, 0xfa, 0xed, 0xfe) || // Mach-O 64
    is(0xfe, 0xed, 0xfa, 0xcf) ||
    is(0xca, 0xfe, 0xba, 0xbe) || // Mach-O fat or Java class
    is(0x00, 0x61, 0x73, 0x6d) // WASM
  );
}

function checkText(
  path: string,
  text: string,
  surfaces: ScanSurface[],
): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const rule of RULES) {
    if (rule.surfaces && !rule.surfaces.some((s) => surfaces.includes(s)))
      continue;
    const match = rule.pattern.exec(text);
    if (match === null) continue;
    findings.push({
      severity: rule.severity,
      category: rule.threat,
      summary: rule.summary,
      evidence: `${path}:${lineOf(text, match.index)}`.slice(0, 300),
      path,
    });
  }
  return findings;
}

function installHookCommands(path: string, text: string): string[] {
  if (basename(path) !== "package.json") return [];
  try {
    const scripts = (JSON.parse(text) as { scripts?: Record<string, unknown> })
      .scripts;
    return INSTALL_HOOKS.flatMap((hook) =>
      typeof scripts?.[hook] === "string" ? [scripts[hook] as string] : [],
    );
  } catch {
    return [];
  }
}

/** JSON that configures tools rather than holding data; always reviewed. */
const CONFIG_JSON =
  /(?:^|\/)(?:tsconfig[^/]*|jsconfig[^/]*|\.?eslintrc[^/]*|\.babelrc|babel\.config|\.swcrc|turbo|nx|lerna|vercel|netlify|wrangler|app|manifest|renovate|\.prettierrc|biome|components|project|angular|firebase|now)\.json$/iu;
const GENERATED =
  /(?:^|\/)(?:dist|build|out|\.next|\.output|coverage)\/|\.min\.(?:m?js|css)$|(?:^|\/)(?:assets|static|public)\/(?:[^/]+\/)*[^/]+[-.][A-Za-z0-9_-]{8,}\.m?js$/u;
const VENDORED = /(?:^|\/)(?:vendor|third_party|third-party|node_modules)\//u;
/** Obfuscation and staged-payload signals that keep a bulk file in model review. */
const OBFUSCATION =
  /\beval\s*\(|new\s+Function\s*\(|\batob\s*\(|String\.fromCharCode\s*\((?:\s*\d+\s*,){16}|(?:\\x[0-9a-f]{2}){32}|[A-Za-z0-9+/]{2000,}={0,2}|child_process|\bexecSync\b|\bspawn\s*\(/iu;

/**
 * Content whose model review adds little over the deterministic checks:
 * dependency locks, data JSON, generated bundles and vendored copies. Used
 * only when an inventory exceeds one review call. Install scripts, agent
 * instructions and manifests are never bulk. A deterministic finding or
 * obfuscation signal in bulk content sends the model every match in context
 * (`signalExcerpt`).
 */
export function bulkClass(
  path: string,
  surfaces: ScanSurface[],
): "lockfile" | "data" | "generated" | "vendored" | null {
  if (
    surfaces.includes("installScripts") ||
    surfaces.includes("agentInstructions") ||
    surfaces.includes("manifests")
  )
    return null;
  const lower = path.toLowerCase();
  if (surfaces.includes("dependencies")) return "lockfile";
  if (VENDORED.test(lower)) return "vendored";
  if (GENERATED.test(lower)) return "generated";
  if (
    lower.endsWith(".json") &&
    !CONFIG_JSON.test(lower) &&
    !lower.includes("/.vscode/") &&
    !lower.startsWith(".vscode/") &&
    !lower.startsWith(".claude/") &&
    !lower.startsWith(".cursor/") &&
    !lower.startsWith(".github/")
  )
    return "data";
  return null;
}

const SIGNAL_CONTEXT = 1536;
/**
 * The text around every deterministic-rule match and obfuscation signal of a
 * bulk file, with character offsets; null when there is none. The
 * deterministic checks still read the whole file.
 */
export function signalExcerpt(path: string, text: string): string | null {
  const matches: [number, number][] = [];
  for (const pattern of [
    OBFUSCATION,
    DOWNLOAD,
    ...RULES.map((rule) => rule.pattern),
  ])
    for (const match of text.matchAll(
      new RegExp(pattern.source, `g${pattern.flags.replace("g", "")}`),
    ))
      matches.push([match.index, Math.min(match[0].length, 4096)]);
  if (matches.length === 0) return null;
  matches.sort((a, b) => a[0] - b[0]);
  const windows: [number, number][] = [];
  for (const [index, length] of matches) {
    const start = Math.max(0, index - SIGNAL_CONTEXT);
    const end = Math.min(text.length, index + length + SIGNAL_CONTEXT);
    const last = windows[windows.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }
  return [
    `Signal excerpts of ${path} (${text.length} characters). Deterministic checks read the whole file; this item holds every deterministic-rule match and obfuscation signal with ${SIGNAL_CONTEXT} characters of context.`,
    ...windows.map(
      ([start, end]) =>
        `--- characters ${start}-${end} ---\n${text.slice(start, end)}`,
    ),
  ].join("\n");
}

/** Consecutive parts of at most `size` bytes, split after a newline when possible. */
export function textParts(text: string, size = MAX_TEXT_FILE_BYTES): string[] {
  const bytes = Buffer.from(text);
  if (bytes.length <= size) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + size, bytes.length);
    if (end < bytes.length) {
      const newline = bytes.lastIndexOf(10, end - 1);
      if (newline > start) end = newline + 1;
      // Never split inside a UTF-8 sequence.
      while (end > start + 1 && (bytes[end] & 0xc0) === 0x80) end -= 1;
    }
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts;
}

/** The inventory item that lists bulk files; never a repository path. */
export const DETERMINISTIC_COVERAGE_ID = "/slop-scan/deterministic-coverage";

export type DeterministicRecord = {
  path: string;
  sha256: string;
  bytes: number;
  class: "lockfile" | "data" | "generated" | "vendored";
  /** The model read every rule match and obfuscation signal as `<path>#signals`. */
  signals?: true;
};

export type RepositoryInspection = {
  /** Exact bytes of the evidence bundle the model reads. */
  inventory: Uint8Array;
  inventorySha256: string;
  coverage: VettingScanResult["coverage"];
  checks: VettingScanResult["checks"];
  findings: ScanFinding[];
  artifacts: VettingArtifact[];
  dependencyLocks: { path: string; sha256: string }[];
  visibilityGaps: string[];
  /** Download URLs install-time content references. */
  downloads: string[];
  /**
   * Bulk content covered by every deterministic check but not sent to the
   * model; empty unless the inventory exceeds one review call.
   */
  deterministic: DeterministicRecord[];
  /** Paths of reviewed items with a deterministic finding or obfuscation signal. */
  riskSignals: string[];
};

/**
 * Inspects one revision's acquired files. Pure and deterministic: the same
 * bytes and surface classifications produce the same inventory digest, so an
 * unchanged executable inventory reuses its clean result and any change to
 * executable content is scanned again.
 */
export function inspectRepository(input: {
  files: ScanInputFile[];
  /** Source the acquisition could not read; each keeps the scan incomplete. */
  acquisitionGaps?: string[];
}): RepositoryInspection {
  const files = [...input.files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const counts = Object.fromEntries(
    SCAN_SURFACES.map((surface) => [surface, 0]),
  ) as Record<ScanSurface, number>;
  const partial = new Set<ScanSurface>();
  const gaps: string[] = [...(input.acquisitionGaps ?? [])];
  if (gaps.length > 0) partial.add("source");
  const findings: ScanFinding[] = [];
  const artifacts: VettingArtifact[] = [];
  const dependencyLocks: { path: string; sha256: string }[] = [];
  type Candidate = {
    path: string;
    sha256: string;
    bytes: number;
    text: string;
    surfaces: ScanSurface[];
    flagged: boolean;
  };
  const candidates: Candidate[] = [];
  const classifications: { path: string; surfaces: ScanSurface[] }[] = [];
  const downloads = new Set<string>();
  for (const file of files) {
    const surfaces = surfacesOf(file.path);
    // Previously unclassified interpreter scripts still need review, even
    // when their name has no recognized extension (for example, configure).
    if (surfaces.length === 0 && declaresInterpreter(file.bytes))
      surfaces.push("installScripts", "source");
    if (surfaces.length > 0)
      classifications.push({ path: file.path, surfaces: [...surfaces].sort() });
    const digest = sha256(file.bytes);
    if (
      EXECUTABLE_BINARIES.test(file.path) ||
      ARCHIVES.test(file.path) ||
      binaryMagic(file.bytes)
    ) {
      // A committed binary or archive cannot be judged from text. It stays
      // quarantined until a specialist or isolated analysis releases it.
      artifacts.push({
        sha256: digest,
        parentSha256: null,
        origin: "repository",
        path: file.path.slice(0, 500),
        type: ARCHIVES.test(file.path)
          ? "archive"
          : file.path.toLowerCase().endsWith(".wasm")
            ? "wasm"
            : file.path.toLowerCase().endsWith(".node")
              ? "native-module"
              : "binary",
        state: "quarantined",
        analysis: "pending",
        requestedExecution: false,
      });
      counts.downloads += 1;
      continue;
    }
    const text = decode(file.bytes);
    // Ant imports may use any filename. Its project root identifies the
    // executable build document without parsing XML or resolving entities.
    if (text !== null && /<project(?=[\t\n\r />])/u.test(text)) {
      if (!surfaces.includes("installScripts")) surfaces.push("installScripts");
      if (!surfaces.includes("source")) surfaces.push("source");
    }
    if (surfaces.length === 0) continue;
    for (const surface of surfaces) counts[surface] += 1;
    if (surfaces.includes("dependencies"))
      dependencyLocks.push({ path: file.path.slice(0, 500), sha256: digest });
    if (text === null) {
      for (const surface of surfaces) partial.add(surface);
      gaps.push(`Undecodable executable content at ${file.path}`);
      continue;
    }
    // Every deterministic check reads the whole file, whatever its size.
    const found = checkText(file.path, text, surfaces);
    findings.push(...found);
    const hooks = installHookCommands(file.path, text);
    if (hooks.length > 0) {
      counts.installScripts += 1;
      for (const command of hooks)
        findings.push(
          ...checkText(`${file.path}#scripts`, command, ["installScripts"]),
        );
    }
    if (surfaces.includes("installScripts") || hooks.length > 0)
      for (const match of [text, ...hooks].join("\n").matchAll(DOWNLOAD))
        downloads.add((match[1] ?? match[2]).slice(0, 500));
    candidates.push({
      path: file.path,
      sha256: digest,
      bytes: file.bytes.byteLength,
      text,
      surfaces,
      flagged: found.length > 0 || hooks.length > 0,
    });
  }
  // A large text file is reviewed in consecutive parts; none is skipped.
  const itemsOf = (candidate: Candidate) =>
    textParts(candidate.text).map((text, index, parts) => {
      const id =
        parts.length === 1
          ? candidate.path
          : `${candidate.path}#part-${index + 1}-of-${parts.length}`;
      return { id, text, sha256: sha256(text) };
    });
  // Keep original link bytes and the resolved path in the reviewed/reused
  // identity, even when two targets happen to contain identical content.
  // The absolute ID namespace cannot collide with a repository path.
  const links = files.flatMap((file) => {
    if (!file.symlink) return [];
    return textParts(JSON.stringify({ path: file.path, ...file.symlink })).map(
      (text, index, parts) => ({
        id: `/slop-scan/symlink/${file.path}${parts.length === 1 ? "" : `#part-${index + 1}-of-${parts.length}`}`,
        text,
        sha256: sha256(text),
      }),
    );
  });
  let items = [...candidates.flatMap(itemsOf), ...links];
  const deterministic: DeterministicRecord[] = [];
  const envelope = (list: typeof items) =>
    list.length > MAX_INVENTORY_ITEMS ||
    list.reduce(
      (total, item) =>
        total + Buffer.byteLength(item.text) + item.id.length + 160,
      0,
    ) > MAX_INVENTORY_BYTES;
  // Beyond one review call, bulk content is covered by the deterministic
  // checks above and listed by digest instead of sent to the model.
  const excerpted = new Set<string>();
  if (envelope(items)) {
    items = [...links];
    for (const candidate of candidates) {
      const kind = bulkClass(candidate.path, candidate.surfaces);
      const excerpt =
        kind === null ? null : signalExcerpt(candidate.path, candidate.text);
      // Signals too dense to excerpt in one item keep the whole file reviewed.
      if (
        kind === null ||
        (excerpt !== null && Buffer.byteLength(excerpt) > MAX_TEXT_FILE_BYTES)
      ) {
        items.push(...itemsOf(candidate));
        continue;
      }
      deterministic.push({
        path: candidate.path,
        sha256: candidate.sha256,
        bytes: candidate.bytes,
        class: kind,
        ...(excerpt === null ? {} : { signals: true as const }),
      });
      if (excerpt !== null) {
        excerpted.add(candidate.path);
        items.push({
          id: `${candidate.path}#signals`,
          text: excerpt,
          sha256: sha256(excerpt),
        });
      }
    }
  }
  // Bulk files are bound into the reviewed inventory by digest, so any change
  // to one changes the inventory and its reuse key. The id cannot be a
  // repository path, which never starts with "/".
  if (deterministic.length > 0) {
    const text = JSON.stringify({
      note: "Files covered by every deterministic check and not sent to the model. A file with signals has a <path>#signals item with every rule match and obfuscation signal in context.",
      files: deterministic,
    });
    items.unshift({
      id: DETERMINISTIC_COVERAGE_ID,
      text,
      sha256: sha256(text),
    });
  }
  const bulk = new Set(deterministic.map((record) => record.path));
  const riskSignals = candidates
    .filter(
      (candidate) =>
        excerpted.has(candidate.path) ||
        ((candidate.flagged || OBFUSCATION.test(candidate.text)) &&
          !bulk.has(candidate.path)),
    )
    .map((candidate) => candidate.path);
  // The scan does not retrieve install-time downloads; each stays a gap.
  for (const url of [...downloads].sort()) {
    counts.downloads += 1;
    partial.add("downloads");
    gaps.push(`Install-time download not retrieved: ${url}`);
  }
  const inventory = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: INVENTORY_SCHEMA,
      classifications,
      items,
      // Binary and archive bytes are not text items. Bind their digests so
      // adding or changing quarantined content invalidates clean scan reuse.
      artifacts,
      visibilityGaps: gaps,
    }),
  );
  return {
    inventory,
    inventorySha256: sha256(inventory),
    coverage: Object.fromEntries(
      SCAN_SURFACES.map((surface) => [
        surface,
        {
          state: partial.has(surface) ? "partial" : "complete",
          items: counts[surface],
        },
      ]),
    ) as VettingScanResult["coverage"],
    checks: Object.fromEntries(
      SCAN_THREATS.map((threat) => [
        threat,
        findings.some((finding) => finding.category === threat)
          ? "flagged"
          : "passed",
      ]),
    ) as VettingScanResult["checks"],
    findings,
    artifacts,
    dependencyLocks,
    visibilityGaps: gaps,
    downloads: [...downloads].sort(),
    deterministic,
    riskSignals,
  };
}

/**
 * Adds isolated-execution evidence to the inventory the model reads. `finish`
 * records the given
 * gaps on the inspection and its inventory, then replaces the inventory
 * bytes and digest.
 */
export function executionInventory(inspection: RepositoryInspection) {
  const inventory = JSON.parse(
    new TextDecoder().decode(inspection.inventory),
  ) as {
    items: { id: string; text: string; sha256: string }[];
    visibilityGaps: string[];
  };
  return {
    /** Never refused: a larger inventory is reviewed in batches. */
    add(id: string, text: string): void {
      inventory.items.push({ id, text, sha256: sha256(text) });
    },
    finish(gaps: string[]) {
      for (const gap of gaps) {
        inspection.visibilityGaps.push(gap);
        inventory.visibilityGaps.push(gap);
      }
      inspection.inventory = new TextEncoder().encode(
        JSON.stringify(inventory),
      );
      inspection.inventorySha256 = sha256(inspection.inventory);
    },
  };
}

/**
 * The intake form of one model review. Its risk is read from the review
 * itself, with no score threshold: any suspected malice or high finding is
 * high risk, any other finding or incomplete coverage is ambiguous.
 */
export function scanReview(evidence: ScannerEvidence): ScanReview {
  const completed = evidence.review.status === "completed";
  const risk = !completed
    ? null
    : evidence.review.verdict === "malicious-suspected" ||
        evidence.findings.some((finding) =>
          ["high", "critical"].includes(finding.severity),
        )
      ? "high"
      : evidence.review.verdict === "findings" ||
          evidence.coverage === null ||
          SCAN_REVIEW_AREAS.some(
            (area) => evidence.coverage?.[area] !== "complete",
          )
        ? "ambiguous"
        : "low";
  return {
    provider: evidence.review.provider,
    model: evidence.review.model,
    promptPolicyRevision: evidence.review.promptPolicyRevision,
    inputManifestSha256: evidence.review.inputManifestSha256,
    runId: evidence.review.runId,
    status: evidence.review.status,
    verdict: completed ? evidence.review.verdict : null,
    risk,
    findingCount: evidence.review.findingCount,
  };
}

/** The queue assignment a scan answers, exactly as the signed queue sent it. */
export type QueuedScan = QueuedAssessment & { repository: string };

/** Records that acquisition was refused, without inventing a source or model review. */
export function composeAcquisitionRefusal(input: {
  queued: QueuedScan;
  reason: string;
  primaryModel: string;
  policyVersion: string;
  runId: string;
  startedAt: string;
  completedAt: string;
}) {
  const visibilityGaps = [
    `Acquisition refused before inspection: ${input.reason}`,
  ];
  const inventory = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: INVENTORY_SCHEMA,
      classifications: [],
      items: [],
      artifacts: [],
      visibilityGaps,
    }),
  );
  const report = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: "slop-scan-acquisition-refusal-v1",
      assessmentId: input.queued.assessmentId,
      reason: input.reason,
      acquiredFilesInspected: 0,
      modelReviewStarted: false,
      inventorySha256: sha256(inventory),
    }),
  );
  const result: VettingScanResult = {
    schemaVersion: VETTING_SCAN_SCHEMA,
    assessmentId: input.queued.assessmentId,
    projectId: input.queued.projectId,
    revision: input.queued.revision,
    manifestSha256: input.queued.manifestSha256,
    disposition: "incomplete",
    policyVersion: input.policyVersion,
    assessed: {
      repository: input.queued.repository,
      commitSha: input.queued.commitSha,
      templateSha256: input.queued.templateSha256,
      inputManifestSha256: sha256(inventory),
      dependencyLocks: [],
    },
    scan: {
      runId: input.runId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      reportSha256: sha256(report),
    },
    coverage: Object.fromEntries(
      SCAN_SURFACES.map((surface) => [
        surface,
        { state: "unsupported", items: 0 },
      ]),
    ) as VettingScanResult["coverage"],
    checks: Object.fromEntries(
      SCAN_THREATS.map((threat) => [threat, "not-run"]),
    ) as VettingScanResult["checks"],
    visibilityGaps,
    execution: null,
    reusedAssessmentId: null,
    // This names the configured review but does not claim that it ran.
    primaryReview: {
      provider: "surplus",
      model: input.primaryModel,
      promptPolicyRevision: SCAN_PROMPT_REVISION,
      inputManifestSha256: sha256(inventory),
      runId: `not-started-${input.runId}`,
      status: "not-started",
      verdict: null,
      risk: null,
      findingCount: 0,
    },
    specialistReview: null,
    artifacts: [],
    findings: [],
    confirmation: null,
  };
  return { result, report, inventory };
}

/**
 * Composes the signed-intake result and its private report. The disposition
 * is derived, never supplied: it is clean only when the intake's own rules
 * accept clean, and incomplete in every other case. A scan never confirms
 * malice; a moderator does. A primary review is always required; a
 * specialist review is needed only when `needsSpecialist` says so.
 */
export function composeScanResult(input: {
  queued: QueuedScan;
  inspection: RepositoryInspection;
  policyVersion: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  primary: ScannerEvidence;
  specialist?: ScannerEvidence | null;
  execution?: VettingScanResult["execution"];
  executionEvidenceSha256s?: string[];
  sourceInventorySha256?: string;
}) {
  const { inspection } = input;
  for (const scanner of [input.primary, input.specialist ?? null])
    if (
      scanner &&
      scanner.review.inputManifestSha256 !== inspection.inventorySha256
    )
      throw new Error("A review read another inventory");
  const report = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: input.sourceInventorySha256
        ? "slop-scan-report-v2"
        : "slop-scan-report-v1",
      assessmentId: input.queued.assessmentId,
      ...(input.sourceInventorySha256
        ? { sourceInventorySha256: input.sourceInventorySha256 }
        : {}),
      inventorySha256: inspection.inventorySha256,
      findings: inspection.findings,
      downloads: inspection.downloads,
      execution: input.execution ?? null,
      executionEvidenceSha256s: input.executionEvidenceSha256s ?? [],
      visibilityGaps: inspection.visibilityGaps,
      reviews: [input.primary, ...(input.specialist ? [input.specialist] : [])],
    }),
  );
  const result: VettingScanResult = {
    schemaVersion: VETTING_SCAN_SCHEMA,
    assessmentId: input.queued.assessmentId,
    projectId: input.queued.projectId,
    revision: input.queued.revision,
    manifestSha256: input.queued.manifestSha256,
    disposition: "incomplete",
    policyVersion: input.policyVersion,
    assessed: {
      repository: input.queued.repository,
      commitSha: input.queued.commitSha,
      templateSha256: input.queued.templateSha256,
      inputManifestSha256: inspection.inventorySha256,
      ...(input.sourceInventorySha256
        ? { sourceInventorySha256: input.sourceInventorySha256 }
        : {}),
      dependencyLocks: inspection.dependencyLocks.slice(0, 200),
    },
    scan: {
      runId: input.runId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      reportSha256: sha256(report),
    },
    coverage: inspection.coverage,
    checks: inspection.checks,
    visibilityGaps: [
      ...new Set([
        ...inspection.visibilityGaps,
        ...input.primary.visibilityGaps,
        ...(input.specialist?.visibilityGaps ?? []),
      ]),
    ].slice(0, 50),
    execution: input.execution ?? null,
    reusedAssessmentId: null,
    primaryReview: scanReview(input.primary),
    specialistReview: input.specialist ? scanReview(input.specialist) : null,
    artifacts: inspection.artifacts.slice(0, 500),
    findings: inspection.findings
      .slice(0, 200)
      .map(({ path: _path, ...finding }) => finding),
    confirmation: null,
  };
  if (inspection.dependencyLocks.length > 200)
    result.visibilityGaps.push("More than 200 dependency locks");
  if (inspection.findings.length > 200)
    result.visibilityGaps.push("More than 200 scan findings");
  if (inspection.artifacts.length > 500)
    result.visibilityGaps.push("More than 500 scan artifacts");
  result.disposition = "clean";
  if (scanProblems(result).length > 0) result.disposition = "incomplete";
  return {
    result,
    report,
    /** True when only a second model or specialist can finish this scan. */
    needsSpecialist: !input.specialist && specialistRequired(result),
  };
}

/**
 * Reads the immutable source a verified acquisition stored (`acquire.ts`):
 * every inventory record's bytes, rechecked against their SHA-256. Its
 * visibility gaps (submodules, unresolved links, LFS objects) carry into the scan.
 */
export async function readAcquiredSource(directory: string): Promise<{
  files: ScanInputFile[];
  acquisitionGaps: string[];
}> {
  const inventory = JSON.parse(
    await readFile(join(directory, "inventory.json"), "utf8"),
  ) as {
    schema: string;
    records: (TreeEntry & {
      sha256: string | null;
      resolvedPath?: string;
    })[];
    directories?: TreeEntry[];
    visibilityGaps: string[];
  };
  if (inventory.schema !== "slop-source-inventory-v1")
    throw new Error("Unknown source inventory");
  const files: ScanInputFile[] = [];
  const byPath = new Map(
    [...(inventory.directories ?? []), ...inventory.records].map((entry) => [
      entry.path,
      entry,
    ]),
  );
  const recordsByPath = new Map(
    inventory.records.map((entry) => [entry.path, entry]),
  );
  for (const record of inventory.records)
    if (record.sha256 !== null) {
      let bytes = await readAcquiredObject(directory, record.sha256);
      let symlink: ScanInputFile["symlink"];
      if (record.resolvedPath !== undefined) {
        const resolvedPath = await resolveSymlinkTarget(
          record,
          byPath,
          (link) => {
            const stored = recordsByPath.get(link.path);
            if (!stored?.sha256) throw new Error("Invalid acquired link");
            return readAcquiredObject(directory, stored.sha256);
          },
        );
        const target =
          resolvedPath === null ? null : recordsByPath.get(resolvedPath);
        if (resolvedPath !== record.resolvedPath || !target?.sha256)
          throw new Error("Acquired symlink target changed");
        symlink = {
          gitSha: record.gitSha,
          sha256: record.sha256,
          target: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          resolvedPath,
          targetSha256: target.sha256,
        };
        bytes = await readAcquiredObject(directory, target.sha256);
      }
      files.push({ path: record.path, bytes, ...(symlink ? { symlink } : {}) });
    }
  return { files, acquisitionGaps: [...inventory.visibilityGaps] };
}

/** An acquired object, read by its SHA-256 and rechecked against it. */
export async function readAcquiredObject(
  directory: string,
  digest: string,
): Promise<Uint8Array> {
  // The digest names the object file, so it must not name another path.
  if (!/^[0-9a-f]{64}$/u.test(digest))
    throw new Error("Invalid acquired object digest");
  const bytes = new Uint8Array(
    await readFile(join(directory, "objects", digest)),
  );
  if (sha256(bytes) !== digest)
    throw new Error("Acquired object bytes changed");
  return bytes;
}
