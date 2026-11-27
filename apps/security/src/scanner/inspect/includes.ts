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

function isQuote(char: string | undefined): char is "'" | '"' {
  return char === "'" || char === '"';
}

function isOperatorChar(char: string | undefined): boolean {
  return char !== undefined && "+-*/%|&^<>=!~@".includes(char);
}

function startsAtom(char: string | undefined): boolean {
  return char === "(" || char === "[" || char === "{" || isQuote(char) || (char !== undefined && /[A-Za-z0-9_]/u.test(char));
}

function collectGypEntry(item: GypLiteral, paths: string[]): boolean {
  if (item.kind === "string") {
    if (item.value) paths.push(item.value);
    return false;
  }
  if (item.kind === "tuple") {
    if (item.items.length === 0) return true;
    let unresolved = false;
    for (const member of item.items) {
      if (collectGypEntry(member, paths)) unresolved = true;
    }
    return unresolved;
  }
  return true;
}

function collectGypValue(item: GypLiteral, paths: string[]): boolean {
  if (item.kind === "list" || item.kind === "tuple") {
    let unresolved = false;
    for (const entry of item.items) {
      if (collectGypEntry(entry, paths)) unresolved = true;
    }
    return unresolved;
  }
  if (item.kind === "string") {
    if (item.value) {
      paths.push(item.value);
      return false;
    }
    return true;
  }
  return true;
}

class GypReader {
  i = 0;
  readonly text: string;
  readonly n: number;

  constructor(text: string) {
    this.text = text;
    this.n = text.length;
  }

  skipSpaceAndComments() {
    while (this.i < this.n) {
      const c = this.text[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
        this.i += 1;
        continue;
      }
      if (c === "\\" && (this.text[this.i + 1] === "\n" || this.text[this.i + 1] === "\r")) {
        this.i += 2;
        if (this.text[this.i - 1] === "\r" && this.text[this.i] === "\n") this.i += 1;
        continue;
      }
      if (c === "#") {
        while (this.i < this.n && this.text[this.i] !== "\n" && this.text[this.i] !== "\r") this.i += 1;
        continue;
      }
      return;
    }
  }

  private rawPrefix(at: number) {
    let start = at;
    while (start > 0 && /[rRuUbBfF]/u.test(this.text[start - 1] ?? "")) start -= 1;
    if (start === at) return false;
    if (start > 0 && /[A-Za-z0-9_]/u.test(this.text[start - 1] ?? "")) return false;
    return /r/iu.test(this.text.slice(start, at));
  }

  private decodeEscape(raw: boolean) {
    if (this.i >= this.n) return "\\";
    const next = this.text[this.i] ?? "";
    this.i += 1;
    if (raw) {
      if (next === "\r" && this.text[this.i] === "\n") {
        this.i += 1;
        return "\\\r\n";
      }
      return `\\${next}`;
    }
    if (next === "\n") return "";
    if (next === "\r") {
      if (this.text[this.i] === "\n") this.i += 1;
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
      const digits = this.text.slice(this.i, this.i + width);
      if (digits.length === width && /^[0-9a-fA-F]+$/u.test(digits)) {
        const code = Number.parseInt(digits, 16);
        if (code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
          this.i += width;
          return String.fromCodePoint(code);
        }
      }
      return `\\${next}`;
    }
    if (next >= "0" && next <= "7") {
      let digits = next;
      while (digits.length < 3 && this.i < this.n && (this.text[this.i] ?? "") >= "0" && (this.text[this.i] ?? "") <= "7") {
        digits += this.text[this.i];
        this.i += 1;
      }
      return String.fromCharCode(Number.parseInt(digits, 8));
    }
    return `\\${next}`;
  }

