import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
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

export function isNameOnlyCommand(command) {
  const text = String(command ?? "").trim();
  if (text === "ls" || text.startsWith("ls ")) return true;
  if (text === "tree" || text.startsWith("tree ")) return true;
  if (text === "git status" || text.startsWith("git status ")) return true;
  if (text === "git branch" || text.startsWith("git branch ")) return true;
  if (text === "git log" || text.startsWith("git log ")) {
    return !/(?:^|\s)(?:-p|--patch)(?:\s|$)/.test(text);
  }
  if (text === "git diff" || text.startsWith("git diff ")) {
    return /(?:^|\s)--name-only(?:\s|$)/.test(text) || /(?:^|\s)--name-status(?:\s|$)/.test(text);
  }
  if (text === "find" || text.startsWith("find ")) {
    return !/(?:^|\s)(?:-exec|-delete|-print0)(?:\s|$)/.test(text);
  }
  return false;
}

export function isPathInsideRepo(path, repoRoot) {
  const root = resolve(repoRoot);
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
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
  return String(text).replace(/(?:\/[A-Za-z0-9._-]+)+\/?/g, (match) => {
    const target = resolve(match);
    return target === root || target.startsWith(root + sep) ? match : MARKER_LOCAL_PATH;
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
  const tracked = paths.length > 0 && paths.every((path) => trackedPaths.has(path));
  const nameOnly = typeof event.command === "string" && isNameOnlyCommand(event.command);
  const resultField = typeof event.result === "string" ? "result" : typeof event.output === "string" ? "output" : null;
  if (resultField === null) return scrubValue(event, repoRoot);
  if (!keepsReadResult({ licensed, tracked, nameOnly, inside, outside })) {
    return scrubValue({ ...event, [resultField]: MARKER_SOURCE }, repoRoot);
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

Cleaning rules: a read result is kept only when the repository licence is an OSI licence, every path it names is inside the repository, and the file is tracked or the command only lists names (ls, tree, git status, git log without a patch, git diff --name-only, git branch, find without actions). An event naming a path outside the repository is replaced whole. Anything else is replaced with [REDACTED:SOURCE]. Credential shapes and absolute paths outside the repository are replaced with [REDACTED:CREDENTIAL] and [REDACTED:LOCAL_PATH]. Pattern matching never guarantees that every secret is found; inspect the cleaned file before sending it.
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
