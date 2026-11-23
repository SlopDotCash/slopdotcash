// Local session cleaner. Runs on the contributor's machine before any upload.
// It reduces what leaves the machine; it does not promise that every secret is
// found, so the contributor sees the cleaned file before it is sent.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
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
const URL_CREDENTIALS =
  /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

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
  const user =
    ctx.userName && ctx.userName.length >= 3
      ? new RegExp(`(?<![\\w-])${escapeRegExp(ctx.userName)}(?![\\w-])`, "g")
      : null;
  return (text) => {
    let s = text;
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
    if (user) {
      s = s.replace(user, () => {
        bump(counts, "LOCAL_PATH");
        return LOCAL_PATH;
      });
    }
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
      const args = contentTool ? dropContent(e.args, ctx, counts) : e.args;
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

function candidateFiles(homeDir) {
  const found = [];
  const claude = join(homeDir, ".claude", "projects");
  for (const d of listDir(claude))
    if (d.isDirectory())
      for (const f of listDir(join(claude, d.name)))
        if (f.isFile() && f.name.endsWith(".jsonl"))
          found.push({
            path: join(claude, d.name, f.name),
            client: "claude-code",
          });
  const walk = (dir) => {
    for (const d of listDir(dir)) {
      const full = join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (
        d.isFile() &&
        d.name.startsWith("rollout-") &&
        d.name.endsWith(".jsonl")
      )
        found.push({ path: full, client: "codex" });
    }
  };
  walk(join(homeDir, ".codex", "sessions"));
  return found;
}

export function findSessionFile(marker, opts) {
  if (!marker) return null;
  const files = [];
  for (const c of candidateFiles(opts.homeDir)) {
    try {
      files.push({ ...c, mtime: statSync(c.path).mtimeMs });
    } catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files) {
    try {
      const text = readFileSync(f.path, "utf8");
      if (!text.includes(marker)) continue;
      const read = f.client === "claude-code" ? readClaudeCode : readCodex;
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      if (read(lines, marker).length > 0)
        return { path: f.path, client: f.client };
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

export function readClaudeCode(lines, marker) {
  const items = [];
  for (const r of parseLines(lines)) {
    if (!r || r.isSidechain === true) continue;
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

function git(repoRoot, args, input) {
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
export function makeRepoIndex(events, repoRoot, homeDir) {
  const root = repoRoot.replace(/\/+$/, "");
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {}
  const tracked = new Set();
  const listed = git(root, ["ls-files", "-z"]);
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
    const r = git(
      root,
      ["check-ignore", "--stdin", "-z"],
      `${rels.join("\0")}\0`,
    );
    if (r && r.status === 0)
      for (const rel of r.stdout.toString("utf8").split("\0"))
        if (rel) ignored.add(`${root}/${rel}`);
  }
  const gx = { repoRoot: root, realRoot };
  return {
    root,
    realRoot,
    written,
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

export function addSecretStrings(text, into) {
  for (const line of text.split(/\r?\n/)) {
    const clean = (v) =>
      v
        .trim()
        .replace(/^["']+/, "")
        .replace(/["',;]+$/, "");
    const t = line.trim();
    if (t.length >= 8) into.add(t);
    const whole = clean(line);
    if (whole.length >= 8) into.add(whole);
    for (const sep of ["=", ":"]) {
      const i = line.indexOf(sep);
      if (i < 0) continue;
      const v = clean(line.slice(i + 1));
      if (v.length >= 8) into.add(v);
    }
    // Pieces, so inline comments, one-line JSON, YAML, .netrc and bare tokens
    // are caught. Ordinary words over-redact; that is accepted.
    for (const m of line.matchAll(URL_USERINFO))
      for (const part of [m[1], m[2]])
        if (part && part.length >= 8) into.add(part);
    for (const piece of line.split(SECRET_SPLIT))
      if (piece.length >= 8 && /[\p{L}\p{N}]/u.test(piece)) into.add(piece);
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

export function collectKnownSecrets(index, homeDir) {
  const strings = new Set();
  let capped = false;
  // Home credential files first, so a cap never drops their strings.
  for (const f of HOME_SECRET_FILES) {
    if (!homeDir) break;
    const text = readSmallText(join(homeDir, f));
    if (text !== null) addSecretStrings(text, strings);
  }
  const listed = git(index.root, ["ls-files", "-z", "-o"]);
  // A file the run wrote is skipped only when it is not gitignored: an edited
  // .env still holds secrets a tracked script may print.
  const ignored = new Set();
  const ign = git(index.root, [
    "ls-files",
    "-z",
    "-o",
    "-i",
    "--exclude-standard",
  ]);
  if (ign && ign.status === 0)
    for (const rel of ign.stdout.toString("utf8").split("\0"))
      if (rel) ignored.add(`${index.root}/${rel}`);
  if (listed && listed.status === 0) {
    let files = 0;
    const budget = { left: MAX_GUARD_TOTAL_BYTES, over: false };
    for (const rel of listed.stdout.toString("utf8").split("\0")) {
      if (!rel) continue;
      const dirs = rel.split("/").slice(0, -1);
      if (dirs.some((seg) => SKIP_DIRS.has(seg))) continue;
      const abs = `${index.root}/${rel}`;
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
  if (/[*?[\]{}\\]/.test(cmd)) return true;
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

function commandTouches(cmd, g, base) {
  let verdict = "ok";
  for (const raw of cmd.split(/[\s;&|<>()"'`=,]+/).slice(0, 400)) {
    if (!raw || raw.startsWith("-")) continue;
    if (SAFE_ABSOLUTE.has(raw)) continue;
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
      } else if (!call) {
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

function readPathFor(input) {
  if (!input || typeof input !== "object") return undefined;
  for (const k of PATH_KEYS) if (typeof input[k] === "string") return input[k];
  return undefined;
}

export async function exportSession(opts) {
  const fallback = {
    path: opts.outPath,
    source: "fallback-needed",
    counts: {},
    licence: null,
  };
  const found = findSessionFile(opts.marker, { homeDir: opts.homeDir });
  if (!found) return fallback;
  let lines;
  try {
    lines = readFileSync(found.path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
  } catch {
    return fallback;
  }
  const read = found.client === "claude-code" ? readClaudeCode : readCodex;
  const raw = read(lines, opts.marker);
  if (raw.length === 0) return fallback;
  const licence = await repoLicence(opts.repo, opts.fetchImpl);
  const keepRepoFiles = licence !== null && OSI_LICENCES.has(licence);
  const userName =
    opts.env?.USER || opts.env?.LOGNAME || basename(opts.homeDir || "");
  const index = makeRepoIndex(raw, opts.repoRoot, opts.homeDir);
  const known = collectKnownSecrets(index, opts.homeDir);
  const isRepoFile = keepRepoFiles ? index.isRepoFile : () => false;
  const repoRoot = index.root;
  const guarded = guardEvents(raw, {
    repoRoot,
    realRoot: index.realRoot,
    homeDir: opts.homeDir,
    keepRepoFiles,
    isRepoFile,
    capped: known.capped,
  });
  const { events, counts } = cleanEvents(guarded, {
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
    source: "client-file",
    client: opts.client,
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
    counts,
    rules: RULES_URL,
  };
  const all = [header, ...events].map((o) => JSON.stringify(o));
  const fitted = truncateToLimit(all, LIMIT_BYTES);
  if (fitted === null) return fallback;
  mkdirSync(dirname(opts.outPath), { recursive: true });
  writeFileSync(opts.outPath, `${fitted.lines.join("\n")}\n`);
  return { path: opts.outPath, source: "client-file", counts, licence };
}
