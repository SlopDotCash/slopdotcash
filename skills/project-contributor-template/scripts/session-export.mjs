import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CLEANER_VERSION = "slop-session-cleaner-1";
export const TRACE_TERMS_VERSION = "private-trace-v3";
export const MAX_SESSION_BYTES = 8388608;
export const MARKER_CREDENTIAL = "[REDACTED:CREDENTIAL]";
export const MARKER_SOURCE = "[REDACTED:SOURCE]";
export const MARKER_LOCAL_PATH = "[REDACTED:LOCAL_PATH]";
export const MARKER_OUTSIDE_REPO = "[REDACTED:OUTSIDE_REPO]";

export const OSI_LICENCES = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0",
  "GPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later",
  "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later",
  "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later",
  "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later",
  "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later",
  "EPL-2.0", "Unlicense", "0BSD", "Zlib", "BSL-1.0",
]);

export const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{16,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}\b/g,
];

const FIND_ACTION_FLAGS = [
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-print0",
  "-fprint",
  "-fprintf",
  "-fls",
  "-printf",
];

const GIT_LOG_FLAGS = new Set([
  "--oneline",
  "--name-only",
  "--name-status",
  "--graph",
  "--decorate",
  "--all",
  "--branches",
  "--tags",
  "--remotes",
  "--no-merges",
  "--first-parent",
  "--abbrev-commit",
  "--since",
  "--until",
  "--author",
  "--grep",
  "--max-count",
  "-n",
]);

const GIT_DIFF_FLAGS = new Set([
  "--name-only",
  "--name-status",
  "--cached",
  "--staged",
]);

const PRETTY_FORMATS = new Set(["oneline", "short", "medium"]);

function hasShellOperator(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "$" || char === "`") return true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }
    if ("|&;><`$()\n\r".includes(char)) return true;
  }
  return false;
}

function splitCommand(text) {
  return (text.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((token) => {
    if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
    return token;
  });
}

function isAllowedFlag(token, allowed) {
  if (!token.startsWith("-") || token === "-" || token === "--") return true;
  const name = token.split("=")[0];
  if (allowed.has(name)) return true;
  return /^-\d+$/.test(token);
}

function isGitLogCommand(args) {
  for (const token of args) {
    if (token === "--pretty" || token === "--format") return false;
    if (token.startsWith("--pretty=") || token.startsWith("--format=")) {
      if (!PRETTY_FORMATS.has(token.split("=")[1])) return false;
      continue;
    }
    if (!isAllowedFlag(token, GIT_LOG_FLAGS)) return false;
  }
  return true;
}

function isGitDiffCommand(args) {
  if (!args.some((token) => token === "--name-only" || token === "--name-status")) return false;
  return args.every((token) => isAllowedFlag(token, GIT_DIFF_FLAGS));
}

function isFindCommand(args) {
  return args.every((token) => {
    if (!token.startsWith("-")) return true;
    return !FIND_ACTION_FLAGS.some((flag) => token.startsWith(flag));
  });
}

export function isNameOnlyCommand(command) {
  const text = String(command ?? "").trim();
  if (text.length === 0 || hasShellOperator(text)) return false;
  const tokens = splitCommand(text);
  const program = tokens[0];
  const args = tokens.slice(1);
  if (program === "ls") return true;
  if (program === "tree") {
    return !args.some((token) => token === "--fromfile" || token.startsWith("--fromfile="));
  }
  if (program === "git") {
    const subcommand = tokens[1];
    const rest = tokens.slice(2);
    if (subcommand === "status" || subcommand === "branch") return true;
    if (subcommand === "log") return isGitLogCommand(rest);
    if (subcommand === "diff") return isGitDiffCommand(rest);
    return false;
  }
  if (program === "find") return isFindCommand(args);
  return false;
}

function resolveRealPath(path) {
  const lexical = resolve(path);
  try {
    return realpathSync(lexical);
  } catch {
    return lexical;
  }
}

export function toRepoRelativePath(path, repoRoot) {
  const root = resolveRealPath(repoRoot);
  const target = resolveRealPath(isAbsolute(path) ? path : join(repoRoot, path));
  const relativePath = relative(root, target);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null;
  return relativePath;
}

export function isPathInsideRepo(path, repoRoot) {
  const root = resolveRealPath(repoRoot);
  const target = resolveRealPath(isAbsolute(path) ? path : join(repoRoot, path));
  return target === root || target.startsWith(root + sep);
}

export function keepsReadResult(flags) {
  return !flags.outside && flags.licensed && flags.inside && (flags.tracked || flags.nameOnly);
}

export function classifyReadResult(flags) {
  const kept = keepsReadResult(flags);
  return { kept, redacted: !kept };
}

export function redactSecrets(text) {
  let cleaned = String(text);
  for (const shape of SECRET_SHAPES) {
    shape.lastIndex = 0;
    cleaned = cleaned.replace(shape, MARKER_CREDENTIAL);
  }
  return cleaned;
}

export function redactLocalPaths(text, repoRoot) {
  const root = resolve(repoRoot);
  return String(text).replace(/(^|[\s"'(\[{=:,;])(\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\/?)/g, (match, prefix, path) => {
    const target = resolve(path);
    if (target === root || target.startsWith(root + sep)) return match;
    return prefix + MARKER_LOCAL_PATH;
  });
}

export function scrubValue(value, repoRoot) {
  if (typeof value === "string") return redactLocalPaths(redactSecrets(value), repoRoot);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, repoRoot));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item, repoRoot)]));
  }
  return value;
}

