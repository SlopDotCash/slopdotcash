// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"
import { posix } from "node:path";

interface Word {
  value: string;
  dynamic: boolean;
  quoted?: boolean;
}

export interface HelperInput {
  readonly path: string;
  readonly text: string | null;
}

export interface CommandSource {
  readonly path: string;
  readonly text: string;
  readonly directory: string;
}

export interface LocalHelpers {
  readonly included: ReadonlySet<string>;
  readonly unacquired: ReadonlyArray<string>;
}

/** @throws {never} */
function commands(text: string) {
  const result: Word[][] = [];
  let command: Word[] = [];
  let word: Word | undefined;
  let quote = "";
  let unresolved = false;
  let branched = false;
  const endWord = () => {
    if (word) command.push(word);
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    if (command.length) result.push(command);
    command = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (!quote && c === "#" && !word) {
      while (i < text.length && text[i] !== "\n") i += 1;
      endCommand();
      continue;
    }
    if (c === "\\" && quote !== "'") {
      const next = text[++i];
      if (next === "\n") continue;
      word ??= { value: "", dynamic: false };
      if (next !== undefined) word.value += next;
      continue;
    }
    if (c === quote) {
      quote = "";
      continue;
    }
    if (!quote && (c === "'" || c === '"')) {
      quote = c;
      word ??= { value: "", dynamic: false };
      word.quoted = true;
      continue;
    }
    if (!quote && c === "<" && text[i + 1] === "<") {
      const match = /^<<(-?)[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s;|&]+))/u.exec(text.slice(i));
      if (!match) {
        unresolved = true;
        break;
      }
      const delimiter = match[2] ?? match[3] ?? match[4];
      if (match[2] === undefined && match[3] === undefined) unresolved = true;
      const newline = text.indexOf("\n", i + match[0].length);
      if (text.slice(i + match[0].length, newline === -1 ? undefined : newline).trim()) unresolved = true;
      if (newline === -1) {
        unresolved = true;
        break;
      }
      endCommand();
      let cursor = newline + 1;
      let found = false;
      while (cursor < text.length) {
        const end = text.indexOf("\n", cursor);
        const stop = end === -1 ? text.length : end;
        const line = text.slice(cursor, stop).replace(/\r$/u, "");
        if ((match[1] ? line.replace(/^\t*/u, "") : line) === delimiter) {
          i = stop;
          found = true;
          break;
        }
        cursor = stop + 1;
      }
      if (!found) {
        unresolved = true;
        break;
      }
      continue;
    }
    if (!quote && /[\s;|&()]/u.test(c)) {
      if (c === "(" || c === ")") unresolved = true;
      if (c === "&" || c === "|") branched = true;
      if (/[\n;|&()]/u.test(c)) endCommand();
      else endWord();
      continue;
    }
    word ??= { value: "", dynamic: false };
    if (!quote && ((c === "~" && word.value === "") || c === "{" || c === "}")) word.dynamic = true;
    if (quote !== "'" && (c === "$" || c === "`")) {
      word.dynamic = true;
      if (c === "`" || text[i + 1] === "(") {
        unresolved = true;
        const closing = c === "`" ? "`" : ")";
        word.value += c;
        if (c === "$") word.value += text[++i];
        while (++i < text.length) {
          word.value += text[i];
          if (text[i] === closing) break;
        }
        continue;
      }
    }
    word.value += c;
  }
  if (quote && word) word.dynamic = true;
  endCommand();
  return { commands: result, unresolved, branched };
}

/** @throws {never} */
function localPath(directory: string | null, word: Word, allowRoot = false): string | null {
  if (directory === null || word.dynamic || !word.value || /[:\\\0*?[\]]/u.test(word.value) || posix.isAbsolute(word.value)) return null;
  const path = posix.normalize(posix.join(directory, word.value));
  return path === ".." || path.startsWith("../") ? null : path === "." ? (allowRoot ? "" : null) : path;
}

