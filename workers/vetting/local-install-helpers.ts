import { posix } from "node:path";

type Word = { value: string; dynamic: boolean; quoted?: boolean };
type Input = { path: string; text: string | null };
type CommandSource = {
  path: string;
  text: string;
  directory: string;
  /** The text is the whole file at `path`, so `$0` names that file. */
  file?: boolean;
};

/** The index just past a double-quoted string that starts after `"` at `i`. */
function doubleQuoteEnd(text: string, i: number): number {
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

/** The index just past the backtick that closes one starting before `i`. */
function backtickEnd(text: string, i: number): number {
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === "`") return i + 1;
    else i += 1;
  }
  return -1;
}

/**
 * The index just past the `)` that closes a `$(` whose body starts at `i`,
 * following nested substitutions and quotes. -1 when it never closes.
 */
function substitutionEnd(text: string, i: number): number {
  let depth = 1;
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

/**
 * Split literal shell command words, without evaluating quotes or
 * expansions. A command substitution is one dynamic word of its command, and
 * the commands inside it are returned too, marked as running in a subshell,
 * as are the commands inside `( ... )`. A substitution that never closes, an
 * unquoted here-document and arithmetic that runs a command are unresolved.
 */
function commands(text: string): {
  commands: Word[][];
  subshell: Set<Word[]>;
  /** Commands that may not run: after `&&`/`||`, or in a pipeline or background. */
  conditional: Set<Word[]>;
  unresolved: boolean;
  branched: boolean;
} {
  const result: Word[][] = [];
  const subshell = new Set<Word[]>();
  const conditional = new Set<Word[]>();
  let command: Word[] = [];
  /** Operators since the last command, and that command. */
  let run = "";
  let previous: Word[] | undefined;
  let word: Word | undefined;
  let quote = "";
  let unresolved = false;
  let branched = false;
  let depth = 0;
  const endWord = () => {
    if (word) command.push(word);
    word = undefined;
  };
  const endCommand = () => {
    endWord();
    if (command.length) {
      result.push(command);
      if (depth > 0) subshell.add(command);
      if (/[&|]/u.test(run)) conditional.add(command);
      // A single `|` or `&` after a command runs it in a subshell or
      // concurrently; `&&` and `||` after it run it first.
      if (previous && /^(?:\|(?!\|)|&(?!&))/u.test(run))
        conditional.add(previous);
      previous = command;
      run = "";
    }
    command = [];
  };
  /** Commands inside a substitution run in a subshell of this command. */
  const nested = (body: string) => {
    const inner = commands(body);
    for (const words of inner.commands) {
      result.push(words);
      subshell.add(words);
      if (inner.conditional.has(words)) conditional.add(words);
    }
    unresolved ||= inner.unresolved;
    branched ||= inner.branched;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
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
      // Here-document bodies are data; unquoted bodies can expand commands.
      const match =
        /^<<(-?)[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s;|&]+))/u.exec(
          text.slice(i),
        );
      if (!match) {
        unresolved = true;
        break;
      }
      const delimiter = match[2] ?? match[3] ?? match[4];
      if (match[2] === undefined && match[3] === undefined) unresolved = true;
      const newline = text.indexOf("\n", i + match[0].length);
      if (
        text
          .slice(i + match[0].length, newline === -1 ? undefined : newline)
          .trim()
      )
        unresolved = true;
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
      if (c === "&" || c === "|") branched = true;
      if (/[\n;|&()]/u.test(c)) {
        endCommand();
        run += c;
      } else endWord();
      // `( ... )` runs its commands in a subshell; `name()` is a function.
      if (c === "(") depth += 1;
      else if (c === ")") {
        if (depth === 0) unresolved = true;
        else depth -= 1;
      }
      continue;
    }
    word ??= { value: "", dynamic: false };
    if (!quote && ((c === "~" && word.value === "") || c === "{" || c === "}"))
      word.dynamic = true;
    if (quote !== "'" && (c === "$" || c === "`")) {
      word.dynamic = true;
      if (c === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
        // Arithmetic is not a command unless it holds a substitution.
        const end = text.indexOf("))", i + 3);
        if (end < 0) {
          unresolved = true;
          break;
        }
        const body = text.slice(i + 3, end);
        if (/\$\(|`/u.test(body)) unresolved = true;
        word.value += text.slice(i, end + 2);
        i = end + 1;
        continue;
      }
      if (c === "`" || text[i + 1] === "(") {
        // The substitution is one dynamic word of this command; its own
        // commands run too and are read like any other command.
        const end =
          c === "`" ? backtickEnd(text, i + 1) : substitutionEnd(text, i + 2);
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
  if (previous && /^(?:\|(?!\|)|&(?!&))/u.test(run)) conditional.add(previous);
  return { commands: result, subshell, conditional, unresolved, branched };
}

/** Only acquired repository paths can become executable helper content. */
function localPath(
  directory: string | null,
  word: Word,
  allowRoot = false,
): string | null {
  if (
    directory === null ||
    word.dynamic ||
    !word.value ||
    /[:\\\0*?[\]]/u.test(word.value) ||
    posix.isAbsolute(word.value)
  )
    return null;
  const path = posix.normalize(posix.join(directory, word.value));
  return path === ".." || path.startsWith("../")
    ? null
    : path === "."
      ? allowRoot
        ? ""
        : null
      : path;
}

/**
 * Commands that run their remaining words as another command. Options are
 * listed with their arity; any other option is not understood, so the
 * command is a coverage gap instead of an unknown, non-executing command.
 */
type Wrapper = {
  /** Options without an argument: short letters and long names. */
  flags?: string;
  /** Options whose argument is attached or the next word. */
  arguments?: string;
  /** Options whose argument may only be attached (`-i{}`, `--eof=x`). */
  optional?: string;
  /** `env -S` style options: their argument is a whole command line. */
  split?: string;
  /** Positional words before the command: a count, or one optional number. */
  positional?: number | "number";
  /** Leading NAME=value words are environment, not the command. */
  assignments?: boolean;
  /** `-` alone is an option (env: empty environment; su: login shell). */
  dash?: boolean;
  /** `nice -10`: an all-digit short option is an adjustment. */
  numeric?: boolean;
  /** xargs appends words from standard input to the command. */
  stdin?: boolean;
};
const options = (text: string) => new Set(text.split(" ").filter(Boolean));
const WRAPPERS: Record<string, Wrapper> = {
  env: {
    flags: "i 0 ignore-environment null",
    arguments: "u unset",
    split: "S split-string",
    assignments: true,
    dash: true,
  },
  "cross-env": { assignments: true },
  sudo: {
    flags:
      "A b B E H i k n P S s askpass background bell login non-interactive preserve-groups reset-timestamp set-home shell stdin",
    arguments:
      "C g p r t T U u close-from command-timeout group other-user prompt role type user",
    optional: "preserve-env",
    assignments: true,
  },
  doas: { flags: "n s S", arguments: "a u" },
  nice: { arguments: "n adjustment", numeric: true },
  nohup: {},
  timeout: {
    flags: "v foreground preserve-status verbose",
    arguments: "k s kill-after signal",
    positional: 1,
  },
  xargs: {
    flags: "0 o p r t x exit interactive no-run-if-empty null open-tty verbose",
    arguments:
      "a d E I L n P s arg-file delimiter max-args max-chars max-procs process-slot-var",
    optional: "e i l eof max-lines replace",
    stdin: true,
  },
  stdbuf: { arguments: "e i o error input output" },
  ionice: { flags: "t ignore", arguments: "c n class classdata" },
  setsid: { flags: "c f w ctty fork wait" },
  chrt: {
    flags:
      "a b d f i o r R v all-tasks batch deadline fifo idle other reset-on-fork rr verbose",
    arguments: "D P T sched-deadline sched-period sched-runtime",
    positional: "number",
  },
  taskset: { flags: "a c all-tasks cpu-list", positional: 1 },
  time: {
    flags: "a p q v append portability quiet verbose",
    arguments: "f o format output",
  },
};
/** `su [options] [-] [user [shell arguments]]`, with `-c` as the command. */
const SU: Wrapper = {
  flags: "f l m p P login pty preserve-environment",
  arguments: "g G s w group shell supp-group whitelist-environment",
  split: "c command session-command",
  dash: true,
};
/** `cd "$(dirname "$0")"`: the directory of the running script file. */
const SCRIPT_DIRECTORY =
  /^\$\(dirname (?:"\$0"|\$0|"\$\{BASH_SOURCE(?:\[0\])?\}"|\$\{BASH_SOURCE(?:\[0\])?\})\)$/u;
const INTERPRETER_NAME =
  /^(?:(?:ba|da|k|z)?sh|node(?:js)?|python[0-9.]*|ruby|perl|php)$/u;
/**
 * Commands that never execute a word they are given. An unknown command is
 * otherwise read fail closed: a later shell or interpreter name, wrapper, or
 * acquired executable script means it may run that helper unseen.
 */
const NON_EXECUTING = options(
  "echo printf true false : test [ [[ exit return export unset set shift local readonly declare typeset wait sleep pwd " +
    "cp mv rm rmdir mkdir touch ln chmod chown chgrp install cat ls head tail wc sort uniq tee cut tr grep egrep fgrep sed awk diff cmp " +
    "basename dirname readlink realpath which whereis type hash tar zip unzip gzip gunzip bzip2 xz git " +
    "apt apt-get yum dnf apk brew port pacman zypper choco snap",
);

type OptionStep =
  | { offset: number; split?: Word }
  | { gap: true; offset?: undefined };

/** Read one option word of a wrapper; anything not listed is not understood. */
function wrapperOption(spec: Wrapper, words: Word[], offset: number) {
  const gap: OptionStep = { gap: true };
  const word = words[offset];
  const value = word.value;
  if (word.dynamic) return gap;
  if (value === "-") return spec.dash ? { offset: offset + 1 } : gap;
  const flags = options(spec.flags ?? "");
  const required = options(spec.arguments ?? "");
  const optional = options(spec.optional ?? "");
  const split = options(spec.split ?? "");
  const argument = (name: string, attached: string | undefined) => {
    const next = attached === undefined ? offset + 2 : offset + 1;
    const body =
      attached === undefined
        ? words[offset + 1]
        : { value: attached, dynamic: word.dynamic };
    if (!body) return gap;
    return split.has(name) ? { offset: next, split: body } : { offset: next };
  };
  if (value.startsWith("--")) {
    const equals = value.indexOf("=");
    const name = value.slice(2, equals === -1 ? undefined : equals);
    const attached = equals === -1 ? undefined : value.slice(equals + 1);
    if (flags.has(name) && attached === undefined)
      return { offset: offset + 1 };
    if (optional.has(name)) return { offset: offset + 1 };
    if (required.has(name) || split.has(name)) return argument(name, attached);
    return gap;
  }
  if (spec.numeric && /^-\d+$/u.test(value)) return { offset: offset + 1 };
  for (let index = 1; index < value.length; index += 1) {
    const letter = value[index];
    if (flags.has(letter)) continue;
    if (optional.has(letter)) return { offset: offset + 1 };
    if (required.has(letter) || split.has(letter))
      return argument(letter, value.slice(index + 1) || undefined);
    return gap;
  }
  return { offset: offset + 1 };
}

/** A literal command word naming a wrapper on PATH or at an absolute path. */
function wrapperOf(command: Word): Wrapper | undefined {
  if (
    command.dynamic ||
    (command.value.includes("/") && !posix.isAbsolute(command.value))
  )
    return undefined;
  const name = posix.basename(command.value);
  return name === "su"
    ? SU
    : Object.hasOwn(WRAPPERS, name)
      ? WRAPPERS[name]
      : undefined;
}

/**
 * Follow literal shell/interpreter file invocations from known install
 * content. Paths keep the invoking package's working directory: executing
 * scripts/a.sh does not itself change cwd to scripts/. No target is run.
 */
export function localInstallHelpers(files: Input[], roots: CommandSource[]) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set<string>();
  const unacquired = new Set<string>();
  const seen = new Set<string>();
  const queue = [...roots];
  const launches = (directory: string | null, word: Word) => {
    if (word.dynamic) return false;
    if (INTERPRETER_NAME.test(posix.basename(word.value))) return true;
    const path = localPath(directory, word);
    const text = path === null ? null : byPath.get(path)?.text;
    return (
      typeof text === "string" &&
      (text.startsWith("#!") ||
        /\.(?:sh|bash|zsh|ksh|dash)$/iu.test(path ?? ""))
    );
  };
  const missing = (from: string, word?: Word) =>
    unacquired.add(
      `Local install helper not acquired at ${from}: ${word && !word.dynamic ? word.value : "unresolved"}`,
    );
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    const identity = JSON.stringify([
      source.path,
      source.directory,
      source.text,
    ]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    let directory: string | null = source.directory;
    // A `cd` inside a subshell changes the directory only there; it is not
    // modelled, so a later local launch inside a subshell is a gap.
    let subshellCd = false;
    let inSubshell = false;
    // Open `if`, loop and `{ }` bodies: a `cd` inside one may not run.
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
      const shellShebang = /^#![^\n]*\b(?:ba|da|k|z)?sh(?:\s|$)/u.test(
        file.text,
      );
      const nonShell =
        !shellShebang &&
        (/^#![^\n]*\b(?:node|python[0-9.]*|ruby|perl|php)\b/u.test(file.text) ||
          /\.(?:[cm]?[jt]sx?|py|rb|pl|php)$/u.test(file.path));
      if (shell === true || (shell === "direct" && !nonShell))
        queue.push({
          path: file.path,
          text: file.text,
          directory: cwd,
          file: true,
        });
    };
    const parsed = commands(source.text);
    if (parsed.unresolved) missing(source.path);
    for (let words of parsed.commands) {
      let offset = 0;
      inSubshell = parsed.subshell.has(words);
      const first = words[0];
      for (const word of words)
        if (!word.quoted && word.value === "{") braces += 1;
        else if (!word.quoted && word.value === "}")
          braces = Math.max(0, braces - 1);
      // Every branch and loop body is read as if it runs. `case` patterns
      // and `select` menus are not modelled, so they stay a gap; a `for` or
      // `function` header and a closing word run nothing themselves.
      if (first && !first.quoted) {
        if (/^(?:case|esac|select)$/u.test(first.value)) missing(source.path);
        if (/^(?:if|while|until|for)$/u.test(first.value)) blocks += 1;
        else if (/^(?:fi|done)$/u.test(first.value))
          blocks = Math.max(0, blocks - 1);
        if (/^(?:for|function|fi|done|\})$/u.test(first.value)) continue;
      }
      let wrapper = false;
      while (
        words[offset] &&
        ((!words[offset].quoted &&
          /^(?:if|elif|while|until|then|do|else|!|\{)$/u.test(
            words[offset].value,
          )) ||
          /^(?:exec|command|[A-Za-z_][A-Za-z0-9_]*=.*)$/u.test(
            words[offset].value,
          ))
      ) {
        if (/^(?:exec|command)$/u.test(words[offset].value)) wrapper = true;
        offset += 1;
      }
      if (wrapper && words[offset]?.value.startsWith("-")) {
        // `command -v name` and `-V` only print where `name` is.
        if (
          words[offset - 1]?.value !== "command" ||
          !/^-[vV]$/u.test(words[offset].value)
        )
          missing(source.path);
        continue;
      }
      let command: Word | undefined = words[offset++];
      if (!command) continue;
      // Unwrap nested wrappers (`sudo env nice sh x`) until the command that
      // actually runs. Every outcome either reaches that command or is a gap.
      let stdinWords = false;
      let handled = false;
      for (let spec = wrapperOf(command); spec; spec = wrapperOf(command)) {
        let split: Word | undefined;
        let gap = false;
        if (spec === SU) {
          // su permutes its options around the user; later words are
          // arguments of the target user's shell.
          let user = false;
          let ended = false;
          const rest: Word[] = [];
          while (offset < words.length && !gap) {
            const word = words[offset];
            if (!ended && !rest.length && word.value === "--") {
              ended = true;
              offset += 1;
            } else if (!ended && !rest.length && word.value.startsWith("-")) {
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
          if (!gap && split && rest.length) gap = true;
          if (!gap && !split) {
            handled = !rest.length;
            words = rest;
            offset = 0;
            command = { value: "sh", dynamic: false };
            break;
          }
        } else {
          while (!gap && !split && words[offset]?.value.startsWith("-")) {
            if (words[offset].value === "--") {
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
            if (spec.assignments)
              while (
                words[offset] &&
                /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[offset].value)
              )
                offset += 1;
          }
        }
        if (gap) missing(source.path);
        else if (split) {
          if (!split.dynamic && directory !== null)
            queue.push({ ...source, directory, text: split.value });
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
        // A `cd` that may not run (after `&&` or `||`, in a pipeline, or in
        // an `if`, loop or `{ }` body) leaves the directory unknown, so any
        // later local launch is a gap.
        directory =
          parsed.conditional.has(words) || blocks > 0 || braces > 0
            ? null
            : target && source.file && SCRIPT_DIRECTORY.test(target.value)
              ? posix.dirname(source.path) === "."
                ? ""
                : posix.dirname(source.path)
              : target
                ? localPath(directory, target, true)
                : null;
        if (
          directory !== null &&
          directory !== "" &&
          !files.some((file) => file.path.startsWith(`${directory}/`))
        )
          directory = null;
        continue;
      }
      if (/^(?:npm|pnpm|yarn|bun)$/u.test(name)) {
        for (const argument of words.slice(offset)) {
          if (argument.value === "--") break;
          if (
            argument.value.startsWith("-") &&
            !/^(?:--version|--help|-v|-h)$/u.test(argument.value)
          )
            missing(source.path);
        }
        const first = words[offset++];
        if (first?.dynamic) {
          missing(source.path);
          continue;
        }
        if (first?.value.startsWith("-")) {
          if (!/^(?:--version|--help|-v|-h)$/u.test(first.value))
            missing(source.path);
          continue;
        }
        const target =
          first?.value === "run" || first?.value === "run-script"
            ? words[offset]
            : name === "yarn"
              ? first
              : undefined;
        if (target) {
          const manifest =
            directory === null
              ? undefined
              : byPath.get(posix.join(directory, "package.json"));
          let alias: unknown;
          try {
            alias = manifest?.text
              ? JSON.parse(manifest.text).scripts?.[target.value]
              : undefined;
          } catch {
            /* The manifest remains separately reviewed. */
          }
          if (
            manifest &&
            !target.dynamic &&
            typeof alias === "string" &&
            directory !== null
          )
            queue.push({
              path: `${manifest.path}#scripts.${target.value}`,
              text: alias,
              directory,
            });
          else if (
            name === "bun" &&
            !target.dynamic &&
            (target.value.includes("/") ||
              /\.[cm]?[jt]sx?$/u.test(target.value))
          )
            include(target, false);
          else missing(source.path, target);
        } else if (
          name === "bun" &&
          first &&
          (first.value.includes("/") || /\.[cm]?[jt]sx?$/u.test(first.value))
        )
          include(first, false);
        continue;
      }
      if (
        !command.dynamic &&
        /^(?:(?:ba|da|k|z)?sh|node(?:js)?|python[0-9.]*|ruby|perl|php|source|\.)$/u.test(
          name,
        )
      ) {
        const shell = /^(?:(?:ba|da|k|z)?sh|source|\.)$/u.test(name);
        let inline = false;
        while (words[offset]?.value.startsWith("-")) {
          const option = words[offset++];
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
            if (body && !body.dynamic && directory !== null)
              queue.push({ ...source, directory, text: body.value });
            else missing(source.path);
            inline = true;
            break;
          }
          if (
            !shell &&
            /^(?:-[empc]|--eval|--print|--version|-V|--help|-h)$/u.test(
              option.value,
            )
          ) {
            inline = true;
            break;
          }
          if (shell && (option.value === "-o" || option.value === "-O"))
            offset += 1;
          else if (!(shell && /^-[a-zA-Z]+$/u.test(option.value))) {
            missing(source.path);
            inline = true;
            break;
          }
        }
        if (!inline && words[offset]) {
          include(words[offset], shell);
          if (name === "source" || name === ".") {
            missing(source.path);
            directory = null;
          }
        } else if (!inline && stdinWords) {
          // xargs supplies the script path from standard input.
          missing(source.path);
        }
      } else if (command.dynamic || command.value.includes("/")) {
        // An explicit path is executed directly; ordinary PATH tools aren't
        // presumed to be repository files.
        include(command, "direct");
      } else if (
        !NON_EXECUTING.has(name) &&
        words.slice(offset).some((word) => launches(directory, word))
      ) {
        // An unknown command handed a shell, an interpreter or an acquired
        // executable script may run it; it is not followed, so it is a gap.
        missing(source.path);
      }
    }
  }
  return { included, unacquired: [...unacquired].sort() };
}
