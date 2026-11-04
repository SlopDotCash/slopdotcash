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
 * undecodable content, an unretrieved install-time download, a GYP include
 * the scan cannot acquire or resolve, and an unanalyzed binary keep the result
 * incomplete. Execution is never needed
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
/**
 * Package-manager configuration read on every install or run. Each file can
 * make the package manager execute code (`node-options` and `script-shell` in
 * `.npmrc`, `yarn-path` in `.yarnrc`, `yarnPath` in `.yarnrc.yml`, the
 * `.pnpmfile.cjs` install hooks, `preload` in `bunfig.toml`), so it is an
 * install surface, never unreviewed content.
 */
const PACKAGE_MANAGER_CONFIGS = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  "bunfig.toml",
]);
const INSTALL_FILES = new Set([
  "setup.py",
  "build.rs",
  "extconf.rb",
  "makefile",
  "makefile.pl",
  "justfile",
  "install.sh",
  "postinstall.js",
  "preinstall.js",
  ".pnpmfile.cjs",
  ".pnpmfile.js",
  ".envrc",
  "tasks.json",
  "tox.ini",
  "tox.toml",
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
  "build.pl",
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
  "build.zig",
  "build.zig.zon",
  "build.ninja",
  "tupfile",
  "tuprules.tup",
]);
/**
 * Build recipes identified by a name suffix, such as `Dockerfile.prod` or
 * `app.dockerfile`, or by a build-system definition extension, such as
 * `Helper.cmake`, `plugins.sbt`, `defs.bzl` or `App.csproj`. They run
 * commands at build time, so they are install surfaces like a Makefile,
 * never unreviewed content.
 */
const MSBUILD_EXTENSIONS = "csproj|fsproj|vbproj|vcxproj|proj|props|targets";
const GYP_EXTENSION = "gyp|gypi";
const BUILD_RECIPE = new RegExp(
  String.raw`(?:^|\/)(?:dockerfile|containerfile|jenkinsfile)(?:\.[^/]+)?$|\.(?:dockerfile|cmake|sbt|bzl|bazel|m4|hcl|ninja|${MSBUILD_EXTENSIONS}|${GYP_EXTENSION})$`,
  "u",
);
const MSBUILD_RECIPE = new RegExp(
  String.raw`\.(?:${MSBUILD_EXTENSIONS})$`,
  "iu",
);
/** Ant reads `build.xml` as XML. Imported files keep whatever name they have. */
const ANT_BUILD_XML = /(?:^|\/)build\.xml$/iu;
/** node-gyp loads these directly; other names are install scripts only via `includes`. */
const GYP_SOURCE = new RegExp(String.raw`\.(?:${GYP_EXTENSION})$`, "iu");
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
/**
 * Composer runs these `scripts` events itself on `install` and `update`. The
 * commands live in the same `scripts` field package.json uses, but the
 * manifest is only reviewed as a manifest, so without this the command is
 * never checked as install content and its download is not collected.
 */