export function cleanSessionEvent(event, context) {
  const { licence, repoRoot, trackedPaths } = context;
  const licensed = OSI_LICENCES.has(licence);
  const paths = Array.isArray(event.paths) ? event.paths.map(String) : [];
  const outside = paths.some((path) => !isPathInsideRepo(path, repoRoot));
  if (outside) {
    return { type: "redacted", marker: MARKER_OUTSIDE_REPO, cleaner: CLEANER_VERSION };
  }
  const inside = paths.length === 0 || paths.every((path) => isPathInsideRepo(path, repoRoot));
  const tracked = paths.length > 0 && paths.every((path) => {
    const relativePath = toRepoRelativePath(path, repoRoot);
    return relativePath !== null && trackedPaths.has(relativePath);
  });
  const nameOnly = typeof event.command === "string" && isNameOnlyCommand(event.command);
  const hasResult = typeof event.result === "string";
  const hasOutput = typeof event.output === "string";
  if (!hasResult && !hasOutput) return scrubValue(event, repoRoot);
  if (!keepsReadResult({ licensed, tracked, nameOnly, inside, outside })) {
    const redacted = { ...event };
    if (hasResult) redacted.result = MARKER_SOURCE;
    if (hasOutput) redacted.output = MARKER_SOURCE;
    return scrubValue(redacted, repoRoot);
  }
  return scrubValue(event, repoRoot);
}

export function cleanSessionText(text, context) {
  const lines = String(text).split("\n").filter((line) => line.length > 0);
  let kept = 0;
  let redacted = 0;
  const cleaned = lines.map((line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      redacted += 1;
      return JSON.stringify({ type: "redacted", marker: MARKER_SOURCE, cleaner: CLEANER_VERSION });
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      redacted += 1;
      return JSON.stringify({ type: "redacted", marker: MARKER_SOURCE, cleaner: CLEANER_VERSION });
    }
    const before = JSON.stringify(event);
    const after = cleanSessionEvent(event, context);
    if (JSON.stringify(after) !== before) redacted += 1;
    else kept += 1;
    return JSON.stringify(after);
  });
  return { text: cleaned.join("\n") + (cleaned.length > 0 ? "\n" : ""), lines: lines.length, kept, redacted };
}

export function trackedPaths(repoRoot) {
  const result = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return new Set();
  return new Set(result.stdout.split("\n").filter((line) => line.length > 0));
}

export function findSessionFile(directory, runId) {
  const marker = `slop-run:${runId}`;
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(directory, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_SESSION_BYTES) continue;
    let content;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (content.includes(marker)) return path;
  }
  return null;
}

export function exportSession(options) {
  const { runId, directory, licence, repoRoot } = options;
  const source = findSessionFile(directory, runId);
  if (source === null) throw new Error(`no session file carries the marker slop-run:${runId}`);
  const text = readFileSync(source, "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_SESSION_BYTES) throw new Error("session file exceeds the 8 MiB bound");
  const cleaned = cleanSessionText(text, { licence, repoRoot, trackedPaths: trackedPaths(repoRoot) });
  const outPath = options.out ?? join(dirname(source), `${basename(source, ".jsonl")}.cleaned.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, cleaned.text, "utf8");
  const sha256 = createHash("sha256").update(cleaned.text, "utf8").digest("hex");
  return {
    cleaner: CLEANER_VERSION,
    termsVersion: TRACE_TERMS_VERSION,
    runId,
    source,
    out: outPath,
    sha256,
    lines: cleaned.lines,
    kept: cleaned.kept,
    redacted: cleaned.redacted,
  };
}

const USAGE = `Usage: node session-export.mjs --run <id> --dir <dir> --licence <spdx> --repo <path> [--out <path>]

Finds the session file carrying the slop-run:<id> marker, cleans it locally with slop-session-cleaner-1, and writes the cleaned file for review under trace terms private-trace-v3. The raw file never leaves the machine.

Cleaning rules: a read result is kept only when the repository licence is an OSI licence, every path it names is inside the repository, and the file is tracked or the command only lists names (ls, tree, git status, git log with only listing flags, git diff --name-only, git branch, find without actions). A command that pipes, redirects, chains or substitutes another command is not name-only. An event naming a path outside the repository is replaced whole. Anything else is replaced with [REDACTED:SOURCE]. Credential shapes and absolute paths outside the repository are replaced with [REDACTED:CREDENTIAL] and [REDACTED:LOCAL_PATH]. Pattern matching never guarantees that every secret is found; inspect the cleaned file before sending it.
`;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!args.run || !args.dir || !args.licence || !args.repo) {
    process.stderr.write(USAGE);
    return 1;
  }
  try {
    const summary = exportSession({ runId: args.run, directory: args.dir, licence: args.licence, repoRoot: args.repo, out: args.out });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`session-export: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
