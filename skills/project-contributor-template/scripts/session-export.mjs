// Local session cleaner. Runs on the contributor's machine before any upload.
// It reduces what leaves the machine; it does not promise that every secret is
// found, so the contributor sees the cleaned file before it is sent.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  globSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLEANER_VERSION = "slop-session-cleaner-1";

export const OSI_LICENCES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "EPL-2.0",
  "Unlicense",
  "0BSD",
  "Zlib",
  "BSL-1.0",
]);

const CREDENTIAL = "[REDACTED:CREDENTIAL]";
const SOURCE = "[REDACTED:SOURCE]";
const LOCAL_PATH = "[REDACTED:LOCAL_PATH]";
const OUTSIDE_REPO = "[REDACTED:OUTSIDE_REPO]";

const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  /\b(?:mnemonic|seed phrase|recovery phrase)\b\s*[:=]\s*(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi,
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{0,40}(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key)[A-Za-z0-9_-]{0,40}["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/gi,
  /(?<!-)--[A-Za-z0-9_-]{0,40}(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key)[A-Za-z0-9_-]{0,40}\s+["']?[A-Za-z0-9._~+/=-]{12,}/gi,
];
// user:password@, or a token alone of 16 or more characters (as `git remote
// -v` prints it). The lookbehind starts a scheme only at a run's first
// character, so long input is scanned in linear time.
const URL_CREDENTIALS =
  /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/)(?:[^\s/@:]+:[^\s/@]+|[^\s/@:]{16,})@/gi;

const SAFE_ABSOLUTE = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);
// An absolute path with at least two segments, not part of a URL or a word.
const ABSOLUTE_PATH = /(?<![\w./:~@%-])\/(?:[\w.@+~-]+\/)+[\w.@+~-]+/g;
const TILDE_PATH = /(?<![\w./:~@%-])~\/[\w.@+~/-]*/g;
const WINDOWS_PATH =
  /(?<![\w])[A-Za-z]:[\\/][^\s"'`<>|*?]*|(?<![\w\\])\\\\[\w.$-]+\\[^\s"'`<>|*?]*/g;
const ALLOWED_FIELDS = ["t", "kind", "text", "tool", "args", "path"];
const CONTENT_TOOL = /edit|write|patch|create|replace/i;
const PATH_KEYS = new Set([
  "file_path",
  "path",
  "filePath",
  "notebook_path",
  "filename",
  "file",
]);

function bump(counts, key, n = 1) {
  if (n > 0) counts[key] = (counts[key] ?? 0) + n;
}

function insideRepo(abs, repoRoot) {
  return abs === repoRoot || abs.startsWith(`${repoRoot}/`);
}

function expandTilde(p, homeDir) {
  if (p === "~") return homeDir || p;
  return p.startsWith("~/") && homeDir ? `${homeDir}/${p.slice(2)}` : p;
}

// Lexically normalise, expanding ~ and treating backslashes as separators.
function normalise(p, repoRoot, homeDir) {
  const flat = expandTilde(p, homeDir).replace(/\\/g, "/");
  return resolve(
    isAbsolute(flat) || /^[A-Za-z]:\//.test(flat)
      ? flat
      : `${repoRoot}/${flat}`,
  );
}

function isOutside(p, repoRoot, homeDir) {
  return !insideRepo(normalise(p, repoRoot, homeDir), repoRoot);
}

function* strings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      yield k;
      yield* strings(v);
    }
}

function hasOutsidePath(value, repoRoot, homeDir) {
  for (const s of strings(value)) {
    for (const m of s.matchAll(ABSOLUTE_PATH)) {
      if (SAFE_ABSOLUTE.has(m[0])) continue;
      if (isOutside(m[0], repoRoot, homeDir)) return true;
    }
    for (const re of [TILDE_PATH, WINDOWS_PATH])
      for (const m of s.matchAll(re))
        if (isOutside(m[0], repoRoot, homeDir)) return true;
  }
  return false;
}

function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[fn(k)] = mapStrings(v, fn);
    return out;
  }
  return value;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Scans text once, whatever the number of known strings: candidates are looked
// up by their first eight characters.
function makeKnownMatcher(list) {
  const byPrefix = new Map();
  const first = new Uint8Array(65536);
  for (const k of list ?? []) {
    if (typeof k !== "string" || k.length < 8) continue;
    const p = k.slice(0, 8);
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(k);
    first[k.charCodeAt(0)] = 1;
  }
  for (const arr of byPrefix.values()) arr.sort((a, b) => b.length - a.length);
  if (byPrefix.size === 0) return null;
  return (s, onHit) => {
    let parts = null;
    let last = 0;
    for (let i = 0; i <= s.length - 8; i++) {
      if (first[s.charCodeAt(i)] === 0) continue;
      const cands = byPrefix.get(s.slice(i, i + 8));
      if (!cands) continue;
      const hit = cands.find((k) => s.startsWith(k, i));
      if (hit === undefined) continue;
      if (parts === null) parts = [];
      parts.push(s.slice(last, i), CREDENTIAL);
      last = i + hit.length;
      i = last - 1;
      onHit();
    }
    return parts === null ? s : parts.join("") + s.slice(last);
  };
}

// A home folder with one of these names says nothing about its owner and the
// word is common, so it is not removed as a name.
const GENERIC_HOME_NAMES = new Set([
  "home",
  "root",
  "user",
  "users",
  "tmp",
  "var",
  "private",
]);

function makeStringCleaner(ctx, counts) {
  const known = makeKnownMatcher(ctx.knownSecrets);
  const values = [
    ...new Set(
      Object.values(ctx.env ?? {}).filter(
        (v) =>
          typeof v === "string" &&
          v.length >= 8 &&
          !v.startsWith("/") &&
          !v.startsWith("~") &&
          v !== ctx.userName &&
          v !== ctx.homeDir,
      ),
    ),
  ].sort((a, b) => b.length - a.length);
  const repo = ctx.repoRoot.replace(/\/+$/, "");
  const home = (ctx.homeDir ?? "").replace(/\/+$/, "");
  // Claude Code names folders after a path with every other character as a
  // hyphen (/Users/x becomes -Users-x), so a name is bounded by
  // non-alphanumerics only.
  const homeSlug =
    home && home !== "/"
      ? new RegExp(
          `${escapeRegExp(home.replace(/[^A-Za-z0-9]/g, "-"))}(?![A-Za-z0-9])`,
          "g",
        )
      : null;
  const names = [
    ...new Set(
      [ctx.userName, basename(home)].filter(
        (n) =>
          typeof n === "string" && n.length >= 3 && !GENERIC_HOME_NAMES.has(n),
      ),
    ),
  ];
  const user =
    names.length > 0
      ? new RegExp(
          `(?<![A-Za-z0-9])(?:${names.map(escapeRegExp).join("|")})(?![A-Za-z0-9])`,
          "g",
        )
      : null;
  const local = () => {
    bump(counts, "LOCAL_PATH");
    return LOCAL_PATH;
  };
  return (text) => {
    let s = text;
    // Paths first: a secret that is also part of the repository path must
    // not stop the path becoming repo-relative.
    s = s.replace(ABSOLUTE_PATH, (p) => {
      const n = normalise(p, repo, home);
      if (n === repo) return ".";
      if (n.startsWith(`${repo}/`)) return n.slice(repo.length + 1);
      return p;
    });
    if (home && home !== "/") {
      const parts = s.split(home);
      if (parts.length > 1) {
        bump(counts, "LOCAL_PATH", parts.length - 1);
        s = parts.join(LOCAL_PATH);
      }
    }
    if (homeSlug) s = s.replace(homeSlug, local);
    for (const v of values) {
      const parts = s.split(v);
      if (parts.length > 1) {
        bump(counts, "CREDENTIAL", parts.length - 1);
        s = parts.join(CREDENTIAL);
      }
    }
    if (known) s = known(s, () => bump(counts, "CREDENTIAL"));
    for (const re of SECRET_SHAPES) {
      s = s.replace(re, () => {
        bump(counts, "CREDENTIAL");
        return CREDENTIAL;
      });
    }
    s = s.replace(URL_CREDENTIALS, (_m, scheme) => {
      bump(counts, "CREDENTIAL");
      return `${scheme}${CREDENTIAL}@`;
    });
    // The bare name last, so a secret that contains it is still matched
    // whole above.
    if (user) s = s.replace(user, local);
    return s;
  };
}