  private readString(): string | null {
    const quote = this.text[this.i];
    if (!isQuote(quote)) return null;
    const raw = this.rawPrefix(this.i);
    const triple = this.text.startsWith(quote.repeat(3), this.i);
    const delimiter = triple ? quote.repeat(3) : quote;
    this.i += delimiter.length;
    let value = "";
    while (this.i < this.n) {
      const c = this.text[this.i] ?? "";
      if (c === "\\") {
        this.i += 1;
        value += this.decodeEscape(raw);
        continue;
      }
      if (this.text.startsWith(delimiter, this.i)) {
        this.i += delimiter.length;
        return value;
      }
      if (!triple && (c === "\n" || c === "\r")) return null;
      value += c;
      this.i += 1;
    }
    return null;
  }

  readConcatenatedString(): string | null {
    const first = this.readString();
    if (first === null) return null;
    let value = first;
    while (this.i < this.n) {
      const mark = this.i;
      this.skipSpaceAndComments();
      if (!isQuote(this.text[this.i])) {
        this.i = mark;
        return value;
      }
      const next = this.readString();
      if (next === null) return value;
      value += next;
    }
    return value;
  }

  private skipOneValue(): boolean {
    this.skipSpaceAndComments();
    if (this.i >= this.n) return false;
    const start = this.text[this.i];
    if (start === "," || start === "]" || start === "}" || start === ")") return false;
    if (isQuote(start)) {
      this.readConcatenatedString();
      return true;
    }
    if (start === "[" || start === "{" || start === "(") {
      const closing = start === "[" ? "]" : start === "{" ? "}" : ")";
      this.i += 1;
      while (this.i < this.n) {
        this.skipSpaceAndComments();
        if (this.i >= this.n) return false;
        if (this.text[this.i] === closing) {
          this.i += 1;
          return true;
        }
        if (this.text[this.i] === ",") {
          this.i += 1;
          continue;
        }
        if (!this.skipOneValue()) return false;
      }
      return false;
    }
    if (/[A-Za-z0-9_]/u.test(start ?? "")) {
      while (this.i < this.n && /[A-Za-z0-9_]/u.test(this.text[this.i] ?? "")) this.i += 1;
      return true;
    }
    this.i += 1;
    return true;
  }

  private stringAt(at: number): number | null {
    let j = at;
    if (j > 0 && /[A-Za-z0-9_]/u.test(this.text[j - 1] ?? "")) return null;
    while (j < this.n && /[rRuUbBfF]/u.test(this.text[j] ?? "")) j += 1;
    return isQuote(this.text[j]) ? j : null;
  }

  private readOneString(): GypLiteral {
    const quote = this.stringAt(this.i);
    if (quote === null) return unresolvedLiteral;
    this.i = quote;
    const value = this.readString();
    return value === null ? unresolvedLiteral : { kind: "string", value };
  }

  private consumeOperator() {
    while (this.i < this.n && isOperatorChar(this.text[this.i])) this.i += 1;
  }

  private consumeTrailers() {
    while (this.i < this.n) {
      const mark = this.i;
      this.skipSpaceAndComments();
      if (this.text[this.i] === "(") {
        this.readDelimited(")", "tuple");
        continue;
      }
      if (this.text[this.i] === "[") {
        this.readDelimited("]", "list");
        continue;
      }
      if (this.text[this.i] === ".") {
        this.i += 1;
        this.skipSpaceAndComments();
        while (this.i < this.n && /[A-Za-z0-9_]/u.test(this.text[this.i] ?? "")) this.i += 1;
        continue;
      }
      this.i = mark;
      return;
    }
  }

  private readAtom(): GypLiteral {
    this.skipSpaceAndComments();
    if (this.i >= this.n) return unresolvedLiteral;
    if (this.stringAt(this.i) !== null) return this.readOneString();
    if (this.text[this.i] === "(") return this.readDelimited(")", "tuple");
    if (this.text[this.i] === "[") return this.readDelimited("]", "list");
    if (this.text[this.i] === "{") {
      this.skipOneValue();
      return unresolvedLiteral;
    }
    if (/[A-Za-z_]/u.test(this.text[this.i] ?? "")) {
      while (this.i < this.n && /[A-Za-z0-9_]/u.test(this.text[this.i] ?? "")) this.i += 1;
      this.consumeTrailers();
      return unresolvedLiteral;
    }
    if (/[0-9]/u.test(this.text[this.i] ?? "")) {
      while (this.i < this.n && /[0-9A-Za-z_.]/u.test(this.text[this.i] ?? "")) this.i += 1;
      this.consumeTrailers();
      return unresolvedLiteral;
    }
    if (isOperatorChar(this.text[this.i])) {
      this.consumeOperator();
      this.readAtom();
      return unresolvedLiteral;
    }
    this.i += 1;
    return unresolvedLiteral;
  }

