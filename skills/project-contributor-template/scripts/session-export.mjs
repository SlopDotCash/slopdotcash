// Local session cleaner. Runs on the contributor's machine before any upload.
// It reduces what leaves the machine; it does not promise that every secret is
// found, so the contributor sees the cleaned file before it is sent.
import { isAbsolute, resolve } from "node:path";

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
    for (const v of Object.values(value)) yield* strings(v);
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
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeStringCleaner(ctx, counts) {
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
    const stripSource = readPath !== null && !keepsSource(readPath, ctx);
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