function keepsSource(p, ctx) {
  if (!ctx.keepRepoFiles) return false;
  const abs = normalise(p, ctx.repoRoot, ctx.homeDir);
  return insideRepo(abs, ctx.repoRoot) && ctx.isRepoFile(abs) === true;
}

function dropContent(args, ctx, counts) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  const target = Object.entries(args).find(
    ([k, v]) => PATH_KEYS.has(k) && typeof v === "string",
  );
  if (target && keepsSource(target[1], ctx)) return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (PATH_KEYS.has(k) || v === undefined || v === null) out[k] = v;
    else {
      out[k] = SOURCE;
      bump(counts, "SOURCE");
    }
  }
  return out;
}

// Keeps the tool name and argument keys; every value becomes SOURCE.
function redactArgValues(args, counts) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    bump(counts, "SOURCE");
    return SOURCE;
  }
  const out = {};
  for (const k of Object.keys(args)) {
    out[k] = SOURCE;
    bump(counts, "SOURCE");
  }
  return out;
}

export function cleanEvents(events, ctx) {
  const counts = {};
  const repo = ctx.repoRoot.replace(/\/+$/, "");
  const cleanString = makeStringCleaner(ctx, counts);
  const out = [];
  for (const original of events) {
    const e = {};
    for (const k of ALLOWED_FIELDS)
      if (original[k] !== undefined) e[k] = original[k];
    const outside =
      original.redactOutside === true ||
      hasOutsidePath(
        [e.text, e.args, e.path].filter((x) => x !== undefined),
        repo,
        ctx.homeDir,
      ) ||
      (typeof e.path === "string" && isOutside(e.path, repo, ctx.homeDir));
    if (outside) {
      bump(counts, "OUTSIDE_REPO");
      if (e.text !== undefined) e.text = OUTSIDE_REPO;
      if (e.args !== undefined) e.args = OUTSIDE_REPO;
      if (e.path !== undefined) e.path = OUTSIDE_REPO;
      out.push(e);
      continue;
    }
    const readPath =
      e.kind === "tool_result" && typeof e.path === "string" ? e.path : null;
    const stripSource =
      e.kind === "tool_result" &&
      (original.redactSource === true ||
        (readPath !== null && !keepsSource(readPath, ctx)));
    const contentTool =
      e.kind === "tool_call" &&
      typeof e.tool === "string" &&
      CONTENT_TOOL.test(e.tool);
    if (e.text !== undefined) e.text = cleanString(String(e.text));
    if (e.args !== undefined) {
      const args =
        original.redactArgs === true
          ? redactArgValues(e.args, counts)
          : contentTool
            ? dropContent(e.args, ctx, counts)
            : e.args;
      e.args = mapStrings(args, (s) => (s === SOURCE ? s : cleanString(s)));
    }
    if (e.path !== undefined) e.path = cleanString(String(e.path));
    if (stripSource) {
      e.text = SOURCE;
      bump(counts, "SOURCE");
    }
    out.push(e);
  }
  return { events: out, counts };
}

const HEAD_BYTES = 32 * 1024;
const TAIL_BYTES = 8 * 1024;

function byteLength(lines) {
  let n = 0;
  for (const l of lines) n += Buffer.byteLength(l) + 1;
  return n;
}

function shorten(line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  if (e?.kind !== "tool_result" || typeof e.text !== "string") return null;
  const buf = Buffer.from(e.text);
  if (buf.length <= HEAD_BYTES + TAIL_BYTES) return null;
  const omitted = buf.length - HEAD_BYTES - TAIL_BYTES;
  e.text = `${buf.subarray(0, HEAD_BYTES).toString()}\n[TRUNCATED:${omitted}]\n${buf.subarray(buf.length - TAIL_BYTES).toString()}`;
  return JSON.stringify(e);
}

export function truncateToLimit(lines, limitBytes) {
  let total = byteLength(lines);
  if (total <= limitBytes) return { lines: [...lines], truncated: 0 };
  const out = [...lines];
  const order = out
    .map((l, i) => [Buffer.byteLength(l), i])
    .sort((a, b) => b[0] - a[0]);
  let truncated = 0;
  for (const [, i] of order) {
    const next = shorten(out[i]);
    if (next === null) continue;
    total += Buffer.byteLength(next) - Buffer.byteLength(out[i]);
    out[i] = next;
    truncated += 1;
    if (total <= limitBytes) return { lines: out, truncated };
  }
  return null;
}

// ---- Reading half: find the client's own session file and read it through an
// allowlist. Only the fields named here are copied; anything else, including
// thinking blocks and records this code does not know, never leaves the file.

export const RULES_URL = "https://slop.cash/protocol/private-trace-v3.md";
const LIMIT_BYTES = 8 * 1024 * 1024;
const READ_TOOL = /^(?:read|notebookread|view|readfile|read_file|cat)$/i;

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Only Claude Code session files are read. Codex clients write the log
// themselves and pass --log; readCodex stays for when one real Codex rollout
// has been checked against it. A run made by a subagent lives in
// <project>/<session>/subagents/*.jsonl, where every record is a sidechain.
function candidateFiles(homeDir) {
  const found = [];
  const claude = join(homeDir, ".claude", "projects");
  const add = (dir, sidechain) => {
    for (const f of listDir(dir))
      if (f.isFile() && f.name.endsWith(".jsonl"))
        found.push({
          path: join(dir, f.name),
          client: "claude-code",
          sidechain,
        });
  };
  for (const d of listDir(claude)) {
    if (!d.isDirectory()) continue;
    const project = join(claude, d.name);
    add(project, false);
    for (const s of listDir(project)) {
      if (!s.isDirectory()) continue;
      add(join(project, s.name), true);
      add(join(project, s.name, "subagents"), true);
    }
  }
  return found;
}

