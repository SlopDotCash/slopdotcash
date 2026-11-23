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
  readonly file?: boolean;
}

export interface LocalHelpers {
  readonly included: ReadonlySet<string>;
  readonly unacquired: ReadonlyArray<string>;
}

interface ParsedCommands {
  readonly commands: ReadonlyArray<Word[]>;
  readonly subshell: ReadonlySet<Word[]>;
  readonly conditional: ReadonlySet<Word[]>;
  readonly unresolved: boolean;
}

const BACKGROUND_OR_PIPE = /^(?:\|(?!\|)|&(?!&))/u;

/** @throws {never} */
function doubleQuoteEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else if (c === "$" && text[i + 1] === "(") {
      const end = substitutionEnd(text, i + 2);
      if (end < 0) return -1;
      i = end;
    } else if (c === "`") {
      const end = backtickEnd(text, i + 1);
      if (end < 0) return -1;
      i = end;
    } else i += 1;
  }
  return -1;
}

/** @throws {never} */
function backtickEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === "`") return i + 1;
    else i += 1;
  }
  return -1;
}

/** @throws {never} */
function substitutionEnd(text: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return -1;
      i = end + 1;
    } else if (c === '"') {
      const end = doubleQuoteEnd(text, i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (c === "`") {
      const end = backtickEnd(text, i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (c === "$" && text[i + 1] === "(") {
      const end = substitutionEnd(text, i + 2);
      if (end < 0) return -1;
      i = end;
    } else {
      if (c === "(") depth += 1;
      else if (c === ")" && --depth === 0) return i + 1;
      i += 1;
    }
  }
  return -1;
}

/** @throws {never} */
function commands(text: string): ParsedCommands {
  const result: Word[][] = [];
  const subshell = new Set<Word[]>();
  const conditional = new Set<Word[]>();
  let command: Word[] = [];
  let run = "";
  let previous: Word[] | undefined;
  let word: Word | undefined;
  let quote = "";
  let unresolved = false;
  let depth = 0;
  const endWord = () => {
    if (word) command.push(word);
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    if (command.length > 0) {
      result.push(command);
      if (depth > 0) subshell.add(command);
      if (/[&|]/u.test(run)) conditional.add(command);
      if (previous && BACKGROUND_OR_PIPE.test(run)) conditional.add(previous);
      previous = command;
      run = "";
    }
    command = [];
  };
  const nested = (body: string) => {
    const inner = commands(body);
    for (const words of inner.commands) {
      result.push(words);
      subshell.add(words);
      if (inner.conditional.has(words)) conditional.add(words);
    }
    unresolved ||= inner.unresolved;
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
      if (/[\n;|&()]/u.test(c)) {
        endCommand();
        run += c;
      } else endWord();
      if (c === "(") depth += 1;
      else if (c === ")") {
        if (depth === 0) unresolved = true;
        else depth -= 1;
      }
      continue;
    }
    word ??= { value: "", dynamic: false };
    if (!quote && ((c === "~" && word.value === "") || c === "{" || c === "}")) word.dynamic = true;
    if (quote !== "'" && (c === "$" || c === "`")) {
      word.dynamic = true;
      if (c === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
        const end = text.indexOf("))", i + 3);
        if (end < 0) {
          unresolved = true;
          break;
        }
        if (/\$\(|`/u.test(text.slice(i + 3, end))) unresolved = true;
        word.value += text.slice(i, end + 2);
        i = end + 1;
        continue;
      }
      if (c === "`" || text[i + 1] === "(") {
        const end = c === "`" ? backtickEnd(text, i + 1) : substitutionEnd(text, i + 2);
        if (end < 0) {
          unresolved = true;
          break;
        }
        nested(text.slice(c === "`" ? i + 1 : i + 2, end - 1));
        word.value += text.slice(i, end);
        i = end - 1;
        continue;
      }
    }
    word.value += c;
  }
  if (quote && word) word.dynamic = true;
  if (depth !== 0) unresolved = true;
  endCommand();
  if (previous && BACKGROUND_OR_PIPE.test(run)) conditional.add(previous);
  return { commands: result, subshell, conditional, unresolved };
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

interface Wrapper {
  readonly flags?: string;
  readonly arguments?: string;
  readonly optional?: string;
  readonly split?: string;
  readonly positional?: number | "number";
  readonly assignments?: boolean;
  readonly dash?: boolean;
  readonly numeric?: boolean;
  readonly stdin?: boolean;
}

const options = (text: string): ReadonlySet<string> => new Set(text.split(" ").filter(Boolean));

const WRAPPERS: Readonly<Record<string, Wrapper>> = {
  env: { flags: "i 0 ignore-environment null", arguments: "u unset", split: "S split-string", assignments: true, dash: true },
  "cross-env": { assignments: true },
  sudo: {
    flags: "A b B E H i k n P S s askpass background bell login non-interactive preserve-groups reset-timestamp set-home shell stdin",
    arguments: "C g p r t T U u close-from command-timeout group other-user prompt role type user",
    optional: "preserve-env",
    assignments: true,
  },
  doas: { flags: "n s S", arguments: "a u" },
  nice: { arguments: "n adjustment", numeric: true },
  nohup: {},
  timeout: { flags: "v foreground preserve-status verbose", arguments: "k s kill-after signal", positional: 1 },
  xargs: {
    flags: "0 o p r t x exit interactive no-run-if-empty null open-tty verbose",
    arguments: "a d E I L n P s arg-file delimiter max-args max-chars max-procs process-slot-var",
    optional: "e i l eof max-lines replace",
    stdin: true,
  },
  stdbuf: { arguments: "e i o error input output" },
  ionice: { flags: "t ignore", arguments: "c n class classdata" },
  setsid: { flags: "c f w ctty fork wait" },
  chrt: {
    flags: "a b d f i o r R v all-tasks batch deadline fifo idle other reset-on-fork rr verbose",
    arguments: "D P T sched-deadline sched-period sched-runtime",
    positional: "number",
  },
  taskset: { flags: "a c all-tasks cpu-list", positional: 1 },
  time: { flags: "a p q v append portability quiet verbose", arguments: "f o format output" },
};

const SU: Wrapper = {
  flags: "f l m p P login pty preserve-environment",
  arguments: "g G s w group shell supp-group whitelist-environment",
  split: "c command session-command",
  dash: true,
};

const SCRIPT_DIRECTORY = /^\$\(dirname (?:"\$0"|\$0|"\$\{BASH_SOURCE(?:\[0\])?\}"|\$\{BASH_SOURCE(?:\[0\])?\})\)$/u;

const INTERPRETER_NAME = /^(?:(?:ba|da|k|z)?sh|node(?:js)?|python[0-9.]*|ruby|perl|php)$/u;

const NON_EXECUTING = options(
  "echo printf true false : test [ [[ exit return export unset set shift local readonly declare typeset wait sleep pwd " +
    "cp mv rm rmdir mkdir touch ln chmod chown chgrp install cat ls head tail wc sort uniq tee cut tr grep egrep fgrep sed awk diff cmp " +
    "basename dirname readlink realpath which whereis type hash tar zip unzip gzip gunzip bzip2 xz git " +
    "apt apt-get yum dnf apk brew port pacman zypper choco snap",
);

type OptionStep = { readonly offset: number; readonly split?: Word } | { readonly gap: true; readonly offset?: undefined };

function wrapperOption(spec: Wrapper, words: ReadonlyArray<Word>, offset: number): OptionStep {
  const gap: OptionStep = { gap: true };
  const word = words[offset];
  if (word === undefined || word.dynamic) return gap;
  const value = word.value;
  if (value === "-") return spec.dash ? { offset: offset + 1 } : gap;
  const flags = options(spec.flags ?? "");
  const required = options(spec.arguments ?? "");
  const optional = options(spec.optional ?? "");
  const split = options(spec.split ?? "");
  const argument = (name: string, attached: string | undefined): OptionStep => {
    const next = attached === undefined ? offset + 2 : offset + 1;
    const body = attached === undefined ? words[offset + 1] : { value: attached, dynamic: word.dynamic };
    if (!body) return gap;
    return split.has(name) ? { offset: next, split: body } : { offset: next };
  };
  if (value.startsWith("--")) {
    const equals = value.indexOf("=");
    const name = value.slice(2, equals === -1 ? undefined : equals);
    const attached = equals === -1 ? undefined : value.slice(equals + 1);
    if (flags.has(name) && attached === undefined) return { offset: offset + 1 };
    if (optional.has(name)) return { offset: offset + 1 };
    if (required.has(name) || split.has(name)) return argument(name, attached);
    return gap;
  }
  if (spec.numeric && /^-\d+$/u.test(value)) return { offset: offset + 1 };
  for (let index = 1; index < value.length; index += 1) {
    const letter = value[index] ?? "";
    if (flags.has(letter)) continue;
    if (optional.has(letter)) return { offset: offset + 1 };
    if (required.has(letter) || split.has(letter)) return argument(letter, value.slice(index + 1) || undefined);
    return gap;
  }
  return { offset: offset + 1 };
}

function wrapperOf(command: Word): Wrapper | undefined {
  if (command.dynamic || (command.value.includes("/") && !posix.isAbsolute(command.value))) return undefined;
  const name = posix.basename(command.value);
  return name === "su" ? SU : Object.hasOwn(WRAPPERS, name) ? WRAPPERS[name] : undefined;
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
  const launches = (directory: string | null, word: Word) => {
    if (word.dynamic) return false;
    if (INTERPRETER_NAME.test(posix.basename(word.value))) return true;
    const path = localPath(directory, word);
    const text = path === null ? null : byPath.get(path)?.text;
    return typeof text === "string" && (text.startsWith("#!") || /\.(?:sh|bash|zsh|ksh|dash)$/iu.test(path ?? ""));
  };
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    if (source === undefined) continue;
    const identity = JSON.stringify([source.path, source.directory, source.text]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    let directory: string | null = source.directory;
    let subshellCd = false;
    let inSubshell = false;
    let blocks = 0;
    let braces = 0;
    const include = (word: Word, shell: boolean | "direct") => {
      const cwd = inSubshell && subshellCd ? null : directory;
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
      if (shell === true || (shell === "direct" && !nonShell)) queue.push({ path: file.path, text: file.text, directory: cwd, file: true });
    };
    const parsed = commands(source.text);
    if (parsed.unresolved) missing(source.path);
    for (let words of parsed.commands) {
      let offset = 0;
      inSubshell = parsed.subshell.has(words);
      const first = words[0];
      for (const word of words)
        if (!word.quoted && word.value === "{") braces += 1;
        else if (!word.quoted && word.value === "}") braces = Math.max(0, braces - 1);
      if (first && !first.quoted) {
        if (/^(?:case|esac|select)$/u.test(first.value)) missing(source.path);
        if (/^(?:if|while|until|for)$/u.test(first.value)) blocks += 1;
        else if (/^(?:fi|done)$/u.test(first.value)) blocks = Math.max(0, blocks - 1);
        if (/^(?:for|function|fi|done|\})$/u.test(first.value)) continue;
      }
      let wrapper = false;
      for (;;) {
        const current = words[offset];
        if (current === undefined) break;
        if (!((!current.quoted && /^(?:if|elif|while|until|then|do|else|!|\{)$/u.test(current.value)) || /^(?:exec|command|[A-Za-z_][A-Za-z0-9_]*=.*)$/u.test(current.value))) break;
        if (/^(?:exec|command)$/u.test(current.value)) wrapper = true;
        offset += 1;
      }
      if (wrapper && words[offset]?.value.startsWith("-")) {
        if (words[offset - 1]?.value !== "command" || !/^-[vV]$/u.test(words[offset]?.value ?? "")) missing(source.path);
        continue;
      }
      let command: Word | undefined = words[offset++];
      if (!command) continue;
      let stdinWords = false;
      let handled = false;
      for (let spec = wrapperOf(command); spec; spec = command === undefined ? undefined : wrapperOf(command)) {
        let split: Word | undefined;
        let gap = false;
        if (spec === SU) {
          let user = false;
          let ended = false;
          const rest: Word[] = [];
          while (offset < words.length && !gap) {
            const word = words[offset];
            if (word === undefined) break;
            if (!ended && rest.length === 0 && word.value === "--") {
              ended = true;
              offset += 1;
            } else if (!ended && rest.length === 0 && word.value.startsWith("-")) {
              const step = wrapperOption(SU, words, offset);
              if (step.offset === undefined) gap = true;
              else {
                split = step.split ?? split;
                offset = step.offset;
              }
            } else if (!user) {
              user = true;
              offset += 1;
            } else {
              rest.push(word);
              offset += 1;
            }
          }
          if (!gap && split && rest.length > 0) gap = true;
          if (!gap && !split) {
            handled = rest.length === 0;
            words = rest;
            offset = 0;
            command = { value: "sh", dynamic: false };
            break;
          }
        } else {
          while (!gap && !split && words[offset]?.value.startsWith("-")) {
            if (words[offset]?.value === "--") {
              offset += 1;
              break;
            }
            const step = wrapperOption(spec, words, offset);
            if (step.offset === undefined) gap = true;
            else {
              split = step.split;
              offset = step.offset;
            }
          }
          if (!gap && !split) {
            if (spec.positional === "number") {
              if (/^\d+$/u.test(words[offset]?.value ?? "")) offset += 1;
            } else offset += spec.positional ?? 0;
            if (spec.assignments) while (words[offset] && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[offset]?.value ?? "")) offset += 1;
          }
        }
        if (gap) missing(source.path);
        else if (split) {
          if (!split.dynamic && directory !== null) queue.push({ ...source, directory, text: split.value });
          else missing(source.path);
        }
        if (gap || split) {
          handled = true;
          break;
        }
        stdinWords ||= spec.stdin === true;
        command = words[offset++];
        if (!command) {
          handled = true;
          break;
        }
      }
      if (handled || !command) continue;
      const name = posix.basename(command.value);
      if (/^(?:eval|exec|command)$/u.test(name)) {
        missing(source.path);
        continue;
      }
      if (name === "cd") {
        if (inSubshell) {
          subshellCd = true;
          continue;
        }
        const target = words[offset];
        const scriptDirectory = posix.dirname(source.path) === "." ? "" : posix.dirname(source.path);
        directory =
          parsed.conditional.has(words) || blocks > 0 || braces > 0
            ? null
            : target && source.file === true && SCRIPT_DIRECTORY.test(target.value)
              ? scriptDirectory
              : target
                ? localPath(directory, target, true)
                : null;
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
        } else if (!inline && stdinWords) missing(source.path);
      } else if (command.dynamic || command.value.includes("/")) include(command, "direct");
      else if (!NON_EXECUTING.has(name) && words.slice(offset).some((word) => launches(directory, word))) missing(source.path);
    }
  }
  return { included, unacquired: [...unacquired].sort() };
}
