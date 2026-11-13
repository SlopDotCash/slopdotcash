import { posix } from "node:path";

type Word = { value: string; dynamic: boolean; quoted?: boolean };
type Input = { path: string; text: string | null };
type CommandSource = { path: string; text: string; directory: string };

/** Split literal shell command words, without evaluating quotes or expansions. */
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
      if (c === "(" || c === ")") unresolved = true;
      if (c === "&" || c === "|") branched = true;
      if (/[\n;|&()]/u.test(c)) endCommand();
      else endWord();
      continue;
    }
    word ??= { value: "", dynamic: false };
    if (!quote && ((c === "~" && word.value === "") || c === "{" || c === "}"))
      word.dynamic = true;
    if (quote !== "'" && (c === "$" || c === "`")) {
      word.dynamic = true;
      // A substitution is one dynamic word, never a nested literal command.
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
    const include = (word: Word, shell: boolean | "direct") => {
      const cwd = directory;
      const path = localPath(cwd, word);
      const file = path === null ? undefined : byPath.get(path);
      if (!file || file.text === null || cwd === null) {
        missing(source.path, word);
        return;
      }
      included.add(file.path);
      // The same shells as the pipe-to-shell rule, including ash, fish, csh and tcsh.
      const shellShebang = /^#![^\n]*\b(?:ba|da|k|a|z|fi|t?c)?sh(?:\s|$)/u.test(
        file.text,
      );
      const nonShell =
        !shellShebang &&
        (/^#![^\n]*\b(?:node|python[0-9.]*|ruby|perl|php)\b/u.test(file.text) ||
          /\.(?:[cm]?[jt]sx?|py|rb|pl|php)$/u.test(file.path));
      if (shell === true || (shell === "direct" && !nonShell))
        queue.push({ path: file.path, text: file.text, directory: cwd });
    };
    const parsed = commands(source.text);
    if (parsed.unresolved) missing(source.path);
    for (const words of parsed.commands) {
      let offset = 0;
      const first = words[0];
      if (
        first &&
        !first.quoted &&
        /^(?:if|elif|else|then|fi|for|while|until|do|done|case|esac|select|function|\{|\})$/u.test(
          first.value,
        )
      )
        missing(source.path);
      let wrapper = false;
      while (
        words[offset] &&
        ((!words[offset].quoted &&
          /^(?:then|do|else|!)$/u.test(words[offset].value)) ||
          /^(?:exec|command|[A-Za-z_][A-Za-z0-9_]*=.*)$/u.test(
            words[offset].value,
          ))
      ) {
        if (/^(?:exec|command)$/u.test(words[offset].value)) wrapper = true;
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
        while (words[offset]?.value.startsWith("-")) {
          const option = words[offset++].value;
          if (option === "--") break;
          if (option === "-i" || option === "--ignore-environment") continue;
          if (option === "-S" || option === "--split-string") {
            const body = words[offset];
            if (body && !body.dynamic && directory !== null)
              queue.push({ ...source, directory, text: body.value });
            else missing(source.path);
          } else missing(source.path);
          expanded = true;
          break;
        }
        if (expanded) continue;
        while (
          words[offset] &&
          /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[offset].value)
        )
          offset += 1;
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
        directory = words[offset]
          ? localPath(directory, words[offset], true)
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
        /^(?:(?:ba|da|k|a|z|fi|t?c)?sh|node(?:js)?|python[0-9.]*|ruby|perl|php|source|\.)$/u.test(
          name,
        )
      ) {
        const shell = /^(?:(?:ba|da|k|a|z|fi|t?c)?sh|source|\.)$/u.test(name);
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
        }
      } else if (command.dynamic || command.value.includes("/")) {
        // An explicit path is executed directly; ordinary PATH tools aren't
        // presumed to be repository files.
        include(command, "direct");
      }
    }
  }
  return { included, unacquired: [...unacquired].sort() };
}