const COMPOSER_INSTALL_HOOKS = [
  "pre-install-cmd",
  "post-install-cmd",
  "pre-update-cmd",
  "post-update-cmd",
  "post-autoload-dump",
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
    PACKAGE_MANAGER_CONFIGS.has(name) ||
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

/** A command token cannot continue into another command or a filename suffix. */
function commandToken(name: string): string {
  const word = String.raw`(?:[^\s|;&<>()'"]*/)?${name}`;
  return String.raw`(?:"${word}"|'${word}'|${word})(?:\\\r?\n)*(?=$|[\s|;&<>()'"])`;
}
const SHELL_COMMAND = commandToken("(?:ba|da|k|a|z|fi|t?c)?sh");
const ENV_COMMAND = commandToken("env");
/**
 * Privilege-escalation prefix: `sudo` or `doas`. Matches the command and
 * any options preceding the shell/interpreter or staged script, such as
 * `doas -u root`, `doas -n`, or `doas --`.
 */
const DOAS_OPERAND = String.raw`(?:"(?!-)[^"\n]{1,256}"|'(?!-)[^'\n]{1,256}'|[^\s|;&<>()'"-][^\s|;&<>()'"]*)`;
const DOAS_COMMAND = String.raw`${commandToken("doas")}(?:\s+(?-i:-(?:n+|n*[au]\s*${DOAS_OPERAND})|--)(?=$|[\s|;&<>()])){0,8}`;
const SUDO_COMMAND = String.raw`(?:${commandToken("sudo")}|${DOAS_COMMAND})`;
/**
 * Interpreters that read their program from standard input when no script
 * file argument is given, so a download piped into one executes the
 * download exactly as a pipe into a shell does.
 */
const INTERPRETER_COMMAND = commandToken(
  String.raw`(?:python(?:3(?:\.\d+)?)?|perl|ruby|node(?:js)?|php|lua)`,
);
const INTERPRETER_PIPE_TARGET = String.raw`(?:${INTERPRETER_COMMAND}(?:\s+-)?|${commandToken(String.raw`python(?:3(?:\.\d+)?)?`)}\s+-u(?:\s+-)?)`;

/**
 * Deterministic indicators. A match is a reason to look closer, never a
 * confirmation: it escalates the result to a specialist review.
 */
const RULES: Rule[] = [
  {
    threat: "wallet-drainer",
    severity: "high",
    // "Local Extension Settings" is a directory name. Match when a quote,
    // slash, backslash, or closing brace is immediately on the left, in any
    // case. A closing quote is not required. A bare phrase is ordinary
    // English, and a high finding stays open after specialist review.
    pattern:
      /\.config\/solana\/id\.json|wallet\.dat|nkbihfbeogaeaoehlefnkodbefgpgknn|bfnaelmomeimhlpmgjnjophhpkkoljpa|(?<=["'`/\\}])Local Extension Settings\b|\.ethereum\/keystore/iu,
    summary: "Reads a wallet key file or browser wallet extension store",
  },
  {
    threat: "wallet-drainer",
    severity: "medium",
    pattern:
      /\b(?:mnemonic|seed[ _-]?phrase|private[ _-]?key)\b[^\n]{0,120}\b(?:fetch|axios|https?:\/\/|XMLHttpRequest|sendTransaction|sendSignedTransaction|signTransaction|sendRawTransaction|eth_sendRawTransaction|eth_sendTransaction|transfer)\b/iu,
    summary: "Handles a seed phrase or private key next to a network send",
  },
  {
    threat: "credential-theft",
    severity: "high",
    // "Login Data" is Chromium's password-file name. Match when a quote,
    // slash, backslash, or closing brace is immediately on the left, in any
    // case, including "Login Data For Account". A bare phrase is ordinary
    // English, and a high finding stays open after specialist review.
    pattern:
      /~\/\.ssh\/|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|\.git-credentials|\.netrc\b|\.config\/gh\/hosts\.yml|(?<=["'`/\\}])Login Data\b|security find-(?:generic|internet)-password|\bgh auth token\b/iu,
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
      /JSON\.stringify\(\s*process\.env\s*\)|json\.dumps\(\s*(?:dict\()?\s*os\.environ|\b(?:env|printenv)\s*\|\s*(?:(?:[^\s|;&<>()'"]*\/)?(?:sudo|doas|busybox|env)(?:\s+-\S+)*\s+)*(?:[^\s|;&<>()'"]*\/)?(?:curl|wget|ncat|netcat|nc)\b/iu,
    summary: "Serializes the whole environment, which holds secrets",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b(?:[^\n|]|\\[ \t]*\r?\n)*\|\s*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?${SHELL_COMMAND}|(?:^|[\s;|&()'"])(?:${ENV_COMMAND}\s+)?${SHELL_COMMAND}\s+-c\s+["']?\$\(\s*(?:curl|wget)\b|(?:^|[\s;|&()'"])eval\s+["']?(?:\$\(|\x60)\s*(?:curl|wget)\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(?:iex|Invoke-Expression)\b|\.DownloadString\s*\([^\n]*\)\s*\|\s*(?:iex|Invoke-Expression)\b|(?:iex|Invoke-Expression)\s*\(+\s*(?:New-Object\s+(?:System\.)?Net\.WebClient|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)|\b(?:powershell|pwsh)[^\n]*-(?:e|enc|encodedcommand)\s`,
      "iu",
    ),
    summary: "Runs a remote download in a shell",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    // Process substitution hands a remote download to a shell without a
    // pipe: `bash <(curl ...)`, `sh <(curl ...)`, `source <(curl ...)`
    // and `. <(curl ...)` are the same act. Shell flags can select stdin
    // or syntax-only mode, so this rule covers a direct script argument.
    // Only curl/wget inside the substitution count; `bash <(cat local.sh)` stays clean.
    pattern: new RegExp(
      String.raw`(?:^|[\s;|&()'"])(?:(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?${SHELL_COMMAND}\s+|source\s+|\.\s+)<\(\s*(?:curl|wget)\b`,
      "iu",
    ),
    summary: "Runs a remote download in a shell via process substitution",
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
    severity: "high",
    // Reading a response object does not execute its body. Match the direct
    // response-text forms; other data flow needs the model's source review.
    pattern:
      /(?<![\w.])(?:eval|exec)\s*\(\s*(?:(?:urllib(?:\.request)?\.)?urlopen\s*\([^()\n]*\)\s*\.read\s*\(\s*\)|requests\.[a-z]+\s*\([^()\n]*\)\s*\.text\b)|(?<![\w.])(?:eval|new\s+Function)\s*\(\s*await\s+\(\s*await\s+fetch\s*\([^()\n]*\)\s*\)\s*\.text\s*\(\s*\)/iu,
    summary: "Executes code fetched from the network",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    // The interpreter is the pipe target the shell rule above does not
    // name. It matches only when the interpreter reads its program from
    // the pipe: bare, with `-`, or with Python's unbuffered option. Arbitrary
    // flags can instead print a version or select a different program.
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b[^\n|]*\|\s*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?${INTERPRETER_PIPE_TARGET}(?=\s*(?:$|[|;&<>()]))`,
      "iu",
    ),
    summary: "Runs a remote download in an interpreter",
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
  {
    threat: "unsafe-execution",
    severity: "high",
    // A decoder between the download and the executor changes nothing
    // about what runs: the shell or interpreter still receives the
    // downloaded bytes, decoded. The pipe rules above require the
    // executor immediately after the first pipe, so
    // `curl … | base64 -d | sh` matched nothing. Only a decode stage
    // qualifies: encoding, checksumming or saving a download keeps no
    // finding, and decoding local content has no download to run. Limit each
    // decoder to known stream arguments: extra operands can read local files
    // and help/version flags do not decode the download.
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b(?:[^\n|]|\\[ \t]*\r?\n)*\|\s*(?:${commandToken("base64")}\s+(?:-d|-D|--decode|-di|-id)|${commandToken("xxd")}\s+(?:-r(?:\s+-p)?|-p\s+-r)|${commandToken("uudecode")}\s+-o\s+/dev/stdout|${commandToken("openssl")}\s+(?:base64\s+-d|enc\s+(?:-d\s+-(?:a|base64)|-(?:a|base64)\s+-d)))\s*\|\s*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:${SHELL_COMMAND}(?:\s+-)?|${INTERPRETER_PIPE_TARGET})(?=\s*(?:$|[|;&<>()]))`,
      "iu",
    ),
    summary: "Runs a decoded remote download in a shell or interpreter",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    // A direct script argument can execute a URL without a separate download.
    // Match a command line or a JSON task value, with only known no-value
    // Deno permission flags. A URL after a local script is just script data.
    pattern:
      /(?:^[ \t]*|:[ \t]*")(?:deno[ \t]+run[ \t]+(?:(?:-A|--allow-all)[ \t]+)*|mshta(?:\.exe)?[ \t]+)["']?https?:\/\//imu,
    summary: "Runs a remote script URL directly",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    // These direct calls pass the downloaded text to eval/exec. Ruby's
    // URI.open and Net::HTTP.get_response return objects, so require the
    // read/body access rather than reporting those objects as executed.
    // Keep the argument boundary: a later fetch after a local eval is not
    // remote execution, and arbitrary transformations need source review.
    pattern:
      /(?<![\w.$])(?:eval|exec)\s*\(\s*(?:Net::HTTP\.get\s*\(\s*URI\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\)\s*\)|Net::HTTP\.get_response\s*\(\s*URI\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\)\s*\)\s*\.body\b|URI\.open\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\)\s*\.read\b(?:\s*\(\s*\))?|(?:file_get_contents|get)\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\))\s*\)|(?<![\w.$])(?:include|require)(?:_once)?\s*\(?\s*["']https?:\/\//u,
    summary: "Executes code fetched from the network",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    // A download saved to a path and run later in the same file is the
    // pipe act in two steps. Each step alone is already reviewed: the
    // download is collected, and running a local file is ordinary. Only
    // the link was invisible, so the execution must name the exact path
    // the download wrote (the backreference), after the download, in
    // command position or after a shell, interpreter or `source` verb.
    // Bare filenames search PATH, so direct execution requires a path.
    // Shell flags can select syntax-only or version output and are excluded.
    // The path is one literal token: quoted spellings count, but a
    // variable, a glob, a glued or clustered output flag and `curl -O`
    // (which is given no path) stay out. Reading, checksumming or
    // mentioning the downloaded file keeps no finding, and neither does
    // running a file this file did not download. The rule is
    // case-sensitive because the tools assign opposite meanings to the
    // two spellings: `curl -o` names the download, `wget -o` names a
    // log file, and only `wget -O` names the download.
    pattern: new RegExp(
      String.raw`(?:^|[\n;|&])[ \t]*curl\b(?=[^\n;|&]*https?://)[^\n;|&]*?(?<![\w-])(?:-o|--output)(?:=|\s+)["']?([A-Za-z0-9._~/%+=@][A-Za-z0-9._~/%+=@-]*)["']?(?=$|[\s;|&])[\s\S]{0,8192}?(?:^|[\n;|&])[ \t]*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:(?:${SHELL_COMMAND}|${INTERPRETER_COMMAND}|source|\.)\s+["']?(?:\./)?|["']?(?:\./|(?=/)))\1["']?(?=$|[\s|;&<>()'"])|(?:^|[\n;|&])[ \t]*wget\b(?=[^\n;|&]*https?://)[^\n;|&]*?(?<![\w-])(?:-O|--output-document)(?:=|\s+)["']?([A-Za-z0-9._~/%+=@][A-Za-z0-9._~/%+=@-]*)["']?(?=$|[\s;|&])[\s\S]{0,8192}?(?:^|[\n;|&])[ \t]*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:(?:${SHELL_COMMAND}|${INTERPRETER_COMMAND}|source|\.)\s+["']?(?:\./)?|["']?(?:\./|(?=/)))\2["']?(?=$|[\s|;&<>()'"])|(?:^|[\n;|&])[ \t]*(?:curl|wget)\b(?=[^\n;|&]*https?://)[^\n;|&]*?(?<![\d&])>\s*["']?([A-Za-z0-9._~/%+=@][A-Za-z0-9._~/%+=@-]*)["']?(?=$|[\s;|&])[\s\S]{0,8192}?(?:^|[\n;|&])[ \t]*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:(?:${SHELL_COMMAND}|${INTERPRETER_COMMAND}|source|\.)\s+["']?(?:\./)?|["']?(?:\./|(?=/)))\3["']?(?=$|[\s|;&<>()'"])`,
      "mu",
    ),
    summary: "Executes a file staged by an earlier download in the same file",
  },
];

// Rule text reaches the reviewer. Bind it, matching semantics, scope and order
// so identical source bytes cannot reuse a result from a different rule set.
// XML normalization is part of that semantics: it changes which bytes match.
const RULE_POLICY_SHA256 = sha256(
  JSON.stringify({
    schemaVersion: "slop-deterministic-rules-v1",
    xmlAttributeWhitespace: "msbuild-and-ant-build-xml-literal-cr-lf-to-space",
    xmlAttributeCharacterReferences: "decimal-hex-and-predefined-entities",
    xmlElementCharacterReferences:
      "msbuild-element-text-except-exec-comments-and-cdata",
    rules: RULES.map(({ pattern, ...rule }) => ({
      ...rule,
      pattern: { source: pattern.source, flags: pattern.flags },
    })),
  }),
);

// certutil counts only in its `-urlcache` download form and bitsadmin
// only in a `/transfer` job: their other invocations read local files.
// Upload-only BITS jobs do not retrieve an artifact. aria2c and axel
// name downloads by their command alone, like curl and wget.
const DOWNLOAD =
  /(?:\b(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|aria2c|axel)\b|\bStart-BitsTransfer\b(?![^\n]*-TransferType\s+["']?Upload\b)|\bcertutil(?:\.exe)?\b[^\n]*?-urlcache\b|\bbitsadmin\b(?![^\n]*\/upload\b)[^\n]*?\/transfer\b)[^\n]*?(https?:\/\/[^\s"'`)|]+)|\b(?:fetch|urlopen|requests\.get|https?\.get)\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/giu;

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

const NAMED_XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** XML 1.0 Char. Surrogates and noncharacters are not character references. */
function xmlScalar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * One numeric character reference or predefined entity at `index`. `quote`
 * is the attribute delimiter, or empty in element text. The scan stops at
 * that delimiter, so a semicolon later in the file cannot finish a reference
 * the quote ended. Element text has no quote; `<` still ends the scan.
 */
function xmlCharacterReference(
  text: string,
  index: number,
  quote: string,
): { value: string; length: number } | null {
  if (text[index] !== "&") return null;
  let cursor = index + 1;
  let semi = -1;
  while (cursor < text.length) {
    const char = text[cursor] ?? "";
    if (char === ";") {
      semi = cursor;
      break;
    }
    if (char === quote || char === "&" || char === "<") return null;
    cursor += 1;
  }
  if (semi < 0) return null;
  const body = text.slice(index + 1, semi);
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const digits = body.slice(hex ? 2 : 1);
    if (
      digits.length === 0 ||
      (hex ? !/^[0-9A-Fa-f]+$/u.test(digits) : !/^\d+$/u.test(digits))
    )
      return null;
    // Leading zeros do not change the code point. A value above U+10FFFF
    // is not a character reference, whatever its written length.
    const trimmed = digits.replace(/^0+/u, "") || "0";
    if (trimmed.length > (hex ? 6 : 7)) return null;
    const code = Number.parseInt(trimmed, hex ? 16 : 10);
    if (!xmlScalar(code)) return null;
    return { value: String.fromCodePoint(code), length: semi - index + 1 };
  }
  const named = NAMED_XML_ENTITIES[body];
  if (named === undefined) return null;
  return { value: named, length: semi - index + 1 };
}

/**
 * MSBuild and Ant run an attribute value after XML attribute normalization.
 * A literal CR or LF inside the quotes becomes one space, so a newline
 * before `| sh` still executes the pipe. A numeric character reference
 * (`&#124;`, `&#x7C;`) or predefined entity (`&amp;`, `&lt;`, `&gt;`,
 * `&quot;`, `&apos;`) becomes that character, so `&amp;&amp;` is `&&`.
 * A reference to CR or LF stays that character: XML does not turn it into
 * a space, and it still ends a shell command. MSBuild also runs property
 * element text after the XML reader decodes those same references there
 * (`PreBuildEvent`, and any property expanded into `Exec`). Element text in
 * an MSBuild file is decoded the same way, except comments, CDATA, and the
 * text of an `Exec` element: the task ignores that text and reads
 * `Command`. Literal CR or LF in element text stays a line break. Ant
 * `build.xml` rewrites quoted attributes only. `origin` maps each index of
 * the rewritten text back to the original text, so a finding's line is the
 * line of the source bytes.
 */
function xmlAttributeRuleText(
  text: string,
  elementText = false,
): {
  text: string;
  origin: (index: number) => number;
} {
  let result = "";
  let index = 0;
  let mode: "text" | "tag" | "comment" | "cdata" | "value" = "text";
  let quote = "";
  let delta = 0;
  const breaks = [0];
  const deltas = [0];
  const stack: string[] = [];
  let tagKind: "start" | "end" | "other" = "start";
  let tagName = "";
  let readingName = false;
  let selfClosing = false;
  const emit = (value: string, sourceLength = value.length) => {
    result += value;
    const growth = sourceLength - value.length;
    if (growth === 0) return;
    delta += growth;
    breaks.push(result.length);
    deltas.push(delta);
  };
  while (index < text.length) {
    const char = text[index] ?? "";
    if (mode === "text") {
      if (text.startsWith("<!--", index)) {
        mode = "comment";
        emit("<!--");
        index += 4;
        continue;
      }
      if (text.startsWith("<![CDATA[", index)) {
        mode = "cdata";
        emit("<![CDATA[");
        index += 9;
        continue;
      }
      if (char === "<") {
        mode = "tag";
        if (!elementText) {
          emit(char);
          index += 1;
          continue;
        }
        tagName = "";
        selfClosing = false;
        readingName = false;
        if (text.startsWith("</", index)) {
          tagKind = "end";
          readingName = true;
          emit("</");
          index += 2;
          continue;
        }
        if (text.startsWith("<?", index) || text.startsWith("<!", index))
          tagKind = "other";
        else {
          tagKind = "start";
          readingName = true;
        }
        emit(char);
        index += 1;
        continue;
      }
      // Exec reads its Command attribute and ignores element text.
      const open = stack[stack.length - 1];
      if (elementText && open !== undefined && open !== "Exec") {
        const reference = xmlCharacterReference(text, index, "");
        if (reference !== null) {
          emit(reference.value, reference.length);
          index += reference.length;
          continue;
        }
      }
      emit(char);
      index += 1;
      continue;
    }
    if (mode === "comment") {
      if (text.startsWith("-->", index)) {
        mode = "text";
        emit("-->");
        index += 3;
        continue;
      }
      emit(char);
      index += 1;
      continue;
    }
    if (mode === "cdata") {
      if (text.startsWith("]]>", index)) {
        mode = "text";
        emit("]]>");
        index += 3;
        continue;
      }
      emit(char);
      index += 1;
      continue;
    }
    if (mode === "value") {
      if (char === quote) {
        mode = "tag";
        emit(char);
        index += 1;
        continue;
      }
      const reference = xmlCharacterReference(text, index, quote);
      if (reference !== null) {
        emit(reference.value, reference.length);
        index += reference.length;
        continue;
      }
      emit(char === "\r" || char === "\n" ? " " : char);
      index += 1;
      continue;
    }
    if (char === ">") {
      if (elementText) {
        const colon = tagName.lastIndexOf(":");
        const local = colon < 0 ? tagName : tagName.slice(colon + 1);
        if (tagKind === "start" && !selfClosing && local !== "")
          stack.push(local);
        else if (tagKind === "end" && local !== "") {
          const at = stack.lastIndexOf(local);
          if (at >= 0) stack.length = at;
        }
      }
      mode = "text";
      readingName = false;
      emit(char);
      index += 1;
      continue;
    }
    if (readingName && !/[\s/>]/u.test(char)) {
      tagName += char;
      emit(char);
      index += 1;
      continue;
    }
    readingName = false;
    if (elementText && char === "/") selfClosing = true;
    if (char === '"' || char === "'") {
      let previous = index - 1;
      while (previous >= 0 && /[ \t\r\n]/u.test(text[previous] ?? ""))
        previous -= 1;
      if (text[previous] === "=") {
        mode = "value";
        quote = char;
      }
    }
    emit(char);
    index += 1;
  }
  const origin =
    breaks.length === 1
      ? (decodedIndex: number) => decodedIndex
      : (decodedIndex: number) => {
          let lo = 0;
          let hi = breaks.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if ((breaks[mid] ?? 0) <= decodedIndex) lo = mid;
            else hi = mid - 1;
          }
          return decodedIndex + (deltas[lo] ?? 0);
        };
  return { text: result, origin };
}

function checkText(
  path: string,
  text: string,
  surfaces: ScanSurface[],
  evidenceText = text,
  origin?: (index: number) => number,
): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const rule of RULES) {
    if (rule.surfaces && !rule.surfaces.some((s) => surfaces.includes(s)))
      continue;
    const match = rule.pattern.exec(text);
    if (match === null) continue;
    const at = origin?.(match.index) ?? match.index;
    findings.push({
      severity: rule.severity,
      category: rule.threat,
      summary: rule.summary,
      evidence: `${path}:${lineOf(evidenceText, at)}`.slice(0, 300),
      path,
    });
  }
  return findings;
}

function installHookCommands(path: string, text: string): string[] {
  const name = basename(path);
  const hooks =
    name === "package.json"
      ? INSTALL_HOOKS
      : name === "composer.json"
        ? COMPOSER_INSTALL_HOOKS
        : null;
  if (hooks === null) return [];
  try {
    const scripts = (JSON.parse(text) as { scripts?: Record<string, unknown> })
      .scripts;
    // Composer accepts one command or an ordered list of commands per event.
    return hooks.flatMap((hook) => {
      const value = scripts?.[hook];
      if (typeof value === "string") return [value];
      return Array.isArray(value)
        ? value.filter(
            (command): command is string => typeof command === "string",
          )
        : [];
    });
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
 * One Python literal the includes reader understood, or a value it refused.
 * A tuple keeps its members so a nested `('evil.txt',)` still yields paths.
 * A list is only an includes value; a list used as one entry is not a path.
 */
type GypLiteral =
  | { kind: "string"; value: string }
  | { kind: "list"; items: GypLiteral[] }
  | { kind: "tuple"; items: GypLiteral[] }
  | { kind: "unresolved" };

/**
 * Quoted paths inside every GYP `includes` list or tuple.
 *
 * gyp evaluates the file as a Python literal and iterates `includes`,
 * including an `includes` key nested under `conditions` or
 * `target_conditions`. A `#` outside a string is a comment, so it cannot
 * hide an entry or end the list, and a `#` inside a quoted path stays part
 * of that path. Adjacent quoted fragments are one path. Parentheses that
 * only group a value are that value, so `('evil.txt')` is the string
 * `evil.txt`. A tuple is read like a list. `+`, names, calls and any other
 * form that is not a plain string literal are not evaluated: each is an
 * unresolved include, and install-script coverage stays partial.
 * Prose that merely says "includes" is not an include list. A bare name
 * such as `{includes: [...]}` is a variable lookup under gyp's empty-builtin
 * eval, not the string key, so it is not treated as an include list.
 */
function gypIncludeSpecifiers(text: string): {
  paths: string[];
  unresolved: boolean;
} {
  const paths: string[] = [];
  let unresolved = false;
  const n = text.length;
  let i = 0;

  const isQuote = (char: string | undefined): char is "'" | '"' =>
    char === "'" || char === '"';

  const skipSpaceAndComments = () => {
    while (i < n) {
      const c = text[i];
      if (
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === "\r" ||
        c === "\f" ||
        c === "\v"
      ) {
        i += 1;
        continue;
      }
      // A backslash-newline outside a string is a line continuation.
      if (c === "\\" && (text[i + 1] === "\n" || text[i + 1] === "\r")) {
        i += 2;
        if (text[i - 1] === "\r" && text[i] === "\n") i += 1;
        continue;
      }
      if (c === "#") {
        while (i < n && text[i] !== "\n" && text[i] !== "\r") i += 1;
        continue;
      }
      return;
    }
  };

  /** True when the quote at `at` opens a raw string (`r`, `fr`, `rb`, …). */
  const rawPrefix = (at: number) => {
    let start = at;
    while (start > 0 && /[rRuUbBfF]/u.test(text[start - 1] ?? "")) start -= 1;
    if (start === at) return false;
    if (start > 0 && /[A-Za-z0-9_]/u.test(text[start - 1] ?? "")) return false;
    return /r/iu.test(text.slice(start, at));
  };

  /** Python string escape. `i` points just after the backslash. */
  const decodeEscape = (raw: boolean) => {
    if (i >= n) return "\\";
    const next = text[i] ?? "";
    i += 1;
    if (raw) {
      if (next === "\r" && text[i] === "\n") {
        i += 1;
        return "\\\r\n";
      }
      return `\\${next}`;
    }
    if (next === "\n") return "";
    if (next === "\r") {
      if (text[i] === "\n") i += 1;
      return "";
    }
    if (next === "n") return "\n";
    if (next === "r") return "\r";
    if (next === "t") return "\t";
    if (next === "a") return "\u0007";
    if (next === "b") return "\b";
    if (next === "f") return "\f";
    if (next === "v") return "\v";
    if (next === "\\" || next === "'" || next === '"') return next;
    if (next === "x" || next === "u" || next === "U") {
      const width = next === "x" ? 2 : next === "u" ? 4 : 8;
      const digits = text.slice(i, i + width);
      if (digits.length === width && /^[0-9a-fA-F]+$/u.test(digits)) {
        const code = Number.parseInt(digits, 16);
        if (code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
          i += width;
          return String.fromCodePoint(code);
        }
      }
      return `\\${next}`;
    }
    if (next >= "0" && next <= "7") {
      let digits = next;
      while (
        digits.length < 3 &&
        i < n &&
        (text[i] ?? "") >= "0" &&
        (text[i] ?? "") <= "7"
      ) {
        digits += text[i];
        i += 1;
      }
      return String.fromCharCode(Number.parseInt(digits, 8));
    }
    return `\\${next}`;
  };

  /** One Python string starting at a quote. Null when the literal is unclosed. */
  const readString = (): string | null => {
    if (!isQuote(text[i])) return null;
    const quote = text[i];
    const raw = rawPrefix(i);
    const triple = text.startsWith(quote.repeat(3), i);
    const delimiter = triple ? quote.repeat(3) : quote;
    i += delimiter.length;
    let value = "";
    while (i < n) {
      const c = text[i] ?? "";
      if (c === "\\") {
        i += 1;
        value += decodeEscape(raw);
        continue;
      }
      if (text.startsWith(delimiter, i)) {
        i += delimiter.length;
        return value;
      }
      // A raw newline ends a non-triple string. Stop so the rest of the file
      // is not swallowed as string content.
      if (!triple && (c === "\n" || c === "\r")) return null;
      value += c;
      i += 1;
    }
    return null;
  };

  /** Adjacent string literals, joined the way Python joins them. */
  const readConcatenatedString = (): string | null => {
    const first = readString();
    if (first === null) return null;
    let value = first;
    while (i < n) {
      const mark = i;
      skipSpaceAndComments();
      if (!isQuote(text[i])) {
        i = mark;
        return value;
      }
      const next = readString();
      if (next === null) return value;
      value += next;
    }
    return value;
  };

  /** A `{...}` value. Strings and comments inside it stay intact. */
  const skipOneValue = (): boolean => {
    skipSpaceAndComments();
    if (i >= n) return false;
    const start = text[i];
    if (start === "," || start === "]" || start === "}" || start === ")")
      return false;
    if (isQuote(start)) {
      readConcatenatedString();
      return true;
    }
    if (start === "[" || start === "{" || start === "(") {
      const closing = start === "[" ? "]" : start === "{" ? "}" : ")";
      i += 1;
      while (i < n) {
        skipSpaceAndComments();
        if (i >= n) return false;
        if (text[i] === closing) {
          i += 1;
          return true;
        }
        if (text[i] === ",") {
          i += 1;
          continue;
        }
        if (!skipOneValue()) return false;
      }
      return false;
    }
    if (/[A-Za-z0-9_]/u.test(start ?? "")) {
      while (i < n && /[A-Za-z0-9_]/u.test(text[i] ?? "")) i += 1;
      return true;
    }
    i += 1;
    return true;
  };

  const isOperatorChar = (char: string | undefined): boolean =>
    char !== undefined && "+-*/%|&^<>=!~@".includes(char);

  /** Quote index of a string that may carry an `r`/`u`/`b`/`f` prefix. */
  const stringAt = (at: number): number | null => {
    let j = at;
    if (j > 0 && /[A-Za-z0-9_]/u.test(text[j - 1] ?? "")) return null;
    while (j < n && /[rRuUbBfF]/u.test(text[j] ?? "")) j += 1;
    return isQuote(text[j]) ? j : null;
  };

  const startsAtom = (char: string | undefined): boolean =>
    char === "(" ||
    char === "[" ||
    char === "{" ||
    isQuote(char) ||
    (char !== undefined && /[A-Za-z0-9_]/u.test(char));

  const readOneString = (): GypLiteral => {
    const quote = stringAt(i);
    if (quote === null) return { kind: "unresolved" };
    i = quote;
    const value = readString();
    return value === null ? { kind: "unresolved" } : { kind: "string", value };
  };

  const consumeOperator = () => {
    while (i < n && isOperatorChar(text[i])) i += 1;
  };

  /**
   * Calls, subscripts and attributes that follow a name. The literal under
   * them is not a path, but the source still has to be consumed.
   */
  const consumeTrailers = () => {
    while (i < n) {
      const mark = i;
      skipSpaceAndComments();
      if (text[i] === "(") {
        readParen();
        continue;
      }
      if (text[i] === "[") {
        readBracket();
        continue;
      }
      if (text[i] === ".") {
        i += 1;
        skipSpaceAndComments();
        while (i < n && /[A-Za-z0-9_]/u.test(text[i] ?? "")) i += 1;
        continue;
      }
      i = mark;
      return;
    }
  };

  const readAtom = (): GypLiteral => {
    skipSpaceAndComments();
    if (i >= n) return { kind: "unresolved" };
    if (stringAt(i) !== null) return readOneString();
    if (text[i] === "(") return readParen();
    if (text[i] === "[") return readBracket();
    if (text[i] === "{") {
      skipOneValue();
      return { kind: "unresolved" };
    }
    if (/[A-Za-z_]/u.test(text[i] ?? "")) {
      while (i < n && /[A-Za-z0-9_]/u.test(text[i] ?? "")) i += 1;
      consumeTrailers();
      return { kind: "unresolved" };
    }
    if (/[0-9]/u.test(text[i] ?? "")) {
      while (i < n && /[0-9A-Za-z_.]/u.test(text[i] ?? "")) i += 1;
      consumeTrailers();
      return { kind: "unresolved" };
    }
    if (isOperatorChar(text[i])) {
      consumeOperator();
      readAtom();
      return { kind: "unresolved" };
    }
    i += 1;
    return { kind: "unresolved" };
  };

  /**
   * One expression. Stops before a comma or a closing bracket so a later
   * entry is still read. Adjacent strings stay one value. Any operator,
   * keyword, call or other trailer makes the whole expression unresolved
   * and is consumed, so `'ev' + 'il.txt'` is not two paths.
   */
  const readExpr = (): GypLiteral => {
    skipSpaceAndComments();
    const start = i;
    let value = readAtom();
    if (i === start && i < n) i += 1;
    while (i < n) {
      const before = i;
      skipSpaceAndComments();
      if (i >= n) return value;
      if (value.kind === "string" && stringAt(i) !== null) {
        const next = readOneString();
        if (next.kind === "string" && value.kind === "string") {
          value = { kind: "string", value: value.value + next.value };
        } else value = { kind: "unresolved" };
        continue;
      }
      const char = text[i];
      if (char === "(" || char === "[" || char === ".") {
        value = { kind: "unresolved" };
        if (char === "(") readParen();
        else if (char === "[") readBracket();
        else i += 1;
        if (i === before) return { kind: "unresolved" };
        continue;
      }
      if (isOperatorChar(char)) {
        value = { kind: "unresolved" };
        consumeOperator();
        if (i === before) return { kind: "unresolved" };
        continue;
      }
      if (value.kind !== "string" && startsAtom(char)) {
        value = { kind: "unresolved" };
        readAtom();
        if (i === before) return { kind: "unresolved" };
        continue;
      }
      if (char !== undefined && /[A-Za-z_]/u.test(char)) {
        value = { kind: "unresolved" };
        while (i < n && /[A-Za-z0-9_]/u.test(text[i] ?? "")) i += 1;
        if (i === before) return { kind: "unresolved" };
        continue;
      }
      i = before;
      return value;
    }
    return value;
  };

  const readDelimited = (
    closing: ")" | "]",
    kind: "tuple" | "list",
  ): GypLiteral => {
    i += 1;
    const items: GypLiteral[] = [];
    let comma = false;
    while (i < n) {
      skipSpaceAndComments();
      if (i >= n) return { kind: "unresolved" };
      if (text[i] === closing) {
        i += 1;
        // No comma: Python grouping, so `('evil.txt')` is the string.
        if (kind === "tuple" && !comma && items.length === 1)
          return items[0] ?? { kind: "unresolved" };
        if (kind === "tuple" && !comma && items.length === 0)
          return { kind: "tuple", items: [] };
        if (comma && items.length === 0) return { kind: "unresolved" };
        return { kind, items };
      }
      if (text[i] === ",") {
        comma = true;
        i += 1;
        continue;
      }
      const before = i;
      items.push(readExpr());
      if (i === before) i += 1;
    }
    return { kind: "unresolved" };
  };

  const readParen = (): GypLiteral => readDelimited(")", "tuple");
  const readBracket = (): GypLiteral => readDelimited("]", "list");

  const markUnresolved = () => {
    unresolved = true;
  };

  const collectEntry = (item: GypLiteral) => {
    if (item.kind === "string") {
      if (item.value) paths.push(item.value);
      return;
    }
    // A tuple contributes its string members, including through nested tuples.
    if (item.kind === "tuple") {
      if (item.items.length === 0) {
        markUnresolved();
        return;
      }
      for (const member of item.items) collectEntry(member);
      return;
    }
    markUnresolved();
  };

  const collectValue = (item: GypLiteral) => {
    if (item.kind === "list" || item.kind === "tuple") {
      for (const entry of item.items) collectEntry(entry);
      return;
    }
    // A resolved string is one include path. gyp iterates a string value by
    // character; recording the whole string still reviews that path, and an
    // unreadable value stays unresolved below.
    if (item.kind === "string") {
      if (item.value) paths.push(item.value);
      else markUnresolved();
      return;
    }
    markUnresolved();
  };

  while (i < n) {
    skipSpaceAndComments();
    if (i >= n) break;
    if (!isQuote(text[i])) {
      i += 1;
      continue;
    }
    const key = readConcatenatedString();
    if (key !== "includes") continue;
    const afterKey = i;
    skipSpaceAndComments();
    if (text[i] !== ":") {
      i = afterKey;
      continue;
    }
    i += 1;
    collectValue(readExpr());
  }
  return { paths, unresolved };
}

/**
 * A build include is relative to the file that names it. Absolute paths, URLs
 * and paths that leave the repository are not acquired files.
 */
function resolveBuildInclude(
  fromFile: string,
  specifier: string,
): string | null {
  const include = specifier.replaceAll("\\", "/").trim();
  if (
    include === "" ||
    include.startsWith("/") ||
    include.includes(":") ||
    include.includes("\0") ||
    /[<>|?*]/u.test(include)
  )
    return null;
  const directory = fromFile.includes("/")
    ? fromFile.slice(0, fromFile.lastIndexOf("/") + 1)
    : "";
  const normalized: string[] = [];
  for (const part of `${directory}${include}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.length === 0 ? null : normalized.join("/");
}

/**
 * Files a `.gyp` or `.gypi` loads through `includes`, including nested
 * includes. node-gyp runs command expansions in those files at install even
 * when the name is not itself a GYP source. A specifier that does not resolve
 * inside the acquired tree, and an includes value the reader cannot reduce to
 * a string literal, are visibility gaps. Install-script coverage is partial.
 */
function gypIncludedPaths(files: ScanInputFile[]): {
  included: Set<string>;
  unacquired: string[];
} {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set<string>();
  const unacquired = new Set<string>();
  const seen = new Set<string>();
  const queue = files
    .filter((file) => GYP_SOURCE.test(file.path))
    .map((file) => file.path);
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const file = byPath.get(path);
    if (!file) continue;
    const text = decode(file.bytes);
    if (text === null) continue;
    const includes = gypIncludeSpecifiers(text);
    if (includes.unresolved)
      unacquired.add("GYP include not acquired: unresolved");
    for (const specifier of includes.paths) {
      const resolved = resolveBuildInclude(path, specifier);
      // `resolveBuildInclude` returns null for an empty, absolute, URL-like or
      // out-of-repository path. A resolved path missing from the acquired
      // tree was not fetched or is generated at install. A file already
      // queued was acquired; repeating it is not a gap.
      if (resolved !== null && byPath.has(resolved)) {
        if (seen.has(resolved)) continue;
        included.add(resolved);
        queue.push(resolved);
        continue;
      }
      unacquired.add(`GYP include not acquired: ${specifier.slice(0, 500)}`);
    }
  }
  return { included, unacquired: [...unacquired].sort() };
}

/**
 * Inspects one revision's acquired files. Pure and deterministic: the same
 * bytes, surface classifications and rules produce the same inventory digest, so an
 * unchanged executable inventory reuses its clean result and any change to
 * executable content is scanned again.
 */
/**
 * A CMake list file: `CMakeLists.txt` or any `.cmake` module. Both are
 * already install surfaces by name; this is the set whose `include()` calls
 * are followed.
 */
const CMAKE_SOURCE = /(?:^|\/)cmakelists\.txt$|\.cmake$/iu;

/**
 * Literal `include(<path>)` arguments. CMake resolves a relative path
 * against the list file that names it, so only a path with no variable
 * expansion and no absolute form can be followed here. A bare module name
 * resolves to `<name>.cmake` through `CMAKE_MODULE_PATH`, which is covered by
 * the extension, so it needs no entry.
 */
function cmakeIncludeSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const code = line.replace(/#.*$/u, "");
    for (const match of code.matchAll(/\binclude\s*\(/giu)) {
      const rest = code.slice((match.index ?? 0) + match[0].length);
      const argument = /^\s*(?:"([^"]*)"|([^\s")]+))/u.exec(rest);
      const value = argument?.[1] ?? argument?.[2];
      if (value !== undefined && value !== "") specifiers.push(value);
    }
  }
  return specifiers;
}

/**
 * Files a CMake list file pulls in with `include()`, including nested ones.
 * CMake evaluates the included file during configure, so its commands run
 * even when its name carries no recipe extension.
 */
function cmakeIncludedPaths(files: ScanInputFile[]): Set<string> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set<string>();
  const seen = new Set<string>();
  const queue = files
    .filter((file) => CMAKE_SOURCE.test(file.path))
    .map((file) => file.path);
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const file = byPath.get(path);
    if (!file) continue;
    const text = decode(file.bytes);
    if (text === null) continue;
    for (const specifier of cmakeIncludeSpecifiers(text)) {
      const resolved = resolveBuildInclude(path, specifier);
      if (resolved === null || !byPath.has(resolved) || seen.has(resolved))
        continue;
      included.add(resolved);
      queue.push(resolved);
    }
  }
  return included;
}

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
  const gyp = gypIncludedPaths(files);
  const gypIncludes = gyp.included;
  if (gyp.unacquired.length > 0) {
    partial.add("installScripts");
    gaps.push(...gyp.unacquired);
  }
  const cmakeIncludes = cmakeIncludedPaths(files);
  for (const file of files) {
    const surfaces = surfacesOf(file.path);
    // Previously unclassified interpreter scripts still need review, even
    // when their name has no recognized extension (for example, configure).
    if (surfaces.length === 0 && declaresInterpreter(file.bytes))
      surfaces.push("installScripts", "source");
    // Both build systems execute included files during configuration.
    if (gypIncludes.has(file.path) || cmakeIncludes.has(file.path)) {
      if (!surfaces.includes("installScripts")) surfaces.push("installScripts");
      if (!surfaces.includes("source")) surfaces.push("source");
    }
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
    // MSBuild and Ant build.xml execute attribute values after XML
    // normalization. MSBuild also executes property element text after
    // character references are decoded. Shell text, and every other file,
    // is left as written.
    const msbuild = MSBUILD_RECIPE.test(file.path);
    const attributes =
      msbuild || ANT_BUILD_XML.test(file.path)
        ? xmlAttributeRuleText(text, msbuild)
        : undefined;
    const ruleText = attributes?.text ?? text;
    const found = checkText(
      file.path,
      ruleText,
      surfaces,
      text,
      attributes?.origin,
    );
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
      for (const match of [ruleText, ...hooks].join("\n").matchAll(DOWNLOAD))
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
      rulePolicySha256: RULE_POLICY_SHA256,
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
      rulePolicySha256: RULE_POLICY_SHA256,
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