/** @throws {never} */
function scriptAlias(text: string, target: string): unknown {
  try {
    return (JSON.parse(text) as { scripts?: Record<string, unknown> } | null)?.scripts?.[target];
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function localInstallHelpers(files: ReadonlyArray<HelperInput>, roots: ReadonlyArray<CommandSource>): LocalHelpers {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set<string>();
  const unacquired = new Set<string>();
  const seen = new Set<string>();
  const queue: CommandSource[] = [...roots];
  const missing = (from: string, word?: Word) =>
    unacquired.add(`Local install helper not acquired at ${from}: ${word && !word.dynamic ? word.value : "unresolved"}`);
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    if (source === undefined) continue;
    const identity = JSON.stringify([source.path, source.directory, source.text]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    let directory: string | null = source.directory;
    const include = (word: Word, shell: boolean | "direct") => {
      const cwd = directory;
      const path = localPath(cwd, word);
      const file = path === null ? undefined : byPath.get(path);
      if (!file || file.text === null || cwd === null) {
        missing(source.path, word);
        return;
      }
      included.add(file.path);
      const shellShebang = /^#![^\n]*\b(?:ba|da|k|z)?sh(?:\s|$)/u.test(file.text);
      const nonShell =
        !shellShebang && (/^#![^\n]*\b(?:node|python[0-9.]*|ruby|perl|php)\b/u.test(file.text) || /\.(?:[cm]?[jt]sx?|py|rb|pl|php)$/u.test(file.path));
      if (shell === true || (shell === "direct" && !nonShell)) queue.push({ path: file.path, text: file.text, directory: cwd });
    };
    const parsed = commands(source.text);
    if (parsed.unresolved) missing(source.path);
    for (const words of parsed.commands) {
      let offset = 0;
      const first = words[0];
      if (first && !first.quoted && /^(?:if|elif|else|then|fi|for|while|until|do|done|case|esac|select|function|\{|\})$/u.test(first.value))
        missing(source.path);
      let wrapper = false;
      for (;;) {
        const current = words[offset];
        if (current === undefined) break;
        if (!((!current.quoted && /^(?:then|do|else|!)$/u.test(current.value)) || /^(?:exec|command|[A-Za-z_][A-Za-z0-9_]*=.*)$/u.test(current.value))) break;
        if (/^(?:exec|command)$/u.test(current.value)) wrapper = true;
        offset += 1;
      }
      if (wrapper && words[offset]?.value.startsWith("-")) {
        missing(source.path);
        continue;
      }
      let command = words[offset++];
      if (!command) continue;
      if (/^(?:env|sudo)$/u.test(posix.basename(command.value))) {
        let expanded = false;
        for (;;) {
          const option = words[offset];
          if (option === undefined || !option.value.startsWith("-")) break;
          offset += 1;
          if (option.value === "--") break;
          if (option.value === "-i" || option.value === "--ignore-environment") continue;
          if (option.value === "-S" || option.value === "--split-string") {
            const body = words[offset];
            if (body && !body.dynamic && directory !== null) queue.push({ ...source, directory, text: body.value });
            else missing(source.path);
          } else missing(source.path);
          expanded = true;
          break;
        }
        if (expanded) continue;
        while (words[offset] && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[offset]?.value ?? "")) offset += 1;
        command = words[offset++];
        if (!command) continue;
      }
      const name = posix.basename(command.value);
      if (/^(?:eval|exec|command)$/u.test(name)) {
        missing(source.path);
        continue;
      }
      if (name === "cd") {
        if (parsed.branched) missing(source.path);
        const target = words[offset];
        directory = target ? localPath(directory, target, true) : null;
        const entered = directory;
        if (entered !== null && entered !== "" && !files.some((file) => file.path.startsWith(`${entered}/`))) directory = null;
        continue;
      }
      if (/^(?:npm|pnpm|yarn|bun)$/u.test(name)) {
        for (const argument of words.slice(offset)) {
          if (argument.value === "--") break;
          if (argument.value.startsWith("-") && !/^(?:--version|--help|-v|-h)$/u.test(argument.value)) missing(source.path);
        }
        const leading = words[offset++];
        if (leading?.dynamic) {
          missing(source.path);
          continue;
        }
        if (leading?.value.startsWith("-")) {
          if (!/^(?:--version|--help|-v|-h)$/u.test(leading.value)) missing(source.path);
          continue;
        }
        const target = leading?.value === "run" || leading?.value === "run-script" ? words[offset] : name === "yarn" ? leading : undefined;
        if (target) {
          const manifest = directory === null ? undefined : byPath.get(posix.join(directory, "package.json"));
          const alias = manifest?.text ? scriptAlias(manifest.text, target.value) : undefined;
          if (manifest && !target.dynamic && typeof alias === "string" && directory !== null)
            queue.push({ path: `${manifest.path}#scripts.${target.value}`, text: alias, directory });
          else if (name === "bun" && !target.dynamic && (target.value.includes("/") || /\.[cm]?[jt]sx?$/u.test(target.value))) include(target, false);
          else missing(source.path, target);
        } else if (name === "bun" && leading && (leading.value.includes("/") || /\.[cm]?[jt]sx?$/u.test(leading.value))) include(leading, false);
        continue;
      }
      if (!command.dynamic && /^(?:(?:ba|da|k|z)?sh|node(?:js)?|python[0-9.]*|ruby|perl|php|source|\.)$/u.test(name)) {
        const shell = /^(?:(?:ba|da|k|z)?sh|source|\.)$/u.test(name);
        let inline = false;
        for (;;) {
          const option = words[offset];
          if (option === undefined || !option.value.startsWith("-")) break;
          offset += 1;
          if (option.value === "--") break;
          if (/^(?:--version|--help)$/u.test(option.value)) {
            inline = true;
            break;
          }
          if (shell && /^-[^-]*n/u.test(option.value)) {
            inline = true;
            break;
          }
          if (/^-[^-]*c/u.test(option.value) && shell) {
            const body = words[offset];
            if (body && !body.dynamic && directory !== null) queue.push({ ...source, directory, text: body.value });
            else missing(source.path);
            inline = true;
            break;
          }
          if (!shell && /^(?:-[empc]|--eval|--print|--version|-V|--help|-h)$/u.test(option.value)) {
            inline = true;
            break;
          }
          if (shell && (option.value === "-o" || option.value === "-O")) offset += 1;
          else if (!(shell && /^-[a-zA-Z]+$/u.test(option.value))) {
            missing(source.path);
            inline = true;
            break;
          }
        }
        const script = words[offset];
        if (!inline && script) {
          include(script, shell);
          if (name === "source" || name === ".") {
            missing(source.path);
            directory = null;
          }
        }
      } else if (command.dynamic || command.value.includes("/")) include(command, "direct");
    }
  }
  return { included, unacquired: [...unacquired].sort() };
}
