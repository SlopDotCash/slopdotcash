// The appeal command is documented as a comment the author writes. It may
// follow their explanation (#1930), so every reader matches it on its own line
// instead of only at the start of the whole comment.
const COMMAND_LINE = /^\/slopbot (?:appeal|dispute)(?:\s|$)/u;
const COMMAND_PREFIX = /^\/slopbot (?:appeal|dispute)(?=\s|$)/u;

/** The command line of a comment body, or null when there is none. */
export function appealCommandLine(
  body: string | null | undefined,
): string | null {
  for (const line of String(body ?? "").split("\n")) {
    const trimmed = line.trim();
    if (COMMAND_LINE.test(trimmed)) return trimmed;
  }
  return null;
}

/**
 * The appellant's text without the command, or null when the comment has no
 * command. An explanation above the command and text after it on the same line
 * are both kept.
 */
export function appealStatementText(
  body: string | null | undefined,
): string | null {
  let found = false;
  const kept: string[] = [];
  for (const line of String(body ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!found) {
      const match = trimmed.match(COMMAND_PREFIX);
      if (match !== null) {
        found = true;
        const rest = trimmed.slice(match[0].length).trim();
        if (rest !== "") kept.push(rest);
        continue;
      }
    }
    kept.push(line);
  }
  return found ? kept.join("\n").trim() : null;
}
