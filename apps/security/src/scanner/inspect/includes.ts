// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"
import type { ScanInputFile } from "./model.ts";
import { CMAKE_SOURCE, GYP_SOURCE } from "./surfaces.ts";

type GypLiteral =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "list"; readonly items: GypLiteral[] }
  | { readonly kind: "tuple"; readonly items: GypLiteral[] }
  | { readonly kind: "unresolved" };

const unresolvedLiteral: GypLiteral = { kind: "unresolved" };

/** @throws {never} */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** @throws {never} */
function gypIncludeSpecifiers(text: string): { paths: string[]; unresolved: boolean } {
  const paths: string[] = [];
  let unresolved = false;
  const n = text.length;
  let i = 0;

  const isQuote = (char: string | undefined): char is "'" | '"' => char === "'" || char === '"';

  const skipSpaceAndComments = () => {
    while (i < n) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
        i += 1;
        continue;
      }
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

  const rawPrefix = (at: number) => {
    let start = at;
    while (start > 0 && /[rRuUbBfF]/u.test(text[start - 1] ?? "")) start -= 1;
    if (start === at) return false;
    if (start > 0 && /[A-Za-z0-9_]/u.test(text[start - 1] ?? "")) return false;
    return /r/iu.test(text.slice(start, at));
  };

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
      while (digits.length < 3 && i < n && (text[i] ?? "") >= "0" && (text[i] ?? "") <= "7") {
        digits += text[i];
        i += 1;
      }
      return String.fromCharCode(Number.parseInt(digits, 8));
    }
    return `\\${next}`;
  };

  const readString = (): string | null => {
    const quote = text[i];
    if (!isQuote(quote)) return null;
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
      if (!triple && (c === "\n" || c === "\r")) return null;
      value += c;
      i += 1;
    }
    return null;
  };

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

  const skipOneValue = (): boolean => {
    skipSpaceAndComments();
    if (i >= n) return false;
    const start = text[i];
    if (start === "," || start === "]" || start === "}" || start === ")") return false;
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

  const isOperatorChar = (char: string | undefined): boolean => char !== undefined && "+-*/%|&^<>=!~@".includes(char);

  const stringAt = (at: number): number | null => {
    let j = at;
    if (j > 0 && /[A-Za-z0-9_]/u.test(text[j - 1] ?? "")) return null;
    while (j < n && /[rRuUbBfF]/u.test(text[j] ?? "")) j += 1;
    return isQuote(text[j]) ? j : null;
  };

  const startsAtom = (char: string | undefined): boolean =>
    char === "(" || char === "[" || char === "{" || isQuote(char) || (char !== undefined && /[A-Za-z0-9_]/u.test(char));

  const readOneString = (): GypLiteral => {
    const quote = stringAt(i);
    if (quote === null) return unresolvedLiteral;
    i = quote;
    const value = readString();
    return value === null ? unresolvedLiteral : { kind: "string", value };
  };

  const consumeOperator = () => {
    while (i < n && isOperatorChar(text[i])) i += 1;
  };

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
    if (i >= n) return unresolvedLiteral;
    if (stringAt(i) !== null) return readOneString();
    if (text[i] === "(") return readParen();
    if (text[i] === "[") return readBracket();
    if (text[i] === "{") {
      skipOneValue();
      return unresolvedLiteral;
    }
    if (/[A-Za-z_]/u.test(text[i] ?? "")) {
      while (i < n && /[A-Za-z0-9_]/u.test(text[i] ?? "")) i += 1;
      consumeTrailers();
      return unresolvedLiteral;
    }
    if (/[0-9]/u.test(text[i] ?? "")) {
      while (i < n && /[0-9A-Za-z_.]/u.test(text[i] ?? "")) i += 1;
      consumeTrailers();
      return unresolvedLiteral;
    }
    if (isOperatorChar(text[i])) {
      consumeOperator();
      readAtom();
      return unresolvedLiteral;
    }
    i += 1;
    return unresolvedLiteral;
  };

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
        value = next.kind === "string" && value.kind === "string" ? { kind: "string", value: value.value + next.value } : unresolvedLiteral;
        continue;
      }
      const char = text[i];
      if (char === "(" || char === "[" || char === ".") {
        value = unresolvedLiteral;
        if (char === "(") readParen();
        else if (char === "[") readBracket();
        else i += 1;
        if (i === before) return unresolvedLiteral;
        continue;
      }
      if (isOperatorChar(char)) {
        value = unresolvedLiteral;
        consumeOperator();
        if (i === before) return unresolvedLiteral;
        continue;
      }
      if (value.kind !== "string" && startsAtom(char)) {
        value = unresolvedLiteral;
        readAtom();
        if (i === before) return unresolvedLiteral;
        continue;
      }
      if (char !== undefined && /[A-Za-z_]/u.test(char)) {
        value = unresolvedLiteral;
        while (i < n && /[A-Za-z0-9_]/u.test(text[i] ?? "")) i += 1;
        if (i === before) return unresolvedLiteral;
        continue;
      }
      i = before;
      return value;
    }
    return value;
  };

  const readDelimited = (closing: ")" | "]", kind: "tuple" | "list"): GypLiteral => {
    i += 1;
    const items: GypLiteral[] = [];
    let comma = false;
    while (i < n) {
      skipSpaceAndComments();
      if (i >= n) return unresolvedLiteral;
      if (text[i] === closing) {
        i += 1;
        if (kind === "tuple" && !comma && items.length === 1) return items[0] ?? unresolvedLiteral;
        if (kind === "tuple" && !comma && items.length === 0) return { kind: "tuple", items: [] };
        if (comma && items.length === 0) return unresolvedLiteral;
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
    return unresolvedLiteral;
  };

  const readParen = (): GypLiteral => readDelimited(")", "tuple");
  const readBracket = (): GypLiteral => readDelimited("]", "list");

  const collectEntry = (item: GypLiteral) => {
    if (item.kind === "string") {
      if (item.value) paths.push(item.value);
      return;
    }
    if (item.kind === "tuple") {
      if (item.items.length === 0) {
        unresolved = true;
        return;
      }
      for (const member of item.items) collectEntry(member);
      return;
    }
    unresolved = true;
  };

  const collectValue = (item: GypLiteral) => {
    if (item.kind === "list" || item.kind === "tuple") {
      for (const entry of item.items) collectEntry(entry);
      return;
    }
    if (item.kind === "string") {
      if (item.value) paths.push(item.value);
      else unresolved = true;
      return;
    }
    unresolved = true;
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

/** @throws {never} */
function resolveBuildInclude(fromFile: string, specifier: string): string | null {
  const include = specifier.replaceAll("\\", "/").trim();
  if (include === "" || include.startsWith("/") || include.includes(":") || include.includes("\0") || /[<>|?*]/u.test(include)) return null;
  const directory = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/") + 1) : "";
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

/** @throws {never} */
export function gypIncludedPaths(files: ReadonlyArray<ScanInputFile>): { included: ReadonlySet<string>; unacquired: string[] } {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set<string>();
  const unacquired = new Set<string>();
  const seen = new Set<string>();
  const queue = files.filter((file) => GYP_SOURCE.test(file.path)).map((file) => file.path);
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const file = byPath.get(path);
    if (!file) continue;
    const text = decodeText(file.bytes);
    if (text === null) continue;
    const includes = gypIncludeSpecifiers(text);
    if (includes.unresolved) unacquired.add("GYP include not acquired: unresolved");
    for (const specifier of includes.paths) {
      const resolved = resolveBuildInclude(path, specifier);
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

/** @throws {never} */
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

/** @throws {never} */
export function cmakeIncludedPaths(files: ReadonlyArray<ScanInputFile>): ReadonlySet<string> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set<string>();
  const seen = new Set<string>();
  const queue = files.filter((file) => CMAKE_SOURCE.test(file.path)).map((file) => file.path);
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const file = byPath.get(path);
    if (!file) continue;
    const text = decodeText(file.bytes);
    if (text === null) continue;
    for (const specifier of cmakeIncludeSpecifiers(text)) {
      const resolved = resolveBuildInclude(path, specifier);
      if (resolved === null || !byPath.has(resolved) || seen.has(resolved)) continue;
      included.add(resolved);
      queue.push(resolved);
    }
  }
  return included;
}