  readExpr(): GypLiteral {
    this.skipSpaceAndComments();
    const start = this.i;
    let value = this.readAtom();
    if (this.i === start && this.i < this.n) this.i += 1;
    while (this.i < this.n) {
      const before = this.i;
      this.skipSpaceAndComments();
      if (this.i >= this.n) return value;
      if (value.kind === "string" && this.stringAt(this.i) !== null) {
        const next = this.readOneString();
        value = next.kind === "string" && value.kind === "string" ? { kind: "string", value: value.value + next.value } : unresolvedLiteral;
        continue;
      }
      const char = this.text[this.i];
      if (char === "(" || char === "[" || char === ".") {
        value = unresolvedLiteral;
        if (char === "(") this.readDelimited(")", "tuple");
        else if (char === "[") this.readDelimited("]", "list");
        else this.i += 1;
        if (this.i === before) return unresolvedLiteral;
        continue;
      }
      if (isOperatorChar(char)) {
        value = unresolvedLiteral;
        this.consumeOperator();
        if (this.i === before) return unresolvedLiteral;
        continue;
      }
      if (value.kind !== "string" && startsAtom(char)) {
        value = unresolvedLiteral;
        this.readAtom();
        if (this.i === before) return unresolvedLiteral;
        continue;
      }
      if (char !== undefined && /[A-Za-z_]/u.test(char)) {
        value = unresolvedLiteral;
        while (this.i < this.n && /[A-Za-z0-9_]/u.test(this.text[this.i] ?? "")) this.i += 1;
        if (this.i === before) return unresolvedLiteral;
        continue;
      }
      this.i = before;
      return value;
    }
    return value;
  }

  private readDelimited(closing: ")" | "]", kind: "tuple" | "list"): GypLiteral {
    this.i += 1;
    const items: GypLiteral[] = [];
    let comma = false;
    while (this.i < this.n) {
      this.skipSpaceAndComments();
      if (this.i >= this.n) return unresolvedLiteral;
      if (this.text[this.i] === closing) {
        this.i += 1;
        if (kind === "tuple" && !comma && items.length === 1) return items[0] ?? unresolvedLiteral;
        if (kind === "tuple" && !comma && items.length === 0) return { kind: "tuple", items: [] };
        if (comma && items.length === 0) return unresolvedLiteral;
        return { kind, items };
      }
      if (this.text[this.i] === ",") {
        comma = true;
        this.i += 1;
        continue;
      }
      const before = this.i;
      items.push(this.readExpr());
      if (this.i === before) this.i += 1;
    }
    return unresolvedLiteral;
  }
}

/** @throws {never} */
function gypIncludeSpecifiers(text: string): { paths: string[]; unresolved: boolean } {
  const paths: string[] = [];
  let unresolved = false;
  const reader = new GypReader(text);
  while (reader.i < reader.n) {
    reader.skipSpaceAndComments();
    if (reader.i >= reader.n) break;
    if (!isQuote(reader.text[reader.i])) {
      reader.i += 1;
      continue;
    }
    const key = reader.readConcatenatedString();
    if (key !== "includes") continue;
    const afterKey = reader.i;
    reader.skipSpaceAndComments();
    if (reader.text[reader.i] !== ":") {
      reader.i = afterKey;
      continue;
    }
    reader.i += 1;
    if (collectGypValue(reader.readExpr(), paths)) unresolved = true;
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