const SEARCH_CHUNK_BYTES = 1024 * 1024;
// Allows for coarse file-system timestamps when comparing with the run start.
const MTIME_SLACK_MS = 5000;

// Reads the file in chunks and stops at the first match, so a large file
// without the marker is never held in memory whole.
export function fileContains(path, needle, chunkBytes = SEARCH_CHUNK_BYTES) {
  const target = Buffer.from(needle);
  if (target.length === 0) return true;
  const keep = target.length - 1;
  const buf = Buffer.alloc(chunkBytes + keep);
  let fd;
  try {
    fd = openSync(path, "r");
    let carried = 0;
    for (;;) {
      const n = readSync(fd, buf, carried, chunkBytes, null);
      if (n === 0) return false;
      const end = carried + n;
      if (buf.subarray(0, end).includes(target)) return true;
      carried = Math.min(keep, end);
      buf.copy(buf, 0, end - carried, end);
    }
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function findSessionFile(marker, opts) {
  if (!marker) return null;
  const since =
    typeof opts.startedAt === "string" ? Date.parse(opts.startedAt) : NaN;
  const files = [];
  for (const c of candidateFiles(opts.homeDir)) {
    try {
      const mtime = statSync(c.path).mtimeMs;
      // A file not written since the run began cannot hold its session.
      if (!Number.isNaN(since) && mtime < since - MTIME_SLACK_MS) continue;
      files.push({ ...c, mtime });
    } catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files) {
    try {
      if (!fileContains(f.path, marker)) continue;
      const lines = readFileSync(f.path, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "");
      if (readClaudeCode(lines, marker, { sidechain: f.sidechain }).length > 0)
        return { path: f.path, client: f.client, sidechain: f.sidechain };
    } catch {}
  }
  return null;
}

function parseLines(lines) {
  return lines.map((l) => {
    try {
      const o = JSON.parse(l);
      return o && typeof o === "object" ? o : null;
    } catch {
      return null;
    }
  });
}

const ISO_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const START_COMMAND = /run-receipt\.mjs["']?\s+start\b/;
const END_COMMAND = /run-receipt\.mjs["']?\s+(?:session|export)\b/;

function isoTime(t) {
  return typeof t === "string" &&
    ISO_TIME.test(t) &&
    !Number.isNaN(Date.parse(t))
    ? t
    : undefined;
}

export function commandText(args) {
  if (!args || typeof args !== "object") return "";
  const c = args.command ?? args.cmd;
  if (Array.isArray(c)) {
    // Codex runs ["bash", "-lc", "<script>"]: analyse the script itself.
    if (
      c.length === 3 &&
      c.every((x) => typeof x === "string") &&
      /^(?:ba|z|da|k)?sh$/.test(c[0]) &&
      /^-[a-z]*c$/.test(c[1])
    )
      return c[2];
    return c.filter((x) => typeof x === "string").join(" ");
  }
  return typeof c === "string" ? c : "";
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function readPathOf(name, input) {
  if (typeof name !== "string" || !READ_TOOL.test(name)) return undefined;
  if (!input || typeof input !== "object") return undefined;
  for (const k of PATH_KEYS) if (typeof input[k] === "string") return input[k];
  return undefined;
}

// items: {kind, t, cwd, text?, tool?, args?, callId?} in file order. The
// session starts at the result of the start command that printed the marker
// and ends before the first session or export command. Internal fields
// (cwd, call) are used by exportSession and never written out.
function windowItems(items, marker) {
  const calls = new Map();
  let started = false;
  const events = [];
  for (const it of items) {
    if (it.kind === "tool_call" && typeof it.callId === "string")
      calls.set(it.callId, { name: it.tool, input: it.args });
    if (!started) {
      if (it.kind !== "tool_result" || !it.text?.includes(marker)) continue;
      const call = calls.get(it.callId);
      if (!START_COMMAND.test(commandText(call?.input))) continue;
      started = true;
    } else if (
      it.kind === "tool_call" &&
      END_COMMAND.test(commandText(it.args))
    )
      break;
    const e = { kind: it.kind };
    const t = isoTime(it.t);
    if (t !== undefined) e.t = t;
    if (it.text !== undefined) e.text = it.text;
    if (it.kind === "tool_call") {
      if (typeof it.tool !== "string" || !TOOL_NAME.test(it.tool)) continue;
      e.tool = it.tool;
      e.args = it.args;
    } else if (it.kind === "tool_result") {
      const call = calls.get(it.callId);
      if (call && !(typeof call.name === "string" && TOOL_NAME.test(call.name)))
        continue;
      if (call) {
        e.tool = call.name;
        e.call = call;
        const path = readPathOf(call.name, call.input);
        if (path !== undefined) e.path = path;
      }
    }
    if (it.cwd !== undefined) e.cwd = it.cwd;
    events.push(e);
  }
  return started ? events : [];
}

// A main session file skips sidechain records (a subagent's own work); a
// subagent's file is read with `sidechain`, since all its records are.
export function readClaudeCode(lines, marker, { sidechain = false } = {}) {
  const items = [];
  for (const r of parseLines(lines)) {
    if (!r || (r.isSidechain === true && !sidechain)) continue;
    if (r.type !== "user" && r.type !== "assistant") continue;
    const content = r.message?.content;
    const t = r.timestamp;
    const cwd = typeof r.cwd === "string" ? r.cwd : undefined;
    if (typeof content === "string") {
      if (r.type === "user" && r.isMeta !== true)
        items.push({ kind: "user", t, cwd, text: content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") {
        if (r.isMeta !== true)
          items.push({ kind: r.type, t, cwd, text: b.text });
      } else if (b.type === "tool_use" && r.type === "assistant") {
        items.push({
          kind: "tool_call",
          t,
          cwd,
          tool: b.name,
          args: b.input,
          callId: b.id,
        });
      } else if (b.type === "tool_result" && r.type === "user") {
        items.push({
          kind: "tool_result",
          t,
          cwd,
          text: resultText(b.content),
          callId: b.tool_use_id,
        });
      }
    }
  }
  return windowItems(items, marker);
}

const CODEX_HARNESS_TEXT =
  /^\s*(?:<environment_context>|<user_instructions>|# AGENTS\.md)/;

function codexText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b) =>
        b &&
        (b.type === "input_text" || b.type === "output_text") &&
        typeof b.text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

function codexArgs(raw) {
  if (typeof raw !== "string") return raw && typeof raw === "object" ? raw : {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : { input: raw };
  } catch {
    return { input: raw };
  }
}

// Shapes follow openai/codex: codex-rs/history RolloutLine {timestamp, type,
// payload} with ResponseItem payloads (message, function_call,
// function_call_output, custom_tool_call, custom_tool_call_output). Reasoning,
// event_msg and unknown types are not read; session_meta and turn_context are
// read only for their working directory.
export function readCodex(lines, marker) {
  const items = [];
  let cwd;
  for (const r of parseLines(lines)) {
    if (!r) continue;
    const p = r.payload;
    if (!p || typeof p !== "object") continue;
    if (r.type === "session_meta" || r.type === "turn_context") {
      if (typeof p.cwd === "string") cwd = p.cwd;
      continue;
    }
    if (r.type !== "response_item") continue;
    const t = r.timestamp;
    if (p.type === "message") {
      if (p.role !== "user" && p.role !== "assistant") continue;
      const text = codexText(p.content);
      if (p.role === "user" && CODEX_HARNESS_TEXT.test(text)) continue;
      items.push({ kind: p.role, t, cwd, text });
    } else if (p.type === "function_call" || p.type === "custom_tool_call") {
      items.push({
        kind: "tool_call",
        t,
        cwd,
        tool: p.name,
        args: codexArgs(p.type === "function_call" ? p.arguments : p.input),
        callId: p.call_id,
      });
    } else if (
      p.type === "function_call_output" ||
      p.type === "custom_tool_call_output"
    ) {
      const out = p.output;
      const text =
        typeof out === "string"
          ? out
          : Array.isArray(out)
            ? out
                .filter((b) => b && typeof b.text === "string")
                .map((b) => b.text)
                .join("\n")
            : "";
      items.push({ kind: "tool_result", t, cwd, text, callId: p.call_id });
    }
  }
  return windowItems(items, marker);
}

export async function repoLicence(repo, fetchImpl) {
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${repo}/license`,
      {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res?.ok) return null;
    const id = (await res.json())?.license?.spdx_id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export function git(repoRoot, args, input) {
  const r = spawnSync("git", ["-C", repoRoot, ...args], {
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
  return r.status === null ? null : r;
}

function writtenPaths(events) {
  const out = [];
  for (const e of events) {
    if (
      e.kind !== "tool_call" ||
      typeof e.tool !== "string" ||
      !CONTENT_TOOL.test(e.tool) ||
      !e.args ||
      typeof e.args !== "object"
    )
      continue;
    for (const k of PATH_KEYS)
      if (typeof e.args[k] === "string") out.push(e.args[k]);
  }
  return out;
}

// Built once per export: tracked files plus files this run wrote, minus
// anything .gitignore covers. Lookups afterwards are set membership.
export function makeRepoIndex(events, repoRoot, homeDir, runGit = git) {
  const root = repoRoot.replace(/\/+$/, "");
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {}
  const tracked = new Set();
  // A failed listing treats no file as tracked.
  const listed = runGit(root, ["ls-files", "-z"]);
  if (listed && listed.status === 0)
    for (const rel of listed.stdout.toString("utf8").split("\0"))
      if (rel) tracked.add(`${root}/${rel}`);
  const written = new Set();
  const candidates = new Set(tracked);
  for (const p of [...writtenPaths(events)]) {
    const abs = normalise(p, root, homeDir);
    if (insideRepo(abs, root)) {
      written.add(abs);
      candidates.add(abs);
    }
  }
  const ignored = new Set();
  const rels = [...candidates].map((a) => a.slice(root.length + 1));
  if (rels.length > 0) {
    const r = runGit(
      root,
      ["check-ignore", "--stdin", "-z"],
      `${rels.join("\0")}\0`,
    );
    if (r && r.status === 0) {
      for (const rel of r.stdout.toString("utf8").split("\0"))
        if (rel) ignored.add(`${root}/${rel}`);
    } else if (r?.status !== 1) {
      // Exit 1 means none is ignored. Anything else (128 is fatal, for
      // example a path behind a symlinked directory) fails closed: every
      // written file that is not tracked counts as ignored.
      for (const abs of written) if (!tracked.has(abs)) ignored.add(abs);
    }
  }
  const gx = { repoRoot: root, realRoot };
  const kept = () => [...tracked, ...written].filter((a) => !ignored.has(a));
  return {
    root,
    realRoot,
    written,
    // True when a tracked or run-written, non-ignored file lies under dir.
    hasFilesUnder: (dir) => {
      const prefix = `${dir.replace(/\/+$/, "")}/`;
      return kept().some((a) => a.startsWith(prefix));
    },
    isRepoFile: (abs) => {
      const a = realTarget(abs, gx);
      return (
        insideRepo(a, root) &&
        (tracked.has(a) || written.has(a)) &&
        !ignored.has(a)
      );
    },
  };
}

// ---- Content guard: strings from files that must not leave the machine.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "vendor",
  "__pycache__",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  "out",
  ".gradle",
  ".tox",
  ".pytest_cache",
  ".mypy_cache",
  ".parcel-cache",
  ".vercel",
  ".output",
]);
const HOME_SECRET_FILES = [
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".aws/credentials",
  ".config/gh/hosts.yml",
  ".docker/config.json",
  ".pypirc",
];
const MAX_GUARD_FILES = 5000;
const MAX_GUARD_STRINGS = 50000;
const MAX_GUARD_FILE_BYTES = 64 * 1024;
const MAX_GUARD_TOTAL_BYTES = 32 * 1024 * 1024;

const SECRET_SPLIT = /[\s"'`,;{}()[\]=:#@/]+/;
// The lookbehind starts a scheme only at a run's first character, so a long
// run of letters, digits and dots (minified code) is scanned once, not once
// per position.
const URL_USERINFO =
  /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/([^\s/@:]+)(?::([^\s/@]*))?@/g;

// A bare host name (github.com, api.example.co.uk) is never stored: it would
// damage every URL that names it.
const HOST_NAME = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

function addGuardString(into, v) {
  if (v && v.length >= 8 && !HOST_NAME.test(v)) into.add(v);
}

const cleanValue = (v) =>
  v
    .trim()
    .replace(/^["']+/, "")
    .replace(/["',;]+$/, "");

export function addSecretStrings(text, into) {
  for (const line of text.split(/\r?\n/)) {
    addGuardString(into, line.trim());
    addGuardString(into, cleanValue(line));
    for (const sep of ["=", ":"]) {
      const i = line.indexOf(sep);
      if (i < 0) continue;
      addGuardString(into, cleanValue(line.slice(i + 1)));
    }
    // Pieces, so inline comments, one-line JSON, YAML, .netrc and bare tokens
    // are caught. Ordinary words over-redact; that is accepted.
    for (const m of line.matchAll(URL_USERINFO))
      for (const part of [m[1], m[2]]) addGuardString(into, part);
    for (const piece of line.split(SECRET_SPLIT))
      if (/[\p{L}\p{N}]/u.test(piece)) addGuardString(into, piece);
  }
}

// Keys whose values are credentials in the home credential files. A key is
// read after its last ':' or '/', without leading underscores, lower case, so
// npm's //host/:_authToken becomes authtoken.
const CREDENTIAL_KEYS = new Set([
  "oauth_token",
  "token",
  "authtoken",
  "password",
  "secret",
  "auth",
  "aws_access_key_id",
  "aws_secret_access_key",
  "aws_session_token",
  "identitytoken",
  "registrytoken",
]);

function credentialKey(raw) {
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .split(/[:/]/)
    .pop()
    .replace(/^_+/, "")
    .toLowerCase();
}

// Home credential files hold host names, user names and settings beside the
// secrets, so only values of credential keys are stored. .netrc and
// .git-credentials also give their logins.
export function addCredentialValues(file, text, into) {
  if (file === ".netrc") {
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++)
      if (/^(?:login|password|account)$/.test(words[i]))
        addGuardString(into, words[i + 1]);
    return;
  }
  if (file.endsWith(".json")) {
    try {
      const walk = (v) => {
        if (Array.isArray(v)) for (const x of v) walk(x);
        else if (v && typeof v === "object")
          for (const [k, x] of Object.entries(v)) {
            if (typeof x === "string" && CREDENTIAL_KEYS.has(credentialKey(k)))
              addGuardString(into, x);
            else walk(x);
          }
      };
      walk(JSON.parse(text));
      return;
    } catch {}
  }
  for (const line of text.split(/\r?\n/)) {
    if (file === ".git-credentials") {
      for (const m of line.matchAll(URL_USERINFO))
        for (const part of [m[1], m[2]]) addGuardString(into, part);
      continue;
    }
    const t = line.trim();
    if (t === "" || t.startsWith("#") || t.startsWith(";")) continue;
    // npm keys hold ':' (//host/:_authToken=...); elsewhere the first of '='
    // or ':' ends the key, since base64 values hold '='.
    const eq = t.indexOf("=");
    const colon = t.indexOf(":");
    const i =
      file === ".npmrc" || colon < 0
        ? eq
        : eq < 0
          ? colon
          : Math.min(eq, colon);
    if (i <= 0) continue;
    if (!CREDENTIAL_KEYS.has(credentialKey(t.slice(0, i)))) continue;
    addGuardString(into, cleanValue(t.slice(i + 1)));
  }
}

function readSmallText(path, budget) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_GUARD_FILE_BYTES) return null;
    if (budget) {
      if (st.size > budget.left) {
        budget.over = true;
        return null;
      }
      budget.left -= st.size;
    }
    const buf = readFileSync(path);
    return buf.includes(0) ? null : buf.toString("utf8");
  } catch {
    return null;
  }
}

export function collectKnownSecrets(
  index,
  homeDir,
  skip = new Set(),
  runGit = git,
) {
  const strings = new Set();
  let capped = false;
  // Home credential files first, so a cap never drops their strings.
  for (const f of HOME_SECRET_FILES) {
    if (!homeDir) break;
    const text = readSmallText(join(homeDir, f));
    if (text !== null) addCredentialValues(f, text, strings);
  }
  const listed = runGit(index.root, ["ls-files", "-z", "-o"]);
  // A file the run wrote is skipped only when it is not gitignored: an edited
  // .env still holds secrets a tracked script may print.
  const ignored = new Set();
  const ign = runGit(index.root, [
    "ls-files",
    "-z",
    "-o",
    "-i",
    "--exclude-standard",
  ]);
  if (ign && ign.status === 0) {
    for (const rel of ign.stdout.toString("utf8").split("\0"))
      if (rel) ignored.add(`${index.root}/${rel}`);
  } else {
    // Unknown: read every written file into the guard.
    for (const abs of index.written) ignored.add(abs);
  }
  if (listed && listed.status === 0) {
    let files = 0;
    const budget = { left: MAX_GUARD_TOTAL_BYTES, over: false };
    for (const rel of listed.stdout.toString("utf8").split("\0")) {
      if (!rel) continue;
      const dirs = rel.split("/").slice(0, -1);
      if (dirs.some((seg) => SKIP_DIRS.has(seg))) continue;
      const abs = `${index.root}/${rel}`;
      if (skip.has(abs)) continue;
      if (index.written.has(abs) && !ignored.has(abs)) continue;
      if (++files > MAX_GUARD_FILES) {
        capped = true;
        break;
      }
      const text = readSmallText(abs, budget);
      if (budget.over) {
        capped = true;
        break;
      }
      if (text !== null) addSecretStrings(text, strings);
      if (strings.size > MAX_GUARD_STRINGS) {
        capped = true;
        break;
      }
    }
  }
  let list = [...strings];
  if (list.length > MAX_GUARD_STRINGS) {
    capped = true;
    list = list.slice(0, MAX_GUARD_STRINGS);
  }
  return { strings: list, capped };
}

const WRITE_TOOL = /^(?:write|edit|multiedit|notebookedit|apply_patch)$/i;
const SEARCH_TOOL = /^(?:grep|glob|search|find)$/i;
// Shell tools whose command the guard reads: Claude Code's Bash, the Codex
// shell tools and agent-written logs that name a shell.
const SHELL_TOOL =
  /^(?:bash|shell|sh|zsh|exec_command|local_shell|container\.exec|shell_command|run_shell_command|run_terminal_cmd)$/i;
// Only these tools' results can be kept, and only these tools' argument
// values are written out. Every other tool (MCP tools, web fetch and search,
// subagents, browsers) has its result and argument values replaced.
function analysedTool(tool) {
  return (
    SHELL_TOOL.test(tool) ||
    READ_TOOL.test(tool) ||
    WRITE_TOOL.test(tool) ||
    SEARCH_TOOL.test(tool)
  );
}
const SINGLE_RECEIPT =
  /^\s*(?:node(?:js)?\s+)?(?:\S*\/)?run-receipt\.mjs(?:\s+[^;&|\n\r<>`$()\\]*)?\s*$/;

let TRUSTED_RECEIPT = null;
try {
  TRUSTED_RECEIPT = realpathSync(
    join(dirname(fileURLToPath(import.meta.url)), "run-receipt.mjs"),
  );
} catch {}

// Trusted only when the one command runs this skill's own run-receipt.mjs.
function isReceiptOnly(cmd, base, g) {
  if (!SINGLE_RECEIPT.test(cmd) || /\$\(|`/.test(cmd)) return false;
  const m = /(\S*run-receipt\.mjs)/.exec(cmd);
  if (!m || TRUSTED_RECEIPT === null) return false;
  try {
    return (
      realpathSync(normalise(unquote(m[1]), base, g.homeDir)) ===
      TRUSTED_RECEIPT
    );
  } catch {
    return false;
  }
}

// A confirmation is accepted only when it is one of these exact lines for the
// call's own path argument.
function exactConfirmation(text, call) {
  const p = readPathFor(call?.input);
  if (p === undefined || p === "") return false;
  const t = text.trim();
  return [
    `File created successfully at: ${p}`,
    `File updated successfully at: ${p}`,
    `The file ${p} has been updated successfully.`,
    `The file ${p} has been created successfully.`,
    `The file ${p} has been updated.`,
    `Successfully wrote to ${p}`,
  ].includes(t);
}

const INTERPRETER =
  /^(?:python[\d.]*|pypy[\d.]*|node|nodejs|deno|bun|perl|ruby|php|lua|luajit|Rscript|R)$/;

function unquote(t) {
  return t.replace(/^["'`]+|["'`]+$/g, "");
}

const DIR_CHANGES = [
  /(?:^|[\s;&|(])(?:cd|pushd)\s+(\S+)/g,
  /\bgit\s+-C\s+(\S+)/g,
  /(?:^|\s)-C\s+(\S+)/g,
  /--(?:cwd|directory|workdir|work-tree|prefix)(?:=|\s+)(\S+)/g,
];

function dirTargets(call) {
  const cmd = commandText(call?.input);
  const targets = [];
  for (const re of DIR_CHANGES)
    for (const m of cmd.matchAll(re)) targets.push(unquote(m[1]));
  return targets;
}

// "outside": the command ran somewhere outside the repo.
function leavesRepo(call, g, base) {
  const input = call?.input;
  const cmd = commandText(input);
  const targets = dirTargets(call);
  if (/(?:^|[;&|(]\s*)(?:cd|pushd)\s*(?:$|[;&|)])/.test(cmd)) return true;
  if (typeof input?.workdir === "string") targets.push(input.workdir);
  return targets.some(
    (t) => t === "-" || /[$`]/.test(t) || isOutside(t, base, g.homeDir),
  );
}

// Anything that cannot be resolved from the command text alone, or that
// changes directory, is not analysed: the whole result is redacted.
function unresolvable(call, cwd, g) {
  const input = call?.input;
  const cmd = commandText(input);
  if (dirTargets(call).length > 0) return true;
  if (/(?:^|[\s;&|(])(?:cd|pushd|popd)\b/.test(cmd)) return true;
  if (typeof input?.workdir === "string") {
    const same =
      cwd !== undefined &&
      normalise(input.workdir, cwd, g.homeDir) ===
        normalise(cwd, cwd, g.homeDir);
    if (!same) return true;
  }
  // Braces and backslashes change words in ways the guard does not follow;
  // * ? [ ] are expanded locally (globTouches).
  if (/[{}\\]/.test(cmd)) return true;
  if (/\$\(|`|\$[A-Za-z_{'"]/.test(cmd)) return true;
  if (/(?:^|[\s;&|(])(?:xargs|eval|source)\b/.test(cmd)) return true;
  if (/(?:^|[;&|(]\s*)\.\s/.test(cmd) || /^\s*\.\s/.test(cmd)) return true;
  if (/\bfind\b/.test(cmd) && /\s-(?:exec|execdir|ok|okdir)\b/.test(cmd))
    return true;
  if (/(?:^|[\s;&|(])(?:ba|z|da|k)?sh\s+-[a-z]*c\b/.test(cmd)) return true;
  if (/(?:^|[\s;&|(])(?:rg|ag|ack|tar)\b/.test(cmd)) return true;
  const words = cmd.split(/\s+/).filter(Boolean);
  if (
    /(?:^|[\s;&|(])(?:e?grep|fgrep|cp|zip|unzip|rsync|scp|7z)\b/.test(cmd) &&
    words.some(
      (w) => /^-[A-Za-z]*[rR][A-Za-z]*$/.test(w) || w === "--recursive",
    )
  )
    return true;
  for (let i = 0; i < words.length; i++) {
    const tool = words[i].split("/").pop();
    if (!INTERPRETER.test(tool)) continue;
    for (let j = i + 1; j < words.length && words[j].startsWith("-"); j++) {
      const f = words[j];
      if (/^--(?:eval|print|exec|command)$/.test(f)) return true;
      if (/^-[A-Za-z]*[cepEn][A-Za-z]*$/.test(f)) return true;
      if (tool === "php" && /^-[A-Za-z]*r[A-Za-z]*$/.test(f)) return true;
    }
  }
  for (const word of words) {
    if (!word) continue;
    if (word.length > 1 && /["']/.test(word.slice(1, -1))) return true;
    if (word.includes(":") && !word.includes("://") && !/:$/.test(word))
      return true;
  }
  return false;
}

function realTarget(abs, g) {
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    return abs;
  }
  if (real === abs) return abs;
  const rr = g.realRoot ?? g.repoRoot;
  if (real === rr || real.startsWith(`${rr}/`))
    return g.repoRoot + real.slice(rr.length);
  return real;
}

// "dir" and "source" both make the result unresolvable.
function fileStatus(abs, g) {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return "ok";
  }
  if (st.isDirectory()) return "dir";
  if (!st.isFile()) return "ok";
  const real = realTarget(abs, g);
  if (!insideRepo(real, g.repoRoot)) return "outside";
  return g.isRepoFile(real) === true ? "ok" : "source";
}

const GLOB_CHARS = /[*?[\]]/;
const MAX_GLOB_MATCHES = 500;

// A glob word is expanded locally from the command's directory. It passes
// only when it matches at least one file and every match is a tracked or
// run-written, non-ignored file inside the repository.
function globTouches(word, g, base) {
  if (word.includes("**")) return "source";
  let matches;
  try {
    matches = globSync(expandTilde(word, g.homeDir), { cwd: base });
  } catch {
    return "source";
  }
  if (matches.length === 0 || matches.length > MAX_GLOB_MATCHES)
    return "source";
  let verdict = "ok";
  for (const m of matches) {
    const abs = resolve(base, m);
    if (!insideRepo(abs, g.repoRoot)) return "outside";
    const st = fileStatus(abs, g);
    if (st === "outside") return "outside";
    if (st !== "ok" || !isFile(abs)) verdict = "source";
  }
  return verdict;
}

function isFile(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function commandTouches(cmd, g, base) {
  let verdict = "ok";
  for (const raw of cmd.split(/[\s;&|<>()"'`=,]+/).slice(0, 400)) {
    if (!raw || raw.startsWith("-")) continue;
    if (SAFE_ABSOLUTE.has(raw)) continue;
    if (GLOB_CHARS.test(raw)) {
      const st = globTouches(raw, g, base);
      if (st === "outside") return "outside";
      if (st === "source") verdict = "source";
      continue;
    }
    const abs = normalise(raw, base, g.homeDir);
    if (
      (raw.includes("/") || raw.startsWith("~")) &&
      !insideRepo(abs, g.repoRoot)
    )
      return "outside";
    const st = fileStatus(abs, g);
    if (st === "outside") return "outside";
    if (st === "source" || st === "dir") verdict = "source";
  }
  return verdict;
}

// ---- Name-only commands: their output is names and metadata, not file
// contents, so it is kept when every path they name lies inside the
// repository. The content guard still strips secret values from it.
const PATCH_FLAG =
  /^(?:-p|-u|-c|-m|--cc|--patch.*|-U\d*|--unified.*|-L.*|--word-diff.*|--color-words.*|--ext-diff|--textconv|--full-diff|--show-signature|--notes.*|--raw)$/;
const SHORT_PATCH = /^-[A-Za-z0-9]*[pucmLU][A-Za-z0-9]*$/;
const DIFF_NAMES =
  /^--(?:stat(?:=\S*)?|numstat|shortstat|name-only|name-status)$/;
const FIND_BLOCKED =
  /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls|printf)$/;
const FIND_PATTERN =
  /^-(?:name|iname|path|ipath|wholename|iwholename|regex|iregex|lname|ilname)$/;
const PIPE_FILTER = /^(?:head|tail|wc|sort|uniq)$/;

function dirOk(abs, g) {
  const real = realTarget(abs, g);
  if (!insideRepo(real, g.repoRoot)) return false;
  return real === g.repoRoot || g.hasFilesUnder?.(real) === true;
}

// A named path may be missing (a branch or revision name), a repository
// file, or a directory holding at least one repository file.
function namedPathOk(word, g, base) {
  if (/^[~$]/.test(word)) return false;
  if (GLOB_CHARS.test(word)) return globTouches(word, g, base) === "ok";
  const abs = normalise(word, base, g.homeDir);
  if (!insideRepo(abs, g.repoRoot)) return false;
  let st;
  try {
    st = statSync(abs);
  } catch {
    return true;
  }
  if (st.isDirectory()) return dirOk(abs, g);
  return fileStatus(abs, g) === "ok";
}

function nameOnlyStage(words, g, base) {
  const tool = words[0];
  let args = words.slice(1);
  const paths = [];
  if (tool === "git") {
    if (args[0] === "--no-pager") args = args.slice(1);
    const sub = args.shift();
    const patch = args.some((a) => PATCH_FLAG.test(a) || SHORT_PATCH.test(a));
    if (sub === "log" || sub === "diff") {
      if (patch) return false;
      if (sub === "diff" && !args.some((a) => DIFF_NAMES.test(a))) return false;
    } else if (sub !== "status" && sub !== "branch") return false;
    for (const a of args) if (!a.startsWith("-")) paths.push(a);
  } else if (tool === "ls" || tool === "tree") {
    for (const a of args) if (!a.startsWith("-")) paths.push(a);
  } else if (tool === "find") {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (FIND_BLOCKED.test(a)) return false;
      if (FIND_PATTERN.test(a)) i++;
      else if (!a.startsWith("-") && a !== "!" && a !== "(" && a !== ")")
        paths.push(a);
    }
  } else return false;
  return paths.every((p) => namedPathOk(p, g, base));
}

export function nameOnlyCommand(cmd, g, base) {
  if (!dirOk(base, g)) return false;
  const c = cmd
    .replace(/\s[12]?>&[12](?=\s|$)/g, " ")
    .replace(/\s2>\s*\/dev\/null(?=\s|$)/g, " ");
  // Redirections, background jobs and subshells are not followed.
  if (/[<>()\n\r]|(?<!&)&(?!&)/.test(c)) return false;
  const statements = c.split(/&&|\|\||;/);
  for (const statement of statements) {
    const stages = statement.split("|");
    for (let i = 0; i < stages.length; i++) {
      const words = stages[i].trim().split(/\s+/).filter(Boolean).map(unquote);
      if (words.length === 0) return false;
      if (i === 0) {
        if (!nameOnlyStage(words, g, base)) return false;
      } else if (
        !PIPE_FILTER.test(words[0]) ||
        // flags and counts only: a file argument would be read
        !words.slice(1).every((w) => /^(?:-[A-Za-z]+\d*|-?\d+)$/.test(w))
      )
        return false;
    }
  }
  return true;
}

function outputTouches(text, g, base) {
  let verdict = "ok";
  for (const line of text.split("\n").slice(0, 2000)) {
    const l = line.trim();
    if (!l || l.length > 400) continue;
    const cands = [];
    if (!/\s/.test(l)) cands.push(l);
    const colon = l.indexOf(":");
    if (colon > 0) cands.push(l.slice(0, colon));
    for (const c of cands) {
      if (!/[./]/.test(c) || /\s/.test(c)) continue;
      const st = fileStatus(normalise(c, base, g.homeDir), g);
      if (st === "outside") return "outside";
      if (st === "source") verdict = "source";
    }
  }
  return verdict;
}

// Marks tool results the cleaner must redact whole, and drops entries made
// outside the repo. Fails closed: with no licence only the receipt tool's own
// output, empty results and exact write confirmations survive.
function guardEvents(events, g) {
  const out = [];
  for (const e of events) {
    if (e.cwd !== undefined && isOutside(e.cwd, g.repoRoot, g.homeDir))
      continue;
    if (
      e.kind === "tool_call" &&
      !analysedTool(typeof e.tool === "string" ? e.tool : "")
    )
      e.redactArgs = true;
    if (e.kind === "tool_result") {
      const call = e.call;
      const cmd = commandText(call?.input);
      const base = e.cwd ?? g.repoRoot;
      const tool = typeof e.tool === "string" ? e.tool : "";
      if (isReceiptOnly(cmd, base, g)) {
        // the receipt tool's own output
      } else if (!g.keepRepoFiles) {
        const t = (e.text ?? "").trim();
        const ok =
          t === "" || (WRITE_TOOL.test(tool) && exactConfirmation(t, call));
        if (!ok) e.redactSource = true;
      } else if (!call || !analysedTool(tool)) {
        e.redactSource = true;
      } else if (leavesRepo(call, g, base)) e.redactOutside = true;
      else if (e.path !== undefined) {
        // a read of one named file: the cleaner applies the file rule
      } else if (CONTENT_TOOL.test(tool)) {
        const p = readPathFor(call.input);
        if (p !== undefined) e.path = p;
        else e.redactSource = true;
      } else if (READ_TOOL.test(tool)) {
        e.redactSource = true;
      } else if (g.capped || unresolvable(call, e.cwd, g)) {
        e.redactSource = true;
      } else if (SHELL_TOOL.test(tool) && nameOnlyCommand(cmd, g, base)) {
        // names and metadata only; output that points outside still goes
        if (outputTouches(e.text ?? "", g, base) === "outside")
          e.redactOutside = true;
      } else {
        let verdict = commandTouches(cmd, g, base);
        if (SEARCH_TOOL.test(tool)) {
          const p = readPathFor(call.input);
          if (p !== undefined) {
            const st = fileStatus(normalise(p, base, g.homeDir), g);
            if (st !== "ok") verdict = st === "dir" ? "source" : st;
          }
        }
        if (verdict !== "outside")
          verdict =
            outputTouches(e.text ?? "", g, base) === "ok" ? verdict : "source";
        if (verdict === "outside") e.redactOutside = true;
        else if (verdict === "source") e.redactSource = true;
      }
    }
    out.push(e);
  }
  return out;
}

// Blocks a client injects into a user turn or a tool result: reminders and
// the output of commands the user ran in the client. They are removed whole
// before guarding, because the shell guard never sees where they came from.
const INJECTED_OPEN =
  /<(system-reminder|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr)>/g;

export function stripInjected(text) {
  if (!text.includes("<")) return text;
  let out = "";
  let from = 0;
  INJECTED_OPEN.lastIndex = 0;
  for (;;) {
    const m = INJECTED_OPEN.exec(text);
    if (m === null) break;
    out += text.slice(from, m.index);
    const close = `</${m[1]}>`;
    const end = text.indexOf(close, m.index + m[0].length);
    // An unclosed block is removed to the end of the text.
    if (end < 0) return out;
    from = end + close.length;
    INJECTED_OPEN.lastIndex = from;
  }
  return out + text.slice(from);
}

function dropInjected(events) {
  const out = [];
  for (const e of events) {
    if (
      (e.kind === "user" || e.kind === "tool_result") &&
      typeof e.text === "string"
    ) {
      const text = stripInjected(e.text);
      if (e.kind === "user" && text.trim() === "") continue;
      out.push(text === e.text ? e : { ...e, text });
    } else out.push(e);
  }
  return out;
}

function readPathFor(input) {
  if (!input || typeof input !== "object") return undefined;
  for (const k of PATH_KEYS) if (typeof input[k] === "string") return input[k];
  return undefined;
}

// Guards, cleans and writes one session. `raw` holds reader events in order;
// the header records where they came from. Returns null when the guard leaves
// no event (no session record) or the result cannot fit the size limit.
const HEADER_COUNTS_RESERVE = 512;
const MARKER = /\[REDACTED:([A-Z_]+)\]/g;

// Counts every marker in the written lines, so the header matches what a
// reader of the file sees.
export function countMarkers(lines) {
  const counts = {};
  for (const line of lines)
    for (const m of line.matchAll(MARKER)) bump(counts, m[1]);
  return counts;
}

export async function writeCleanedSession(
  raw,
  source,
  opts,
  { skip = new Set(), detectedClient = null } = {},
) {
  const licence = await repoLicence(opts.repo, opts.fetchImpl);
  const keepRepoFiles = licence !== null && OSI_LICENCES.has(licence);
  const userName =
    opts.env?.USER || opts.env?.LOGNAME || basename(opts.homeDir || "");
  const index = makeRepoIndex(raw, opts.repoRoot, opts.homeDir);
  const known = collectKnownSecrets(index, opts.homeDir, skip);
  const isRepoFile = keepRepoFiles ? index.isRepoFile : () => false;
  const repoRoot = index.root;
  const guarded = guardEvents(dropInjected(raw), {
    repoRoot,
    realRoot: index.realRoot,
    homeDir: opts.homeDir,
    keepRepoFiles,
    isRepoFile,
    hasFilesUnder: keepRepoFiles ? index.hasFilesUnder : () => false,
    capped: known.capped,
  });
  if (guarded.length === 0) return null;
  const { events } = cleanEvents(guarded, {
    repoRoot: opts.repoRoot,
    homeDir: opts.homeDir,
    userName,
    env: opts.env,
    keepRepoFiles,
    isRepoFile,
    knownSecrets: known.strings,
  });
  const header = {
    format: "slop-session-v1",
    source,
    client: opts.client,
    detectedClient,
    clientVersion: opts.clientVersion,
    provider: opts.provider,
    model: opts.model,
    repository: opts.repo,
    startCommit: opts.startCommit,
    endCommit: opts.endCommit,
    startedAt: events.find((e) => e.t !== undefined)?.t ?? null,
    endedAt: events.findLast((e) => e.t !== undefined)?.t ?? null,
    cleaner: CLEANER_VERSION,
    licence,
    repoFilesKept: keepRepoFiles,
    contentGuard: known.capped ? "capped" : "on",
    counts: {},
    rules: RULES_URL,
  };
  // The header is written last, with the markers actually left in the
  // events, so its size is reserved first.
  const reserve =
    Buffer.byteLength(JSON.stringify(header)) + HEADER_COUNTS_RESERVE;
  const fitted = truncateToLimit(
    events.map((o) => JSON.stringify(o)),
    LIMIT_BYTES - reserve,
  );
  if (fitted === null) return null;
  header.counts = countMarkers(fitted.lines);
  mkdirSync(dirname(opts.outPath), { recursive: true });
  writeFileSync(
    opts.outPath,
    `${[JSON.stringify(header), ...fitted.lines].join("\n")}\n`,
  );
  return {
    path: opts.outPath,
    source,
    counts: header.counts,
    licence,
    repoFilesKept: keepRepoFiles,
  };
}

export async function exportSession(opts) {
  const fallback = {
    path: opts.outPath,
    source: "fallback-needed",
    counts: {},
    licence: null,
  };
  const found = findSessionFile(opts.marker, {
    homeDir: opts.homeDir,
    startedAt: opts.startedAt,
  });
  if (!found) return fallback;
  let lines;
  try {
    lines = readFileSync(found.path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
  } catch {
    return fallback;
  }
  const raw = readClaudeCode(lines, opts.marker, {
    sidechain: found.sidechain === true,
  });
  if (raw.length === 0) return fallback;
  return (
    (await writeCleanedSession(raw, "client-file", opts, {
      detectedClient: found.client,
    })) ?? fallback
  );
}

// ---- Fallback: a log the agent wrote itself, one JSON event per line with
// t, kind, text, tool and args. It goes through the same allowlist, content
// guard and cleaner as a client file. Results carry no call, so the guard
// treats every non-empty tool result as source.
const AGENT_LOG_MAX_BYTES = 64 * 1024 * 1024;
const AGENT_KINDS = new Set(["user", "assistant", "tool_call", "tool_result"]);

export function readAgentLog(lines) {
  const events = [];
  for (const r of parseLines(lines)) {
    if (!r || Array.isArray(r) || !AGENT_KINDS.has(r.kind)) continue;
    const e = { kind: r.kind };
    const t = isoTime(r.t);
    if (t !== undefined) e.t = t;
    if (typeof r.text === "string") e.text = r.text;
    if (r.kind === "tool_call") {
      if (typeof r.tool !== "string" || !TOOL_NAME.test(r.tool)) continue;
      e.tool = r.tool;
      if (r.args !== undefined) e.args = r.args;
    } else if (r.kind === "tool_result") {
      if (typeof r.tool === "string" && TOOL_NAME.test(r.tool)) e.tool = r.tool;
      if (e.text === undefined) e.text = "";
    } else if (e.text === undefined) continue;
    events.push(e);
  }
  return events;
}

export async function exportAgentLog(opts) {
  const unavailable = {
    path: opts.outPath,
    source: "unavailable",
    counts: {},
    licence: null,
  };
  let text;
  let logReal;
  try {
    logReal = realpathSync(resolve(opts.logPath));
    const st = statSync(logReal);
    if (!st.isFile() || st.size === 0 || st.size > AGENT_LOG_MAX_BYTES)
      return unavailable;
    text = readFileSync(logReal, "utf8");
  } catch {
    return unavailable;
  }
  const raw = readAgentLog(text.split("\n").filter((l) => l.trim() !== ""));
  if (raw.length === 0) return unavailable;
  // The log itself is not a secret source: a copy inside the repository
  // would otherwise turn every line it holds into a redaction.
  const skip = new Set([logReal, resolve(opts.logPath)]);
  return (
    (await writeCleanedSession(raw, "agent-written", opts, { skip })) ??
    unavailable
  );
}
